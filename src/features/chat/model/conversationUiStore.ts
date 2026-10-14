import { create } from "zustand"

import type {
  ChatMessage,
  PendingInteraction,
  QueuedUserMessage,
} from "@/features/chat/model/chatTypes"
import {
  type SceneCacheTier,
  compareDurableBubbleBaselineOrder,
  mergeHydratedMessages,
  reconcileQueuedUserMessages,
  restorePendingInteractionFromMessages,
} from "@/features/chat/model/chatStore"
import {
  buildConversationRenderableMessages,
  buildInteractionSuccessorMessages,
  conversationProjectionMessageIdentity,
  isConversationRenderableMessage,
} from "@/features/chat/model/conversationProjection"
import {
  buildInteractionProjection,
  type InteractionResolution,
} from "@/features/chat/model/agentUiProjection"
import { MAX_CONVERSATION_VISIBLE_MESSAGES } from "@/features/chat/runtime/runtimeConfig"

export const MAX_HOT_CONVERSATION_EXPANDED_HISTORY = 400

export type ConversationScopeUiState = {
  scopeId: string
  sceneId: string
  agentInstanceId: string
  messages: ChatMessage[]
  allVisibleMessages: ChatMessage[]
  visibleMessages: ChatMessage[]
  hiddenConversationMessageCount: number
  queuedUserMessages: QueuedUserMessage[]
  pendingInteraction: PendingInteraction | null
  interactionResolutionByIdentity: Record<string, InteractionResolution>
  interactionSelectedOptionIdByIdentity: Record<string, string>
  visibleIdentityKey: string
  hasMorePrevious: boolean
  isLoadingPrevious: boolean
  loadedHistoryCount: number
}

function conversationVisibleIdentityKey(messages: ChatMessage[]): string {
  if (messages.length === 0) return "empty"
  return messages.map(conversationProjectionMessageIdentity).join("|")
}

function messageQuotaForTier(tier: SceneCacheTier): number {
  if (tier === "cold") return 0
  if (tier === "warm") return 100
  return 200
}

/**
 * 裁剪消息并强制常驻未决交互（Pending Interaction Pinning）。
 * 仅保留左侧会话可渲染消息与未决交互消息，避免非会话气泡占用左侧保留配额。
 */
function trimRetainedMessages(messages: ChatMessage[], quota: number): ChatMessage[] {
  const candidateMessages = messages.filter(
    (m) => isConversationRenderableMessage(m) || m.interactionState === "pending",
  )
  if (quota <= 0) {
    // Cold 模式：如果存在未决交互相关的消息，仍需将其 Pin 住
    return candidateMessages.filter((m) => m.interactionState === "pending")
  }
  if (candidateMessages.length <= quota) return candidateMessages

  // 识别需要 pin 住的交互消息
  const pinnedIds = new Set<string>()
  for (const m of candidateMessages) {
    if (m.interactionState === "pending") {
      pinnedIds.add(m.id)
    }
  }

  // 优先保留尾部消息 + 所有 pinned 消息
  const tailMessages = candidateMessages.slice(-quota)
  const tailIds = new Set(tailMessages.map((m) => m.id))

  const pinnedOutsideTail = candidateMessages.filter((m) => pinnedIds.has(m.id) && !tailIds.has(m.id))
  if (pinnedOutsideTail.length === 0) return tailMessages

  return [...pinnedOutsideTail, ...tailMessages].sort(compareDurableBubbleBaselineOrder)
}

