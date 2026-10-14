import type { ChatMessage, QueuedUserMessage, TerminalSession } from "@/features/chat/model/chatTypes"

export const NO_AGENT_SELECTED_SCOPE_ID = "__no_agent_selected__"

export type ChatAgentScope = {
  sceneId: string
  agentInstanceId: string | null
  rootAgentInstanceId: string | null
  scopeId: string
}

export function chatAgentScopeId(sceneId: string, agentInstanceId: string | null | undefined): string {
  return `${sceneId}:${agentInstanceId ?? NO_AGENT_SELECTED_SCOPE_ID}`
}

export function chatAgentRuntimeScopeId(
  sceneId: string,
  agentInstanceId: string | null | undefined,
  rootAgentInstanceId: string | null | undefined,
 ): string {
  const selectedAgentInstanceId = agentInstanceId ?? rootAgentInstanceId ?? null
  return chatAgentScopeId(sceneId, selectedAgentInstanceId)
}

export function createChatAgentScope(
  sceneId: string,
  agentInstanceId: string | null | undefined,
  rootAgentInstanceId: string | null | undefined,
 ): ChatAgentScope {
  const scopedAgentInstanceId = agentInstanceId ?? rootAgentInstanceId ?? null
  return {
    sceneId,
    agentInstanceId: scopedAgentInstanceId,
    rootAgentInstanceId: rootAgentInstanceId ?? null,
    scopeId: chatAgentScopeId(sceneId, scopedAgentInstanceId),
  }
}

export function isAgentOwnedMessage(
  message: ChatMessage,
  agentInstanceId: string | null | undefined,
  rootAgentInstanceId: string | null | undefined,
 ): boolean {
  if (!agentInstanceId) return false
  return message.agentInstanceId === agentInstanceId
}

export function isAgentOwnedQueuedMessage(
  message: QueuedUserMessage,
  agentInstanceId: string | null | undefined,
 ): boolean {
  if (!agentInstanceId) return false
  return message.agentInstanceId === agentInstanceId
}

export function isAgentOwnedTerminalSession(
  session: TerminalSession,
  agentInstanceId: string | null | undefined,
  rootAgentInstanceId: string | null | undefined,
 ): boolean {
  if (!agentInstanceId) return false
  return session.agentInstanceId === agentInstanceId
}



