import { create } from "zustand"
import { useShallow } from "zustand/react/shallow"

import type { AgentContextUsage, AgentParentChildRelationResponse, AgentRuntimeInstance, ChatBubbleMessageDto, PendingAgentUserMessage } from "@/features/chat/api/agentRuntimeApi"
import type { UserMessageAttachment } from "@/features/chat/api/fileResourceApi"
import { normalizeAttachmentList, requestAttachmentToUiAttachment } from "@/features/chat/model/attachments"
import { createClientId } from "@/shared/utils/clientId"
import type {
  AgentEvent,
  AskUserRequestedPayload,
  FrontendDebugElementSelectedPayload,
  LlmResponseCompletedPayload,
  TerminalCreatedPayload,
  TerminalDeletedPayload,
  TerminalOutputDeltaPayload,
  TerminalSessionCompletedPayload,
  TerminalSessionStartedPayload,
  TokenUsage,
  SubagentCreatedPayload,
  SubagentReleasedPayload,
  UserMessageAcceptedPayload,
} from "@/features/chat/model/agentEvents"
import type { ChatMessage, ChatMessageRole, InteractionSelection, PendingInteraction, QueuedUserMessage, TerminalSession } from "@/features/chat/model/chatTypes"
import { buildInteractionSuccessorMessages } from "@/features/chat/model/conversationProjection"
import { chatAgentRuntimeScopeId } from "@/features/chat/model/chatAgentScope"
import {
  COLD_AFTER_INACTIVE_MS,
  CHAT_DEBUG_STORAGE_KEY,
  MAX_COLD_MESSAGES,
  MAX_COLD_RAW_EVENTS,
  MAX_COLD_TERMINAL_LINES,
  MAX_HOT_MESSAGES,
  MAX_HOT_RAW_EVENTS,
  MAX_HOT_RAW_EVENTS_DEBUG,
  MAX_TERMINAL_VISIBLE_LINES_PER_TERMINAL,
  MAX_WARM_MESSAGES,
  MAX_WARM_RAW_EVENTS,
  MAX_WARM_TERMINAL_LINES,
  WARM_AGENT_SCOPE_COUNT,
  WARM_SCENE_COUNT,
} from "@/features/chat/runtime/runtimeConfig"

export type SceneCacheTier = "hot" | "warm" | "cold"
export type SceneRestoreReason = "cold" | "heartbeat_expired" | "sse_gap" | "manual" | null

export type TokenUsageTotals = {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_tokens: number
  reasoning_tokens: number
  cache_creation_tokens: number
  rounds: number
}

const EMPTY_TOKEN_USAGE_TOTALS: TokenUsageTotals = {
  input_tokens: 0,
  output_tokens: 0,
  total_tokens: 0,
  cached_tokens: 0,
  reasoning_tokens: 0,
  cache_creation_tokens: 0,
  rounds: 0,
}

/**
 * 单个对话场景的状态切片。
 *
 * 每个 Tab 对应一个独立的 SceneSlice，同时在 chatStore 里以 sceneId 为键存放，
 * 从而支持多场景并行运行：Agent 运行实例、会话时间线、工具活动、终端会话、
 * SSE seq 进度、token 用量、上下文窗口上限等都不会互相污染。
 */
export type AgentHydrationState = "ready" | "hydrating" | "needs_hydration" | "failed"

export type AgentRuntimeState = {
  scopeId: string
  agentInstanceId: string
  messages: ChatMessage[]
  queuedUserMessages: QueuedUserMessage[]
  terminalSessions: TerminalSession[]
  pendingInteraction: PendingInteraction | null
  latestTimelineMessage: ChatMessage | null
  /** Agent 级历史消息计数（含被 UI cache 淘汰的正文），用于 needs_hydration 判断。 */
  messageCount: number
  /** 当前仍保留在内存中的消息正文数量。 */
  retainedMessageCount: number
  /** Agent 级补水状态：UI cache eviction 后即使 Scene SSE 健康也要定向补水。 */
  hydrationState: AgentHydrationState
  lastHydratedAt: number | null
  /** Agent 级 UI working-set 冷热，与 Scene transport tier 解耦。 */
  uiCacheTier: SceneCacheTier
  /** 用户最近查看该 Agent 面板的时间。 */
  lastViewedAt: number
  /** Agent 最近收到 runtime 事件的时间，不得污染用户 LRU。 */
  lastRuntimeActivityAt: number
}

export type AgentScopedChatBubbleHydration = {
  agentInstanceId: string
  bubbles: ChatBubbleMessageDto[]
}

export type ChatBubbleHydrationMode = "baseline" | "incremental"
export type ChatBubbleHydrationOptions = {
  mode?: ChatBubbleHydrationMode
}

export type SceneSlice = {
  sceneId: string
  sceneName: string
  cacheTier: SceneCacheTier
  lastActivatedAt: number
  lastBackgroundAt: number | null
  lastHydratedAt: number | null
  isDirty: boolean
  isRestoring: boolean
  restoreReason: SceneRestoreReason
  taskId: string
  runStatus: string
  agentInstance: AgentRuntimeInstance | null
  agentInstances: Record<string, AgentRuntimeInstance>
  agentInstanceOrder: string[]
  parentChildRelations: AgentParentChildRelationResponse[]
  rootAgentInstanceId: string | null
  selectedAgentInstanceId: string | null
  agentRuntimeStates: Record<string, AgentRuntimeState>
  composerDraft: string
  composerDraftsByAgentInstanceId: Record<string, string>
  rawEvents: AgentEvent[]
  streamId: string | null
  lastSeq: number
  lastTokenUsage: TokenUsage | null
  tokenUsageTotals: TokenUsageTotals
  contextWindowMax: number | null
}

export type ChatStore = {
  scenes: Record<string, SceneSlice>
  activeSceneId: string | null
  openScene: (sceneId: string, sceneName: string) => void
  renameScene: (sceneId: string, sceneName: string) => void
  closeScene: (sceneId: string) => void
  setActiveScene: (sceneId: string | null) => void
  applySceneCachePolicy: () => void
  markSceneDirty: (sceneId: string, isDirty?: boolean) => void
  markSceneRestoring: (sceneId: string, isRestoring: boolean, reason?: SceneRestoreReason) => void
  resetScene: (sceneId: string) => void
  setAgentInstance: (sceneId: string, instance: AgentRuntimeInstance | null, options?: { syncRunStatus?: boolean }) => void
  setSceneAgentInventory: (sceneId: string, agentInstances: AgentRuntimeInstance[], parentChildRelations?: AgentParentChildRelationResponse[], rootAgentInstanceId?: string | null, selectedAgentInstanceId?: string | null) => void
  selectAgentInstance: (sceneId: string, agentInstanceId: string) => void
  closeAgentInstancePanel: (sceneId: string, agentInstanceId: string) => void
  setStreamId: (sceneId: string, streamId: string | null) => void
  setRootAgentInstanceId: (sceneId: string, rootAgentInstanceId: string | null) => void
  setComposerDraft: (sceneId: string, draft: string, agentInstanceId?: string | null) => void
  appendUserMessage: (sceneId: string, agentInstanceId: string, text: string, clientMessageId: string, interactionSelection?: InteractionSelection, attachments?: UserMessageAttachment[]) => void
  enqueueUserMessage: (sceneId: string, message: QueuedUserMessage, interactionSelection?: InteractionSelection) => void
  markQueuedUserMessageFailed: (sceneId: string, agentInstanceId: string, clientMessageId: string, errorMessage: string) => void
  removeQueuedUserMessage: (sceneId: string, agentInstanceId: string, pendingMessageId: string) => void
  appendAssistantMessage: (sceneId: string, agentInstanceId: string, text: string) => void
  appendProjectedMessage: (sceneId: string, agentInstanceId: string, message: ChatMessage) => void
  appendEvent: (sceneId: string, event: AgentEvent) => void
  appendEvents: (sceneId: string, events: AgentEvent[]) => void
  resetSceneTransportState: (sceneId: string, streamId?: string) => void
  hydrateScene: (sceneId: string, events: AgentEvent[]) => void
  hydrateSceneFromBubbles: (sceneId: string, bubbles: ChatBubbleMessageDto[], options?: ChatBubbleHydrationOptions) => void
  hydrateSceneFromAgentBubbles: (sceneId: string, batches: AgentScopedChatBubbleHydration[], options?: ChatBubbleHydrationOptions) => void
  hydrateTerminalSessions: (sceneId: string, sessions: TerminalSession[]) => void
  removeTerminalSessions: (sceneId: string, agentInstanceId: string, terminalId: string) => void
  restoreQueuedUserMessages: (sceneId: string, pendingMessages: PendingAgentUserMessage[], agentInstanceId: string) => void
  clearAllScenes: () => void
}

function createEmptySceneSlice(sceneId: string, sceneName: string): SceneSlice {
  const now = Date.now()
  return {
    sceneId,
    sceneName,
    cacheTier: "hot",
    lastActivatedAt: now,
    lastBackgroundAt: null,
    lastHydratedAt: null,
    isDirty: false,
    isRestoring: false,
    restoreReason: null,
    taskId: "",
    runStatus: "created",
    agentInstance: null,
    agentInstances: {},
    agentInstanceOrder: [],
    parentChildRelations: [],
    rootAgentInstanceId: null,
    selectedAgentInstanceId: null,
    agentRuntimeStates: {},
    composerDraft: "",
    composerDraftsByAgentInstanceId: {},
    rawEvents: [],
    streamId: null,
    lastSeq: 0,
    lastTokenUsage: null,
    tokenUsageTotals: EMPTY_TOKEN_USAGE_TOTALS,
    contextWindowMax: null,
  }
}

