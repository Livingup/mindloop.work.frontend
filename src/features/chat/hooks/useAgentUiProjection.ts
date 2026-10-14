import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"

import {
  useChatStore,
  type AgentRuntimeState,
  type SceneSlice,
} from "@/features/chat/model/chatStore"
import { chatAgentRuntimeScopeId } from "@/features/chat/model/chatAgentScope"
import {
  buildAgentTerminalProjection,
  type AgentConversationProjection,
} from "@/features/chat/model/agentUiProjection"
import { useConversationUiStore } from "@/features/chat/model/conversationUiStore"
import {
  useTimelineUiStore,
  type ExecutionMonitorBlock,
} from "@/features/chat/model/timelineUiStore"

type AgentScopeProjectionSnapshot = {
  sceneId: string
  rootAgentInstanceId: string | null
  scopeId: string
  runtimeState: AgentRuntimeState | null
} | null

function selectAgentScopeSnapshot(
  state: { scenes: Record<string, SceneSlice> },
  sceneId: string,
  agentInstanceId: string | null | undefined,
): AgentScopeProjectionSnapshot {
  const slice = state.scenes[sceneId]
  if (!slice) return null
  const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, slice.rootAgentInstanceId)
  return {
    sceneId: slice.sceneId,
    rootAgentInstanceId: slice.rootAgentInstanceId,
    scopeId,
    runtimeState: slice.agentRuntimeStates[scopeId] ?? null,
  }
}

function toProjectionSource(snapshot: AgentScopeProjectionSnapshot) {
  if (!snapshot) return null
  return {
    sceneId: snapshot.sceneId,
    rootAgentInstanceId: snapshot.rootAgentInstanceId,
    agentRuntimeStates: snapshot.runtimeState
      ? { [snapshot.scopeId]: snapshot.runtimeState }
      : {},
  }
}

export const EMPTY_CONVERSATION_PROJECTION: AgentConversationProjection = Object.freeze({
  scopeId: "",
  rootAgentInstanceId: null,
  messages: Object.freeze([]) as any,
  allVisibleMessages: Object.freeze([]) as any,
  visibleMessages: Object.freeze([]) as any,
  hiddenConversationMessageCount: 0,
  queuedUserMessages: Object.freeze([]) as any,
  pendingInteraction: null,
  interactionResolutionByIdentity: Object.freeze({}),
  interactionSelectedOptionIdByIdentity: Object.freeze({}),
  visibleIdentityKey: "",
  hasMorePrevious: false,
  isLoadingPrevious: false,
})

export function useAgentConversationProjection(
  sceneId: string,
  agentInstanceId: string | null | undefined,
): AgentConversationProjection {
  const rootAgentInstanceId = useChatStore((state) => state.scenes[sceneId]?.rootAgentInstanceId ?? null)
  const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)

  // 纯粹且唯一地订阅独立的 conversationUiStore（与右侧时间线完全解耦，不回退订阅 canonical messages）
  const uiScope = useConversationUiStore((state) => state.scopes[scopeId])

  return useMemo(() => {
    if (!uiScope) return EMPTY_CONVERSATION_PROJECTION
    return {
      scopeId,
      rootAgentInstanceId,
      messages: uiScope.messages,
      allVisibleMessages: uiScope.allVisibleMessages,
      visibleMessages: uiScope.visibleMessages,
      hiddenConversationMessageCount: uiScope.hiddenConversationMessageCount,
      queuedUserMessages: uiScope.queuedUserMessages,
      pendingInteraction: uiScope.pendingInteraction,
      interactionResolutionByIdentity: uiScope.interactionResolutionByIdentity,
      interactionSelectedOptionIdByIdentity: uiScope.interactionSelectedOptionIdByIdentity,
      visibleIdentityKey: uiScope.visibleIdentityKey,
      hasMorePrevious: uiScope.hasMorePrevious ?? true,
      isLoadingPrevious: uiScope.isLoadingPrevious ?? false,
    }
  }, [rootAgentInstanceId, scopeId, uiScope])
}

export type AgentTimelineProjectionResult = {
  scopeId: string
  rootAgentInstanceId: string | null
  blocks: ExecutionMonitorBlock[]
  allBlocks: ExecutionMonitorBlock[]
  hiddenBlockCount: number
  totalToolCallCount: number
  visibleToolCallCount: number
  latestFingerprint: string
  timelineIdentityKey: string
}

export const EMPTY_TIMELINE_PROJECTION: AgentTimelineProjectionResult = Object.freeze({
  scopeId: "",
  rootAgentInstanceId: null,
  blocks: Object.freeze([]) as any,
  allBlocks: Object.freeze([]) as any,
  hiddenBlockCount: 0,
  totalToolCallCount: 0,
  visibleToolCallCount: 0,
  latestFingerprint: "",
  timelineIdentityKey: "",
})

export function useAgentTimelineProjection(
  sceneId: string,
  agentInstanceId: string | null | undefined,
): AgentTimelineProjectionResult {
  const rootAgentInstanceId = useChatStore((state) => state.scenes[sceneId]?.rootAgentInstanceId ?? null)
  const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)

  // 纯粹且唯一地订阅独立的 timelineUiStore（与左侧会话完全解耦，不回退订阅 canonical messages）
  const timelineScope = useTimelineUiStore((state) => state.scopes[scopeId])

  return useMemo(() => {
    if (!timelineScope) return EMPTY_TIMELINE_PROJECTION
    return {
      scopeId,
      rootAgentInstanceId,
      blocks: timelineScope.blocks,
      allBlocks: timelineScope.allBlocks,
      hiddenBlockCount: timelineScope.hiddenBlockCount,
      totalToolCallCount: timelineScope.totalToolCallCount,
      visibleToolCallCount: timelineScope.visibleToolCallCount,
      latestFingerprint: timelineScope.latestFingerprint,
      timelineIdentityKey: timelineScope.latestFingerprint,
    }
  }, [rootAgentInstanceId, scopeId, timelineScope])
}

export function useAgentTerminalProjection(
  sceneId: string,
  agentInstanceId: string | null | undefined,
) {
  const snapshot = useChatStore(useShallow((state) => selectAgentScopeSnapshot(state, sceneId, agentInstanceId)))

  return useMemo(
    () => buildAgentTerminalProjection(toProjectionSource(snapshot), sceneId, agentInstanceId),
    [agentInstanceId, sceneId, snapshot],
  )
}

export function useAgentConversationVisibleIdentity(
  sceneId: string,
  agentInstanceId: string | null | undefined,
): string {
  const rootAgentInstanceId = useChatStore((state) => state.scenes[sceneId]?.rootAgentInstanceId ?? null)
  const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
  return useConversationUiStore((state) => state.scopes[scopeId]?.visibleIdentityKey ?? "")
}
