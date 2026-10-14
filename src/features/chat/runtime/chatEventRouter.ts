/**
 * chatEventRouter - 纯投影分类与 DTO 分发器
 *
 * 职责：
 * 1. 接收来自 Coordinator 的已确认事件和已解析气泡；
 * 2. 依据事件类型与 metadata 进行严格的消费方分类：
 *    - conversation-only: 普通用户消息、Agent Markdown 正文、用户可见工具结果、交互卡片；
 *    - timeline-only: execution_process 气泡、LLM/Tool 流式更新与执行指标；
 *    - dual-consumer: task_boundary 任务边界，分别向两侧派发专用 DTO；
 *    - terminal-only: 终端事件，不影响主聊天 UI；
 *    - unknown fail-safe: 安全降级记录。
 * 3. 分别向 conversationUiStore 与 timelineUiStore 写入最小必要数据，绝不跨侧污染。
 */

import { chatBubbleToMessage, type AgentScopedChatBubbleHydration, type SceneCacheTier } from "@/features/chat/model/chatStore"
import type { ChatBubbleMessageDto } from "@/features/chat/api/agentRuntimeApi"
import type { ChatMessage, PendingInteraction, QueuedUserMessage } from "@/features/chat/model/chatTypes"
import { chatAgentRuntimeScopeId } from "@/features/chat/model/chatAgentScope"
import { isConversationRenderableMessage } from "@/features/chat/model/conversationProjection"
import { useConversationUiStore } from "@/features/chat/model/conversationUiStore"
import { useTimelineUiStore, type ExecutionMonitorBlock } from "@/features/chat/model/timelineUiStore"
import {
  isExecutionProcessMessage,
  isTaskBoundaryMessage,
  parseExecutionProcessIterations as parseStoredExecutionIterations,
  parseTaskBoundary,
} from "@/features/chat/runtime/executionProcess"
import { userVisibleToolResultKindFromPreview } from "@/features/chat/runtime/userVisibleToolResults"
import { chatTimelineDebug } from "@/features/chat/runtime/chatTimelineDebug"

function parseExecutionProcessIterations(metadata: Record<string, unknown>) {
  return parseStoredExecutionIterations(metadata).map((iteration) => ({
    ...iteration,
    tools: iteration.tools.map((tool) => {
      if (!userVisibleToolResultKindFromPreview(tool.uiPreview, tool.resultPreview, tool.toolName)) return tool
      const { resultPreview: _result, uiPreview: _ui, ...process } = tool
      return process
    }),
  }))
}

