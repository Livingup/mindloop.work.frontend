/**
 * chatEventCoordinator - 全入口接入与水位协调中心
 *
 * 核心职责：
 * 1. 唯一全入口协调：接入 SSE 实时流、Gap replay、乐观消息、Accepted ACK、REST baseline 水合、增量水合、助手注入与场景恢复；
 * 2. 四层 Seq / Generation 水位控制：
 *    - Scene Transport Received Cursor: 传输层收到的最大 seq，严格单调递增，不随 scope 回退；
 *    - Scene Canonical Applied Cursor: 提交到 canonical 的最大 seq (chatStore lastSeq)；
 *    - Scope Projection Watermark: 各 Agent scope 独立的投影水位 { lastAppliedSceneSeq, lastSortOrder }；
 *    - Transport / Hydration Generation: 水合请求代数，拦截陈旧响应与跨代事件；
 * 3. 水合屏障与缓冲区排空：水合期间缓存 live SSE 事件，水合落库后依序排空未处理事件，杜绝旧快照覆盖新事件；
 * 4. 单批次闭环：在同一协调批次内完成 canonical 提交和 Router 分流派发，消除状态漂移。
 */

import type { AgentEvent, TaskNoteUpdatedPayload } from "@/features/chat/model/agentEvents"
import { taskNoteKeys } from "@/features/chat/api/taskNoteApi"
import { chatAgentRuntimeScopeId } from "@/features/chat/model/chatAgentScope"
import { chatTimelineDebug } from "@/features/chat/runtime/chatTimelineDebug"
import {
  useChatStore,
  chatBubbleToMessage,
  findAcceptedMessageForEvent,
  type AgentScopedChatBubbleHydration,
  type SceneCacheTier,
  durableBubbleSortOrder,
  mergeHydratedMessages,
} from "@/features/chat/model/chatStore"
import type {
  ChatBubbleMessageDto,
  CreateChatBubbleMessageRequest,
} from "@/features/chat/api/agentRuntimeApi"
import type { UserMessageAttachment } from "@/features/chat/api/fileResourceApi"
import type {
  ChatMessage,
  InteractionSelection,
} from "@/features/chat/model/chatTypes"
import { chatEventRouter } from "@/features/chat/runtime/chatEventRouter"
import {
  buildAcceptedConversationMessage,
  buildAssistantConversationMessage,
  conversationMessageToCreateRequest,
  conversationMessageToBubble,
  conversationEventOwner,
  buildContextCompressionConversationMessage,
  buildInteractionConversationMessage,
  buildInterruptedConversationMessage,
  buildLifecycleConversationMessage,
  buildUserVisibleToolConversationMessage,
  findOpenProjectedMessage,
} from "@/features/chat/runtime/conversationEventProjector"
import {
  contextCompressionEventJobId,
  buildTaskBoundaryMetadata,
  taskBoundaryBubbleText,
  findExecutionProcessMessageForEvent,
  isExecutionProcessMessage,
  nextExecutionRound,
  isContextCompressionEvent,
  isExecutionProcessEvent,
  isTaskBoundaryEvent,
  normalizeExecutionProcessMetadata,
  reduceExecutionProcessMetadata,
  executionProcessStatus,
  executionProcessText,
  type ExecutionProcessMetadata,
} from "@/features/chat/runtime/executionProcess"
import { queryClient } from "@/shared/api/queryClient"
import { useTaskNoteUiStore } from "@/features/chat/model/taskNoteUiStore"

export type ScopeWatermark = {
  lastAppliedSceneSeq: number
  lastSortOrder: number
}

class ChatEventCoordinator {
  // 1. Scene Transport Received Cursor: Map<sceneId, number>
  private sceneTransportReceivedCursors = new Map<string, number>()

  // 1b. Scene Canonical Applied Cursor: Map<sceneId, number>
  private sceneAppliedCursors = new Map<string, number>()

  // 1c. Scene Transport Generations: Map<sceneId, { streamId?: string; bootId?: string }>
  private sceneTransportGenerations = new Map<string, { streamId?: string; bootId?: string }>()

  // 2. Scope Projection Watermark: Map<scopeId, ScopeWatermark>
  private scopeProjectionWatermarks = new Map<string, ScopeWatermark>()

  // 3. Hydration Generation Token: Map<scopeId, number>
  private hydrationGenerations = new Map<string, number>()

  // 4. Hydration Barrier Lock: Map<scopeId, boolean>
  private scopeHydrationBarriers = new Map<string, boolean>()

  // 5. Hydration Buffer: Map<scopeId, AgentEvent[]>
  private scopeHydrationBuffers = new Map<string, AgentEvent[]>()
  private scopeIncrementalBuffers = new Map<string, AgentScopedChatBubbleHydration>()

  // 5b. Scene-level deferred events held behind an earlier hydrating scope event
  private sceneDeferredEvents = new Map<string, AgentEvent[]>()

  // 6. Active Execution Metadata per Scope (唯一生产路径)
  private activeExecutionMetadataByScope = new Map<string, ExecutionProcessMetadata>()

  // 7. Bubble Persistence Sink (统一向 Outbox 提交气泡)
  private bubblePersistenceSink: ((
    sceneId: string,
    body: CreateChatBubbleMessageRequest,
    createdAt: string,
    label: string,
    messageId: string,
  ) => void) | null = null

  // 8. Task Note SSE 更新防抖定时器
  private taskNoteDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  public getSceneTransportReceivedCursor(sceneId: string): number {
    return this.sceneTransportReceivedCursors.get(sceneId) ?? 0
  }

  public getSceneAppliedCursor(sceneId: string): number {
    return this.sceneAppliedCursors.get(sceneId) ?? 0
  }

  public setSceneTransportGeneration(sceneId: string, generation: { streamId?: string; bootId?: string }): void {
    const previous = this.sceneTransportGenerations.get(sceneId)
    this.sceneTransportGenerations.set(sceneId, { ...previous, ...generation })
  }