export const useChatStore = create<ChatStore>((set) => ({
  scenes: {},
  activeSceneId: null,
  openScene: (sceneId, sceneName) =>
    set((state) => {
      const now = Date.now()
      const existing = state.scenes[sceneId]
      const slice = existing
        ? { ...existing, sceneName, cacheTier: "hot" as const, lastActivatedAt: now, lastBackgroundAt: null }
        : createEmptySceneSlice(sceneId, sceneName)
      return applyCachePolicyToState({
        scenes: { ...state.scenes, [sceneId]: slice },
        activeSceneId: sceneId,
      })
    }),
  renameScene: (sceneId, sceneName) =>
    set((state) => {
      const existing = state.scenes[sceneId]
      if (!existing) return state
      return { scenes: { ...state.scenes, [sceneId]: { ...existing, sceneName } } }
    }),
  closeScene: (sceneId) =>
    set((state) => {
      if (!state.scenes[sceneId]) return state
      const { [sceneId]: _removed, ...rest } = state.scenes
      const remainingIds = Object.keys(rest)
      const nextActive =
        state.activeSceneId === sceneId
          ? remainingIds.length > 0
            ? remainingIds[0]
            : null
          : state.activeSceneId
      const now = Date.now()
      const scenes = nextActive && rest[nextActive]
        ? {
            ...rest,
            [nextActive]: {
              ...rest[nextActive],
              cacheTier: "hot" as const,
              lastActivatedAt: now,
              lastBackgroundAt: null,
            },
          }
        : rest
      return applyCachePolicyToState({ scenes, activeSceneId: nextActive })
    }),
  setActiveScene: (sceneId) =>
    set((state) => {
      const now = Date.now()
      const scenes = Object.fromEntries(
        Object.entries(state.scenes).map(([id, slice]) => {
          if (id === sceneId) {
            const activated = { ...slice, cacheTier: "hot" as const, lastActivatedAt: now, lastBackgroundAt: null }
            const selectedId = activated.selectedAgentInstanceId ?? activated.rootAgentInstanceId
            return [id, selectedId ? markAgentViewed(activated, selectedId, now) : activated]
          }
          if (id === state.activeSceneId) {
            return [id, { ...slice, lastActivatedAt: now, lastBackgroundAt: now }]
          }
          return [id, slice]
        }),
      )
      return applyCachePolicyToState({ scenes, activeSceneId: sceneId })
    }),
  applySceneCachePolicy: () => set((state) => applyCachePolicyToState(state)),
  markSceneDirty: (sceneId, isDirty = true) =>
    set((state) => patchSlice(state, sceneId, (slice) => ({ ...slice, isDirty }))),
  markSceneRestoring: (sceneId, isRestoring, reason = null) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) => ({
        ...slice,
        isRestoring,
        restoreReason: isRestoring ? reason : null,
      })),
    ),
  resetScene: (sceneId) =>
    set((state) => {
      const existing = state.scenes[sceneId]
      if (!existing) return state
      const reset = createEmptySceneSlice(sceneId, existing.sceneName)
      return {
        scenes: {
          ...state.scenes,
          [sceneId]: {
            ...reset,
            cacheTier: existing.cacheTier,
            lastActivatedAt: existing.lastActivatedAt,
            lastBackgroundAt: existing.lastBackgroundAt,
          },
        },
      }
    }),
  setAgentInstance: (sceneId, instance, options) =>
    set((state) =>
      patchSliceAndApplyCachePolicy(state, sceneId, (slice) => {
        const syncRunStatus = options?.syncRunStatus ?? true
        const contextUsage = instance?.context_usage
        const snapshotUsedTokens = typeof contextUsage?.context_window_used_tokens === "number"
          ? Math.max(0, Math.round(contextUsage.context_window_used_tokens))
          : 0
        const snapshotTokenUsage = contextUsage?.token_usage ?? (
          contextUsage
            ? {
                input_tokens: snapshotUsedTokens,
                output_tokens: 0,
                total_tokens: snapshotUsedTokens,
                cached_tokens: 0,
              }
            : null
        )
        const snapshotContextWindow = typeof contextUsage?.context_window_max === "number" && contextUsage.context_window_max > 0
          ? contextUsage.context_window_max
          : null
        if (!instance) {
          return {
            ...slice,
            runStatus: syncRunStatus ? "created" : slice.runStatus,
            agentInstance: null,
            agentInstances: {},
            agentInstanceOrder: [],
            parentChildRelations: [],
            rootAgentInstanceId: null,
            selectedAgentInstanceId: null,
            lastTokenUsage: contextUsage ? snapshotTokenUsage : slice.lastTokenUsage,
            contextWindowMax: contextUsage ? snapshotContextWindow : slice.contextWindowMax,
          }
        }
        const agentInstances = { ...slice.agentInstances, [instance.instance_id]: instance }
        const agentInstanceOrder = slice.agentInstanceOrder.includes(instance.instance_id)
          ? slice.agentInstanceOrder
          : [...slice.agentInstanceOrder, instance.instance_id]
        const selectedAgentInstanceId = slice.selectedAgentInstanceId && agentInstances[slice.selectedAgentInstanceId]
          ? slice.selectedAgentInstanceId
          : instance.instance_id
        const selectedAgentInstance = agentInstances[selectedAgentInstanceId] ?? instance
        const nextSlice = {
          ...slice,
          taskId: instance.task_id ?? slice.taskId,
          runStatus: syncRunStatus ? selectedAgentInstance.status ?? instance.status ?? "created" : slice.runStatus,
          agentInstance: selectedAgentInstance,
          agentInstances,
          agentInstanceOrder,
          rootAgentInstanceId: slice.rootAgentInstanceId ?? instance.instance_id,
          selectedAgentInstanceId,
          lastTokenUsage: contextUsage ? snapshotTokenUsage : slice.lastTokenUsage,
          contextWindowMax: contextUsage ? snapshotContextWindow : slice.contextWindowMax,
        }
        return markAgentViewed(nextSlice, selectedAgentInstanceId)
      }),
    ),
  setSceneAgentInventory: (sceneId, agentInstances, parentChildRelations = [], rootAgentInstanceId = null, selectedAgentInstanceId = null) =>
    set((state) =>
      patchSliceAndApplyCachePolicy(state, sceneId, (slice) => {
        const nextInstances = Object.fromEntries(
          agentInstances.map((instance) => [instance.instance_id, instance]),
        ) as Record<string, AgentRuntimeInstance>
        const nextOrder = agentInstances.map((instance) => instance.instance_id)
        const resolvedRootAgentInstanceId = rootAgentInstanceId && nextInstances[rootAgentInstanceId]
          ? rootAgentInstanceId
          : agentInstances[0]?.instance_id ?? null
        const requestedSelection = selectedAgentInstanceId
          ?? (slice.selectedAgentInstanceId && nextInstances[slice.selectedAgentInstanceId] ? slice.selectedAgentInstanceId : null)
          ?? resolvedRootAgentInstanceId
        const selectedId = requestedSelection && nextInstances[requestedSelection] ? requestedSelection : resolvedRootAgentInstanceId
        const selectedAgent = selectedId ? nextInstances[selectedId] ?? null : null
        const nextSlice = {
          ...slice,
          taskId: selectedAgent?.task_id ?? agentInstances[0]?.task_id ?? slice.taskId,
          runStatus: selectedAgent?.status ?? slice.runStatus,
          agentInstance: selectedAgent,
          agentInstances: nextInstances,
          agentInstanceOrder: nextOrder,
          parentChildRelations,
          rootAgentInstanceId: resolvedRootAgentInstanceId,
          selectedAgentInstanceId: selectedId,
        }
        return selectedId ? markAgentViewed(nextSlice, selectedId) : nextSlice
      }),
    ),
  selectAgentInstance: (sceneId, agentInstanceId) =>
    set((state) =>
      patchSliceAndApplyCachePolicy(state, sceneId, (slice) => {
        const selected = slice.agentInstances[agentInstanceId]
        if (!selected) return slice
        const withViewed = markAgentViewed(slice, agentInstanceId)
        return {
          ...withViewed,
          agentInstance: selected,
          selectedAgentInstanceId: agentInstanceId,
          runStatus: selected.status ?? slice.runStatus,
        }
      }),
    ),
  closeAgentInstancePanel: (sceneId, agentInstanceId) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) => {
        if (!agentInstanceId || agentInstanceId === slice.rootAgentInstanceId) return slice
        if (!slice.agentInstances[agentInstanceId]) return slice
        const { [agentInstanceId]: _closed, ...agentInstances } = slice.agentInstances
        const agentInstanceOrder = slice.agentInstanceOrder.filter((instanceId) => instanceId !== agentInstanceId)
        const parentChildRelations = slice.parentChildRelations.filter(
          (relation) => relation.child_instance_id !== agentInstanceId,
        )
        const selectedAgentInstanceId = slice.selectedAgentInstanceId === agentInstanceId
          ? slice.rootAgentInstanceId ?? agentInstanceOrder[0] ?? null
          : slice.selectedAgentInstanceId
        const selectedAgent = selectedAgentInstanceId ? agentInstances[selectedAgentInstanceId] ?? null : null
        return {
          ...slice,
          agentInstances,
          agentInstanceOrder,
          parentChildRelations,
          selectedAgentInstanceId,
          agentInstance: selectedAgent,
          runStatus: selectedAgent?.status ?? slice.runStatus,
        }
      }),
    ),
  setStreamId: (sceneId, streamId) =>
    set((state) => patchSlice(state, sceneId, (slice) => ({ ...slice, streamId }))),
  setRootAgentInstanceId: (sceneId, rootAgentInstanceId) =>
    set((state) => patchSlice(state, sceneId, (slice) => ({ ...slice, rootAgentInstanceId }))),
  setComposerDraft: (sceneId, draft, agentInstanceId) =>
    set((state) => patchSlice(state, sceneId, (slice) => applyComposerDraft(slice, agentInstanceId ?? slice.rootAgentInstanceId, draft))),
  appendUserMessage: (sceneId, agentInstanceId, text, clientMessageId, interactionSelection, attachments = []) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) => {
        if (agentHasClientMessage(slice, agentInstanceId, clientMessageId)) {
          return touchSceneActivity(finalizeUserSubmission(slice, agentInstanceId, interactionSelection))
        }
        const appended = appendMessage(slice, {
          id: `user-${clientMessageId}`,
          role: "user",
          createdAt: new Date().toISOString(),
          status: "sending",
          content: {
            text, text_format: "plain_text", channel: "web",
            ...(interactionSelection ? { metadata: {
              interaction_message_id: interactionSelection.interactionMessageId,
              interaction_option_id: interactionSelection.optionId,
            } } : {}),
          },
          attachments,
          clientMessageId,
          agentInstanceId,
        })
        return touchSceneActivity(finalizeUserSubmission(appended, agentInstanceId, interactionSelection))
      }),
    ),
  enqueueUserMessage: (sceneId, message, interactionSelection) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) => {
        const ownerId = message.agentInstanceId
        if (!ownerId) {
          console.warn("[chatStore] drop enqueueUserMessage: missing agent owner")
          return slice
        }
        const queuedMessage = {
          ...(interactionSelection ? { ...message, interactionSelection } : message),
          agentInstanceId: ownerId,
        }
        if (agentHasClientMessage(slice, ownerId, message.clientMessageId)) {
          return touchSceneActivity(finalizeUserSubmission(slice, ownerId, interactionSelection))
        }
        return touchSceneActivity(updateAgentLedger(slice, ownerId, (agentState) => {
          const matchesQueuedMessage = (queued: QueuedUserMessage) => (
            queued.pendingMessageId === message.pendingMessageId
            || queued.clientMessageId === message.clientMessageId
          )
          const duplicated = agentState.queuedUserMessages.some(matchesQueuedMessage)
          const queuedUserMessages = duplicated
            ? agentState.queuedUserMessages.map((queued) => (
                matchesQueuedMessage(queued)
                  ? { ...queued, interactionSelection: queuedMessage.interactionSelection ?? queued.interactionSelection }
                  : queued
              ))
            : [...agentState.queuedUserMessages, queuedMessage]
          return { ...agentState, queuedUserMessages }
        }))
      }),
    ),
  markQueuedUserMessageFailed: (sceneId, agentInstanceId, clientMessageId, errorMessage) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) =>
        updateAgentLedger(slice, agentInstanceId, (agentState) => ({
          ...agentState,
          queuedUserMessages: agentState.queuedUserMessages.map((message) =>
            message.clientMessageId === clientMessageId
              ? { ...message, status: "failed", errorMessage }
              : message,
          ),
        })),
      ),
    ),
  removeQueuedUserMessage: (sceneId, agentInstanceId, pendingMessageId) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) => {
        const next = updateAgentLedger(slice, agentInstanceId, (agentState) => ({
          ...agentState,
          queuedUserMessages: agentState.queuedUserMessages.filter((message) => message.pendingMessageId !== pendingMessageId),
        }))
        const runtimeInstance = next.agentInstances[agentInstanceId]
        const pendingMessages = runtimeInstance?.pending_user_messages.filter((message) => message.message_id !== pendingMessageId) ?? []
        const agentInstances = runtimeInstance
          ? {
              ...next.agentInstances,
              [agentInstanceId]: {
                ...runtimeInstance,
                pending_user_message_count: pendingMessages.length,
                pending_user_messages: pendingMessages,
              },
            }
          : next.agentInstances
        return {
          ...next,
          agentInstances,
          agentInstance: next.agentInstance?.instance_id === agentInstanceId
            ? agentInstances[agentInstanceId] ?? next.agentInstance
            : next.agentInstance,
        }
      }),
    ),
  appendAssistantMessage: (sceneId, agentInstanceId, text) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) =>
        touchSceneActivity(appendMessage(slice, {
          id: createClientId("assistant"),
          role: "agent",
          createdAt: new Date().toISOString(),
          status: "completed",
          content: { text, text_format: "markdown", channel: "web" },
          agentInstanceId,
        })),
      ),
    ),
  appendProjectedMessage: (sceneId, agentInstanceId, message) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) => appendMessage(slice, { ...message, agentInstanceId })),
    ),
  appendEvent: (sceneId, event) =>
    set((state) => patchSlice(state, sceneId, (slice) => normalizeSceneSlice(reduceAgentEvent(slice, event)))),
  appendEvents: (sceneId, events) => {
    if (events.length === 0) return
    set((state) => patchSlice(state, sceneId, (slice) => normalizeSceneSlice(reduceAgentEvents(slice, events))))
  },
  resetSceneTransportState: (sceneId, streamId) =>
    set((state) => patchSlice(state, sceneId, (slice) => ({
      ...slice,
      lastSeq: 0,
      rawEvents: [],
      streamId: streamId ?? slice.streamId,
    }))),
  hydrateScene: (sceneId, events) =>
    set((state) => {
      const existing = state.scenes[sceneId]
      if (!existing) return state
      // 仅保留与 attach 结果绑定的「身份字段」：sceneName、agentInstance、streamId 等；
      // 其它运行态字段（messages/terminalSessions/lastSeq/totals…）
      // 全部按空切片重置，再逐条 replay 历史事件。
      const reset: SceneSlice = {
        ...createEmptySceneSlice(sceneId, existing.sceneName),
        cacheTier: existing.cacheTier,
        lastActivatedAt: existing.lastActivatedAt,
        lastBackgroundAt: existing.lastBackgroundAt,
        taskId: existing.taskId,
        agentInstance: existing.agentInstance,
        rootAgentInstanceId: existing.rootAgentInstanceId,
        streamId: existing.streamId,
      }
      const replayed = events.reduce<SceneSlice>(
        (slice, event) => reduceAgentEvent(slice, event),
        reset,
      )
      return { scenes: { ...state.scenes, [sceneId]: normalizeSceneSlice(replayed) } }
    }),
  hydrateSceneFromBubbles: (sceneId, bubbles, options) =>
    set((state) => {
      const existing = state.scenes[sceneId]
      if (!existing) return state
      const batches = groupChatBubblesByAgent(existing, bubbles)
      return {
        scenes: {
          ...state.scenes,
          [sceneId]: hydrateSceneWithScopedBubbles(existing, batches, options?.mode ?? "baseline"),
        },
      }
    }),
  hydrateSceneFromAgentBubbles: (sceneId, batches, options) =>
    set((state) => {
      const existing = state.scenes[sceneId]
      if (!existing) return state
      return {
        scenes: {
          ...state.scenes,
          [sceneId]: hydrateSceneWithScopedBubbles(existing, batches, options?.mode ?? "incremental"),
        },
      }
    }),
  hydrateTerminalSessions: (sceneId, sessions) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) => {
        let next = ensureAllAgentStates(slice)
        // 先清空各 Agent terminal，再按 owner 重灌。
        const cleared: Record<string, AgentRuntimeState> = {}
        for (const [scopeId, agentState] of Object.entries(next.agentRuntimeStates)) {
          cleared[scopeId] = { ...agentState, terminalSessions: [] }
        }
        next = { ...next, agentRuntimeStates: cleared }
        for (const session of sessions) {
          const ownerId = session.agentInstanceId
          if (!ownerId) {
            console.warn("[chatStore] drop hydrated terminal session: missing agent owner", session.id)
            continue
          }
          next = updateAgentLedger(next, ownerId, (agentState) => ({
            ...agentState,
            terminalSessions: compactTerminalSessions(
              [...agentState.terminalSessions, session],
              terminalLineLimitForTier(agentState.uiCacheTier),
            ),
          }))
        }
        return next
      }),
    ),
  removeTerminalSessions: (sceneId, agentInstanceId, terminalId) =>
    set((state) => patchSlice(state, sceneId, (slice) => removeTerminalSessionsById(slice, agentInstanceId, terminalId))),
  restoreQueuedUserMessages: (sceneId, pendingMessages, agentInstanceId) =>
    set((state) =>
      patchSlice(state, sceneId, (slice) => {
        const targetAgentInstanceId = agentInstanceId
        const currentAgentState = resolveAgentRuntimeState(slice, targetAgentInstanceId)
        const acceptedMessages = currentAgentState?.messages ?? []
        const restoredQueuedUserMessages = pendingMessages
          .map<QueuedUserMessage>((message) => ({
            id: message.message_id,
            pendingMessageId: message.message_id,
            clientMessageId: message.client_message_id ?? message.message_id,
            text: message.user_text,
            attachments: (message.attachments ?? []).map(requestAttachmentToUiAttachment),
            createdAt: message.received_at,
            status: "queued",
            agentInstanceId: targetAgentInstanceId,
            interactionSelection: currentAgentState?.queuedUserMessages.find((queued) =>
              queued.pendingMessageId === message.message_id
              || queued.clientMessageId === (message.client_message_id ?? message.message_id),
            )?.interactionSelection,
          }))
        return updateAgentLedger(slice, targetAgentInstanceId, (agentState) => ({
          ...agentState,
          queuedUserMessages: reconcileQueuedUserMessages(restoredQueuedUserMessages, acceptedMessages),
        }))
      }),
    ),
  clearAllScenes: () => set(() => ({ scenes: {}, activeSceneId: null })),
}))