export function executionRoundFromMetadata(metadata: Record<string, unknown> | undefined): number | undefined {
  const value = metadata?.execution_round
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

export function buildExecutionMonitorBlocksFromMessages(messages: ChatMessage[]): ExecutionMonitorBlock[] {
  const blocks: ExecutionMonitorBlock[] = []
  const seenIterationIds = new Set<string>()
  let previousExecutionRound = 0
  for (const message of messages) {
    if (isTaskBoundaryMessage(message)) {
      const boundary = parseTaskBoundary(message.content.metadata ?? {})
      if (!boundary) continue
      blocks.push({
        kind: "task_boundary",
        messageId: message.id,
        createdAt: message.createdAt,
        boundary,
      })
      previousExecutionRound = 0
      continue
    }
    if (!isExecutionProcessMessage(message)) continue
    const iterations = parseExecutionProcessIterations(message.content.metadata ?? {})
    if (iterations.length === 0) continue
    const persistedRound = executionRoundFromMetadata(message.content.metadata)
    iterations.forEach((iteration, iterationIndex) => {
      const blockMessageId = iteration.id || `${message.id}:${iteration.id}`
      if (seenIterationIds.has(blockMessageId)) {
        return
      }
      seenIterationIds.add(blockMessageId)
      const round = iterationIndex === 0 && persistedRound !== undefined
        ? persistedRound
        : previousExecutionRound + 1
      blocks.push({
        kind: "execution",
        messageId: blockMessageId,
        sourceMessageId: message.id,
        createdAt: message.createdAt,
        round,
        iteration,
      })
      previousExecutionRound = round
    })
  }
  return blocks
}

export const chatEventRouter = {
  /**
   * 分流并派发单条 ChatBubble。
   */
  routeChatBubble(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    bubble: ChatBubbleMessageDto,
    tier: SceneCacheTier = "hot",
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    const bubbleKind = bubble.metadata?.bubble_kind

    if (bubbleKind === "execution_process") {
      // 纯右侧时间线消费
      const iterations = parseExecutionProcessIterations(bubble.metadata ?? {})
      chatTimelineDebug("router.execution_route", { sceneId, scopeId, agentInstanceId, bubbleId: bubble.bubble_id, iterationCount: iterations.length, executionRound: executionRoundFromMetadata(bubble.metadata) ?? null })
      if (iterations.length > 0) {
        const persistedRound = executionRoundFromMetadata(bubble.metadata)
        useTimelineUiStore.getState().upsertExecutionIterations(
          scopeId,
          sceneId,
          agentInstanceId,
          bubble.bubble_id,
          bubble.created_at,
          iterations,
          persistedRound,
          tier,
        )
      }
      return
    }

    if (bubbleKind === "task_boundary") {
      // 双消费边界！两侧都必须得到各自的专用 DTO
      const boundary = parseTaskBoundary(bubble.metadata ?? {})
      if (boundary) {
        useTimelineUiStore.getState().appendTaskBoundaryBlock(
          scopeId,
          sceneId,
          agentInstanceId,
          bubble.bubble_id,
          bubble.created_at,
          boundary,
          tier,
        )
      }
      const message = chatBubbleToMessage(bubble)
      useConversationUiStore.getState().appendMessages(
        scopeId,
        sceneId,
        agentInstanceId,
        [message],
        tier,
      )
      return
    }

    // 会话消息（普通对话、用户可见工具结果、上下文压缩气泡等）
    const message = chatBubbleToMessage(bubble)
    if (isConversationRenderableMessage(message)) {
      useConversationUiStore.getState().appendMessages(
        scopeId,
        sceneId,
        agentInstanceId,
        [message],
        tier,
      )
    }
  },

  /**
   * 分流并派发批量水合数据。
   */
  routeHydratedBatches(
    sceneId: string,
    batches: AgentScopedChatBubbleHydration[],
    mode: "baseline" | "incremental",
    rootAgentInstanceId: string | null,
    tier: SceneCacheTier = "hot",
  ): void {
    for (const batch of batches) {
      const agentInstanceId = batch.agentInstanceId?.trim()
      if (!agentInstanceId) continue
      const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)

      const allMessages = batch.bubbles.map(chatBubbleToMessage)

      // 1. 左侧会话分流
      const conversationMessages = allMessages.filter(isConversationRenderableMessage)
      if (mode === "baseline") {
        const existingConversationScope = useConversationUiStore.getState().scopes[scopeId]
        useConversationUiStore.getState().hydrateScope(
          scopeId,
          sceneId,
          agentInstanceId,
          conversationMessages,
          existingConversationScope?.queuedUserMessages ?? [],
          existingConversationScope?.pendingInteraction ?? null,
          tier,
        )
      } else if (conversationMessages.length > 0) {
        useConversationUiStore.getState().appendMessages(
          scopeId,
          sceneId,
          agentInstanceId,
          conversationMessages,
          tier,
        )
      }

      // 2. 右侧时间线分流
      if (mode === "baseline") {
        // baseline 允许一次性 O(N) 构建
        const timelineBlocks = buildExecutionMonitorBlocksFromMessages(allMessages)
        chatTimelineDebug("router.timeline_baseline", { sceneId, scopeId, agentInstanceId, blockCount: timelineBlocks.length })
        useTimelineUiStore.getState().hydrateBlocks(
          scopeId,
          sceneId,
          agentInstanceId,
          timelineBlocks,
          tier,
        )
      } else {
        // 增量水合逐个派发
        for (const bubble of batch.bubbles) {
          const kind = bubble.metadata?.bubble_kind
          if (kind === "execution_process") {
            const iterations = parseExecutionProcessIterations(bubble.metadata ?? {})
            if (iterations.length > 0) {
              const persistedRound = executionRoundFromMetadata(bubble.metadata)
              useTimelineUiStore.getState().upsertExecutionIterations(
                scopeId,
                sceneId,
                agentInstanceId,
                bubble.bubble_id,
                bubble.created_at,
                iterations,
                persistedRound,
                tier,
              )
            }
          } else if (kind === "task_boundary") {
            const boundary = parseTaskBoundary(bubble.metadata ?? {})
            if (boundary) {
              useTimelineUiStore.getState().appendTaskBoundaryBlock(
                scopeId,
                sceneId,
                agentInstanceId,
                bubble.bubble_id,
                bubble.created_at,
                boundary,
                tier,
              )
            }
          }
        }
      }
    }
  },

  /**
   * 派发乐观发送的用户消息（仅左侧会话）。
   */
  routeOptimisticUserMessage(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    message: ChatMessage,
    tier: SceneCacheTier = "hot",
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    useConversationUiStore.getState().appendMessages(
      scopeId,
      sceneId,
      agentInstanceId,
      [message],
      tier,
    )
  },

  /**
   * 派发助手消息（仅左侧会话）。
   */
  routeAssistantMessage(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    message: ChatMessage,
    tier: SceneCacheTier = "hot",
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    useConversationUiStore.getState().appendMessages(scopeId, sceneId, agentInstanceId, [message], tier)
  },
  routeQueuedUserMessage(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    message: QueuedUserMessage,
    tier: SceneCacheTier = "hot",
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    useConversationUiStore.getState().enqueueQueuedUserMessage(scopeId, sceneId, agentInstanceId, message, tier)
  },
  routeConversationControls(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    queuedUserMessages: QueuedUserMessage[],
    pendingInteraction: PendingInteraction | null,
    tier: SceneCacheTier = "hot",
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    const store = useConversationUiStore.getState()
    store.updateQueuedUserMessages(scopeId, queuedUserMessages, sceneId, agentInstanceId, tier)
    store.updatePendingInteraction(scopeId, pendingInteraction)
  },
  routeQueuedUserMessageFailed(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    clientMessageId: string,
    errorMessage: string,
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    useConversationUiStore.getState().markQueuedUserMessageFailed(
      scopeId, clientMessageId, errorMessage, sceneId, agentInstanceId,
    )
  },
  routeRemovedQueuedUserMessage(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    pendingMessageId: string,
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    useConversationUiStore.getState().removeQueuedUserMessage(
      scopeId, pendingMessageId, undefined, sceneId, agentInstanceId,
    )
  },
  routeAcceptedUserMessage(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    message: ChatMessage,
    pendingMessageId?: string | null,
    clientMessageId?: string | null,
    tier: SceneCacheTier = "hot",
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    const store = useConversationUiStore.getState()
    store.appendMessages(scopeId, sceneId, agentInstanceId, [message], tier)
    store.removeQueuedUserMessage(
      scopeId,
      pendingMessageId ?? undefined,
      clientMessageId ?? message.clientMessageId ?? undefined,
      sceneId, agentInstanceId, tier,
    )
  },
  routeInteractionRequested(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    message: ChatMessage,
    pendingInteraction: PendingInteraction | null,
    tier: SceneCacheTier = "hot",
  ): void {
    const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
    const store = useConversationUiStore.getState()
    store.appendMessages(scopeId, sceneId, agentInstanceId, [message], tier)
    store.updatePendingInteraction(scopeId, pendingInteraction)
  },
  routeConversationMessage(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    message: ChatMessage,
    tier: SceneCacheTier = "hot",
  ): void {
    this.routeAssistantMessage(sceneId, agentInstanceId, rootAgentInstanceId, message, tier)
  },
  routeUserVisibleToolResult(
    sceneId: string,
    agentInstanceId: string,
    rootAgentInstanceId: string | null,
    message: ChatMessage,
    tier: SceneCacheTier = "hot",
  ): void {
    this.routeConversationMessage(sceneId, agentInstanceId, rootAgentInstanceId, message, tier)
  },
}