  public resetSceneTransportGeneration(sceneId: string, generation: { streamId?: string; bootId?: string } = {}): void {
    this.sceneTransportReceivedCursors.delete(sceneId)
    this.sceneAppliedCursors.delete(sceneId)
    this.sceneDeferredEvents.delete(sceneId)
    const scopeIds = this.sceneScopeIds(sceneId)
    for (const scopeId of scopeIds) {
      // Keep a bumped generation tombstone so an in-flight baseline cannot become current again.
      this.hydrationGenerations.set(scopeId, this.getHydrationGeneration(scopeId) + 1)
      this.scopeProjectionWatermarks.delete(scopeId)
      this.scopeHydrationBarriers.delete(scopeId)
      this.scopeHydrationBuffers.delete(scopeId)
      this.scopeIncrementalBuffers.delete(scopeId)
      this.activeExecutionMetadataByScope.delete(scopeId)
    }
    this.sceneTransportGenerations.set(sceneId, { ...generation })
  }

  public getSceneTransportGeneration(sceneId: string): { streamId?: string; bootId?: string } | undefined {
    return this.sceneTransportGenerations.get(sceneId)
  }

  public setBubblePersistenceSink(
    sink: ((
      sceneId: string,
      body: CreateChatBubbleMessageRequest,
      createdAt: string,
      label: string,
      messageId: string,
    ) => void) | null,
  ): void {
    this.bubblePersistenceSink = sink
  }

  private sceneScopeIds(sceneId: string): Set<string> {
    const prefix = `${sceneId}:`
    const scopeIds = new Set<string>()
    for (const scopeId of this.scopeProjectionWatermarks.keys()) if (scopeId.startsWith(prefix)) scopeIds.add(scopeId)
    for (const scopeId of this.hydrationGenerations.keys()) if (scopeId.startsWith(prefix)) scopeIds.add(scopeId)
    for (const scopeId of this.scopeHydrationBarriers.keys()) if (scopeId.startsWith(prefix)) scopeIds.add(scopeId)
    for (const scopeId of this.scopeHydrationBuffers.keys()) if (scopeId.startsWith(prefix)) scopeIds.add(scopeId)
    for (const scopeId of this.scopeIncrementalBuffers.keys()) if (scopeId.startsWith(prefix)) scopeIds.add(scopeId)
    for (const scopeId of this.activeExecutionMetadataByScope.keys()) if (scopeId.startsWith(prefix)) scopeIds.add(scopeId)
    return scopeIds
  }
  public getScopeWatermark(scopeId: string): ScopeWatermark {
    return this.scopeProjectionWatermarks.get(scopeId) ?? { lastAppliedSceneSeq: 0, lastSortOrder: 0 }
  }

  public getHydrationGeneration(scopeId: string): number {
    return this.hydrationGenerations.get(scopeId) ?? 0
  }

  public isScopeHydrating(scopeId: string): boolean {
    return this.scopeHydrationBarriers.get(scopeId) ?? false
  }

  public clearScene(sceneId: string): void {
    this.sceneTransportReceivedCursors.delete(sceneId)
    this.sceneAppliedCursors.delete(sceneId)
    this.sceneTransportGenerations.delete(sceneId)
    for (const scopeId of this.sceneScopeIds(sceneId)) {
      // Preserve an invalidated generation tombstone for late REST responses.
      this.hydrationGenerations.set(scopeId, this.getHydrationGeneration(scopeId) + 1)
      this.scopeProjectionWatermarks.delete(scopeId)
      this.scopeHydrationBarriers.delete(scopeId)
      this.scopeHydrationBuffers.delete(scopeId)
      this.scopeIncrementalBuffers.delete(scopeId)
      this.activeExecutionMetadataByScope.delete(scopeId)
    }
    this.sceneDeferredEvents.delete(sceneId)
    for (const timer of this.taskNoteDebounceTimers.values()) clearTimeout(timer)
    this.taskNoteDebounceTimers.clear()
  }

  public clearAll(): void {
    this.sceneTransportReceivedCursors.clear()
    this.sceneAppliedCursors.clear()
    this.sceneTransportGenerations.clear()
    this.scopeProjectionWatermarks.clear()
    this.hydrationGenerations.clear()
    this.scopeHydrationBarriers.clear()
    this.scopeHydrationBuffers.clear()
    this.scopeIncrementalBuffers.clear()
    this.sceneDeferredEvents.clear()
    this.activeExecutionMetadataByScope.clear()
    this.bubblePersistenceSink = null
    for (const timer of this.taskNoteDebounceTimers.values()) clearTimeout(timer)
    this.taskNoteDebounceTimers.clear()
  }

  /**
   * 启动某个 Agent scope 的 baseline 水合屏障，并自增 generation 代数。
   */
  public beginHydration(scopeId: string): number {
    const nextGen = (this.hydrationGenerations.get(scopeId) ?? 0) + 1
    this.hydrationGenerations.set(scopeId, nextGen)
    this.scopeHydrationBarriers.set(scopeId, true)
    if (!this.scopeHydrationBuffers.has(scopeId)) {
      this.scopeHydrationBuffers.set(scopeId, [])
    }
    return nextGen
  }

  /**
   * 取消或中断水合屏障。
   */
  public cancelHydration(scopeId: string, expectedGeneration?: number): boolean {
    const currentGeneration = this.getHydrationGeneration(scopeId)
    if (expectedGeneration !== undefined && expectedGeneration !== currentGeneration) return false
    this.hydrationGenerations.set(scopeId, currentGeneration + 1)
    this.scopeHydrationBarriers.set(scopeId, false)
    const scene = Object.values(useChatStore.getState().scenes).find((item) => scopeId.startsWith(`${item.sceneId}:`))
    const events = this.scopeHydrationBuffers.get(scopeId) ?? []
    const incremental = this.scopeIncrementalBuffers.get(scopeId)
    this.scopeHydrationBuffers.delete(scopeId)
    this.scopeIncrementalBuffers.delete(scopeId)
    if (!scene) return true
    if (incremental) this.dispatchIncrementalBubbles(scene.sceneId, [incremental], scene.rootAgentInstanceId)
    this.applyLiveEvents(scene.sceneId, events, scene.rootAgentInstanceId, "hot")
    return true
  }

