import type { AgentRuntimeState, SceneSlice } from "@/features/chat/model/chatStore"
import { resolveAgentRuntimeState } from "@/features/chat/model/chatStore"
import type { ChatMessage, PendingInteraction, QueuedUserMessage, TerminalSession } from "@/features/chat/model/chatTypes"
import { chatAgentRuntimeScopeId } from "@/features/chat/model/chatAgentScope"
import {
  buildConversationRenderableMessages,
  buildInteractionSuccessorMessages,
  conversationProjectionMessageIdentity,
} from "@/features/chat/model/conversationProjection"
import { MAX_CONVERSATION_VISIBLE_MESSAGES } from "@/features/chat/runtime/runtimeConfig"

export type InteractionResolution = "active" | "selected" | "custom_reply" | "superseded"

export type AgentConversationProjection = {
  scopeId: string
  rootAgentInstanceId: string | null
  messages: ChatMessage[]
  allVisibleMessages: ChatMessage[]
  visibleMessages: ChatMessage[]
  hiddenConversationMessageCount: number
  queuedUserMessages: QueuedUserMessage[]
  pendingInteraction: PendingInteraction | null
  interactionResolutionByIdentity: Record<string, InteractionResolution>
  interactionSelectedOptionIdByIdentity: Record<string, string>
  visibleIdentityKey: string
  hasMorePrevious?: boolean
  isLoadingPrevious?: boolean
}

export type AgentTimelineProjection = {
  scopeId: string
  rootAgentInstanceId: string | null
  messages: ChatMessage[]
  timelineIdentityKey: string
}

export type AgentTerminalProjection = {
  scopeId: string
  rootAgentInstanceId: string | null
  terminalSessions: TerminalSession[]
  terminalIdentityKey: string
}

export type AgentRuntimeProjectionSource = Pick<SceneSlice, "sceneId" | "rootAgentInstanceId" | "agentRuntimeStates"> | Pick<AgentRuntimeState, "scopeId" | "agentInstanceId" | "messages" | "queuedUserMessages" | "terminalSessions" | "pendingInteraction">

export function buildAgentConversationProjection(
  scene: Pick<SceneSlice, "sceneId" | "rootAgentInstanceId" | "agentRuntimeStates"> | null | undefined,
  sceneId: string,
  agentInstanceId: string | null | undefined,
 ): AgentConversationProjection {
  const rootAgentInstanceId = scene?.rootAgentInstanceId ?? null
  const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
  const runtimeState = resolveAgentRuntimeState(scene, agentInstanceId)
  // runtimeState.messages is the shared persisted bubble collection for this Agent scope.
  // The left conversation/user-visible-result list is a filtered projection, independent
  // from the right execution timeline projection that consumes the same underlying bubbles.
  const scopedMessages = runtimeState?.messages ?? []
  const allVisibleMessages = buildConversationRenderableMessages(scopedMessages)
  const hiddenConversationMessageCount = Math.max(0, allVisibleMessages.length - MAX_CONVERSATION_VISIBLE_MESSAGES)
  const visibleMessages = hiddenConversationMessageCount > 0
    ? allVisibleMessages.slice(-MAX_CONVERSATION_VISIBLE_MESSAGES)
    : allVisibleMessages
  const queuedUserMessages = runtimeState?.queuedUserMessages ?? []
  const pendingInteraction = runtimeState?.pendingInteraction ?? null
  // Task boundaries remain visible in the left list, but timeline facts must not
  // resolve an interaction until an actual conversation successor arrives.
  const interactionProjection = buildInteractionProjection(buildInteractionSuccessorMessages(scopedMessages))

  return {
    scopeId,
    rootAgentInstanceId,
    messages: scopedMessages,
    allVisibleMessages,
    visibleMessages,
    hiddenConversationMessageCount,
    queuedUserMessages,
    pendingInteraction,
    interactionResolutionByIdentity: interactionProjection.resolutions,
    interactionSelectedOptionIdByIdentity: interactionProjection.selectedOptionIds,
    visibleIdentityKey: conversationVisibleIdentityKey(visibleMessages),
    hasMorePrevious: true,
    isLoadingPrevious: false,
  }
}