function patchSlice(
  state: ChatStore,
  sceneId: string,
  updater: (slice: SceneSlice) => SceneSlice,
): Partial<ChatStore> | ChatStore {
  const existing = state.scenes[sceneId]
  if (!existing) return state
  const next = updater(existing)
  return { scenes: { ...state.scenes, [sceneId]: normalizeAgentLedgers(next) } }
}

function patchSliceAndApplyCachePolicy(
  state: ChatStore,
  sceneId: string,
  updater: (slice: SceneSlice) => SceneSlice,
): Partial<ChatStore> | ChatStore {
  const existing = state.scenes[sceneId]
  if (!existing) return state
  const next = normalizeAgentLedgers(updater(existing))
  return applyCachePolicyToState({
    scenes: { ...state.scenes, [sceneId]: next },
    activeSceneId: state.activeSceneId,
  })
}

function touchSceneActivity(slice: SceneSlice): SceneSlice {
  return { ...slice, lastActivatedAt: Date.now() }
}

function sceneHasPendingInteraction(slice: SceneSlice): boolean {
  for (const runtimeState of Object.values(slice.agentRuntimeStates ?? {})) {
    if (runtimeState.pendingInteraction) return true
    if (runtimeState.messages.some((message) => message.interactionState === "pending")) return true
  }
  return false
}

function applyCachePolicyToState(state: Pick<ChatStore, "scenes" | "activeSceneId">): Pick<ChatStore, "scenes" | "activeSceneId"> {
  const now = Date.now()
  const sceneEntries = Object.entries(state.scenes).map(([sceneId, slice]) => [
    sceneId,
    ensureAllAgentStates(slice),
  ] as const)

  // Scene tier only governs transport/control-plane retention. Runtime traffic never updates lastActivatedAt.
  const warmSceneIds = new Set(
    sceneEntries
      .filter(([sceneId, slice]) => sceneId !== state.activeSceneId && !sceneHasPendingInteraction(slice))
      .sort(([, left], [, right]) => right.lastActivatedAt - left.lastActivatedAt)
      .filter(([, slice]) => now - slice.lastActivatedAt < COLD_AFTER_INACTIVE_MS)
      .slice(0, WARM_SCENE_COUNT)
      .map(([sceneId]) => sceneId),
  )
  const transportScenes = Object.fromEntries(
    sceneEntries.map(([sceneId, slice]) => {
      const cacheTier: SceneCacheTier = sceneId === state.activeSceneId
        ? "hot"
        : warmSceneIds.has(sceneId)
          ? "warm"
          : "cold"
      return [
        sceneId,
        {
          ...slice,
          cacheTier,
          lastBackgroundAt: cacheTier === "hot" ? null : slice.lastBackgroundAt ?? slice.lastActivatedAt,
        },
      ]
    }),
  ) as Record<string, SceneSlice>

function isTerminalAgentStatus(status?: string | null): boolean {
  return status === "completed" || status === "failed" || status === "cancelled" || status === "released"
}

  const hotScopeIds = new Set<string>()
  const pinnedWarmScopeIds = new Set<string>()
  const warmCandidates: { runtimeState: AgentRuntimeState; recency: number }[] = []
  for (const [sceneId, slice] of Object.entries(transportScenes)) {
    const selectedId = slice.selectedAgentInstanceId ?? slice.rootAgentInstanceId
    for (const runtimeState of Object.values(slice.agentRuntimeStates)) {
      const isActiveSelected = sceneId === state.activeSceneId
        && runtimeState.agentInstanceId != null
        && runtimeState.agentInstanceId === selectedId
      if (isActiveSelected) {
        hotScopeIds.add(runtimeState.scopeId)
        continue
      }
      const status = runtimeState.agentInstanceId
        ? slice.agentInstances[runtimeState.agentInstanceId]?.status
        : undefined
      const isPinned = Boolean(runtimeState.pendingInteraction) || status === "running" || status === "paused"
      if (isPinned) {
        pinnedWarmScopeIds.add(runtimeState.scopeId)
        continue
      }
      const isTerminal = isTerminalAgentStatus(status)
      const effectiveRecency = !isTerminal && runtimeState.lastViewedAt === 0
        ? runtimeState.lastRuntimeActivityAt
        : runtimeState.lastViewedAt
      if (now - effectiveRecency < COLD_AFTER_INACTIVE_MS) {
        warmCandidates.push({ runtimeState, recency: effectiveRecency })
      }
    }
  }
  warmCandidates.sort((left, right) => right.recency - left.recency)
  const budgetedWarmScopeIds = new Set(
    warmCandidates.slice(0, WARM_AGENT_SCOPE_COUNT).map((candidate) => candidate.runtimeState.scopeId),
  )
  const uiCacheTierByScope = new Map<string, SceneCacheTier>()
  for (const slice of Object.values(transportScenes)) {
    for (const runtimeState of Object.values(slice.agentRuntimeStates)) {
      const tier: SceneCacheTier = hotScopeIds.has(runtimeState.scopeId)
        ? "hot"
        : pinnedWarmScopeIds.has(runtimeState.scopeId) || budgetedWarmScopeIds.has(runtimeState.scopeId)
          ? "warm"
          : "cold"
      uiCacheTierByScope.set(runtimeState.scopeId, tier)
    }
  }

  const scenes = Object.fromEntries(
    Object.entries(transportScenes).map(([sceneId, slice]) => [
      sceneId,
      normalizeAgentLedgers(slice, { uiCacheTierByScope }),
    ]),
  )
  return { scenes, activeSceneId: state.activeSceneId }
}

function normalizeSceneSlice(
  slice: SceneSlice,
  _options: { pinnedByInteraction?: boolean } = {},
): SceneSlice {
  return normalizeAgentLedgers(slice)
}

function normalizeAgentLedgers(
  slice: SceneSlice,
  options: { uiCacheTierByScope?: ReadonlyMap<string, SceneCacheTier> } = {},
): SceneSlice {
  const selectedId = slice.selectedAgentInstanceId ?? slice.rootAgentInstanceId
  const nextAgentRuntimeStates: Record<string, AgentRuntimeState> = {}
  const ensured = ensureAllAgentStates(slice)
  let selectedPendingResolved = false

  for (const [scopeId, runtimeState] of Object.entries(ensured.agentRuntimeStates)) {
    const uiCacheTier = options.uiCacheTierByScope?.get(scopeId) ?? runtimeState.uiCacheTier
    const previousMessages = runtimeState.messages
    const trimmedMessages = trimMessagesForTier(previousMessages, uiCacheTier)
    const trimmedTerminals = compactTerminalSessions(
      runtimeState.terminalSessions,
      terminalLineLimitForTier(uiCacheTier),
    )
    const messageCount = Math.max(runtimeState.messageCount, previousMessages.length, trimmedMessages.length)
    const retainedMessageCount = trimmedMessages.length
    const emptiedByCache = previousMessages.length > 0 && trimmedMessages.length === 0
    let hydrationState = runtimeState.hydrationState
    if (emptiedByCache && messageCount > 0) {
      hydrationState = "needs_hydration"
    } else if (retainedMessageCount > 0 && hydrationState === "needs_hydration") {
      hydrationState = "ready"
    }
    const pendingInteraction = restorePendingInteractionFromMessages(trimmedMessages)
    if (runtimeState.agentInstanceId === selectedId && runtimeState.pendingInteraction && !pendingInteraction) {
      selectedPendingResolved = true
    }
    const nextState: AgentRuntimeState = {
      ...runtimeState,
      messages: trimmedMessages,
      terminalSessions: trimmedTerminals,
      messageCount,
      retainedMessageCount,
      hydrationState,
      uiCacheTier,
      pendingInteraction,
      latestTimelineMessage: latestTimelineMessageFrom(trimmedMessages),
    }
    nextAgentRuntimeStates[scopeId] = stabilizeAgentRuntimeState(runtimeState, nextState)
  }

  const selectedPending = selectedId
    ? nextAgentRuntimeStates[chatAgentRuntimeScopeId(slice.sceneId, selectedId, slice.rootAgentInstanceId)]?.pendingInteraction ?? null
    : null
  const runStatus = selectedPending
    ? "paused"
    : selectedPendingResolved && slice.runStatus === "paused"
      ? resumedRunStatus(slice)
      : slice.runStatus

  return {
    ...slice,
    agentRuntimeStates: nextAgentRuntimeStates,
    rawEvents: trimTailByTier(slice.rawEvents, rawEventLimitForTier(slice.cacheTier)),
    runStatus,
  }
}