function computeScopeDerivations(
  scopeId: string,
  sceneId: string,
  agentInstanceId: string,
  rawMessages: ChatMessage[],
  queuedUserMessages: QueuedUserMessage[],
  pendingInteraction: PendingInteraction | null,
  tier: SceneCacheTier = "hot",
  options: {
    hasMorePrevious?: boolean
    isLoadingPrevious?: boolean
    loadedHistoryCount?: number
  } = {},
): ConversationScopeUiState {
  const loadedHistoryCount = options.loadedHistoryCount ?? 0
  const effectiveLoadedHistoryCount = tier === "hot" ? loadedHistoryCount : 0
  const baseQuota = messageQuotaForTier(tier)
  // 当为活跃 hot 状态时，为用户主动展开或实时追加的窗口提供配额保护；切走或降级时正常收拢
  const quota = tier === "hot"
    ? Math.max(baseQuota, baseQuota + effectiveLoadedHistoryCount)
    : baseQuota
  const retainedMessages = trimRetainedMessages(rawMessages, quota)
  const allVisibleMessages = buildConversationRenderableMessages(retainedMessages)
  const effectiveVisibleLimit = MAX_CONVERSATION_VISIBLE_MESSAGES + effectiveLoadedHistoryCount
  const hiddenConversationMessageCount = Math.max(
    0,
    allVisibleMessages.length - effectiveVisibleLimit,
  )
  const visibleMessages = hiddenConversationMessageCount > 0
    ? allVisibleMessages.slice(-effectiveVisibleLimit)
    : allVisibleMessages

  const interactionProjection = buildInteractionProjection(
    buildInteractionSuccessorMessages(retainedMessages),
  )

  return {
    scopeId,
    sceneId,
    agentInstanceId,
    messages: retainedMessages,
    allVisibleMessages,
    visibleMessages,
    hiddenConversationMessageCount,
    queuedUserMessages: reconcileQueuedUserMessages(queuedUserMessages, rawMessages),
    pendingInteraction,
    interactionResolutionByIdentity: interactionProjection.resolutions,
    interactionSelectedOptionIdByIdentity: interactionProjection.selectedOptionIds,
    visibleIdentityKey: conversationVisibleIdentityKey(visibleMessages),
    hasMorePrevious: options.hasMorePrevious ?? true,
    isLoadingPrevious: options.isLoadingPrevious ?? false,
    loadedHistoryCount: effectiveLoadedHistoryCount,
  }
}

export type ConversationUiStore = {
  scopes: Record<string, ConversationScopeUiState>
  setScopeState: (scopeId: string, state: ConversationScopeUiState) => void
  setLoadingPrevious: (scopeId: string, loading: boolean) => void
  prependMessages: (
    scopeId: string,
    sceneId: string,
    agentInstanceId: string,
    olderMessages: ChatMessage[],
    hasMore: boolean,
    tier?: SceneCacheTier,
  ) => void
  hydrateScope: (
    scopeId: string,
    sceneId: string,
    agentInstanceId: string,
    messages: ChatMessage[],
    queuedUserMessages: QueuedUserMessage[],
    pendingInteraction: PendingInteraction | null,
    tier?: SceneCacheTier,
  ) => void
  appendMessages: (
    scopeId: string,
    sceneId: string,
    agentInstanceId: string,
    newMessages: ChatMessage[],
    tier?: SceneCacheTier,
  ) => void
  updatePendingInteraction: (
    scopeId: string,
    pendingInteraction: PendingInteraction | null,
  ) => void
  updateQueuedUserMessages: (
    scopeId: string,
    queuedUserMessages: QueuedUserMessage[],
    sceneId?: string,
    agentInstanceId?: string,
    tier?: SceneCacheTier,
  ) => void
  enqueueQueuedUserMessage: (
    scopeId: string,
    sceneId: string,
    agentInstanceId: string,
    queuedUserMessage: QueuedUserMessage,
    tier?: SceneCacheTier,
  ) => void
  removeQueuedUserMessage: (
    scopeId: string,
    pendingMessageId?: string,
    clientMessageId?: string,
    sceneId?: string,
    agentInstanceId?: string,
    tier?: SceneCacheTier,
  ) => void
  markQueuedUserMessageFailed: (
    scopeId: string,
    clientMessageId: string,
    errorMessage: string,
    sceneId?: string,
    agentInstanceId?: string,
    tier?: SceneCacheTier,
  ) => void
  clearScope: (scopeId: string) => void
  clearScene: (sceneId: string) => void
  clearAll: () => void
}