export function buildAgentTimelineProjection(
  scene: Pick<SceneSlice, "sceneId" | "rootAgentInstanceId" | "agentRuntimeStates"> | null | undefined,
  sceneId: string,
  agentInstanceId: string | null | undefined,
 ): AgentTimelineProjection {
  const rootAgentInstanceId = scene?.rootAgentInstanceId ?? null
  const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
  // The timeline intentionally reads the same persisted bubble collection as the left
  // projection, but applies its own rendering rules for LLM/tool execution process state.
  const messages = resolveAgentRuntimeState(scene, agentInstanceId)?.messages ?? []
  return {
    scopeId,
    rootAgentInstanceId,
    messages,
    timelineIdentityKey: messages.map((message) => `${message.id}:${message.status}:${message.content.metadata?.bubble_kind ?? "message"}`).join("|"),
  }
}

export function buildAgentTerminalProjection(
  scene: Pick<SceneSlice, "sceneId" | "rootAgentInstanceId" | "agentRuntimeStates"> | null | undefined,
  sceneId: string,
  agentInstanceId: string | null | undefined,
 ): AgentTerminalProjection {
  const rootAgentInstanceId = scene?.rootAgentInstanceId ?? null
  const scopeId = chatAgentRuntimeScopeId(sceneId, agentInstanceId, rootAgentInstanceId)
  const terminalSessions = resolveAgentRuntimeState(scene, agentInstanceId)?.terminalSessions ?? []
  return {
    scopeId,
    rootAgentInstanceId,
    terminalSessions,
    terminalIdentityKey: terminalSessions.map(terminalSessionIdentityPart).join("|"),
  }
}

export { conversationProjectionMessageIdentity } from "@/features/chat/model/conversationProjection"

export function buildInteractionProjection(
  allVisibleMessages: ChatMessage[],
): { resolutions: Record<string, InteractionResolution>; selectedOptionIds: Record<string, string> } {
  const resolutions: Record<string, InteractionResolution> = {}
  const selectedOptionIds: Record<string, string> = {}
  allVisibleMessages.forEach((message, index) => {
    if ((message.interactionOptions?.length ?? 0) === 0) return
    const identity = conversationProjectionMessageIdentity(message)
    const successor = allVisibleMessages[index + 1]
    const successorMetadata = successor?.content.metadata
    const successorInteractionMessageId = typeof successorMetadata?.interaction_message_id === "string"
      ? successorMetadata.interaction_message_id
      : null
    const successorOptionId = successorInteractionMessageId === message.id && typeof successorMetadata?.interaction_option_id === "string"
      ? successorMetadata.interaction_option_id
      : null
    const selectedOptionId = message.selectedOptionId ?? successorOptionId
    if (selectedOptionId) {
      resolutions[identity] = "selected"
      selectedOptionIds[identity] = selectedOptionId
      return
    }
    if (!successor) {
      resolutions[identity] = "active"
    } else if (successor.role === "user") {
      resolutions[identity] = "custom_reply"
    } else {
      resolutions[identity] = "superseded"
    }
  })
  return { resolutions, selectedOptionIds }
}

function conversationVisibleIdentityKey(messages: ChatMessage[]): string {
  if (messages.length === 0) return "empty"
  return messages.map(conversationProjectionMessageIdentity).join("|")
}

function terminalSessionIdentityPart(session: TerminalSession): string {
  const terminalId = session.terminalId ?? session.id
  const latestChunk = session.output[session.output.length - 1]
  return [
    session.id,
    terminalId,
    session.status,
    session.exitCode ?? "",
    latestChunk?.chunk_index ?? "",
    latestChunk?.chunk?.length ?? 0,
  ].join(":")
}