function groupChatBubblesByAgent(
  slice: Pick<SceneSlice, "sceneId" | "rootAgentInstanceId">,
  bubbles: ChatBubbleMessageDto[],
): AgentScopedChatBubbleHydration[] {
  const batches = new Map<string, AgentScopedChatBubbleHydration>()
  for (const bubble of bubbles) {
    const agentInstanceId = typeof bubble.agent_instance_id === "string"
      ? bubble.agent_instance_id.trim()
      : ""
    if (!agentInstanceId) {
      console.warn("[chatStore] drop hydrated ChatBubble: missing agent owner", bubble.bubble_id)
      continue
    }
    const scopeId = chatAgentRuntimeScopeId(slice.sceneId, agentInstanceId, slice.rootAgentInstanceId)
    const existing = batches.get(scopeId)
    if (existing) {
      existing.bubbles.push(bubble)
    } else {
      batches.set(scopeId, { agentInstanceId, bubbles: [bubble] })
    }
  }
  return Array.from(batches.values())
}

function hydrateSceneWithScopedBubbles(
  existing: SceneSlice,
  batches: AgentScopedChatBubbleHydration[],
  mode: ChatBubbleHydrationMode,
): SceneSlice {
  const now = Date.now()
  const next = ensureAllAgentStates(existing)
  const nextAgentRuntimeStates: Record<string, AgentRuntimeState> = { ...next.agentRuntimeStates }

  for (const batch of batches) {
    const agentInstanceId = typeof batch.agentInstanceId === "string" ? batch.agentInstanceId.trim() : ""
    if (!agentInstanceId) {
      console.warn("[chatStore] drop scoped ChatBubble batch: missing agent owner")
      continue
    }
    const invalidBubble = batch.bubbles.find((bubble) => {
      const bubbleOwnerId = typeof bubble.agent_instance_id === "string" ? bubble.agent_instance_id.trim() : ""
      return bubbleOwnerId !== agentInstanceId
    })
    if (invalidBubble) {
      const bubbleOwnerId = typeof invalidBubble.agent_instance_id === "string"
        ? invalidBubble.agent_instance_id.trim()
        : ""
      console.warn("[chatStore] drop scoped ChatBubble batch: owner contract violation", {
        bubbleId: invalidBubble.bubble_id,
        expectedAgentInstanceId: agentInstanceId,
        actualAgentInstanceId: bubbleOwnerId || null,
      })
      continue
    }
    const scopeId = chatAgentRuntimeScopeId(existing.sceneId, agentInstanceId, existing.rootAgentInstanceId)
    const currentState = nextAgentRuntimeStates[scopeId] ?? createEmptyAgentRuntimeState(scopeId, agentInstanceId, now)
    const hydratedMessages = batch.bubbles.map((bubble) => ({
      ...chatBubbleToMessage(bubble),
      agentInstanceId,
    }))
    const mergedMessages = mergeHydratedMessages(currentState.messages, hydratedMessages, mode)
    nextAgentRuntimeStates[scopeId] = {
      ...currentState,
      messages: mergedMessages,
      queuedUserMessages: reconcileQueuedUserMessages(currentState.queuedUserMessages, mergedMessages),
      messageCount: mode === "baseline" ? mergedMessages.length : Math.max(currentState.messageCount, mergedMessages.length),
      retainedMessageCount: mergedMessages.length,
      hydrationState: "ready",
      lastHydratedAt: now,
      pendingInteraction: restorePendingInteractionFromMessages(mergedMessages),
      latestTimelineMessage: latestTimelineMessageFrom(mergedMessages),
    }
  }

  const hydrated: SceneSlice = {
    ...next,
    lastHydratedAt: now,
    isDirty: false,
    isRestoring: false,
    restoreReason: null,
    agentRuntimeStates: nextAgentRuntimeStates,
  }
  return normalizeAgentLedgers(hydrated)
}


function createEmptyAgentRuntimeState(
  scopeId: string,
  agentInstanceId: string,
  now: number = Date.now(),
): AgentRuntimeState {
  return {
    scopeId,
    agentInstanceId,
    messages: [],
    queuedUserMessages: [],
    terminalSessions: [],
    pendingInteraction: null,
    latestTimelineMessage: null,
    messageCount: 0,
    retainedMessageCount: 0,
    hydrationState: "ready",
    lastHydratedAt: null,
    uiCacheTier: "warm",
    // 0 means this scope has never been user-viewed; runtime/inventory creation must not fabricate recency.
    lastViewedAt: 0,
    lastRuntimeActivityAt: now,
  }
}

function latestTimelineMessageFrom(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (isExecutionTimelineMessage(messages[index])) return messages[index]
  }
  return null
}


function sameObjectList<T>(left: T[], right: T[]): boolean {
  if (left === right) return true
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function samePendingInteraction(
  left: PendingInteraction | null,
  right: PendingInteraction | null,
): boolean {
  if (left === right) return true
  if (!left || !right) return false
  return left.eventId === right.eventId
    && left.interaction_state === right.interaction_state
    && left.requires_user_response === right.requires_user_response
}

function stabilizeAgentRuntimeState(
  previous: AgentRuntimeState | undefined,
  next: AgentRuntimeState,
): AgentRuntimeState {
  if (!previous) return next
  if (
    previous.scopeId === next.scopeId
    && previous.agentInstanceId === next.agentInstanceId
    && sameObjectList(previous.messages, next.messages)
    && sameObjectList(previous.queuedUserMessages, next.queuedUserMessages)
    && sameObjectList(previous.terminalSessions, next.terminalSessions)
    && previous.latestTimelineMessage === next.latestTimelineMessage
    && samePendingInteraction(previous.pendingInteraction, next.pendingInteraction)
    && previous.messageCount === next.messageCount
    && previous.retainedMessageCount === next.retainedMessageCount
    && previous.hydrationState === next.hydrationState
    && previous.lastHydratedAt === next.lastHydratedAt
    && previous.uiCacheTier === next.uiCacheTier
    && previous.lastViewedAt === next.lastViewedAt
    && previous.lastRuntimeActivityAt === next.lastRuntimeActivityAt
  ) {
    return previous
  }
  return {
    ...next,
    messages: sameObjectList(previous.messages, next.messages) ? previous.messages : next.messages,
    queuedUserMessages: sameObjectList(previous.queuedUserMessages, next.queuedUserMessages)
      ? previous.queuedUserMessages
      : next.queuedUserMessages,
    terminalSessions: sameObjectList(previous.terminalSessions, next.terminalSessions)
      ? previous.terminalSessions
      : next.terminalSessions,
    pendingInteraction: samePendingInteraction(previous.pendingInteraction, next.pendingInteraction)
      ? previous.pendingInteraction
      : next.pendingInteraction,
    latestTimelineMessage: previous.latestTimelineMessage === next.latestTimelineMessage
      ? previous.latestTimelineMessage
      : next.latestTimelineMessage,
  }
}

function ensureAllAgentStates(slice: SceneSlice): SceneSlice {
  const now = Date.now()
  const agentRuntimeStates = { ...(slice.agentRuntimeStates ?? {}) }
  const ensure = (agentInstanceId: string) => {
    const normalizedAgentInstanceId = agentInstanceId.trim()
    if (!normalizedAgentInstanceId) return
    const scopeId = chatAgentRuntimeScopeId(slice.sceneId, normalizedAgentInstanceId, slice.rootAgentInstanceId)
    if (agentRuntimeStates[scopeId]) return
    agentRuntimeStates[scopeId] = createEmptyAgentRuntimeState(scopeId, normalizedAgentInstanceId, now)
  }
  if (slice.rootAgentInstanceId) ensure(slice.rootAgentInstanceId)
  for (const agentInstanceId of slice.agentInstanceOrder) ensure(agentInstanceId)
  for (const agentInstanceId of Object.keys(slice.agentInstances)) ensure(agentInstanceId)
  return { ...slice, agentRuntimeStates }
}

function markAgentViewed(
  slice: SceneSlice,
  agentInstanceId: string,
  viewedAt: number = Date.now(),
): SceneSlice {
  const ensured = ensureAllAgentStates(slice)
  const scopeId = chatAgentRuntimeScopeId(ensured.sceneId, agentInstanceId, ensured.rootAgentInstanceId)
  const current = ensured.agentRuntimeStates[scopeId] ?? createEmptyAgentRuntimeState(scopeId, agentInstanceId, viewedAt)
  const next: AgentRuntimeState = {
    ...current,
    lastViewedAt: viewedAt,
    uiCacheTier: "hot",
  }
  return {
    ...ensured,
    agentRuntimeStates: {
      ...ensured.agentRuntimeStates,
      [scopeId]: stabilizeAgentRuntimeState(current, next),
    },
  }
}

function updateAgentLedger(
  slice: SceneSlice,
  agentInstanceId: string | null | undefined,
  updater: (state: AgentRuntimeState) => AgentRuntimeState,
): SceneSlice {
  const now = Date.now()
  const ensured = ensureAllAgentStates(slice)
  if (!agentInstanceId) {
    console.warn("[chatStore] drop agent ledger update: missing agent owner")
    return ensured
  }
  const resolved = agentInstanceId
  const scopeId = chatAgentRuntimeScopeId(ensured.sceneId, resolved, ensured.rootAgentInstanceId)
  const current = ensured.agentRuntimeStates[scopeId] ?? createEmptyAgentRuntimeState(scopeId, resolved, now)
  const next = updater({
    ...current,
    lastRuntimeActivityAt: now,
  })
  return {
    ...ensured,
    agentRuntimeStates: {
      ...ensured.agentRuntimeStates,
      [scopeId]: stabilizeAgentRuntimeState(current, next),
    },
  }
}

function resumedRunStatus(slice: SceneSlice): string {
  const selectedAgentInstanceId = slice.selectedAgentInstanceId ?? slice.rootAgentInstanceId
  const selectedAgentStatus = selectedAgentInstanceId
    ? slice.agentInstances[selectedAgentInstanceId]?.status
    : slice.agentInstance?.status
  return selectedAgentStatus && selectedAgentStatus !== "paused" ? selectedAgentStatus : "running"
}

export function resolveAgentRuntimeState(
  scene: Pick<SceneSlice, "sceneId" | "rootAgentInstanceId" | "agentRuntimeStates"> | null | undefined,
  agentInstanceId: string | null | undefined,
 ): AgentRuntimeState | null {
  if (!scene) return null
  const resolvedAgentInstanceId = agentInstanceId ?? scene.rootAgentInstanceId
  if (!resolvedAgentInstanceId) return null
  const scopeId = chatAgentRuntimeScopeId(scene.sceneId, resolvedAgentInstanceId, scene.rootAgentInstanceId)
  return scene.agentRuntimeStates[scopeId] ?? null
}

export function getAgentRuntimeState(
  sceneId: string,
  agentInstanceId: string | null | undefined,
 ): AgentRuntimeState | null {
  return resolveAgentRuntimeState(useChatStore.getState().scenes[sceneId], agentInstanceId)
}

function messageLimitForTier(tier: SceneCacheTier): number {
  if (tier === "cold") return MAX_COLD_MESSAGES
  if (tier === "warm") return MAX_WARM_MESSAGES
  return MAX_HOT_MESSAGES
}

function isChatDebugEnabled(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(CHAT_DEBUG_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

function rawEventLimitForTier(tier: SceneCacheTier): number {
  if (tier === "cold") return MAX_COLD_RAW_EVENTS
  if (tier === "warm") return MAX_WARM_RAW_EVENTS
  if (tier === "hot" && isChatDebugEnabled()) return MAX_HOT_RAW_EVENTS_DEBUG
  return MAX_HOT_RAW_EVENTS
}

function terminalLineLimitForTier(tier: SceneCacheTier): number {
  if (tier === "cold") return MAX_COLD_TERMINAL_LINES
  if (tier === "warm") return MAX_WARM_TERMINAL_LINES
  return MAX_TERMINAL_VISIBLE_LINES_PER_TERMINAL
}

function trimMessagesForTier(messages: ChatMessage[], tier: SceneCacheTier): ChatMessage[] {
  const limit = messageLimitForTier(tier)
  // cold 等 limit<=0：只保留 pending interaction 正文，其余全部 eviction。
  // 注意 JS 的 array.slice(-0) === array.slice(0)，会错误保留全部内容。
  if (limit <= 0) {
    return messages.filter((message) => message.interactionState === "pending")
  }
  if (messages.length <= limit) return messages
  const retained = messages.slice(-limit)
  const pendingMessages = messages.filter((message) => message.interactionState === "pending")
  if (pendingMessages.length === 0) return retained
  const retainedIds = new Set(retained.map((message) => message.id))
  const missingPendingMessages = pendingMessages.filter((message) => !retainedIds.has(message.id))
  return missingPendingMessages.length > 0 ? [...missingPendingMessages, ...retained] : retained
}

/** 列出需要按 agent_instance_id 定向补水的 Agent scope。 */
export function listAgentScopesNeedingHydration(
  scene: Pick<SceneSlice, "agentRuntimeStates"> | null | undefined,
  agentInstanceId: string | null | undefined,
): AgentRuntimeState[] {
  const targetAgentInstanceId = agentInstanceId?.trim()
  if (!scene || !targetAgentInstanceId) return []
  return Object.values(scene.agentRuntimeStates ?? {}).filter((state) => {
    if (state.agentInstanceId !== targetAgentInstanceId) return false
    if (state.hydrationState === "needs_hydration" || state.hydrationState === "failed") return true
    if (state.hydrationState === "hydrating") return false
    return state.retainedMessageCount === 0 && state.messageCount > 0
  })
}

export function markAgentScopesHydrating(
  sceneId: string,
  agentInstanceIds: string[],
): void {
  useChatStore.setState((state) => {
    const existing = state.scenes[sceneId]
    if (!existing) return state
    let changed = false
    const agentRuntimeStates = { ...existing.agentRuntimeStates }
    for (const agentInstanceId of agentInstanceIds) {
      if (!agentInstanceId.trim()) continue
      const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, existing.rootAgentInstanceId)
      const current = agentRuntimeStates[scopeId]
      if (!current || current.hydrationState === "hydrating") continue
      agentRuntimeStates[scopeId] = {
        ...current,
        hydrationState: "hydrating",
      }
      changed = true
    }
    if (!changed) return state
    return {
      scenes: {
        ...state.scenes,
        [sceneId]: {
          ...existing,
          agentRuntimeStates,
        },
      },
    }
  })
}

export function markAgentScopesHydrationFailed(
  sceneId: string,
  agentInstanceIds: string[],
): void {
  useChatStore.setState((state) => {
    const existing = state.scenes[sceneId]
    if (!existing) return state
    let changed = false
    const agentRuntimeStates = { ...existing.agentRuntimeStates }
    for (const agentInstanceId of agentInstanceIds) {
      if (!agentInstanceId.trim()) continue
      const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, existing.rootAgentInstanceId)
      const current = agentRuntimeStates[scopeId]
      if (!current) continue
      agentRuntimeStates[scopeId] = {
        ...current,
        hydrationState: "failed",
      }
      changed = true
    }
    if (!changed) return state
    return {
      scenes: {
        ...state.scenes,
        [sceneId]: {
          ...existing,
          agentRuntimeStates,
        },
      },
    }
  })
}

function trimTailByTier<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items
  return items.slice(-limit)
}