  /** Cancel every active hydration barrier owned by a scene. */
  public cancelSceneHydrations(sceneId: string): void {
    const scopeIds = new Set<string>()
    for (const scopeId of this.scopeHydrationBarriers.keys()) {
      if (scopeId.startsWith(`${sceneId}:`)) scopeIds.add(scopeId)
    }
    for (const scopeId of scopeIds) this.cancelHydration(scopeId)
  }

  /**
   * 派发 REST Baseline 水合批次。
   */
  public dispatchBaselineHydration(
    sceneId: string,
    batches: AgentScopedChatBubbleHydration[],
    requestGeneration: number,
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier = "hot",
    snapshotWatermark?: { maxSeq?: number; maxSortOrder?: number },
  ): boolean {
    for (const batch of batches) {
      const agentInstanceId = batch.agentInstanceId?.trim()
      if (!agentInstanceId || !this.validHydrationBatch(sceneId, batch)) return false
      const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
      const currentGen = this.getHydrationGeneration(scopeId)

      // 代数校验：若请求代数过期，整批拒绝丢弃
      if (requestGeneration !== currentGen) {
        console.warn("[chatEventCoordinator] drop stale baseline hydration: generation mismatch", {
          scopeId,
          requestGeneration,
          currentGen,
        })
        chatTimelineDebug("coordinator.baseline_stale", { sceneId, scopeId, requestGeneration, currentGeneration: currentGen })
        return false
      }

      try {
        chatTimelineDebug("coordinator.baseline_start", { sceneId, scopeId, agentInstanceId, requestGeneration, currentGeneration: currentGen })
        // Resolve durable bounds before merging newer local snapshots.
        let maxSortOrder = snapshotWatermark?.maxSortOrder ?? 0
        let maxBubbleCommSeq = 0
        for (const bubble of batch.bubbles) {
          if (typeof bubble.sort_order === "number") {
            maxSortOrder = Math.max(maxSortOrder, bubble.sort_order)
          }
          const commSeq = bubble.metadata?.communication_seq
          if (typeof commSeq === "number") {
            maxBubbleCommSeq = Math.max(maxBubbleCommSeq, commSeq)
          }
        }
        const before = useChatStore.getState().scenes[sceneId]?.agentRuntimeStates[scopeId]?.messages ?? []
        const local = before.filter((message) => durableBubbleSortOrder(message) === 0
          || Number(message.content.metadata?.communication_seq ?? 0) > maxBubbleCommSeq)
        const merged = mergeHydratedMessages(mergeHydratedMessages(before, batch.bubbles.map(chatBubbleToMessage), "baseline"), local, "incremental")
        useChatStore.getState().hydrateSceneFromAgentBubbles(sceneId, [{
          agentInstanceId, bubbles: merged.map((message) => conversationMessageToBubble(sceneId, message)),
        }], { mode: "baseline" })
        chatEventRouter.routeHydratedBatches(sceneId, [this.canonicalBatch(sceneId, batch, true)], "baseline", rootAgentInstanceId, tier)
        this.syncConversationControls(sceneId, agentInstanceId, rootAgentInstanceId, tier)
        const streamSeq = typeof snapshotWatermark?.maxSeq === "number"
          ? Math.max(this.getScopeWatermark(scopeId).lastAppliedSceneSeq, snapshotWatermark.maxSeq)
          : this.getScopeWatermark(scopeId).lastAppliedSceneSeq
        this.scopeProjectionWatermarks.set(scopeId, {
          lastAppliedSceneSeq: streamSeq,
          lastSortOrder: maxSortOrder,
        })
        this.activeExecutionMetadataByScope.delete(scopeId)
        const bufferedEvents = this.scopeHydrationBuffers.get(scopeId) ?? []
        const incremental = this.scopeIncrementalBuffers.get(scopeId)
        this.scopeHydrationBuffers.delete(scopeId)
        this.scopeIncrementalBuffers.delete(scopeId)
        this.scopeHydrationBarriers.set(scopeId, false)
        if (incremental) this.dispatchIncrementalBubbles(sceneId, [incremental], rootAgentInstanceId, tier)
        this.applyLiveEvents(sceneId, bufferedEvents, rootAgentInstanceId, tier)
        chatTimelineDebug("coordinator.baseline_complete", { sceneId, scopeId, agentInstanceId, requestGeneration, bufferedEventCount: bufferedEvents.length, hadIncrementalBuffer: Boolean(incremental), maxSeq: streamSeq, maxSortOrder })
      } catch (error) {
        console.error("[chatEventCoordinator] baseline hydration failed", { sceneId, scopeId, error })
        chatTimelineDebug("coordinator.baseline_failed", { sceneId, scopeId, requestGeneration, error: error instanceof Error ? error.name : "unknown" })
        this.cancelHydration(scopeId, requestGeneration)
        return false
      }
    }
    return true
  }

  private validHydrationBatch(sceneId: string, batch: AgentScopedChatBubbleHydration): boolean {
    const owner = batch.agentInstanceId?.trim()
    return Boolean(owner && useChatStore.getState().scenes[sceneId])
      && batch.bubbles.every((bubble) => bubble.scene_id === sceneId && bubble.agent_instance_id?.trim() === owner)
  }

  private canonicalBatch(sceneId: string, batch: AgentScopedChatBubbleHydration, baseline: boolean): AgentScopedChatBubbleHydration {
    const scene = useChatStore.getState().scenes[sceneId]
    const scopeId = chatAgentRuntimeScopeId(sceneId, batch.agentInstanceId, scene?.rootAgentInstanceId ?? null)
    const messages = scene?.agentRuntimeStates[scopeId]?.messages ?? []
    const selected = baseline ? messages : messages.filter((message) => batch.bubbles.some((bubble) =>
      message.content.metadata?.bubble_kind === bubble.metadata?.bubble_kind
      && (message.id === bubble.bubble_id
        || (bubble.client_message_id && message.clientMessageId === bubble.client_message_id)
        || (bubble.pending_message_id && message.content.metadata?.chat_bubble_pending_message_id === bubble.pending_message_id)
        || (bubble.backend_message_id && message.backendMessageId === bubble.backend_message_id)),
    ))
    return { agentInstanceId: batch.agentInstanceId, bubbles: selected.map((message) => conversationMessageToBubble(sceneId, message)) }
  }

