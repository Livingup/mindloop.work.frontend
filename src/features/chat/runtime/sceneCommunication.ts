/**
 * Scene 通信运行时（SSE + heartbeat + gap replay + re-attach）单一权威模块。
 *
 * 角色定位
 * - 每个 ChatPage instance 持有一个 manager，按 sceneId 隔离所有底层资源：
 *   SSE client、heartbeat 定时器、批处理 flush 定时器、retry 退避定时器、
 *   pending event buffer、gap replay buffer、cursor 等。
 * - 业务侧通过回调注入（appendEvents / requestReattach 等），
 *   manager 不直接依赖 chatStore / React。
 * - 单测面：只 mock 注入的回调 + sceneHeartbeat / createAgentCommunicationClient /
 *   listCommunicationMessages 即可覆盖核心状态机。
 *
 * 设计要点
 * - per-scene 隔离：每个 sceneId 独立的 SseClient / heartbeat interval / retry timer。
 * - generation 失效：heartbeat 用 generation 计数确保 stale 任务在 stop 后静默退出，
 *   避免向已停止 scene 写状态。
 * - gap replay：SSE seq 跳跃时 buffer 缺失之后的事件 → 拉 communication 日志补齐 →
 *   排序合并 → 继续 apply。
 * - SSE/replay 事件融合：apply 走单调递增 cursor 路径，replay 完毕后 drain buffer。
 * - 重试退避：heartbeat 首次 error 后 5s 快重试，连续 error 升级为 re-attach；
 *   re-attach 失败走 backoff 退避，scene 存活期间持续后台自动恢复。
 * - 内存安全：所有 setInterval / setTimeout / SseClient 都有显式 cleanup 路径，
 *   cleanupScene / cleanupAll 提供综合清理入口。
 */

import {
  createAgentCommunicationClient,
  sceneHeartbeat,
  SCENE_HEARTBEAT_INTERVAL_MS,
  type HeartbeatResult,
} from "@/features/chat/api/agentRuntimeApi"
import {
  CommunicationGapUnrecoverableError,
  listCommunicationMessagesWithMeta,
} from "@/features/chat/api/communicationApi"
import type { AgentEvent } from "@/features/chat/model/agentEvents"
import type { SceneRestoreReason } from "@/features/chat/model/chatStore"
import { chatTimelineDebug } from "@/features/chat/runtime/chatTimelineDebug"
import {
  hasRecentSseActivity,
  hasUsableSseTransport,
  type CommunicationHealthState,
} from "@/features/chat/runtime/communicationHealth"
import {
  BACKGROUND_EVENT_FLUSH_DELAY_MS,
  COMMUNICATION_GAP_REPLAY_LIMIT,
  COMMUNICATION_RECOVERY_LONG_RUNNING_NOTICE_MS,
  COMMUNICATION_RECOVERY_RETRY_BACKOFF_MS,
  FOREGROUND_EVENT_FLUSH_DELAY_MS,
  HEARTBEAT_ERROR_QUICK_RETRY_DELAY_MS,
  HEARTBEAT_ERROR_REATTACH_THRESHOLD,
  HEARTBEAT_MIN_INTERVAL_MS,
  MAX_PENDING_EVENTS_PER_SCENE,
} from "@/features/chat/runtime/runtimeConfig"
import type { SseActivity, SseClient } from "@/shared/api/sseClient"

type SpreadDesktopBridge = {
  appendLlmStreamLog?: (line: string) => Promise<unknown>
}

const FRONTEND_LLM_STREAM_LOG_EVENT_TYPES = new Set([
  "llm.request.started",
  "llm.request.failed",
  "llm.call.failed",
  "llm.response.started",
  "llm.response.completed",
  "llm.thinking.started",
  "llm.thinking.delta",
  "llm.thinking.completed",
  "llm.content.started",
  "llm.content.delta",
  "llm.content.completed",
  "llm.tool_call.started",
  "llm.tool_call.arguments.delta",
  "llm.tool_call.completed",
])

/**
 * Manager 与外界交互的依赖注入回调集合。
 * 所有 chatStore / mutation / React state / 持久化队列 的访问都通过回调发起，
 * 让 sceneCommunication 自身保持纯逻辑 + 可单测。
 */
export type SceneCommunicationCallbacks = {
  /** flush 时把批量事件喂给 chatStore（appendEvents）。 */
  appendEvents: (sceneId: string, events: AgentEvent[]) => void
  /** 需要 re-attach 时调用：heartbeat expired / quick retry escalation / stale watchdog / replay failure。 */
  requestReattach: (sceneId: string, reason: Exclude<SceneRestoreReason, null>) => void
  /** 更新通信健康 FSM 状态。 */
  updateCommunicationHealth: (
    sceneId: string,
    updater: (current: CommunicationHealthState) => CommunicationHealthState,
  ) => void
  /** 读取当前通信健康状态（heartbeat error 计数、watchdog 判定等用）。 */
  getCommunicationHealth: (sceneId: string) => CommunicationHealthState
  /** SSE gap / heartbeat expired / replay 失败时标脏 scene。 */
  markSceneDirty: (sceneId: string, dirty: boolean) => void
  /** replay 时取 streamId（来自 chatStore 的 scene.streamId）。 */
  getSceneStreamId: (sceneId: string) => string | null
  /** 检查 scene 是否仍存在（timer 自检防止向已销毁 scene 写状态）。 */
  isSceneAlive: (sceneId: string) => boolean
  /** 当前 lifecycle 是否后台（影响 SSE event flush 节拍）。 */
  isLifecycleBackground: () => boolean
  /** 拉取通信消息（gap replay 用）。 */
  fetchCommunicationGap: (
    streamId: string,
    options: { after_seq: number; limit: number },
  ) => Promise<AgentEvent[]>
  /** stale watchdog 判定函数（由 communicationHealth.shouldRecoverStaleHeartbeat 注入）。 */
  detectStaleScene: (state: CommunicationHealthState, nowMs: number) => boolean
  /** 调试日志钩子。 */
  chatDebug: (label: string, payload?: unknown) => void
  /** 后端通讯代数重置（boot_id 变更等）时的回调，用于通知 Coordinator 同步 transport 代数。 */
  onGenerationReset?: (sceneId: string, generation: { bootId?: string | null }) => void
}