/** 选中当前活动场景的切片，未选中时返回 null。 */
export const selectActiveSlice = (state: ChatStore): SceneSlice | null =>
  state.activeSceneId ? state.scenes[state.activeSceneId] ?? null : null

/** 读取所有已打开场景的切片列表（未排序、以插入顺序为准）。 */
export const selectOpenedScenes = (state: ChatStore): SceneSlice[] =>
  Object.values(state.scenes)

/** Hook 版：返回已打开的场景列表并采用 shallow 比较避免不必要重渲染。 */
export const useOpenedScenes = (): SceneSlice[] =>
  useChatStore(useShallow(selectOpenedScenes))

/** Returns the canonical accepted message produced for a user.message.accepted event. */
export function findAcceptedMessageForEvent(
  scene: Pick<SceneSlice, "sceneId" | "rootAgentInstanceId" | "agentRuntimeStates"> | null | undefined,
  event: Pick<AgentEvent, "message_id" | "payload">,
  agentInstanceId: string,
): ChatMessage | null {
  const agentState = resolveAgentRuntimeState(scene, agentInstanceId)
  if (!agentState) return null
  const payload = event.payload as { pending_message_id?: string | null; client_message_id?: string | null; user_message_id?: string | null }
  return agentState.messages.find((message) =>
    message.id === event.message_id
    || (payload.client_message_id && message.clientMessageId === payload.client_message_id)
    || (payload.user_message_id && message.backendMessageId === payload.user_message_id)
    || (payload.pending_message_id && message.content.metadata?.chat_bubble_pending_message_id === payload.pending_message_id),
  ) ?? null
}

function reduceAgentEvent(state: SceneSlice, event: AgentEvent): SceneSlice {
  if (event.seq <= state.lastSeq) return state
  const rawLimit = rawEventLimitForTier(state.cacheTier)
  const rawEvents = rawLimit > 0
    ? [...state.rawEvents, compactRawEvent(event)].slice(-rawLimit)
    : []
  const baseState = { ...state, rawEvents, lastSeq: event.seq, streamId: event.stream_id }
  const eventAgentInstanceId = liveEventAgentInstanceId(event)
  if (liveEventRequiresAgentOwner(event) && !eventAgentInstanceId) {
    console.warn("[chatStore] drop owner-required live event: missing agent owner", event.type, event.message_id)
    return baseState
  }

  if (event.metadata.task_id && event.metadata.task_id !== state.taskId) {
    baseState.taskId = event.metadata.task_id
  }

  if (event.type === "agent.task.started") {
    return updateAgentInstanceStatus(baseState, eventAgentInstanceId, "running")
  }

  if (event.type === "agent.task.paused") {
    return updateAgentInstanceStatus(baseState, eventAgentInstanceId, "paused")
  }

  if (event.type === "agent.task.completed") {
    return updateAgentInstanceStatus(baseState, eventAgentInstanceId, "completed")
  }

  if (event.type === "agent.task.failed") {
    return updateAgentInstanceStatus(baseState, eventAgentInstanceId, "failed")
  }

  if (event.type === "agent.task.cancelled") {
    return updateAgentInstanceStatus(baseState, eventAgentInstanceId, "cancelled")
  }

  if (event.type === "agent.subagent.created") {
    return addSubagentCreatedEvent(baseState, event.payload as SubagentCreatedPayload)
  }

  if (event.type === "agent.subagent.completed" || event.type === "agent.subagent.failed") {
    const payload = event.payload as { released_agent_instance_ids?: string[] }
    const releasedAgentInstanceIds = payload.released_agent_instance_ids?.length
      ? payload.released_agent_instance_ids
      : eventAgentInstanceId ? [eventAgentInstanceId] : []
    return markAgentInstancesReleased(
      baseState,
      releasedAgentInstanceIds,
      event.type === "agent.subagent.failed" ? "failed" : "completed",
      event.type,
    )
  }

  if (event.type === "agent.subagent.released") {
    const payload = event.payload as SubagentReleasedPayload
    return markAgentInstancesReleased(
      baseState,
      payload.released_agent_instance_ids?.length ? payload.released_agent_instance_ids : [payload.child_agent_instance_id],
      "released",
      payload.reason ?? event.type,
    )
  }

  if (event.type === "agent.execution.interrupted") {
    return updateAgentInstanceStatus(baseState, eventAgentInstanceId, "ready")
  }

  if (event.type === "user.message.accepted") {
    const payload = event.payload as UserMessageAcceptedPayload
    return confirmUserMessage(baseState, payload, event)
  }

  if (event.type === "agent.lifecycle.message") {
    // Coordinator materializes the lifecycle DTO after canonical event reduction.
    return baseState
  }

  if (event.type === "agent.interaction.requested") {
    const payload = event.payload as AskUserRequestedPayload
    const pendingInteraction = {
      ...payload,
      requires_user_response: payload.requires_user_response ?? true,
      interaction_state: payload.interaction_state ?? "pending",
      eventId: event.message_id,
    }
    // interaction bubble 由 ChatBubble 投影 hydrate；这里只更新目标 Agent 的 pending 控制态。
    const withPending = updateAgentLedger(baseState, eventAgentInstanceId, (agentState) => ({
      ...agentState,
      pendingInteraction: pendingInteraction.interaction_state === "pending" ? pendingInteraction : null,
    }))
    return pendingInteraction.interaction_state === "pending"
      ? updateAgentInstanceStatus(withPending, eventAgentInstanceId, "paused")
      : withPending
  }

  // Coordinator 聚合 LLM / tool 的 execution_process metadata，并统一提交持久化队列。
  // chatStore 不再在内存里单独维护 ExecutionBlock / ToolActivity 体系，避免与气泡成为双重源。
  // 保留 scene 级 token usage 累加用于历史兼容；Agent tab header 的 TokenMeter 读取实例级 context_usage。
  if (event.type === "llm.response.completed") {
    const payload = event.payload as LlmResponseCompletedPayload
    const usage = payload.token_usage ?? null
    const nextTotals = usage ? accumulateTokenUsage(baseState.tokenUsageTotals, usage) : baseState.tokenUsageTotals
    const nextContextWindow = typeof payload.context_window_max === "number" && payload.context_window_max > 0
      ? payload.context_window_max
      : baseState.contextWindowMax
    const nextAgentInstances = updateAgentInstanceContextUsage(
      baseState.agentInstances,
      eventAgentInstanceId,
      payload,
    )
    const nextAgentInstance = baseState.agentInstance?.instance_id && nextAgentInstances[baseState.agentInstance.instance_id]
      ? nextAgentInstances[baseState.agentInstance.instance_id]
      : baseState.agentInstance
    return {
      ...baseState,
      agentInstances: nextAgentInstances,
      agentInstance: nextAgentInstance,
      lastTokenUsage: usage,
      tokenUsageTotals: nextTotals,
      contextWindowMax: nextContextWindow,
    }
  }

  if (event.type === "terminal.created") {
    const payload = event.payload as TerminalCreatedPayload
    if (!eventAgentInstanceId) {
      console.warn("[chatStore] drop terminal.created: missing agent owner", event.message_id)
      return baseState
    }
    const terminalId = payload.terminal_id
    const session: TerminalSession = {
      id: terminalId,
      terminalId,
      commandVisible: false,
      toolCallId: event.correlation_id ?? terminalId,
      commandLine: "",
      cwd: payload.cwd,
      shell: payload.shell,
      status: "completed",
      output: [],
      agentInstanceId: eventAgentInstanceId,
    }
    return updateAgentLedger(baseState, eventAgentInstanceId, (agentState) => {
      if (agentState.terminalSessions.some((item) => (item.terminalId ?? item.id) === terminalId)) return agentState
      return {
        ...agentState,
        terminalSessions: compactTerminalSessions(
          [session, ...agentState.terminalSessions],
          terminalLineLimitForTier(agentState.uiCacheTier),
        ),
      }
    })
  }

  if (event.type === "terminal.session.started") {
    const payload = event.payload as TerminalSessionStartedPayload
    if (!eventAgentInstanceId) {
      console.warn("[chatStore] drop terminal.session.started: missing agent owner", event.message_id)
      return baseState
    }
    const session: TerminalSession = {
      id: payload.terminal_session_id,
      terminalId: payload.terminal_id,
      commandVisible: true,
      toolCallId: payload.tool_call_id,
      commandLine: payload.command_line,
      cwd: payload.cwd,
      shell: payload.shell,
      status: "running",
      output: [],
      agentInstanceId: eventAgentInstanceId,
    }
    return updateAgentLedger(baseState, eventAgentInstanceId, (agentState) => {
      const terminalSessions = agentState.terminalSessions.filter(
        (existingSession) => existingSession.id !== (payload.terminal_id ?? payload.terminal_session_id),
      )
      return {
        ...agentState,
        terminalSessions: compactTerminalSessions(
          [session, ...terminalSessions],
          terminalLineLimitForTier(agentState.uiCacheTier),
        ),
      }
    })
  }

  if (event.type === "terminal.output.delta") {
    return reduceTerminalOutputDeltaEvents(state, [event], true)
  }

  if (event.type === "terminal.session.completed") {
    const payload = event.payload as TerminalSessionCompletedPayload
    const completedAgentInstanceId = eventMetadataAgentInstanceId(event)
    if (!completedAgentInstanceId) {
      console.warn("[chatStore] drop terminal.session.completed: missing agent owner", event.message_id)
      return baseState
    }
    return updateAgentLedger(baseState, completedAgentInstanceId, (agentState) => ({
      ...agentState,
      terminalSessions: compactTerminalSessions(
        agentState.terminalSessions.map((session) =>
          session.id === payload.terminal_session_id
            ? { ...session, status: payload.exit_code === 0 ? "completed" : "failed", exitCode: payload.exit_code }
            : session,
        ),
        terminalLineLimitForTier(agentState.uiCacheTier),
      ),
    }))
  }

  if (event.type === "terminal.deleted") {
    const payload = event.payload as TerminalDeletedPayload
    return removeTerminalSessionsById(baseState, eventAgentInstanceId as string, payload.terminal_id)
  }

  if (event.type === "frontend.debug.element.selected") {
    const payload = event.payload as FrontendDebugElementSelectedPayload
    return applyComposerDraft(
      baseState,
      eventAgentInstanceId,
      formatFrontendDebugElementDraft(payload),
    )
  }

  return baseState
}