  /**
   * 派发增量水合批次（如本地快照生成）。
   */
  public dispatchIncrementalBubbles(
    sceneId: string,
    batches: AgentScopedChatBubbleHydration[],
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier = "hot",
  ): void {
    for (const batch of batches) {
      if (!this.validHydrationBatch(sceneId, batch)) continue
      const scopeId = chatAgentRuntimeScopeId(sceneId, batch.agentInstanceId, rootAgentInstanceId)
      if (this.isScopeHydrating(scopeId)) {
        const buffered = this.scopeIncrementalBuffers.get(scopeId)
        const messages = mergeHydratedMessages((buffered?.bubbles ?? []).map(chatBubbleToMessage), batch.bubbles.map(chatBubbleToMessage), "incremental")
        this.scopeIncrementalBuffers.set(scopeId, {
          agentInstanceId: batch.agentInstanceId,
          bubbles: messages.map((message) => conversationMessageToBubble(sceneId, message)),
        })
        continue
      }
      useChatStore.getState().hydrateSceneFromAgentBubbles(sceneId, [batch], { mode: "incremental" })
      const canonical = this.canonicalBatch(sceneId, batch, false)
      chatEventRouter.routeHydratedBatches(sceneId, [canonical], "incremental", rootAgentInstanceId, tier)
      if (canonical.bubbles.some((bubble) => bubble.metadata?.bubble_kind !== "execution_process")) {
        this.syncConversationControls(sceneId, batch.agentInstanceId, rootAgentInstanceId, tier)
      }
    }
  }

  /**
   * 派发实时 SSE 事件流。
   */
  public dispatchLiveEvents(
    sceneId: string,
    events: AgentEvent[],
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier = "hot",
  ): void {
    if (events.length === 0) return
    chatTimelineDebug("coordinator.live_batch", { sceneId, eventCount: events.length, receivedCursor: this.getSceneTransportReceivedCursor(sceneId), appliedCursor: this.getSceneAppliedCursor(sceneId), rootAgentInstanceId })

    // 0. Transport Generation 校验：过滤 streamId 不匹配的陈旧流事件
    const generation = this.getSceneTransportGeneration(sceneId)
    const matchingEvents = events.filter((e) => {
      if (generation?.streamId && e.stream_id && e.stream_id !== generation.streamId) {
        console.warn("[chatEventCoordinator] drop live event: stream_id mismatch with current transport generation", {
          sceneId,
          eventStreamId: e.stream_id,
          expectedStreamId: generation.streamId,
          seq: e.seq,
        })
        chatTimelineDebug("coordinator.drop_stream_mismatch", { sceneId, seq: e.seq, eventType: e.type, eventStreamId: e.stream_id ?? "", expectedStreamId: generation.streamId })
        return false
      }
      return true
    })
    if (matchingEvents.length === 0) return

    const receivedCursor = this.getSceneTransportReceivedCursor(sceneId)
    // 过滤低于 transport received cursor 的乱序/重复接收项
    const deferredSeqs = new Set((this.sceneDeferredEvents.get(sceneId) ?? []).map((event) => event.seq))
    const freshEvents = matchingEvents.filter((e) => e.seq > receivedCursor || deferredSeqs.has(e.seq))
    if (freshEvents.length === 0) return

    // 严格按 seq 升序排序，保证单调提交
    freshEvents.sort((a, b) => a.seq - b.seq)

    // 更新 transport received cursor（严格单调递增，不可回退）
    let maxNewSeq = receivedCursor
    for (const e of freshEvents) {
      if (e.seq > maxNewSeq) maxNewSeq = e.seq
    }
    this.sceneTransportReceivedCursors.set(sceneId, maxNewSeq)

    // 检查是否有事件属于正在水合中的 scope
    const readyEvents: AgentEvent[] = []
    for (const event of freshEvents) {
      const agentInstanceId = conversationEventOwner(event)
      chatTimelineDebug("coordinator.event_owner", { sceneId, seq: event.seq, eventType: event.type, agentInstanceId: agentInstanceId ?? "", hasPayloadOwner: Boolean((event.payload as Record<string, unknown> | undefined)?.agent_instance_id), hasMetadataOwner: Boolean(event.metadata?.agent_instance_id) })
      if (agentInstanceId) {
        const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
        if (this.isScopeHydrating(scopeId)) {
          // 放入该 scope 的水合缓冲区
          const buf = this.scopeHydrationBuffers.get(scopeId) ?? []
          buf.push(event)
          this.scopeHydrationBuffers.set(scopeId, buf)
          chatTimelineDebug("coordinator.scope_buffer", { sceneId, scopeId, agentInstanceId, seq: event.seq, eventType: event.type, bufferCount: buf.length })
          continue
        }
      }
      readyEvents.push(event)
    }

    if (readyEvents.length > 0) {
      this.applyLiveEvents(sceneId, readyEvents, rootAgentInstanceId, tier)
    }
  }