/**
 * 暴露给 ChatPage 的方法集合。
 *
 * 接口分组：
 * - SSE Lifecycle：connectEventStream / closeEventClient / closeAllEventClients / hasEventClient
 * - Heartbeat Lifecycle：startHeartbeat / stopHeartbeat / stopAllHeartbeats / hasHeartbeat /
 *   forceHeartbeat / forceAllHeartbeats / recordHeartbeatResult
 * - Stale Watchdog：detectStaleAndRecover
 * - Pending Events：clearPendingEvents / clearAllPendingEvents / flushPendingEvents
 * - Recovery Retry：scheduleRecoveryRetry / clearRecoveryRetry / clearAllRecoveryRetries /
 *   resetReattachAttempt
 * - Reattaching Lock：markReattaching / unmarkReattaching / isReattaching
 * - Quick Retry：clearHeartbeatQuickRetry / clearAllHeartbeatQuickRetries
 * - Scene Workspace：setSceneWorkspace / getSceneWorkspace / deleteSceneWorkspace / clearAllSceneWorkspaces
 * - Cursor：getCursor / setCursor / mergeCursor / clearCursor / clearAllCursors
 */
export type SceneCommunicationManager = {
  // === SSE Lifecycle ===
  connectEventStream: (sceneId: string, eventStreamUrl: string) => void
  closeEventClient: (sceneId: string) => void
  closeAllEventClients: () => void
  hasEventClient: (sceneId: string) => boolean

  // === Heartbeat Lifecycle ===
  startHeartbeat: (sceneId: string, workspacePath: string | null, clientSessionId?: string | null) => void
  getClientSessionId: (sceneId: string) => string | null
  stopHeartbeat: (sceneId: string) => void
  stopAllHeartbeats: () => void
  hasHeartbeat: (sceneId: string) => boolean
  forceHeartbeat: (sceneId: string, options?: { force?: boolean }) => void
  forceAllHeartbeats: (options?: { force?: boolean }) => void
  recordHeartbeatResult: (sceneId: string, result: HeartbeatResult) => void

  // === Stale Watchdog ===
  detectStaleAndRecover: () => void

  // === Pending Events ===
  clearPendingEvents: (sceneId: string) => void
  clearAllPendingEvents: () => void
  flushPendingEvents: (sceneId: string) => void

  // === Recovery Retry ===
  scheduleRecoveryRetry: (sceneId: string) => void
  clearRecoveryRetry: (sceneId: string) => void
  clearAllRecoveryRetries: () => void
  resetReattachAttempt: (sceneId: string) => void

  // === Reattaching Lock ===
  /** 尝试标记 reattaching；如果已被标记则返回 false，可被调用方用于"防并发"判定。 */
  markReattaching: (sceneId: string) => boolean
  unmarkReattaching: (sceneId: string) => void
  unmarkAllReattaching: () => void
  isReattaching: (sceneId: string) => boolean

  // === Quick Retry ===
  clearHeartbeatQuickRetry: (sceneId: string) => void
  clearAllHeartbeatQuickRetries: () => void

  // === Scene Workspace ===
  setSceneWorkspace: (sceneId: string, workspacePath: string) => void
  getSceneWorkspace: (sceneId: string) => string | null
  deleteSceneWorkspace: (sceneId: string) => void
  clearAllSceneWorkspaces: () => void

  // === Cursor ===
  getCursor: (sceneId: string) => number
  setCursor: (sceneId: string, seq: number) => void
  /** 合并 cursor（max(previous, seq)），attach 成功后用于合并 hydrated 和实时 cursor。 */
  mergeCursor: (sceneId: string, seq: number) => void
  clearCursor: (sceneId: string) => void
  clearAllCursors: () => void
}

/**
 * 创建一个 scene 通信运行时 manager 实例。
 *
 * 整体生命周期管理：
 * - 每个 ChatPage instance 创建一个 manager（通过 useSceneCommunication hook）。
 * - 组件 unmount 时调用方必须显式调用所有 cleanup 方法，避免 SSE / timer 泄漏：
 *   closeAllEventClients() + stopAllHeartbeats() + clearAllPendingEvents() +
 *   clearAllRecoveryRetries() + clearAllHeartbeatQuickRetries()。
 */