function reduceAgentEvents(state: SceneSlice, events: AgentEvent[]): SceneSlice {
  let current = state
  let pendingTerminalOutputEvents: AgentEvent[] = []
  const terminalOutputOwnerIds = new Set<string>()

  const flushPendingTerminalOutputEvents = () => {
    if (pendingTerminalOutputEvents.length === 0) return
    current = reduceTerminalOutputDeltaEvents(current, pendingTerminalOutputEvents, false)
    pendingTerminalOutputEvents = []
  }

  for (const event of events) {
    if (event.type === "terminal.output.delta") {
      const ownerId = liveEventAgentInstanceId(event)
      if (ownerId) terminalOutputOwnerIds.add(ownerId)
      pendingTerminalOutputEvents.push(event)
      continue
    }

    flushPendingTerminalOutputEvents()
    current = reduceAgentEvent(current, event)
  }

  flushPendingTerminalOutputEvents()
  let compacted = current
  for (const ownerId of terminalOutputOwnerIds) {
    compacted = updateAgentLedger(compacted, ownerId, (agentState) => ({
      ...agentState,
      terminalSessions: compactTerminalSessions(
        agentState.terminalSessions,
        terminalLineLimitForTier(agentState.uiCacheTier),
      ),
    }))
  }
  return compacted
}

function reduceTerminalOutputDeltaEvents(state: SceneSlice, events: AgentEvent[], compact: boolean): SceneSlice {
  const acceptedEvents = events.filter((event) => event.seq > state.lastSeq)
  if (acceptedEvents.length === 0) return state

  let taskId = state.taskId
  for (const event of acceptedEvents) {
    if (event.metadata.task_id && event.metadata.task_id !== taskId) {
      taskId = event.metadata.task_id
    }
  }

  const rawLimit = rawEventLimitForTier(state.cacheTier)
  const rawEvents = rawLimit > 0
    ? [...state.rawEvents, ...acceptedEvents.map(compactRawEvent)].slice(-rawLimit)
    : []
  const lastEvent = acceptedEvents[acceptedEvents.length - 1]
  let next: SceneSlice = {
    ...state,
    rawEvents,
    lastSeq: lastEvent.seq,
    streamId: lastEvent.stream_id,
    taskId,
  }
  const outputByOwnerAndSession = new Map<string, Map<string, TerminalOutputDeltaPayload[]>>()
  for (const event of acceptedEvents) {
    const ownerId = eventMetadataAgentInstanceId(event)
    if (!ownerId) {
      console.warn("[chatStore] drop terminal.output.delta: missing agent owner", event.message_id)
      continue
    }
    const payload = event.payload as TerminalOutputDeltaPayload
    const bySession = outputByOwnerAndSession.get(ownerId) ?? new Map<string, TerminalOutputDeltaPayload[]>()
    const chunks = bySession.get(payload.terminal_session_id) ?? []
    chunks.push(payload)
    bySession.set(payload.terminal_session_id, chunks)
    outputByOwnerAndSession.set(ownerId, bySession)
  }
  for (const [ownerId, bySession] of outputByOwnerAndSession.entries()) {
    next = updateAgentLedger(next, ownerId, (agentState) => {
      const terminalSessions = agentState.terminalSessions.map((session) => {
        const chunks = bySession.get(session.id)
        if (!chunks || chunks.length === 0) return session
        return { ...session, output: [...session.output, ...chunks] }
      })
      return {
        ...agentState,
        terminalSessions: compact
          ? compactTerminalSessions(terminalSessions, terminalLineLimitForTier(agentState.uiCacheTier))
          : terminalSessions,
      }
    })
  }
  return next
}

function removeTerminalSessionsById(
  state: SceneSlice,
  agentInstanceId: string,
  terminalId: string,
): SceneSlice {
  return updateAgentLedger(state, agentInstanceId, (agentState) => ({
    ...agentState,
    terminalSessions: agentState.terminalSessions.filter(
      (session) => (session.terminalId ?? session.id) !== terminalId,
    ),
  }))
}

function eventMetadataAgentInstanceId(event: AgentEvent): string | undefined {
  const metadataAgentInstanceId = (event.metadata as Record<string, unknown>).agent_instance_id
  return typeof metadataAgentInstanceId === "string" && metadataAgentInstanceId.length > 0
    ? metadataAgentInstanceId
    : undefined
}

function eventPayloadAgentInstanceId(event: AgentEvent): string | undefined {
  const payloadAgentInstanceId = (event.payload as Record<string, unknown> | null | undefined)?.agent_instance_id
  return typeof payloadAgentInstanceId === "string" && payloadAgentInstanceId.length > 0
    ? payloadAgentInstanceId
    : undefined
}

export function liveEventAgentInstanceId(event: AgentEvent): string | null {
  return eventPayloadAgentInstanceId(event) ?? eventMetadataAgentInstanceId(event) ?? null
}

export function liveEventRequiresAgentOwner(event: Pick<AgentEvent, "type">): boolean {
  return event.type.startsWith("agent.")
    || event.type.startsWith("user.message.")
    || event.type.startsWith("llm.")
    || event.type.startsWith("tool.")
    || event.type.startsWith("context_compression.")
    || event.type.startsWith("terminal.")
    || event.type.startsWith("frontend.debug.")
}

function compactRawEvent(event: AgentEvent): AgentEvent {
  if (event.type === "terminal.output.delta") {
    const payload = event.payload as TerminalOutputDeltaPayload
    return { ...event, payload: { ...payload, chunk: "" } }
  }
  if (event.type === "llm.thinking.delta" || event.type === "llm.content.delta") {
    const payload = event.payload as Record<string, unknown>
    return { ...event, payload: { ...payload, delta: "" } }
  }
  if (event.type === "llm.tool_call.arguments.delta") {
    const payload = event.payload as Record<string, unknown>
    return { ...event, payload: { ...payload, delta: "", arguments_partial: "" } }
  }
  return event
}

function formatFrontendDebugElementDraft(payload: FrontendDebugElementSelectedPayload): string {
  const element = payload.element ?? {}
  const rect = element.bounding_rect
  const attributes = element.attributes ? JSON.stringify(element.attributes, null, 2) : "{}"
  const outerHtml = element.outer_html?.trim() || ""
  const text = element.text?.trim() || ""
  const lines = [
    "我选择了一个前端页面元素，请基于这个元素上下文继续分析或修改：",
    "",
    `- 调试会话：${payload.session_name || payload.session_id}`,
    `- 目标页面：${payload.target_url}`,
    `- 调试页面：${payload.debug_url}`,
    `- 实际页面：${element.page_url || "未知"}`,
    `- 文档标题：${element.document_title || "未知"}`,
    `- 元素标签：${element.tag_name || "未知"}`,
    `- CSS Selector：${element.selector || "未知"}`,
    `- XPath：${element.xpath || "未知"}`,
    `- 元素 ID：${element.id || "无"}`,
    `- 元素 class：${element.class_name || "无"}`,
    rect
      ? `- 元素位置：x=${rect.x ?? "?"}, y=${rect.y ?? "?"}, width=${rect.width ?? "?"}, height=${rect.height ?? "?"}`
      : "- 元素位置：未知",
    "",
    "元素文本：",
    "```text",
    text || "<empty>",
    "```",
    "",
    "元素属性：",
    "```json",
    attributes,
    "```",
    "",
    "元素 HTML：",
    "```html",
    outerHtml || "<empty>",
    "```",
  ]
  return lines.join("\n")
}

function compactTerminalSessions(sessions: TerminalSession[], maxVisibleLines: number = MAX_TERMINAL_VISIBLE_LINES_PER_TERMINAL): TerminalSession[] {
  // cold tier: 只保留 session 元数据，清空输出行。
  if (maxVisibleLines <= 0) {
    return sessions.map((session) => ({
      ...session,
      commandVisible: false,
      output: [],
    }))
  }

  const sessionsByTerminal = new Map<string, TerminalSession[]>()

  for (const session of sessions) {
    const terminalKey = terminalSessionKey(session)
    const terminalSessions = sessionsByTerminal.get(terminalKey) ?? []
    terminalSessions.push(session)
    sessionsByTerminal.set(terminalKey, terminalSessions)
  }

  const compactedBySessionId = new Map<string, TerminalSession>()

  for (const terminalSessions of sessionsByTerminal.values()) {
    let remainingLines = maxVisibleLines

    for (const session of terminalSessions) {
      if (remainingLines <= 0) break

      const outputLineCount = countOutputLines(session.output)
      const commandLineCount = session.commandVisible === false ? 0 : 1
      const sessionLineCount = commandLineCount + outputLineCount

      if (sessionLineCount <= remainingLines) {
        compactedBySessionId.set(session.id, session)
        remainingLines -= sessionLineCount
        continue
      }

      if (outputLineCount >= remainingLines) {
        compactedBySessionId.set(session.id, {
          ...session,
          commandVisible: false,
          output: trimOutputToLineLimit(session.output, remainingLines),
        })
        break
      }

      compactedBySessionId.set(session.id, {
        ...session,
        commandVisible: commandLineCount > 0 && remainingLines > outputLineCount,
      })
      break
    }
  }

  return sessions.filter((session) => compactedBySessionId.has(session.id)).map((session) => compactedBySessionId.get(session.id) ?? session)
}

function terminalSessionKey(session: TerminalSession): string {
  return session.terminalId ?? session.id
}

function countOutputLines(output: TerminalOutputDeltaPayload[]): number {
  if (output.length === 0) return 0
  return 1 + output.reduce((total, chunk) => total + countLineBreaks(chunk.chunk), 0)
}

function countLineBreaks(text: string): number {
  return text.match(/\r\n|\r|\n/g)?.length ?? 0
}

function trimOutputToLineLimit(output: TerminalOutputDeltaPayload[], maxLines: number): TerminalOutputDeltaPayload[] {
  if (maxLines <= 0 || output.length === 0) return []
  const outputLineCount = countOutputLines(output)
  if (outputLineCount <= maxLines) return output

  let linesToDrop = outputLineCount - maxLines
  const trimmed: TerminalOutputDeltaPayload[] = []

  for (const chunk of output) {
    let text = chunk.chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    while (linesToDrop > 0 && text.length > 0) {
      const nextLineBreak = text.indexOf("\n")
      if (nextLineBreak < 0) {
        text = ""
        break
      }
      text = text.slice(nextLineBreak + 1)
      linesToDrop -= 1
    }
    if (linesToDrop <= 0 && text.length > 0) {
      trimmed.push({ ...chunk, chunk: text })
    }
  }

  if (trimmed.length === 0 && maxLines > 0) {
    return [{ ...output[output.length - 1], chunk: "" }]
  }
  return trimmed
}

function appendMessage(state: SceneSlice, message: ChatMessage): SceneSlice {
  const ownerId = message.agentInstanceId
  if (!ownerId) {
    console.warn("[chatStore] drop appendMessage: missing agent owner")
    return state
  }
  return updateAgentLedger(state, ownerId, (agentState) => {
    const ownedMessage: ChatMessage = {
      ...message,
      agentInstanceId: ownerId,
    }
    const messages = mergeHydratedMessages(agentState.messages, [ownedMessage], "incremental")
    return {
      ...agentState,
      messages,
      messageCount: Math.max(agentState.messageCount, messages.length),
      retainedMessageCount: messages.length,
      latestTimelineMessage: isExecutionTimelineMessage(ownedMessage)
        ? ownedMessage
        : agentState.latestTimelineMessage,
      pendingInteraction: restorePendingInteractionFromMessages(messages),
    }
  })
}