  /**
   * 提交并投影已就绪事件至全局权威仓库及目标 UI Store。
   * 仅依据 sceneAppliedCursor 判断是否已应用，绝不经过 transport receivedCursor 过滤。
   */
  private applyLiveEvents(
    sceneId: string,
    events: AgentEvent[],
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier,
  ): void {
    const deferred = this.sceneDeferredEvents.get(sceneId) ?? []
    const candidates = [...deferred, ...events]
    this.sceneDeferredEvents.delete(sceneId)
    if (candidates.length === 0) return

    const appliedCursor = this.getSceneAppliedCursor(sceneId)
    // 严格按 seq 升序排序并按 seq 去重
    const sorted = Array.from(new Map(candidates.map((event) => [event.seq, event])).values())
      .sort((a, b) => a.seq - b.seq)
    // 过滤低于或等于 scene applied cursor 的项
    const deferredSeqs = new Set(deferred.map((event) => event.seq))
    const unappliedEvents = sorted.filter((e) => e.seq > appliedCursor || deferredSeqs.has(e.seq))
    if (unappliedEvents.length === 0) return

    // 不能让 ready scope 越过另一个正在 hydrate scope 中更早的事件。
    const blockedSeq = this.minimumHydrationBufferedSeq(sceneId)
    const readyEvents = blockedSeq === null
      ? unappliedEvents
      : unappliedEvents.filter((event) => event.seq < blockedSeq)
    const deferredEvents = blockedSeq === null
      ? []
      : unappliedEvents.filter((event) => event.seq >= blockedSeq)
    if (deferredEvents.length > 0) {
      this.sceneDeferredEvents.set(sceneId, deferredEvents)
      chatTimelineDebug("coordinator.scene_deferred", { sceneId, blockedSeq: blockedSeq ?? null, deferredCount: deferredEvents.length, readyCount: readyEvents.length })
    }
    if (readyEvents.length === 0) {
      chatTimelineDebug("coordinator.batch_fully_deferred", { sceneId, blockedSeq: blockedSeq ?? null, deferredCount: deferredEvents.length })
      return
    }

    for (let index = 0; index < readyEvents.length; index += 1) {
      const event = readyEvents[index]
      // Keep the dedicated terminal reducer's existing batch path.
      if (event.type.startsWith("terminal.")) {
        const terminalBatch = [event]
        while (readyEvents[index + 1]?.type.startsWith("terminal.")) terminalBatch.push(readyEvents[++index])
        useChatStore.getState().appendEvents(sceneId, terminalBatch)
        this.sceneAppliedCursors.set(sceneId, Math.max(this.getSceneAppliedCursor(sceneId), terminalBatch[terminalBatch.length - 1].seq))
        continue
      }
      if (event.seq > this.getSceneAppliedCursor(sceneId)) {
        useChatStore.getState().appendEvents(sceneId, [event])
        this.sceneAppliedCursors.set(sceneId, event.seq)
      }
      const projected = this.projectSingleLiveEvent(sceneId, event, rootAgentInstanceId, tier)
      if (!projected) {
        chatTimelineDebug("coordinator.projection_failed", { sceneId, scopeId: chatAgentRuntimeScopeId(sceneId, conversationEventOwner(event), rootAgentInstanceId), seq: event.seq, eventType: event.type, retryReadyCount: readyEvents.length - index, deferredCount: deferredEvents.length })
        const retryEvents = Array.from(new Map(
          [...readyEvents.slice(index), ...deferredEvents].map((candidate) => [candidate.seq, candidate]),
        ).values()).sort((left, right) => left.seq - right.seq)
        this.sceneDeferredEvents.set(sceneId, retryEvents)
        break
      }
    }
  }

  private minimumHydrationBufferedSeq(sceneId: string): number | null {
    let minimum = Number.POSITIVE_INFINITY
    const prefix = `${sceneId}:`
    for (const [scopeId, events] of this.scopeHydrationBuffers) {
      if (!scopeId.startsWith(prefix)) continue
      for (const event of events) minimum = Math.min(minimum, event.seq)
    }
    return Number.isFinite(minimum) ? minimum : null
  }

  /**
   * 派发 Gap Replay / 重连补洞事件。
   */
  public dispatchReplayEvents(
    sceneId: string,
    events: AgentEvent[],
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier = "hot",
  ): void {
    this.dispatchLiveEvents(sceneId, events, rootAgentInstanceId, tier)
  }