export function createSceneCommunicationManager(
  callbacks: SceneCommunicationCallbacks,
): SceneCommunicationManager {
  // === SSE 资源 ===
  const eventClients = new Map<string, SseClient<AgentEvent>>()
  const eventClientUrls = new Map<string, string>()
  const eventClientStates = new Map<string, "connecting" | "open" | "failed">()

  // === Heartbeat 资源 ===
  const heartbeatIntervals = new Map<string, ReturnType<typeof setInterval>>()
  const heartbeatInFlight = new Set<string>()
  const heartbeatGenerations = new Map<string, number>()
  const lastHeartbeatAttemptAt = new Map<string, number>()

  // === Pending events 资源 ===
  const pendingEventsByScene = new Map<string, AgentEvent[]>()
  const eventFlushTimers = new Map<string, ReturnType<typeof setTimeout>>()

  // === Buffer / replay 资源 ===
  const communicationSeqCursor = new Map<string, number>()
  const communicationBootId = new Map<string, string>()
  const bufferedCommunicationEvents = new Map<string, Map<number, AgentEvent>>()
  const replayingScenes = new Set<string>()
  const generationResetInFlight = new Set<string>()

  // === Recovery 资源 ===
  const isReattachingScenes = new Set<string>()
  const recoveryRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const reattachAttempts = new Map<string, { attempt: number; startedAt: number }>()
  const heartbeatErrorQuickRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const llmStreamEventCounts = new Map<string, number>()

  // === Scene metadata 资源 ===
  const sceneWorkspace = new Map<string, string>()
  const sceneClientSessions = new Map<string, string>()

  function settleRecoveredCommunication(sceneId: string, options: { markClean?: boolean } = {}): void {
    clearRecoveryRetry(sceneId)
    clearHeartbeatQuickRetry(sceneId)
    resetReattachAttempt(sceneId)
    unmarkReattaching(sceneId)
    if (options.markClean) callbacks.markSceneDirty(sceneId, false)
  }

  function idleRestoreStatus(current: CommunicationHealthState): CommunicationHealthState["restoreStatus"] {
    return current.restoreStatus === "failed" ? "failed" : "idle"
  }

  function hasSseTransportProof(current: CommunicationHealthState, nowMs: number = Date.now()): boolean {
    return hasUsableSseTransport(current) || hasRecentSseActivity(current, nowMs)
  }

  function keepUsableSseStatus(current: CommunicationHealthState, fallback: CommunicationHealthState["sseStatus"]): CommunicationHealthState["sseStatus"] {
    return hasSseTransportProof(current) ? "connected" : fallback
  }

  function recordSseActivity(sceneId: string, activity: SseActivity): void {
    if (activity.kind === "ping") {
      const bootId = runtimeBootIdFromActivityData(activity.data)
      if (bootId) {
        const previousBootId = communicationBootId.get(sceneId)
        if (previousBootId && previousBootId !== bootId) {
          void handleBackendGenerationReset(sceneId, "boot_id_mismatch", { bootId })
        } else if (!previousBootId) {
          communicationBootId.set(sceneId, bootId)
        }
      }
    }
    callbacks.updateCommunicationHealth(sceneId, (current) => {
      const isError = activity.kind === "error"
      const nextState: CommunicationHealthState = {
        ...current,
        sseStatus: isError ? current.sseStatus : "connected",
        sseErrorCount: isError ? current.sseErrorCount + 1 : 0,
      }
      if (!isError) {
        nextState.lastSseActivityAt = activity.at
      }
      if (activity.kind === "message") {
        nextState.lastSseMessageAt = activity.at
      }
      if (isError) {
        nextState.lastSseErrorAt = activity.at
        nextState.lastErrorAt = activity.at
      }
      return nextState
    })
  }

  function runtimeBootIdFromActivityData(data: unknown): string | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) return null
    const bootId = (data as Record<string, unknown>).runtime_boot_id
    return typeof bootId === "string" && bootId.trim() ? bootId.trim() : null
  }

  async function handleBackendGenerationReset(
    sceneId: string,
    reason: "boot_id_mismatch" | "cursor_ahead_of_ring" | "communication_gap_unrecoverable",
    options: { bootId?: string | null; lastSeq?: number } = {},
  ): Promise<void> {
    if (generationResetInFlight.has(sceneId)) return
    generationResetInFlight.add(sceneId)
    try {
      const streamId = callbacks.getSceneStreamId(sceneId)
      let lastSeq = options.lastSeq
      let bootId = options.bootId ?? communicationBootId.get(sceneId) ?? null
      if (streamId && (lastSeq === undefined || !bootId)) {
        try {
          const latest = await listCommunicationMessagesWithMeta(streamId, { latest: true, limit: 1 })
          lastSeq = latest.messages[0]?.seq ?? 0
          bootId = latest.runtimeBootId ?? bootId
        } catch (error) {
          callbacks.chatDebug("generation reset latest fetch failed", { sceneId, reason, error })
          lastSeq = lastSeq ?? 0
        }
      }
      const nextSeq = typeof lastSeq === "number" && Number.isFinite(lastSeq) ? Math.max(0, lastSeq) : 0
      communicationSeqCursor.set(sceneId, nextSeq)
      if (bootId) communicationBootId.set(sceneId, bootId)
      callbacks.onGenerationReset?.(sceneId, { bootId: bootId ?? null })
      bufferedCommunicationEvents.delete(sceneId)
      replayingScenes.delete(sceneId)
      callbacks.markSceneDirty(sceneId, true)
      callbacks.updateCommunicationHealth(sceneId, (current) => ({
        ...current,
        sseStatus: keepUsableSseStatus(current, "stale"),
        restoreStatus: current.restoreStatus === "reattaching" ? current.restoreStatus : "idle",
        lastErrorAt: new Date().toISOString(),
        errorMessage:
          reason === "boot_id_mismatch"
            ? "后端通信进程已重启，正在从业务快照恢复并接入实时流。"
            : reason === "cursor_ahead_of_ring"
              ? "通信游标已失效，正在从业务快照恢复并接入实时流。"
              : "SSE 实时事件缺口不可恢复，正在从业务快照恢复。",
      }))
      callbacks.chatDebug("communication generation reset", { sceneId, reason, nextSeq, bootId })
      // 禁止对旧 cursor 做 gap replay：直接走 reattach / ChatBubble hydrate 路径。
      callbacks.requestReattach(sceneId, "sse_gap")
    } finally {
      generationResetInFlight.delete(sceneId)
    }
  }

  async function validateCommunicationCursorOnOpen(sceneId: string): Promise<void> {
    const streamId = callbacks.getSceneStreamId(sceneId)
    if (!streamId || !callbacks.isSceneAlive(sceneId)) return
    try {
      const latest = await listCommunicationMessagesWithMeta(streamId, { latest: true, limit: 1 })
      const lastSeq = latest.messages[0]?.seq ?? 0
      const bootId = latest.runtimeBootId
      const previousBootId = communicationBootId.get(sceneId)
      if (previousBootId && bootId && previousBootId !== bootId) {
        await handleBackendGenerationReset(sceneId, "boot_id_mismatch", { bootId, lastSeq })
        return
      }
      if (bootId) communicationBootId.set(sceneId, bootId)
      const cursor = communicationSeqCursor.get(sceneId) ?? 0
      if (cursor > lastSeq) {
        await handleBackendGenerationReset(sceneId, "cursor_ahead_of_ring", { bootId, lastSeq })
      }
    } catch (error) {
      if (error instanceof CommunicationGapUnrecoverableError) {
        await handleBackendGenerationReset(sceneId, "communication_gap_unrecoverable", {
          lastSeq: error.ringLastSeq,
        })
        return
      }
      callbacks.chatDebug("validate communication cursor failed", { sceneId, error })
    }
  }

  // -------------------------------------------------------------------
  // SSE Lifecycle
  // -------------------------------------------------------------------

  function connectEventStream(sceneId: string, eventStreamUrl: string): void {
    chatTimelineDebug("sse.connect_start", { sceneId, afterSeq: communicationSeqCursor.get(sceneId) ?? 0 })
    const existing = eventClients.get(sceneId)
    const existingUrl = eventClientUrls.get(sceneId)
    const existingState = eventClientStates.get(sceneId)
    if (existing && existingUrl === eventStreamUrl && (existingState === "connecting" || existingState === "open")) return
    if (existing) existing.close()
    eventClients.delete(sceneId)
    eventClientUrls.delete(sceneId)
    eventClientStates.delete(sceneId)
    callbacks.updateCommunicationHealth(sceneId, (current) => ({
      ...current,
      sseStatus: keepUsableSseStatus(current, "connecting"),
      backendStatus: current.backendStatus === "unhealthy" ? "unknown" : current.backendStatus,
      sseErrorCount: 0,
      errorMessage: current.restoreStatus === "failed" ? current.errorMessage : undefined,
    }))
    let client: SseClient<AgentEvent>
    client = createAgentCommunicationClient(
      eventStreamUrl,
      (event) => {
        if (eventClients.get(sceneId) !== client) return
        const previousSeq = communicationSeqCursor.get(sceneId) ?? 0
        const hasSeqGap = previousSeq > 0 && event.seq > previousSeq + 1
        if (!hasSeqGap) settleRecoveredCommunication(sceneId, { markClean: true })
        callbacks.updateCommunicationHealth(sceneId, (current) => ({
          ...current,
          backendStatus: "ok",
          sseStatus: "connected",
          restoreStatus: hasSeqGap ? current.restoreStatus : idleRestoreStatus(current),
          lastEventAt: event.created_at,
          reconnectAttempt: hasSeqGap ? current.reconnectAttempt + 1 : 0,
          errorMessage: hasSeqGap
            ? "SSE 实时事件流检测到缺失消息，正在从 communication 日志补齐。"
            : current.restoreStatus === "failed"
              ? current.errorMessage
              : undefined,
        }))
        if (!event.type.startsWith("llm.")) {
          callbacks.chatDebug("sse event", {
            sceneId,
            seq: event.seq,
            type: event.type,
            previousSeq,
            hasSeqGap,
          })
        }
        chatTimelineDebug("sse.event", { sceneId, seq: event.seq, eventType: event.type, streamId: event.stream_id ?? "", previousSeq, hasSeqGap })
        handleCommunicationEvent(sceneId, event)
      },
      {
        getAfterSeq: () => communicationSeqCursor.get(sceneId) ?? 0,
        onOpen: () => {
          if (eventClients.get(sceneId) !== client) return
          eventClientStates.set(sceneId, "open")
          chatTimelineDebug("sse.open", { sceneId, afterSeq: communicationSeqCursor.get(sceneId) ?? 0 })
          settleRecoveredCommunication(sceneId, { markClean: true })
          callbacks.updateCommunicationHealth(sceneId, (current) => ({
            ...current,
            backendStatus: "ok",
            sseStatus: "connected",
            restoreStatus: idleRestoreStatus(current),
            reconnectAttempt: 0,
            sseErrorCount: 0,
            errorMessage: current.restoreStatus === "failed" ? current.errorMessage : undefined,
          }))
          // 连接成功后校验 runtime_boot_id / cursor，避免后端重启后旧 cursor 假 gap 死等。
          void validateCommunicationCursorOnOpen(sceneId)
          // SSE 重连成功后立即发一次 force heartbeat 验证后端 session 是否有效。
          // 场景：SSE 重接连成功不等于 session 仍在（后端可能重启、连接是新进程上的，session 在新进程
          // 里从未创建）。不等 SCENE_HEARTBEAT_INTERVAL_MS 节拍，立刻跟一次 heartbeat 探测。
          if (heartbeatIntervals.has(sceneId)) {
            void sendSceneHeartbeat(sceneId, { force: true })
          }
        },
        onError: () => {
          if (eventClients.get(sceneId) !== client) return
          eventClientStates.set(sceneId, "failed")
          chatTimelineDebug("sse.error", { sceneId, afterSeq: communicationSeqCursor.get(sceneId) ?? 0 })
          callbacks.updateCommunicationHealth(sceneId, (current) => ({
            ...current,
            sseStatus: keepUsableSseStatus(current, "reconnecting"),
            reconnectAttempt: current.reconnectAttempt + 1,
            errorMessage: "前后端实时事件流连接异常，正在重连。",
          }))
        },
        onActivity: (activity) => {
          if (eventClients.get(sceneId) !== client) return
          if (activity.kind !== "error") eventClientStates.set(sceneId, "open")
          recordSseActivity(sceneId, activity)
        },
      },
    )
    eventClients.set(sceneId, client)
    eventClientUrls.set(sceneId, eventStreamUrl)
    eventClientStates.set(sceneId, "connecting")
    client.connect()
  }

  function closeEventClient(sceneId: string): void {
    const client = eventClients.get(sceneId)
    if (!client) return
    client.close()
    eventClients.delete(sceneId)
    eventClientUrls.delete(sceneId)
    eventClientStates.delete(sceneId)
  }

  function closeAllEventClients(): void {
    for (const client of eventClients.values()) client.close()
    eventClients.clear()
    eventClientUrls.clear()
    eventClientStates.clear()
  }

  function hasEventClient(sceneId: string): boolean {
    return eventClients.has(sceneId)
  }

  // -------------------------------------------------------------------
  // Pending events / batching
  // -------------------------------------------------------------------

  function clearPendingEvents(sceneId: string): void {
    const timer = eventFlushTimers.get(sceneId)
    if (timer) clearTimeout(timer)
    eventFlushTimers.delete(sceneId)
    pendingEventsByScene.delete(sceneId)
    bufferedCommunicationEvents.delete(sceneId)
    replayingScenes.delete(sceneId)
    generationResetInFlight.delete(sceneId)
    clearLlmStreamEventCounts(sceneId)
  }

  function clearAllPendingEvents(): void {
    for (const timer of eventFlushTimers.values()) clearTimeout(timer)
    eventFlushTimers.clear()
    pendingEventsByScene.clear()
    bufferedCommunicationEvents.clear()
    replayingScenes.clear()
    generationResetInFlight.clear()
    llmStreamEventCounts.clear()
  }

  function flushPendingEvents(sceneId: string): void {
    const timer = eventFlushTimers.get(sceneId)
    if (timer) clearTimeout(timer)
    eventFlushTimers.delete(sceneId)

    const events = pendingEventsByScene.get(sceneId)
    if (!events || events.length === 0) return
    pendingEventsByScene.delete(sceneId)
    callbacks.chatDebug("flush pending events", { sceneId, count: events.length })
    callbacks.appendEvents(sceneId, events)
  }

  function schedulePendingEventFlush(sceneId: string): void {
    if (eventFlushTimers.has(sceneId)) return
    const delay = callbacks.isLifecycleBackground()
      ? BACKGROUND_EVENT_FLUSH_DELAY_MS
      : FOREGROUND_EVENT_FLUSH_DELAY_MS
    const timer = setTimeout(() => flushPendingEvents(sceneId), delay)
    eventFlushTimers.set(sceneId, timer)
  }

  function enqueueAgentEvent(sceneId: string, event: AgentEvent): void {
    const existingEvents = pendingEventsByScene.get(sceneId) ?? []
    existingEvents.push(event)
    pendingEventsByScene.set(sceneId, existingEvents)
    if (existingEvents.length >= MAX_PENDING_EVENTS_PER_SCENE) {
      flushPendingEvents(sceneId)
      return
    }
    schedulePendingEventFlush(sceneId)
  }

  function logLlmStreamEvent(sceneId: string, event: AgentEvent): void {
    if (!FRONTEND_LLM_STREAM_LOG_EVENT_TYPES.has(event.type)) return
    const payload = event.payload && typeof event.payload === "object" && !Array.isArray(event.payload)
      ? event.payload as Record<string, unknown>
      : undefined
    const llmRequestId = textLogValue(payload?.llm_request_id)
    const llmCallId = textLogValue(payload?.llm_call_id)
    const llmLogId = llmRequestId ?? (llmCallId ? `call:${llmCallId}` : event.stream_id)
    const streamKey = `${sceneId}:${String(llmLogId)}`
    const eventIndex = (llmStreamEventCounts.get(streamKey) ?? 0) + 1
    llmStreamEventCounts.set(streamKey, eventIndex)
    const line = `[chat][llm-stream] llm_request_id=${llmRequestId ?? llmLogId} ${String(eventIndex).padStart(3, "0")} ${event.type} - ${llmStreamEventDescription(event.type, payload)}`
    console.debug(line)
    appendLlmStreamLogToTempFile(line)
    if (
      event.type === "llm.response.completed" ||
      event.type === "llm.request.failed" ||
      event.type === "llm.call.failed"
    ) {
      llmStreamEventCounts.delete(streamKey)
    }
  }

  function clearLlmStreamEventCounts(sceneId: string): void {
    const sceneKeyPrefix = `${sceneId}:`
    for (const key of Array.from(llmStreamEventCounts.keys())) {
      if (key.startsWith(sceneKeyPrefix)) llmStreamEventCounts.delete(key)
    }
  }

  function textLogValue(value: unknown): string | null {
    if (typeof value !== "string") return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  function llmStreamEventDescription(eventType: string, payload?: Record<string, unknown>): string {
    switch (eventType) {
      case "llm.request.started":
        return "LLM 请求尝试开始"
      case "llm.request.failed":
        return payload?.will_retry === true ? "LLM 请求尝试失败，准备重试" : "LLM 请求尝试失败"
      case "llm.call.failed":
        return "LLM 调用最终失败"
      case "llm.response.started":
        return "LLM 响应开始"
      case "llm.response.completed":
        return "LLM 响应完成"
      case "llm.thinking.started":
        return "模型思考开始"
      case "llm.thinking.delta":
        return "模型思考增量"
      case "llm.thinking.completed":
        return "模型思考完成"
      case "llm.content.started":
        return "模型正文输出开始"
      case "llm.content.delta":
        return "模型正文增量"
      case "llm.content.completed":
        return "模型正文输出完成"
      case "llm.tool_call.started":
        return "模型工具调用生成开始"
      case "llm.tool_call.arguments.delta":
        return "模型工具参数增量"
      case "llm.tool_call.completed":
        return "模型工具调用生成完成"
      default:
        return "LLM 事件"
    }
  }

  function appendLlmStreamLogToTempFile(line: string): void {
    if (typeof window === "undefined") return
    const bridge = (window as Window & { spreadDesktop?: SpreadDesktopBridge }).spreadDesktop
    if (!bridge?.appendLlmStreamLog) return
    void bridge.appendLlmStreamLog(line).catch((error) => {
      console.warn("[chat][llm-stream] write temp log failed:", error)
    })
  }

  // -------------------------------------------------------------------
  // SSE / replay event 融合
  // -------------------------------------------------------------------

  function isTerminalEvent(event: AgentEvent): boolean {
    return event.type.startsWith("terminal.")
  }

  function applyCommunicationEvent(sceneId: string, event: AgentEvent): void {
    const lastAppliedSeq = communicationSeqCursor.get(sceneId) ?? 0
    if (event.seq <= lastAppliedSeq) return
    logLlmStreamEvent(sceneId, event)
    // 同 SSE：terminal 走 terminal applicator（只入 store terminalSessions）；
    // main 事件统一由 Coordinator 在 canonical append 后完成 UI 投影与持久化。
    enqueueAgentEvent(sceneId, event)
    communicationSeqCursor.set(sceneId, event.seq)
  }

  function bufferCommunicationEvent(sceneId: string, event: AgentEvent): void {
    const lastAppliedSeq = communicationSeqCursor.get(sceneId) ?? 0
    if (event.seq <= lastAppliedSeq) return
    const buffered = bufferedCommunicationEvents.get(sceneId) ?? new Map<number, AgentEvent>()
    buffered.set(event.seq, event)
    bufferedCommunicationEvents.set(sceneId, buffered)
  }

  function drainBufferedCommunicationEvents(sceneId: string): void {
    const buffered = bufferedCommunicationEvents.get(sceneId)
    if (!buffered || buffered.size === 0) return
    let lastAppliedSeq = communicationSeqCursor.get(sceneId) ?? 0
    for (const seq of Array.from(buffered.keys())) {
      if (seq <= lastAppliedSeq) buffered.delete(seq)
    }
    while (buffered.has(lastAppliedSeq + 1)) {
      const next = buffered.get(lastAppliedSeq + 1)!
      buffered.delete(lastAppliedSeq + 1)
      applyCommunicationEvent(sceneId, next)
      lastAppliedSeq = communicationSeqCursor.get(sceneId) ?? lastAppliedSeq
    }
    if (buffered.size === 0) {
      bufferedCommunicationEvents.delete(sceneId)
    }
  }

  function handleCommunicationEvent(sceneId: string, event: AgentEvent): void {
    const lastAppliedSeq = communicationSeqCursor.get(sceneId) ?? 0
    if (event.seq <= lastAppliedSeq) return
    if (replayingScenes.has(sceneId)) {
      bufferCommunicationEvent(sceneId, event)
      return
    }
    if (lastAppliedSeq > 0 && event.seq > lastAppliedSeq + 1) {
      bufferCommunicationEvent(sceneId, event)
      void replayCommunicationGap(sceneId, lastAppliedSeq)
      return
    }
    applyCommunicationEvent(sceneId, event)
    drainBufferedCommunicationEvents(sceneId)
  }

  async function replayCommunicationGap(sceneId: string, afterSeq: number): Promise<void> {
    if (replayingScenes.has(sceneId)) return
    const streamId = callbacks.getSceneStreamId(sceneId)
    if (!streamId) {
      callbacks.markSceneDirty(sceneId, true)
      callbacks.requestReattach(sceneId, "sse_gap")
      return
    }
    replayingScenes.add(sceneId)
    callbacks.updateCommunicationHealth(sceneId, (current) => ({
      ...current,
      sseStatus: keepUsableSseStatus(current, "reconnecting"),
      reconnectAttempt: current.reconnectAttempt + 1,
      lastErrorAt: new Date().toISOString(),
      errorMessage: "SSE 实时事件流检测到缺失消息，正在从 communication 日志补齐。",
    }))
    try {
      const replayEvents = await callbacks.fetchCommunicationGap(streamId, {
        after_seq: afterSeq,
        limit: COMMUNICATION_GAP_REPLAY_LIMIT,
      })
      const orderedEvents = replayEvents
        .filter((event) => event.seq > (communicationSeqCursor.get(sceneId) ?? afterSeq))
        .sort((left, right) => left.seq - right.seq)
      for (const replayEvent of orderedEvents) {
        const lastAppliedSeq = communicationSeqCursor.get(sceneId) ?? afterSeq
        if (replayEvent.seq <= lastAppliedSeq) continue
        if (replayEvent.seq !== lastAppliedSeq + 1) {
          throw new Error(`communication replay gap remains: expected ${lastAppliedSeq + 1}, got ${replayEvent.seq}`)
        }
        applyCommunicationEvent(sceneId, replayEvent)
      }
      drainBufferedCommunicationEvents(sceneId)
      const buffered = bufferedCommunicationEvents.get(sceneId)
      if (buffered && buffered.size > 0) {
        const lastAppliedSeq = communicationSeqCursor.get(sceneId) ?? afterSeq
        const nextBufferedSeq = Math.min(...buffered.keys())
        if (nextBufferedSeq > lastAppliedSeq + 1) {
          throw new Error(`communication replay incomplete: expected ${lastAppliedSeq + 1}, buffered ${nextBufferedSeq}`)
        }
      }
      settleRecoveredCommunication(sceneId, { markClean: true })
      callbacks.updateCommunicationHealth(sceneId, (current) => ({
        ...current,
        backendStatus: "ok",
        sseStatus: "connected",
        restoreStatus: idleRestoreStatus(current),
        sseErrorCount: 0,
        errorMessage: current.restoreStatus === "failed" ? current.errorMessage : undefined,
      }))
    } catch (error) {
      console.warn("[chat] communication gap replay failed:", error)
      if (error instanceof CommunicationGapUnrecoverableError) {
        await handleBackendGenerationReset(sceneId, "communication_gap_unrecoverable", {
          lastSeq: error.ringLastSeq,
        })
        return
      }
      callbacks.markSceneDirty(sceneId, true)
      callbacks.updateCommunicationHealth(sceneId, (current) => ({
        ...current,
        sseStatus: keepUsableSseStatus(current, "stale"),
        lastErrorAt: new Date().toISOString(),
        errorMessage: "SSE 实时事件流缺失消息无法自动补齐，正在重新连接 Scene。",
      }))
      callbacks.requestReattach(sceneId, "sse_gap")
    } finally {
      replayingScenes.delete(sceneId)
    }
  }

  // -------------------------------------------------------------------
  // Heartbeat
  // -------------------------------------------------------------------

  async function sendSceneHeartbeat(
    sceneId: string,
    options: { force?: boolean; generation?: number } = {},
  ): Promise<void> {
    const currentGeneration = heartbeatGenerations.get(sceneId) ?? 0
    const generation = options.generation ?? currentGeneration
    if (generation !== currentGeneration) return
    const now = Date.now()
    const lastAttemptAt = lastHeartbeatAttemptAt.get(sceneId) ?? 0
    if (!options.force && now - lastAttemptAt < HEARTBEAT_MIN_INTERVAL_MS) return
    if (heartbeatInFlight.has(sceneId)) return
    heartbeatInFlight.add(sceneId)
    lastHeartbeatAttemptAt.set(sceneId, now)
    try {
      const result: HeartbeatResult = await sceneHeartbeat(sceneId, sceneClientSessions.get(sceneId) ?? null)
      if ((heartbeatGenerations.get(sceneId) ?? 0) !== generation) return
      recordHeartbeatResult(sceneId, result)
      if (result === "expired") {
        callbacks.requestReattach(sceneId, "heartbeat_expired")
      }
    } finally {
      heartbeatInFlight.delete(sceneId)
      if (!heartbeatIntervals.has(sceneId)) {
        lastHeartbeatAttemptAt.delete(sceneId)
        heartbeatGenerations.delete(sceneId)
      }
    }
  }

  /**
   * 处理 heartbeat 探测结果。三分支：
   * - ok：重置连续错误计数 + 清除快重试定时器；必要时只修复历史 stale 投影。
   * - expired (404)：后端认为 session 已过期，sendSceneHeartbeat 内部会触发 requestReattach。
   * - error：递增连续错误计数并做有限快重试；heartbeat 失败只表示 presence/control-plane 异常，
   *   不能反向证明 SSE transport 断链，也不能因为连续 timeout 自动触发 re-attach。
   */
  function recordHeartbeatResult(sceneId: string, result: HeartbeatResult): void {
    const now = new Date().toISOString()
    if (result === "ok") {
      const before = callbacks.getCommunicationHealth(sceneId)
      clearHeartbeatQuickRetry(sceneId)
      if (before.restoreStatus !== "reattaching") resetReattachAttempt(sceneId)
      if (before.sseStatus !== "stale") callbacks.markSceneDirty(sceneId, false)
      callbacks.updateCommunicationHealth(sceneId, (current) => ({
        ...current,
        backendStatus: "ok",
        heartbeatStatus: "ok",
        lastHeartbeatAt: now,
        consecutiveHeartbeatErrors: 0,
        errorMessage: current.restoreStatus === "failed" ? current.errorMessage : undefined,
      }))
      return
    }
    if (result === "expired") {
      clearHeartbeatQuickRetry(sceneId)
      callbacks.updateCommunicationHealth(sceneId, (current) => ({
        ...current,
        sseStatus: keepUsableSseStatus(current, "stale"),
        heartbeatStatus: "expired",
        lastErrorAt: now,
        consecutiveHeartbeatErrors: 0,
        errorMessage: "Scene presence 已过期，正在重新 attach；实时事件流若仍活跃则不会被标记为断链。",
      }))
      return
    }
    // result === "error"
    const previousErrors = callbacks.getCommunicationHealth(sceneId).consecutiveHeartbeatErrors ?? 0
    const consecutive = previousErrors + 1
    const reachedRetryThreshold = consecutive >= HEARTBEAT_ERROR_REATTACH_THRESHOLD
    callbacks.updateCommunicationHealth(sceneId, (current) => ({
      ...current,
      heartbeatStatus: "error",
      lastErrorAt: now,
      consecutiveHeartbeatErrors: consecutive,
      errorMessage: reachedRetryThreshold
        ? "HTTP heartbeat 连续失败，Scene presence 保活暂时降级；实时 SSE 事件流若仍活跃则 Agent 执行与事件接收不受影响。"
        : "前后端 heartbeat 保活异常，正在自动重试。",
    }))
    if (reachedRetryThreshold) {
      clearHeartbeatQuickRetry(sceneId)
    } else {
      scheduleHeartbeatQuickRetry(sceneId)
    }
  }

  function startHeartbeat(sceneId: string, workspacePath: string | null, clientSessionId?: string | null): void {
    stopHeartbeat(sceneId)
    if (clientSessionId) sceneClientSessions.set(sceneId, clientSessionId)
    isReattachingScenes.delete(sceneId)
    clearRecoveryRetry(sceneId)
    const generation = (heartbeatGenerations.get(sceneId) ?? 0) + 1
    heartbeatGenerations.set(sceneId, generation)
    lastHeartbeatAttemptAt.delete(sceneId)
    const tick = () => void sendSceneHeartbeat(sceneId, { generation })
    void sendSceneHeartbeat(sceneId, { force: true, generation })
    const intervalId = setInterval(tick, SCENE_HEARTBEAT_INTERVAL_MS)
    heartbeatIntervals.set(sceneId, intervalId)
    if (workspacePath) {
      sceneWorkspace.set(sceneId, workspacePath)
    }
  }

  function getClientSessionId(sceneId: string): string | null {
    return sceneClientSessions.get(sceneId) ?? null
  }

  function stopHeartbeat(sceneId: string): void {
    const existing = heartbeatIntervals.get(sceneId)
    if (existing) {
      clearInterval(existing)
      heartbeatIntervals.delete(sceneId)
    }
    // 心跳停止同时需清除快重试 timer，避免它在 scene 关闭后反复打 force heartbeat。
    clearHeartbeatQuickRetry(sceneId)
    heartbeatGenerations.set(sceneId, (heartbeatGenerations.get(sceneId) ?? 0) + 1)
    lastHeartbeatAttemptAt.delete(sceneId)
    if (!heartbeatInFlight.has(sceneId)) {
      heartbeatGenerations.delete(sceneId)
    }
    sceneClientSessions.delete(sceneId)
  }

  function stopAllHeartbeats(): void {
    for (const [sceneId, intervalId] of heartbeatIntervals.entries()) {
      clearInterval(intervalId)
      heartbeatGenerations.set(sceneId, (heartbeatGenerations.get(sceneId) ?? 0) + 1)
    }
    heartbeatIntervals.clear()
    lastHeartbeatAttemptAt.clear()
    // 一并清除所有 heartbeat error 快重试定时器，避免 unmount / workspace 切换后还打请求。
    clearAllHeartbeatQuickRetries()
    for (const sceneId of Array.from(heartbeatGenerations.keys())) {
      if (!heartbeatInFlight.has(sceneId)) {
        heartbeatGenerations.delete(sceneId)
      }
    }
    heartbeatInFlight.clear()
    sceneClientSessions.clear()
  }

  function hasHeartbeat(sceneId: string): boolean {
    return heartbeatIntervals.has(sceneId)
  }

  function forceHeartbeat(sceneId: string, options: { force?: boolean } = {}): void {
    void sendSceneHeartbeat(sceneId, { force: options.force ?? false })
  }

  function forceAllHeartbeats(options: { force?: boolean } = {}): void {
    const force = options.force ?? false
    for (const sceneId of heartbeatIntervals.keys()) {
      void sendSceneHeartbeat(sceneId, force ? { force: true } : {})
    }
  }

  // -------------------------------------------------------------------
  // Recovery retry
  // -------------------------------------------------------------------

  function clearRecoveryRetry(sceneId: string): void {
    const timer = recoveryRetryTimers.get(sceneId)
    if (!timer) return
    clearTimeout(timer)
    recoveryRetryTimers.delete(sceneId)
  }

  function clearAllRecoveryRetries(): void {
    for (const timer of recoveryRetryTimers.values()) clearTimeout(timer)
    recoveryRetryTimers.clear()
    reattachAttempts.clear()
  }

  function resetReattachAttempt(sceneId: string): void {
    reattachAttempts.delete(sceneId)
  }

  /**
   * 调度 re-attach 退避重试。阶梯 COMMUNICATION_RECOVERY_RETRY_BACKOFF_MS（后端重启通常 5-30s），
   * 达到阶梯末尾后继续按末尾间隔后台重试，不把瞬时本地卡顿升级成 manual-only failed。
   * 每次调用递增 attempt 计数；成功重连（外部 attach mutation 的 onSuccess）应调用
   * resetReattachAttempt 重置 attempt。
   */
  function scheduleRecoveryRetry(sceneId: string): void {
    if (recoveryRetryTimers.has(sceneId)) return
    if (!callbacks.isSceneAlive(sceneId)) return
    const previous = reattachAttempts.get(sceneId)
    const nowMs = Date.now()
    const startedAt = previous?.startedAt ?? nowMs
    const nextAttempt = (previous?.attempt ?? 0) + 1
    const stepIndex = Math.min(nextAttempt - 1, COMMUNICATION_RECOVERY_RETRY_BACKOFF_MS.length - 1)
    const delay = COMMUNICATION_RECOVERY_RETRY_BACKOFF_MS[stepIndex]
    const isLongRunningRecovery = nowMs - startedAt > COMMUNICATION_RECOVERY_LONG_RUNNING_NOTICE_MS
    const scheduledAt = new Date().toISOString()
    reattachAttempts.set(sceneId, { attempt: nextAttempt, startedAt })
    callbacks.updateCommunicationHealth(sceneId, (current) => ({
      ...current,
      sseStatus: hasSseTransportProof(current, nowMs)
        ? "connected"
        : current.sseStatus === "idle" ? "connecting" : "reconnecting",
      restoreStatus: "reattaching",
      lastErrorAt: current.lastErrorAt ?? scheduledAt,
      reconnectAttempt: nextAttempt,
      errorMessage: isLongRunningRecovery
        ? "前后端通信恢复时间较长，仍在后台自动重试；恢复后会按通信游标自动同步消息。"
        : current.errorMessage ?? "前后端通信会话恢复中，正在自动重试。",
    }))
    console.info(`[chat] schedule re-attach retry #${nextAttempt} in ${delay}ms for scene:`, sceneId)
    const timer = setTimeout(() => {
      recoveryRetryTimers.delete(sceneId)
      if (!callbacks.isSceneAlive(sceneId)) return
      callbacks.requestReattach(sceneId, "heartbeat_expired")
    }, delay)
    recoveryRetryTimers.set(sceneId, timer)
  }

  // -------------------------------------------------------------------
  // Reattaching 并发锁
  // -------------------------------------------------------------------

  function markReattaching(sceneId: string): boolean {
    if (isReattachingScenes.has(sceneId)) return false
    isReattachingScenes.add(sceneId)
    return true
  }

  function unmarkReattaching(sceneId: string): void {
    isReattachingScenes.delete(sceneId)
  }

  function unmarkAllReattaching(): void {
    isReattachingScenes.clear()
  }

  function isReattaching(sceneId: string): boolean {
    return isReattachingScenes.has(sceneId)
  }

  // -------------------------------------------------------------------
  // Heartbeat error 快重试
  // -------------------------------------------------------------------

  function clearHeartbeatQuickRetry(sceneId: string): void {
    const timer = heartbeatErrorQuickRetryTimers.get(sceneId)
    if (!timer) return
    clearTimeout(timer)
    heartbeatErrorQuickRetryTimers.delete(sceneId)
  }

  function clearAllHeartbeatQuickRetries(): void {
    for (const timer of heartbeatErrorQuickRetryTimers.values()) clearTimeout(timer)
    heartbeatErrorQuickRetryTimers.clear()
  }

  /**
   * heartbeat 首次 error 后 5s 快重试，不等 setInterval 节拍（SCENE_HEARTBEAT_INTERVAL_MS 通常 40s）。
   * 幂等：同一 sceneId 已有 timer 则跳过；ok / expired / 升级 re-attach 都会清除。
   */
  function scheduleHeartbeatQuickRetry(sceneId: string): void {
    if (heartbeatErrorQuickRetryTimers.has(sceneId)) return
    if (!callbacks.isSceneAlive(sceneId)) return
    const timer = setTimeout(() => {
      heartbeatErrorQuickRetryTimers.delete(sceneId)
      if (!callbacks.isSceneAlive(sceneId)) return
      // 心跳已被 stopHeartbeat 清除（如 scene 关闭 / workspace 切换）则不重试。
      if (!heartbeatIntervals.has(sceneId)) return
      void sendSceneHeartbeat(sceneId, { force: true })
    }, HEARTBEAT_ERROR_QUICK_RETRY_DELAY_MS)
    heartbeatErrorQuickRetryTimers.set(sceneId, timer)
  }

  // -------------------------------------------------------------------
  // Stale watchdog
  // -------------------------------------------------------------------

  /**
   * 周期性扫描所有 heartbeat 在跑的 scene，对 stale 命中的触发 re-attach。
   * 调用方应在 useEffect 中 setInterval(detectStaleAndRecover, HEARTBEAT_STALE_WATCHDOG_INTERVAL_MS)。
   */
  function detectStaleAndRecover(): void {
    const nowMs = Date.now()
    for (const sceneId of heartbeatIntervals.keys()) {
      const state = callbacks.getCommunicationHealth(sceneId)
      if (!callbacks.detectStaleScene(state, nowMs)) continue
      callbacks.requestReattach(sceneId, "heartbeat_expired")
    }
  }

  // -------------------------------------------------------------------
  // Scene workspace mapping
  // -------------------------------------------------------------------

  function setSceneWorkspace(sceneId: string, workspacePath: string): void {
    sceneWorkspace.set(sceneId, workspacePath)
  }

  function getSceneWorkspace(sceneId: string): string | null {
    return sceneWorkspace.get(sceneId) ?? null
  }

  function deleteSceneWorkspace(sceneId: string): void {
    sceneWorkspace.delete(sceneId)
  }

  function clearAllSceneWorkspaces(): void {
    sceneWorkspace.clear()
  }

  // -------------------------------------------------------------------
  // Cursor
  // -------------------------------------------------------------------

  function getCursor(sceneId: string): number {
    return communicationSeqCursor.get(sceneId) ?? 0
  }

  function setCursor(sceneId: string, seq: number): void {
    communicationSeqCursor.set(sceneId, seq)
  }

  function mergeCursor(sceneId: string, seq: number): void {
    const previous = communicationSeqCursor.get(sceneId) ?? 0
    if (seq > previous) communicationSeqCursor.set(sceneId, seq)
  }

  function clearCursor(sceneId: string): void {
    communicationSeqCursor.delete(sceneId)
    communicationBootId.delete(sceneId)
  }

  function clearAllCursors(): void {
    communicationSeqCursor.clear()
    communicationBootId.clear()
  }

  return {
    connectEventStream,
    closeEventClient,
    closeAllEventClients,
    hasEventClient,
    startHeartbeat,
    getClientSessionId,
    stopHeartbeat,
    stopAllHeartbeats,
    hasHeartbeat,
    forceHeartbeat,
    forceAllHeartbeats,
    recordHeartbeatResult,
    detectStaleAndRecover,
    clearPendingEvents,
    clearAllPendingEvents,
    flushPendingEvents,
    scheduleRecoveryRetry,
    clearRecoveryRetry,
    clearAllRecoveryRetries,
    resetReattachAttempt,
    markReattaching,
    unmarkReattaching,
    unmarkAllReattaching,
    isReattaching,
    clearHeartbeatQuickRetry,
    clearAllHeartbeatQuickRetries,
    setSceneWorkspace,
    getSceneWorkspace,
    deleteSceneWorkspace,
    clearAllSceneWorkspaces,
    getCursor,
    setCursor,
    mergeCursor,
    clearCursor,
    clearAllCursors,
  }
}