export function mergeHydratedMessages(
  existingMessages: ChatMessage[],
  hydratedMessages: ChatMessage[],
  mode: ChatBubbleHydrationMode,
): ChatMessage[] {
  let messages = mode === "baseline" ? [] : collapseMessageAliases(existingMessages)
  for (const hydratedMessage of collapseMessageAliases(hydratedMessages)) {
    const identityKeys = new Set(messageIdentityKeys(hydratedMessage))
    const answered = existingMessages.find((message) =>
      message.interactionState === "answered"
      && messageIdentityKeys(message).some((key) => identityKeys.has(key)),
    )
    messages = mergeHydratedMessageAtStableOccurrence(messages, answered
      ? { ...hydratedMessage, interactionState: "answered", selectedOptionId: answered.selectedOptionId ?? hydratedMessage.selectedOptionId }
      : hydratedMessage)
  }
  messages = reconcileAnsweredInteractions(messages)
  if (mode !== "baseline") return messages
  return restoreExecutionRounds([...messages].sort(compareDurableBubbleBaselineOrder))
}

export function reconcileQueuedUserMessages(queued: QueuedUserMessage[], messages: ChatMessage[]): QueuedUserMessage[] {
  return queued.filter((item) => !messages.some((message) =>
    message.status !== "sending" && message.status !== "failed"
    && (message.clientMessageId === item.clientMessageId
      || message.content.metadata?.chat_bubble_pending_message_id === item.pendingMessageId),
  ))
}

function reconcileAnsweredInteractions(messages: ChatMessage[]): ChatMessage[] {
  const replies = new Map<string, ChatMessage>()
  for (const message of messages) {
    const interactionId = message.content.metadata?.interaction_message_id
    if (message.role === "user" && message.status !== "failed" && typeof interactionId === "string") {
      replies.set(interactionId, message)
    }
  }
  return messages.map((message) => {
    const reply = replies.get(message.id)
    if (!reply) return message
    const optionId = reply.content.metadata?.interaction_option_id
    return {
      ...message,
      interactionState: "answered" as const,
      selectedOptionId: typeof optionId === "string" ? optionId : message.selectedOptionId,
    }
  })
}

function restoreExecutionRounds(messages: ChatMessage[]): ChatMessage[] {
  let previousExecutionRound = 0
  return messages.map((message) => {
    const bubbleKind = message.content.metadata?.bubble_kind
    if (bubbleKind === "task_boundary") {
      previousExecutionRound = 0
      return message
    }
    if (bubbleKind !== "execution_process") return message
    const metadata = message.content.metadata ?? {}
    const rawIterations = Array.isArray(metadata.iterations) ? metadata.iterations : []
    if (rawIterations.length === 0) return message
    const storedRound = positiveRound(metadata.execution_round)
    const executionRound = storedRound ?? previousExecutionRound + 1
    const executionRoundEnd = executionRound + rawIterations.length - 1
    previousExecutionRound = executionRoundEnd
    if (metadata.execution_round === executionRound && metadata.execution_round_end === executionRoundEnd) return message
    return {
      ...message,
      content: {
        ...message.content,
        metadata: {
          ...metadata,
          execution_round: executionRound,
          execution_round_end: executionRoundEnd,
        },
      },
    }
  })
}