  /** Synchronize canonical queued messages and pending interaction into the left Conversation working set. */
  public syncConversationControls(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId?: string | null,
    tier: SceneCacheTier = "hot",
  ): void {
    const scene = useChatStore.getState().scenes[sceneId]
    const agentState = scene?.agentRuntimeStates[chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId ?? scene?.rootAgentInstanceId ?? null)]
    if (!agentState) return
    chatEventRouter.routeConversationControls(
      sceneId,
      agentInstanceId,
      rootAgentInstanceId ?? scene.rootAgentInstanceId ?? null,
      agentState.queuedUserMessages,
      agentState.pendingInteraction,
      tier,
    )
  }

  /**
   * 派发用户乐观消息。
   */
  public dispatchOptimisticUserMessage(
    sceneId: string,
    agentInstanceId: string,
    text: string,
    clientMessageId: string,
    rootAgentInstanceId: string | null,
    attachments?: UserMessageAttachment[],
    interactionSelection?: InteractionSelection,
    tier: SceneCacheTier = "hot",
  ): void {
    // 1. 提交 canonical
    useChatStore.getState().appendUserMessage(
      sceneId,
      agentInstanceId,
      text,
      clientMessageId,
      interactionSelection,
      attachments,
    )

    // 2. 分流派发至左侧会话 UI Store
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    const optimisticMessage = useChatStore.getState().scenes[sceneId]?.agentRuntimeStates[scopeId]?.messages
      .find((message) => message.clientMessageId === clientMessageId)
    if (!optimisticMessage) return
    chatEventRouter.routeOptimisticUserMessage(
      sceneId,
      agentInstanceId,
      rootAgentInstanceId,
      optimisticMessage,
      tier,
    )
    this.syncAnsweredInteraction(sceneId, agentInstanceId, interactionSelection?.interactionMessageId, tier)
    this.syncConversationControls(sceneId, agentInstanceId, rootAgentInstanceId, tier)
  }

  /**
   * 派发助手文本注入消息。
   */
  public dispatchAssistantMessage(
    sceneId: string,
    agentInstanceId: string,
    text: string,
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier = "hot",
  ): void {
    useChatStore.getState().appendAssistantMessage(sceneId, agentInstanceId, text)
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    const messages = useChatStore.getState().scenes[sceneId]?.agentRuntimeStates[scopeId]?.messages ?? []
    const assistantMessage = messages[messages.length - 1]
    if (!assistantMessage) return
    chatEventRouter.routeAssistantMessage(
      sceneId,
      agentInstanceId,
      rootAgentInstanceId,
      assistantMessage,
      tier,
    )
  }

  /**
   * 派发场景全量恢复。
   */
  public dispatchSceneRestore(
    sceneId: string,
    events: AgentEvent[],
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier = "hot",
  ): void {
    // 1. 重置并提交 canonical
    useChatStore.getState().hydrateScene(sceneId, events)
    this.sceneTransportReceivedCursors.set(
      sceneId,
      events.reduce((max, e) => Math.max(max, e.seq), 0),
    )

    // 2. 从 canonical 重建 UI Store 投影
    const sceneSlice = useChatStore.getState().scenes[sceneId]
    if (!sceneSlice) return

    for (const [scopeId, agentState] of Object.entries(sceneSlice.agentRuntimeStates)) {
      const messages = agentState.messages ?? []
      const agentInstanceId = agentState.agentInstanceId
      this.scopeProjectionWatermarks.set(scopeId, {
        lastAppliedSceneSeq: sceneSlice.lastSeq,
        lastSortOrder: messages.reduce((max, m) => Math.max(max, durableBubbleSortOrder(m)), 0),
      })
      // 左右两侧从 canonical 分流重建
      const batches: AgentScopedChatBubbleHydration[] = [{
        agentInstanceId,
        bubbles: messages.map((m) => ({
          bubble_id: m.id,
          scene_id: sceneId,
          agent_instance_id: agentInstanceId,
          task_id: null,
          conversation_id: null,
          role: m.role,
          status: m.status,
          text: m.content.text,
          text_format: m.content.text_format ?? "plain_text",
          channel: m.content.channel ?? "web",
          client_message_id: m.clientMessageId ?? null,
          backend_message_id: m.backendMessageId ?? null,
          pending_message_id: m.content.metadata?.chat_bubble_pending_message_id as string ?? null,
          interaction_options: m.interactionOptions ?? [],
          interaction_state: m.interactionState ?? "none",
          selected_option_id: m.selectedOptionId ?? null,
          sort_order: durableBubbleSortOrder(m),
          created_at: m.createdAt,
          updated_at: m.createdAt,
          metadata: m.content.metadata ?? {},
        })),
      }]
      chatEventRouter.routeHydratedBatches(sceneId, batches, "baseline", rootAgentInstanceId, tier)
    }
  }

  private syncAnsweredInteraction(
    sceneId: string,
    agentInstanceId: string,
    interactionMessageId: unknown,
    tier: SceneCacheTier,
  ): void {
    if (typeof interactionMessageId !== "string") return
    const scene = useChatStore.getState().scenes[sceneId]
    if (!scene) return
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, scene.rootAgentInstanceId)
    const message = scene.agentRuntimeStates[scopeId]?.messages.find((item) => item.id === interactionMessageId)
    if (!message || message.interactionState !== "answered") return
    chatEventRouter.routeConversationMessage(sceneId, agentInstanceId, scene.rootAgentInstanceId, message, tier)
    this.bubblePersistenceSink?.(sceneId, conversationMessageToCreateRequest(sceneId, message),
      message.createdAt, "answered interaction bubble", message.id)
  }

  private persistConversationMessage(
    sceneId: string,
    message: ChatMessage,
    event: AgentEvent,
    label: string,
  ): void {
    if (!this.bubblePersistenceSink) return
    const body = conversationMessageToCreateRequest(sceneId, message)
    this.bubblePersistenceSink(sceneId, body, event.created_at, label, event.message_id)
  }

  /**
   * 将单条确认后的 live 事件投射到目标 UI Store。
   */
  private projectSingleLiveEvent(
    sceneId: string,
    event: AgentEvent,
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier,
  ): boolean {
    const payload = event.payload as Record<string, unknown> | undefined
    const agentInstanceId = conversationEventOwner(event)
    if (!agentInstanceId || event.type.startsWith("terminal.")) {
      if (!event.type.startsWith("terminal.")) chatTimelineDebug("coordinator.drop_ownerless", { sceneId, seq: event.seq, eventType: event.type })
      return true
    }

    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    const watermark = this.getScopeWatermark(scopeId)

    // Scope 水位去重与防回退校验：若事件 seq 已被该 scope 应用过，直接跳过投影
    if (event.seq <= watermark.lastAppliedSceneSeq) {
      return true
    }

    try {
      // 双消费边界：task.completed / task.failed
      if (isTaskBoundaryEvent(event) || event.type === "agent.task.completed" || event.type === "agent.task.failed" || event.type === "agent.task.cancelled") {
        queryClient.removeQueries({ queryKey: taskNoteKeys.all })
        void queryClient.invalidateQueries({ queryKey: taskNoteKeys.all, refetchType: "active" })
        const isFailed = event.type === "agent.task.failed"
        const isCancelled = event.type === "agent.task.cancelled"
        const boundaryStatus = isFailed ? "failed" : isCancelled ? "cancelled" : "completed"
        const boundaryMetadata = buildTaskBoundaryMetadata(
          event,
          agentInstanceId,
          typeof event.metadata.task_id === "string" ? event.metadata.task_id : null,
          typeof event.metadata.conversation_id === "string" ? event.metadata.conversation_id : null,
        )
        if (!boundaryMetadata) return true
        const boundaryBubble: ChatBubbleMessageDto = {
          bubble_id: `task-boundary-${event.message_id}`,
          scene_id: sceneId,
          agent_instance_id: agentInstanceId,
          task_id: boundaryMetadata.task_id,
          conversation_id: boundaryMetadata.conversation_id,
          role: "agent",
          status: boundaryStatus,
          text: taskBoundaryBubbleText(boundaryMetadata),
          text_format: "plain_text",
          channel: "web",
          client_message_id: null,
          backend_message_id: event.message_id,
          pending_message_id: null,
          interaction_options: [],
          interaction_state: "none",
          selected_option_id: null,
          sort_order: event.seq,
          created_at: event.created_at,
          updated_at: event.created_at,
          metadata: boundaryMetadata,
        }
        this.activeExecutionMetadataByScope.delete(scopeId)
        useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, chatBubbleToMessage(boundaryBubble))
        chatEventRouter.routeChatBubble(sceneId, agentInstanceId, rootAgentInstanceId, boundaryBubble, tier)

        if (this.bubblePersistenceSink) {
          this.bubblePersistenceSink(sceneId, {
            bubble_id: boundaryBubble.bubble_id,
            agent_instance_id: agentInstanceId,
            task_id: boundaryBubble.task_id,
            conversation_id: boundaryBubble.conversation_id,
            role: "agent",
            status: boundaryStatus,
            text: boundaryBubble.text,
            text_format: "plain_text",
            channel: "web",
            backend_message_id: event.message_id,
            metadata: boundaryBubble.metadata,
          }, event.created_at, "task boundary bubble", event.message_id)
        }
        this.scopeProjectionWatermarks.set(scopeId, {
          lastAppliedSceneSeq: Math.max(watermark.lastAppliedSceneSeq, event.seq),
          lastSortOrder: Math.max(watermark.lastSortOrder, event.seq),
        })
        return true
      }

      // 2. 实时执行过程事件（llm.*, tool.call.*, agent.tool.*）
      if (isExecutionProcessEvent(event)) {
        const active = this.activeExecutionMetadataByScope.get(scopeId)
        const canonicalMessages = useChatStore.getState().scenes[sceneId]?.agentRuntimeStates[scopeId]?.messages ?? []
        const previousExecutionMessage = findExecutionProcessMessageForEvent(canonicalMessages, event)
        chatTimelineDebug("coordinator.execution_match", { sceneId, scopeId, agentInstanceId, seq: event.seq, eventType: event.type, hasActiveAggregation: Boolean(active), hasHistoricalBubble: Boolean(previousExecutionMessage), historicalBubbleId: previousExecutionMessage?.id ?? "", canonicalMessageCount: canonicalMessages.length })
        const seed = active
          ?? (previousExecutionMessage ? normalizeExecutionProcessMetadata(previousExecutionMessage.content.metadata) : normalizeExecutionProcessMetadata({}))
        const reduced = reduceExecutionProcessMetadata(seed, event)
        if (previousExecutionMessage) {
          const previousMetadata = previousExecutionMessage.content.metadata ?? {}
          const previousRound = previousMetadata.execution_round
          if (typeof previousRound === "number" && previousRound > 0 && reduced.execution_round === undefined) {
            reduced.execution_round = previousRound
          }
          ;(reduced as Record<string, unknown>).bubble_id = previousExecutionMessage.id
        } else if (!(reduced as Record<string, unknown>).bubble_id) {
          const previousTimeline = [...canonicalMessages].reverse().find((message) =>
            isExecutionProcessMessage(message) || message.content.metadata?.bubble_kind === "task_boundary",
          )
          reduced.execution_round = reduced.execution_round ?? nextExecutionRound(previousTimeline)
        }
        this.activeExecutionMetadataByScope.set(scopeId, reduced)

        const status = executionProcessStatus(reduced)
        reduced.process_status = status
        reduced.communication_message_id = event.message_id
        reduced.communication_seq = event.seq
        reduced.updated_at = event.created_at
        reduced.agent_instance_id = agentInstanceId

        const bubbleId = (reduced as Record<string, unknown>).bubble_id as string | undefined
          ?? `execution-process-${event.message_id}`
        ;(reduced as Record<string, unknown>).bubble_id = bubbleId

        const execBubble: ChatBubbleMessageDto = {
          bubble_id: bubbleId,
          scene_id: sceneId,
          agent_instance_id: agentInstanceId,
          task_id: (event.metadata.task_id as string) ?? null,
          conversation_id: (event.metadata.conversation_id as string) ?? null,
          role: "agent",
          status,
          text: executionProcessText(reduced),
          text_format: "plain_text",
          channel: "tool",
          client_message_id: null,
          backend_message_id: event.message_id,
          pending_message_id: null,
          interaction_options: [],
          interaction_state: "none",
          selected_option_id: null,
          sort_order: event.seq,
          created_at: event.created_at,
          updated_at: event.created_at,
          metadata: reduced as unknown as Record<string, unknown>,
        }

        useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, chatBubbleToMessage(execBubble))
        chatTimelineDebug("coordinator.execution_bubble", { sceneId, scopeId, agentInstanceId, seq: event.seq, eventType: event.type, bubbleId, status, executionRound: (reduced as Record<string, unknown>).execution_round ?? null, iterationCount: reduced.iterations.length })
        chatEventRouter.routeChatBubble(sceneId, agentInstanceId, rootAgentInstanceId, execBubble, tier)
        if (event.type === "tool.call.completed") {
          const userVisibleMessage = buildUserVisibleToolConversationMessage(event,
            useChatStore.getState().scenes[sceneId]?.agentRuntimeStates[scopeId]?.messages ?? [],
          )
          if (userVisibleMessage) {
            useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, userVisibleMessage)
            chatEventRouter.routeUserVisibleToolResult(sceneId, agentInstanceId, rootAgentInstanceId, userVisibleMessage, tier)
            this.persistConversationMessage(sceneId, userVisibleMessage, event, "user-visible tool result bubble")
          }
        }

        if (this.bubblePersistenceSink) {
          this.bubblePersistenceSink(sceneId, {
            bubble_id: bubbleId,
            agent_instance_id: agentInstanceId,
            task_id: execBubble.task_id,
            conversation_id: execBubble.conversation_id,
            role: "agent",
            status,
            text: execBubble.text,
            text_format: "plain_text",
            channel: "tool",
            backend_message_id: event.message_id,
            metadata: reduced as unknown as Record<string, unknown>,
          }, event.created_at, event.type === "llm.content.delta" ? "execution process delta" : "execution process bubble", event.message_id)
        }

        if (status === "completed" || status === "failed") {
          this.activeExecutionMetadataByScope.delete(scopeId)
        }
        this.scopeProjectionWatermarks.set(scopeId, {
          lastAppliedSceneSeq: Math.max(watermark.lastAppliedSceneSeq, event.seq),
          lastSortOrder: Math.max(watermark.lastSortOrder, event.seq),
        })
        return true
      }

      if (event.type === "user.message.accepted") {
        this.activeExecutionMetadataByScope.delete(scopeId)
        const accepted = findAcceptedMessageForEvent(useChatStore.getState().scenes[sceneId], event, agentInstanceId)
        const message = buildAcceptedConversationMessage(event, accepted)
        if (!message) return false
        const acceptedPayload = event.payload as { pending_message_id?: string | null; client_message_id?: string | null }
        if (!accepted) {
          useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, message)
        }
        chatEventRouter.routeAcceptedUserMessage(sceneId, agentInstanceId, rootAgentInstanceId, message, acceptedPayload.pending_message_id ?? undefined, acceptedPayload.client_message_id ?? undefined, tier)
        this.syncAnsweredInteraction(sceneId, agentInstanceId, message.content.metadata?.interaction_message_id, tier)
        this.syncConversationControls(sceneId, agentInstanceId, rootAgentInstanceId, tier)
        this.persistConversationMessage(sceneId, message, event, "accepted user bubble")
      } else if (event.type === "agent.assistant.message.received") {
        const message = buildAssistantConversationMessage(event)
        if (!message) return true
        useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, message)
        chatEventRouter.routeConversationMessage(sceneId, agentInstanceId, rootAgentInstanceId, message, tier)
        this.persistConversationMessage(sceneId, message, event, "assistant bubble")
      } else if (event.type === "agent.lifecycle.message") {
        const message = buildLifecycleConversationMessage(event)
        if (!message) return true
        useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, message)
        chatEventRouter.routeConversationMessage(sceneId, agentInstanceId, rootAgentInstanceId, message, tier)
        this.persistConversationMessage(sceneId, message, event, "lifecycle bubble")
      } else if (event.type === "agent.interaction.requested") {
        const projected = buildInteractionConversationMessage(event)
        if (!projected) return true
        useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, projected.message)
        const ledger = useChatStore.getState().scenes[sceneId]?.agentRuntimeStates[scopeId]
        const message = ledger?.messages.find((item) => item.id === projected.message.id) ?? projected.message
        chatEventRouter.routeInteractionRequested(sceneId, agentInstanceId, rootAgentInstanceId, message, ledger?.pendingInteraction ?? null, tier)
        this.persistConversationMessage(sceneId, message, event, "interaction bubble")
      } else if (isContextCompressionEvent(event)) {
        const current = findOpenProjectedMessage(useChatStore.getState().scenes[sceneId]?.agentRuntimeStates[scopeId]?.messages ?? [], "context_compression", contextCompressionEventJobId(event))
        const message = buildContextCompressionConversationMessage(event, current)
        if (!message) return true
        useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, message)
        chatEventRouter.routeConversationMessage(sceneId, agentInstanceId, rootAgentInstanceId, message, tier)
        this.persistConversationMessage(sceneId, message, event, "context compression bubble")
      } else if (event.type === "agent.execution.interrupted") {
        this.activeExecutionMetadataByScope.delete(scopeId)
        const message = buildInterruptedConversationMessage(event)
        if (!message) return true
        useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, message)
        chatEventRouter.routeConversationMessage(sceneId, agentInstanceId, rootAgentInstanceId, message, tier)
        this.persistConversationMessage(sceneId, message, event, "execution interrupted bubble")
      } else if (event.type === "tool.call.completed") {
        const message = buildUserVisibleToolConversationMessage(
          event,
          useChatStore.getState().scenes[sceneId]?.agentRuntimeStates[scopeId]?.messages ?? [],
        )
        if (message) {
          useChatStore.getState().appendProjectedMessage(sceneId, agentInstanceId, message)
          chatEventRouter.routeUserVisibleToolResult(sceneId, agentInstanceId, rootAgentInstanceId, message, tier)
        }
      } else if (event.type === "task_note.updated") {
        const eventPayload = event.payload as TaskNoteUpdatedPayload | undefined
        const eventTaskId = (eventPayload?.task_id as string) || (event.metadata?.task_id as string) || null
        const activeInspectorTab = useTaskNoteUiStore.getState().getActiveTab(agentInstanceId)
        const scene = useChatStore.getState().scenes[sceneId]
        const currentSelectedAgentInstanceId = scene
          ? scene.selectedAgentInstanceId ?? scene.agentInstance?.instance_id ?? scene.rootAgentInstanceId
          : null

        const isCurrentlyViewingThisNote =
          activeInspectorTab === "task_note" && currentSelectedAgentInstanceId === agentInstanceId

        if (isCurrentlyViewingThisNote) {
          // 当前处于手记 Tab 且正看着这个 Agent：防抖 150ms 重新拉取快照
          const timerKey = `${eventTaskId ?? ""}:${agentInstanceId}`
          const existingTimer = this.taskNoteDebounceTimers.get(timerKey)
          if (existingTimer) {
            clearTimeout(existingTimer)
          }
          this.taskNoteDebounceTimers.set(
            timerKey,
            setTimeout(() => {
              this.taskNoteDebounceTimers.delete(timerKey)
              void queryClient.invalidateQueries({
                queryKey: taskNoteKeys.detail(eventTaskId, agentInstanceId),
                refetchType: "active",
              })
            }, 150),
          )
        } else {
          // 未在当前视野中（在 Timeline 或看着其他 Agent）：仅标记失效，坚决不发网络请求，坚决不加任何小圆点
          void queryClient.invalidateQueries({
            queryKey: taskNoteKeys.detail(eventTaskId, agentInstanceId),
            refetchType: "none",
          })
        }
      } else {
        this.scopeProjectionWatermarks.set(scopeId, {
          lastAppliedSceneSeq: Math.max(watermark.lastAppliedSceneSeq, event.seq),
          lastSortOrder: Math.max(watermark.lastSortOrder, event.seq),
        })
        return true
      }
      this.scopeProjectionWatermarks.set(scopeId, {
        lastAppliedSceneSeq: Math.max(watermark.lastAppliedSceneSeq, event.seq),
        lastSortOrder: Math.max(watermark.lastSortOrder, event.seq),
      })
    } catch (error) {
      console.error("[chatEventCoordinator] project live event failed; keeping watermark retryable", {
        sceneId,
        scopeId,
        seq: event.seq,
        error,
      })
      return false
    }
    this.scopeProjectionWatermarks.set(scopeId, {
      lastAppliedSceneSeq: Math.max(watermark.lastAppliedSceneSeq, event.seq),
      lastSortOrder: Math.max(watermark.lastSortOrder, event.seq),
    })
    return true
  }
}

export const chatEventCoordinator = new ChatEventCoordinator()