export const useConversationUiStore = create<ConversationUiStore>((set) => ({
  scopes: {},

  setScopeState: (scopeId, scopeState) =>
    set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeId]: scopeState,
      },
    })),

  setLoadingPrevious: (scopeId, loading) =>
    set((state) => {
      const existing = state.scopes[scopeId]
      if (!existing || existing.isLoadingPrevious === loading) return state
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            ...existing,
            isLoadingPrevious: loading,
          },
        },
      }
    }),

  prependMessages: (scopeId, sceneId, agentInstanceId, olderMessages, hasMore, tier = "hot") =>
    set((state) => {
      const existing = state.scopes[scopeId]
      const currentMessages = existing?.messages ?? []
      if (!olderMessages || olderMessages.length === 0) {
        if (!existing) return state
        const nextScope = computeScopeDerivations(
          scopeId,
          sceneId,
          agentInstanceId,
          currentMessages,
          existing.queuedUserMessages,
          existing.pendingInteraction,
          tier,
          {
            hasMorePrevious: hasMore,
            isLoadingPrevious: false,
            loadedHistoryCount: existing.loadedHistoryCount,
          },
        )
        return {
          scopes: {
            ...state.scopes,
            [scopeId]: nextScope,
          },
        }
      }
      // 使用 baseline 模式合并去重，并严格保证按 sortOrder 升序排列
      const combinedMessages = mergeHydratedMessages([], [...currentMessages, ...olderMessages], "baseline")
      const previousRenderableCount = existing?.allVisibleMessages.length
        ?? buildConversationRenderableMessages(currentMessages).length
      const nextRenderableCount = buildConversationRenderableMessages(combinedMessages).length
      const newlyAddedCount = Math.max(0, nextRenderableCount - previousRenderableCount)
      const nextLoadedCount = (existing?.loadedHistoryCount ?? 0) + newlyAddedCount
      const nextScope = computeScopeDerivations(
        scopeId,
        sceneId,
        agentInstanceId,
        combinedMessages,
        existing?.queuedUserMessages ?? [],
        restorePendingInteractionFromMessages(combinedMessages),
        tier,
        {
          hasMorePrevious: hasMore,
          isLoadingPrevious: false,
          loadedHistoryCount: nextLoadedCount,
        },
      )
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: nextScope,
        },
      }
    }),

  hydrateScope: (scopeId, sceneId, agentInstanceId, messages, queuedUserMessages, _pendingInteraction, tier = "hot") =>
    set((state) => {
      const existing = state.scopes[scopeId]
      const merged = mergeHydratedMessages(existing?.messages ?? [], messages, "baseline")
      const nextScope = computeScopeDerivations(
        scopeId,
        sceneId,
        agentInstanceId,
        merged,
        queuedUserMessages,
        restorePendingInteractionFromMessages(merged),
        tier,
        {
          hasMorePrevious: existing?.hasMorePrevious ?? true,
          isLoadingPrevious: false,
          loadedHistoryCount: existing?.loadedHistoryCount ?? 0,
        },
      )
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: nextScope,
        },
      }
    }),

  appendMessages: (scopeId, sceneId, agentInstanceId, newMessages, tier = "hot") =>
    set((state) => {
      if (!newMessages || newMessages.length === 0) return state
      const existing = state.scopes[scopeId]
      const currentMessages = existing?.messages ?? []
      const combinedMessages = mergeHydratedMessages(currentMessages, newMessages, "incremental")
      const currentLoadedHistoryCount = existing?.loadedHistoryCount ?? 0
      let nextLoadedHistoryCount = currentLoadedHistoryCount
      if (existing && tier === "hot") {
        const previousRenderableCount = existing.allVisibleMessages.length
        const nextRenderableCount = buildConversationRenderableMessages(combinedMessages).length
        const appendedRenderableCount = Math.max(0, nextRenderableCount - previousRenderableCount)
        if (appendedRenderableCount > 0) {
          const targetVisibleCount = existing.visibleMessages.length + appendedRenderableCount
          const requiredLoadedHistoryCount = Math.max(
            0,
            targetVisibleCount - MAX_CONVERSATION_VISIBLE_MESSAGES,
          )
          nextLoadedHistoryCount = Math.max(
            currentLoadedHistoryCount,
            Math.min(MAX_HOT_CONVERSATION_EXPANDED_HISTORY, requiredLoadedHistoryCount),
          )
        }
      }
      const nextScope = computeScopeDerivations(
        scopeId,
        sceneId,
        agentInstanceId,
        combinedMessages,
        existing?.queuedUserMessages ?? [],
        restorePendingInteractionFromMessages(combinedMessages),
        tier,
        {
          hasMorePrevious: existing?.hasMorePrevious,
          isLoadingPrevious: existing?.isLoadingPrevious,
          loadedHistoryCount: nextLoadedHistoryCount,
        },
      )
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: nextScope,
        },
      }
    }),

  updatePendingInteraction: (scopeId, pendingInteraction) =>
    set((state) => {
      const existing = state.scopes[scopeId]
      if (!existing || existing.pendingInteraction === pendingInteraction) return state
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            ...existing,
            pendingInteraction,
          },
        },
      }
    }),

  updateQueuedUserMessages: (scopeId, queuedUserMessages, sceneId, agentInstanceId, tier = "hot") =>
    set((state) => {
      const existing = state.scopes[scopeId]
      if (!existing && (!sceneId || !agentInstanceId)) return state
      const resolvedSceneId = existing?.sceneId ?? sceneId!
      const resolvedAgentInstanceId = existing?.agentInstanceId ?? agentInstanceId!
      const nextScope = computeScopeDerivations(
        scopeId,
        resolvedSceneId,
        resolvedAgentInstanceId,
        existing?.messages ?? [],
        queuedUserMessages,
        existing?.pendingInteraction ?? null,
        tier,
        {
          hasMorePrevious: existing?.hasMorePrevious,
          isLoadingPrevious: existing?.isLoadingPrevious,
          loadedHistoryCount: existing?.loadedHistoryCount,
        },
      )
      return { scopes: { ...state.scopes, [scopeId]: nextScope } }
    }),
  enqueueQueuedUserMessage: (scopeId, sceneId, agentInstanceId, queuedUserMessage, tier = "hot") =>
    set((state) => {
      const existing = state.scopes[scopeId]
      const current = existing?.queuedUserMessages ?? []
      const matches = (message: QueuedUserMessage) =>
        message.pendingMessageId === queuedUserMessage.pendingMessageId
        || message.clientMessageId === queuedUserMessage.clientMessageId
      const nextQueued = current.some(matches)
        ? current.map((message) => matches(message)
          ? { ...message, ...queuedUserMessage, interactionSelection: queuedUserMessage.interactionSelection ?? message.interactionSelection }
          : message)
        : [...current, queuedUserMessage]
      const nextScope = computeScopeDerivations(
        scopeId,
        sceneId,
        agentInstanceId,
        existing?.messages ?? [],
        nextQueued,
        existing?.pendingInteraction ?? null,
        tier,
        {
          hasMorePrevious: existing?.hasMorePrevious,
          isLoadingPrevious: existing?.isLoadingPrevious,
          loadedHistoryCount: existing?.loadedHistoryCount,
        },
      )
      return { scopes: { ...state.scopes, [scopeId]: nextScope } }
    }),
  removeQueuedUserMessage: (scopeId, pendingMessageId, clientMessageId, sceneId, agentInstanceId, tier = "hot") =>
    set((state) => {
      const existing = state.scopes[scopeId]
      if (!existing && (!sceneId || !agentInstanceId)) return state
      const resolvedSceneId = existing?.sceneId ?? sceneId!
      const resolvedAgentInstanceId = existing?.agentInstanceId ?? agentInstanceId!
      const currentQueued = existing?.queuedUserMessages ?? []
      const nextQueued = currentQueued.filter((message) =>
        !((pendingMessageId && message.pendingMessageId === pendingMessageId)
          || (clientMessageId && message.clientMessageId === clientMessageId)),
      )
      if (existing && nextQueued.length === currentQueued.length) return state
      const nextScope = computeScopeDerivations(
        scopeId,
        resolvedSceneId,
        resolvedAgentInstanceId,
        existing?.messages ?? [],
        nextQueued,
        existing?.pendingInteraction ?? null,
        tier,
        {
          hasMorePrevious: existing?.hasMorePrevious,
          isLoadingPrevious: existing?.isLoadingPrevious,
          loadedHistoryCount: existing?.loadedHistoryCount,
        },
      )
      return { scopes: { ...state.scopes, [scopeId]: nextScope } }
    }),
  markQueuedUserMessageFailed: (scopeId, clientMessageId, errorMessage, sceneId, agentInstanceId, tier = "hot") =>
    set((state) => {
      const existing = state.scopes[scopeId]
      if (!existing && (!sceneId || !agentInstanceId)) return state
      const resolvedSceneId = existing?.sceneId ?? sceneId!
      const resolvedAgentInstanceId = existing?.agentInstanceId ?? agentInstanceId!
      const currentQueued = existing?.queuedUserMessages ?? []
      const nextQueued = currentQueued.map((message) =>
        message.clientMessageId === clientMessageId ? { ...message, status: "failed" as const, errorMessage } : message,
      )
      const nextScope = computeScopeDerivations(
        scopeId,
        resolvedSceneId,
        resolvedAgentInstanceId,
        existing?.messages ?? [],
        nextQueued,
        existing?.pendingInteraction ?? null,
        tier,
        {
          hasMorePrevious: existing?.hasMorePrevious,
          isLoadingPrevious: existing?.isLoadingPrevious,
          loadedHistoryCount: existing?.loadedHistoryCount,
        },
      )
      return { scopes: { ...state.scopes, [scopeId]: nextScope } }
    }),

  clearScope: (scopeId) =>
    set((state) => {
      if (!state.scopes[scopeId]) return state
      const { [scopeId]: _removed, ...rest } = state.scopes
      return { scopes: rest }
    }),

  clearScene: (sceneId) =>
    set((state) => {
      let changed = false
      const nextScopes: Record<string, ConversationScopeUiState> = {}
      for (const [scopeId, scope] of Object.entries(state.scopes)) {
        if (scope.sceneId === sceneId) {
          changed = true
        } else {
          nextScopes[scopeId] = scope
        }
      }
      return changed ? { scopes: nextScopes } : state
    }),

  clearAll: () => set({ scopes: {} }),
}))