function positiveRound(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

function isExecutionTimelineMessage(message: ChatMessage): boolean {
  const bubbleKind = message.content.metadata?.bubble_kind
  return bubbleKind === "execution_process" || bubbleKind === "task_boundary"
}

function collapseMessageAliases(messages: ChatMessage[]): ChatMessage[] {
  let collapsed: ChatMessage[] = []
  for (const message of messages) {
    collapsed = mergeHydratedMessageAtStableOccurrence(collapsed, message)
  }
  return collapsed
}

function mergeHydratedMessageAtStableOccurrence(
  messages: ChatMessage[],
  hydratedMessage: ChatMessage,
): ChatMessage[] {
  const hydratedIdentityKeys = new Set(messageIdentityKeys(hydratedMessage))
  const matchingIndices: number[] = []
  for (let index = 0; index < messages.length; index += 1) {
    if (messageIdentityKeys(messages[index]).some((key) => hydratedIdentityKeys.has(key))) {
      matchingIndices.push(index)
    }
  }
  if (matchingIndices.length === 0) return [...messages, hydratedMessage]

  const firstIndex = matchingIndices[0]
  let mergedMessage = messages[firstIndex]
  for (let index = 1; index < matchingIndices.length; index += 1) {
    mergedMessage = mergeHydratedMessageSnapshot(mergedMessage, messages[matchingIndices[index]])
  }
  mergedMessage = mergeHydratedMessageSnapshot(mergedMessage, hydratedMessage)

  const matchingIndexSet = new Set(matchingIndices)
  const nextMessages = messages.filter((_, index) => !matchingIndexSet.has(index))
  nextMessages.splice(firstIndex, 0, mergedMessage)
  return nextMessages
}

function mergeHydratedMessageSnapshot(current: ChatMessage, incoming: ChatMessage): ChatMessage {
  const currentSeq = messageCommunicationSeq(current)
  const incomingSeq = messageCommunicationSeq(incoming)
  const currentSortOrder = durableBubbleSortOrder(current)
  const incomingSortOrder = durableBubbleSortOrder(incoming)
  const durableSortOrder = incomingSortOrder > 0 ? incomingSortOrder : currentSortOrder
  const incomingIsStale = currentSeq > 0 && incomingSeq < currentSeq
  const currentMetadata = current.content.metadata ?? {}
  const incomingMetadata = incoming.content.metadata ?? {}

  if (incomingIsStale) {
    return {
      ...current,
      clientMessageId: current.clientMessageId ?? incoming.clientMessageId,
      backendMessageId: current.backendMessageId ?? incoming.backendMessageId,
      content: {
        ...current.content,
        metadata: {
          ...incomingMetadata,
          ...currentMetadata,
          ...(durableSortOrder > 0 ? { chat_bubble_sort_order: durableSortOrder } : {}),
          communication_seq: currentSeq,
        },
      },
    }
  }

  const communicationSeq = Math.max(currentSeq, incomingSeq)
  return {
    ...current,
    ...incoming,
    createdAt: current.createdAt,
    clientMessageId: incoming.clientMessageId ?? current.clientMessageId,
    backendMessageId: incoming.backendMessageId ?? current.backendMessageId,
    interactionState: current.interactionState === "answered" ? "answered" : incoming.interactionState ?? current.interactionState,
    selectedOptionId: current.selectedOptionId ?? incoming.selectedOptionId,
    content: {
      ...current.content,
      ...incoming.content,
      metadata: {
        ...currentMetadata,
        ...incomingMetadata,
        ...(durableSortOrder > 0 ? { chat_bubble_sort_order: durableSortOrder } : {}),
        ...(communicationSeq > 0 ? { communication_seq: communicationSeq } : {}),
      },
    },
  }
}

export function compareDurableBubbleBaselineOrder(left: ChatMessage, right: ChatMessage): number {
  const leftSortOrder = durableBubbleSortOrder(left)
  const rightSortOrder = durableBubbleSortOrder(right)
  if (leftSortOrder > 0 && rightSortOrder > 0) return leftSortOrder - rightSortOrder
  if (leftSortOrder > 0) return -1
  if (rightSortOrder > 0) return 1
  return 0
}

export function durableBubbleSortOrder(message: ChatMessage): number {
  const sortOrder = message.content.metadata?.chat_bubble_sort_order
  return typeof sortOrder === "number" && Number.isFinite(sortOrder) && sortOrder > 0 ? sortOrder : 0
}

function messageCommunicationSeq(message: ChatMessage): number {
  const communicationSeq = message.content.metadata?.communication_seq
  return typeof communicationSeq === "number" && Number.isFinite(communicationSeq) && communicationSeq > 0
    ? communicationSeq
    : 0
}

function messageIdentityScope(message: ChatMessage): string {
  const bubbleKind = message.content.metadata?.bubble_kind
  if (typeof bubbleKind === "string" && bubbleKind.length > 0) return bubbleKind
  if (message.role === "user") return "user_message"
  if (message.role === "local_agent") return "local_agent_message"
  if (message.role === "remote_agent") return "remote_agent_message"
  return message.role
}

function messageIdentityKeys(message: ChatMessage): string[] {
  const scope = messageIdentityScope(message)
  const keys = [`id:${scope}:${message.id}`]
  if (message.clientMessageId) keys.push(`client:${scope}:${message.clientMessageId}`)
  if (message.backendMessageId) keys.push(`backend:${scope}:${message.backendMessageId}`)
  const pendingMessageId = message.content.metadata?.chat_bubble_pending_message_id
  if (typeof pendingMessageId === "string" && pendingMessageId.length > 0) {
    keys.push(`pending:${scope}:${pendingMessageId}`)
  }
  return keys
}

function addSubagentCreatedEvent(state: SceneSlice, payload: SubagentCreatedPayload): SceneSlice {
  const maybeInstance = payload.agent_instance
  if (!maybeInstance || typeof maybeInstance !== "object") return state
  const instance = maybeInstance as AgentRuntimeInstance
  if (!instance.instance_id) return state
  const agentInstances = { ...state.agentInstances, [instance.instance_id]: instance }
  const agentInstanceOrder = state.agentInstanceOrder.includes(instance.instance_id)
    ? state.agentInstanceOrder
    : [...state.agentInstanceOrder, instance.instance_id]
  const relation: AgentParentChildRelationResponse = {
    relation_id: payload.relation_id,
    task_id: payload.task_id,
    parent_instance_id: payload.parent_agent_instance_id,
    child_instance_id: payload.child_agent_instance_id,
    created_at: payload.created_at,
    released: payload.released,
  }
  const parentChildRelations = [
    ...state.parentChildRelations.filter((existing) => existing.relation_id !== relation.relation_id),
    relation,
  ]
  const selectedAgentInstanceId = state.selectedAgentInstanceId ?? state.rootAgentInstanceId ?? instance.instance_id
  return {
    ...state,
    taskId: instance.task_id ?? state.taskId,
    agentInstances,
    agentInstanceOrder,
    parentChildRelations,
    selectedAgentInstanceId,
    agentInstance: selectedAgentInstanceId ? agentInstances[selectedAgentInstanceId] ?? state.agentInstance : state.agentInstance,
  }
}

function markAgentInstancesReleased(
  state: SceneSlice,
  agentInstanceIds: string[],
  status: string,
  releaseReason?: string | null,
 ): SceneSlice {
  const uniqueIds = [...new Set(agentInstanceIds.filter(Boolean))]
  if (uniqueIds.length === 0) return state
  const releasedIdSet = new Set(uniqueIds)
  const agentInstances = { ...state.agentInstances }
  for (const agentInstanceId of uniqueIds) {
    const current = state.agentInstances[agentInstanceId]
    if (current) {
      agentInstances[agentInstanceId] = { ...current, status }
    }
  }
  const parentChildRelations = state.parentChildRelations.map((relation) =>
    releasedIdSet.has(relation.child_instance_id)
      ? {
          ...relation,
          released: true,
          release_reason: releaseReason ?? relation.release_reason ?? status,
          released_at: relation.released_at ?? new Date().toISOString(),
        }
      : relation,
  )
  const selectedAgent = state.selectedAgentInstanceId ? agentInstances[state.selectedAgentInstanceId] ?? null : null
  return {
    ...state,
    agentInstances,
    parentChildRelations,
    agentInstance: selectedAgent ?? state.agentInstance,
    runStatus: state.selectedAgentInstanceId && releasedIdSet.has(state.selectedAgentInstanceId) ? status : state.runStatus,
  }
}

function applyComposerDraft(state: SceneSlice, agentInstanceId: string | null | undefined, draft: string): SceneSlice {
  if (!agentInstanceId) return { ...state, composerDraft: draft }
  return {
    ...state,
    composerDraft: state.rootAgentInstanceId === agentInstanceId ? draft : state.composerDraft,
    composerDraftsByAgentInstanceId: {
      ...(state.composerDraftsByAgentInstanceId ?? {}),
      [agentInstanceId]: draft,
    },
  }
}

export function chatBubbleToMessage(bubble: ChatBubbleMessageDto): ChatMessage {
  const role = normalizeMessageRole(bubble.role, bubble.metadata, bubble.channel)
  return {
    id: bubble.bubble_id,
    role,
    createdAt: bubble.created_at,
    status: bubble.status,
    content: {
      text: bubble.text,
      text_format: role === "user" ? "plain_text" : normalizeMessageTextFormat(bubble.text_format),
      channel: bubble.channel ?? "web",
      metadata: {
        ...bubble.metadata,
        chat_bubble_sort_order: bubble.sort_order,
        ...(bubble.pending_message_id ? { chat_bubble_pending_message_id: bubble.pending_message_id } : {}),
      },
    },
    attachments: normalizeAttachmentList(bubble.metadata?.attachments),
    clientMessageId: bubble.client_message_id ?? undefined,
    backendMessageId: bubble.backend_message_id ?? null,
    interactionOptions: bubble.interaction_options.length > 0
      ? bubble.interaction_options.map((option) => ({
        id: option.id,
        label: option.label,
        description: option.description ?? undefined,
      }))
      : undefined,
    interactionState: bubble.interaction_state,
    selectedOptionId: bubble.selected_option_id ?? undefined,
    agentInstanceId: bubble.agent_instance_id ?? undefined,
  }
}

export function restorePendingInteractionFromMessages(messages: ChatMessage[]): PendingInteraction | null {
  const interactionSuccessorMessages = buildInteractionSuccessorMessages(messages)
  const message = interactionSuccessorMessages[interactionSuccessorMessages.length - 1]
  if (!message || !isAgentResponseRole(message.role)) return null
  const hasInteraction = message.interactionState === "pending" || (message.interactionOptions?.length ?? 0) > 0
  if (!hasInteraction || message.selectedOptionId || message.interactionState === "answered") return null

  const metadata = message.content.metadata ?? {}
  const interactionId = typeof metadata.interaction_id === "string" && metadata.interaction_id
    ? metadata.interaction_id
    : message.id
  return {
    eventId: message.id,
    interaction_id: interactionId,
    question: {
      text: message.content.text,
      text_format: message.content.text_format,
    },
    options: message.interactionOptions ?? [],
    allow_free_text: metadata.allow_free_text === true,
    requires_user_response: true,
    interaction_state: "pending",
    loop_control: { decision: "pause" },
  }
}

function finalizeUserSubmission(
  state: SceneSlice,
  agentInstanceId: string,
  interactionSelection?: InteractionSelection,
): SceneSlice {
  const interactionMessageId = interactionSelection?.interactionMessageId
  if (!interactionMessageId) return state
  const currentAgentState = resolveAgentRuntimeState(state, agentInstanceId)
  const resolvesInteraction = Boolean(
    currentAgentState?.pendingInteraction?.eventId === interactionMessageId
    || currentAgentState?.messages.some((message) => message.id === interactionMessageId),
  )
  if (!resolvesInteraction) return state
  const updated = updateAgentLedger(state, agentInstanceId, (agentState) => {
    const messages = agentState.messages.map((message) => {
      if (message.id !== interactionMessageId) return message
      return {
        ...message,
        interactionState: "answered" as const,
        selectedOptionId: interactionSelection?.optionId ?? message.selectedOptionId,
      }
    })
    return {
      ...agentState,
      messages,
      pendingInteraction: agentState.pendingInteraction?.eventId === interactionMessageId
        ? null
        : agentState.pendingInteraction,
    }
  })
  const selectedAgentInstanceId = updated.selectedAgentInstanceId ?? updated.rootAgentInstanceId
  return selectedAgentInstanceId === agentInstanceId && updated.runStatus === "paused"
    ? { ...updated, runStatus: resumedRunStatus(updated) }
    : updated
}

function accumulateTokenUsage(totals: TokenUsageTotals, usage: TokenUsage): TokenUsageTotals {
  return {
    input_tokens: totals.input_tokens + (usage.input_tokens || 0),
    output_tokens: totals.output_tokens + (usage.output_tokens || 0),
    total_tokens: totals.total_tokens + (usage.total_tokens || 0),
    cached_tokens: totals.cached_tokens + (usage.cached_tokens || 0),
    reasoning_tokens: totals.reasoning_tokens + (usage.reasoning_tokens || 0),
    cache_creation_tokens: totals.cache_creation_tokens + (usage.cache_creation_tokens || 0),
    rounds: totals.rounds + 1,
  }
}

function updateAgentInstanceStatus(
  state: SceneSlice,
  agentInstanceId: string | null | undefined,
  status: string,
 ): SceneSlice {
  const selectedAgentInstanceId = state.selectedAgentInstanceId ?? state.agentInstance?.instance_id ?? state.rootAgentInstanceId ?? null
  const syncSceneRunStatus = !agentInstanceId || agentInstanceId === selectedAgentInstanceId

  if (!agentInstanceId) {
    return { ...state, runStatus: syncSceneRunStatus ? status : state.runStatus }
  }

  const currentInstance = state.agentInstances[agentInstanceId]
  const agentInstances = currentInstance
    ? {
        ...state.agentInstances,
        [agentInstanceId]: {
          ...currentInstance,
          status,
        },
      }
    : state.agentInstances
  const agentInstance = state.agentInstance?.instance_id === agentInstanceId
    ? {
        ...state.agentInstance,
        status,
      }
    : state.agentInstance

  return {
    ...state,
    agentInstances,
    agentInstance,
    runStatus: syncSceneRunStatus ? status : state.runStatus,
  }
}

function updateAgentInstanceContextUsage(
  agentInstances: Record<string, AgentRuntimeInstance>,
  agentInstanceId: string | null | undefined,
  payload: LlmResponseCompletedPayload,
): Record<string, AgentRuntimeInstance> {
  if (!agentInstanceId) return agentInstances
  const instance = agentInstances[agentInstanceId]
  if (!instance) return agentInstances

  const previous = instance.context_usage ?? null
  const usage = payload.token_usage ?? previous?.token_usage ?? null
  const contextWindowMax = typeof payload.context_window_max === "number" && payload.context_window_max > 0
    ? payload.context_window_max
    : previous?.context_window_max ?? null
  const usedTokens = typeof usage?.total_tokens === "number" && Number.isFinite(usage.total_tokens)
    ? Math.max(0, Math.round(usage.total_tokens))
    : previous?.context_window_used_tokens ?? 0
  const contextUsage: AgentContextUsage = {
    token_usage: usage,
    context_window_used_tokens: usedTokens,
    context_window_max: contextWindowMax,
    provider_id: payload.provider_id ?? previous?.provider_id ?? null,
    binding_id: payload.binding_id ?? previous?.binding_id ?? null,
    model_id: payload.model_id ?? previous?.model_id ?? null,
    model_alias: payload.model_alias ?? previous?.model_alias ?? null,
  }

  return {
    ...agentInstances,
    [agentInstanceId]: {
      ...instance,
      context_usage: contextUsage,
    },
  }
}

function normalizeMessageTextFormat(value: unknown): ChatMessage["content"]["text_format"] {
  if (value === "html" || value === "markdown" || value === "json" || value === "diff" || value === "plain_text") return value
  return "plain_text"
}

function normalizeMessageRole(value: unknown, metadata?: Record<string, unknown> | null, channel?: string | null): ChatMessageRole {
  if (value === "local_agent" || value === "remote_agent" || value === "agent" || value === "system") return value
  const sourceRole = agentSourceRole(metadata, channel)
  if (sourceRole) return sourceRole
  if (value === "assistant") return "agent"
  return "user"
}

function agentSourceRole(metadata?: Record<string, unknown> | null, channel?: string | null): ChatMessageRole | null {
  const sourceType = typeof metadata?.source_type === "string" ? metadata.source_type : null
  const transport = typeof metadata?.transport === "string" ? metadata.transport : null
  const metadataChannel = typeof metadata?.channel === "string" ? metadata.channel : null
  const actualChannel = channel ?? metadataChannel
  if (sourceType === "local_agent" || transport === "subagent" || actualChannel === "subagent") return "local_agent"
  if (sourceType === "remote_agent" || transport === "lacp" || actualChannel === "lacp") return "remote_agent"
  return null
}

function isAgentResponseRole(role: ChatMessageRole): boolean {
  return role === "agent" || role === "assistant"
}

function findQueuedMessageInAgent(
  state: SceneSlice,
  agentInstanceId: string,
  pendingMessageId?: string,
  clientMessageId?: string,
): QueuedUserMessage | undefined {
  return resolveAgentRuntimeState(state, agentInstanceId)?.queuedUserMessages.find((message) =>
    (pendingMessageId && message.pendingMessageId === pendingMessageId)
    || (clientMessageId && message.clientMessageId === clientMessageId),
  )
}

function agentHasClientMessage(state: SceneSlice, agentInstanceId: string, clientMessageId: string): boolean {
  return resolveAgentRuntimeState(state, agentInstanceId)?.messages.some(
    (message) => message.clientMessageId === clientMessageId,
  ) ?? false
}

function confirmUserMessage(state: SceneSlice, payload: UserMessageAcceptedPayload, event: AgentEvent): SceneSlice {
  const pendingMessageId = payload.pending_message_id ?? undefined
  const payloadClientMessageId = payload.client_message_id ?? undefined
  const messageMetadata = payload.metadata ?? {}
  const messageChannel = payload.channel ?? "web"
  const acceptedRole = normalizeMessageRole("user", messageMetadata, messageChannel)
  const acceptedTextFormat = acceptedRole === "user" ? "plain_text" : normalizeMessageTextFormat(messageMetadata.text_format ?? "markdown")
  const acceptedText = typeof messageMetadata.display_text === "string" && messageMetadata.display_text.length > 0
    ? messageMetadata.display_text
    : payload.text
  const ensured = ensureAllAgentStates(state)
  const ownerId = liveEventAgentInstanceId(event)
  if (!ownerId) {
    console.warn("[chatStore] drop user.message.accepted: missing agent owner", event.message_id)
    return ensured
  }
  const queuedMessage = findQueuedMessageInAgent(ensured, ownerId, pendingMessageId, payloadClientMessageId)
  const clientMessageId = payloadClientMessageId ?? queuedMessage?.clientMessageId
  const optimisticMessage = resolveAgentRuntimeState(ensured, ownerId)?.messages.find((message) =>
    Boolean(clientMessageId) && message.clientMessageId === clientMessageId,
  )
  const interactionMessageId = messageMetadata.interaction_message_id ?? optimisticMessage?.content.metadata?.interaction_message_id
  const interactionOptionId = messageMetadata.interaction_option_id ?? optimisticMessage?.content.metadata?.interaction_option_id
  const acceptedInteractionSelection = queuedMessage?.interactionSelection
    ?? (typeof interactionMessageId === "string" ? {
      interactionMessageId,
      ...(typeof interactionOptionId === "string" ? { optionId: interactionOptionId } : {}),
    } : undefined)
  const acceptedMessage: ChatMessage = {
    id: event.message_id,
    role: acceptedRole,
    createdAt: event.created_at,
    status: "accepted",
    content: {
      text: acceptedText || queuedMessage?.text || "",
      text_format: acceptedTextFormat,
      channel: messageChannel,
      metadata: {
        ...event.metadata,
        ...messageMetadata,
        agent_instance_id: ownerId,
        communication_message_id: event.message_id,
        communication_seq: event.seq,
        ...(pendingMessageId ? { chat_bubble_pending_message_id: pendingMessageId } : {}),
        ...(acceptedInteractionSelection
          ? {
              interaction_message_id: acceptedInteractionSelection.interactionMessageId,
              ...(acceptedInteractionSelection.optionId
                ? { interaction_option_id: acceptedInteractionSelection.optionId }
                : {}),
            }
          : {}),
      },
    },
    attachments: payload.attachments?.map(requestAttachmentToUiAttachment) ?? queuedMessage?.attachments ?? [],
    clientMessageId,
    backendMessageId: payload.user_message_id ?? null,
    agentInstanceId: ownerId,
  }
  const next = updateAgentLedger(ensured, ownerId, (agentState) => {
    const messages = mergeHydratedMessages(agentState.messages, [acceptedMessage], "incremental")
    const queuedUserMessages = agentState.queuedUserMessages.filter((message) =>
      !((pendingMessageId && message.pendingMessageId === pendingMessageId)
        || (clientMessageId && message.clientMessageId === clientMessageId)),
    )
    return {
      ...agentState,
      messages,
      queuedUserMessages,
      messageCount: Math.max(agentState.messageCount, messages.length),
      retainedMessageCount: messages.length,
      pendingInteraction: restorePendingInteractionFromMessages(messages),
    }
  })
  return finalizeUserSubmission(next, ownerId, acceptedInteractionSelection)
}




