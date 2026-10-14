import type { ChatMessage } from "@/features/chat/model/chatTypes"
import { isExecutionProcessMessage, isTaskBoundaryMessage } from "@/features/chat/runtime/executionProcess"
import {
  isUserVisibleToolResultMessage,
  parseUserVisibleToolResult,
  userVisibleToolResultKindFromPreview,
} from "@/features/chat/runtime/userVisibleToolResults"

/**
 * Whether a message belongs to the left-side user-facing conversation rendering.
 *
 * Execution-process blocks are timeline-only, while task boundaries are intentionally
 * renderable in the conversation as task-end separators.
 */
export function isConversationRenderableMessage(message: ChatMessage): boolean {
  if (isExecutionProcessMessage(message)) return false
  if (isUserVisibleToolResultMessage(message)) return parseUserVisibleToolResult(message) !== null
  if (message.content.metadata?.bubble_kind === "tool_call") {
    const metadata = message.content.metadata
    const uiPreview = recordValue(metadata.ui_preview) ?? null
    return userVisibleToolResultKindFromPreview(uiPreview, metadata.result_preview, typeof metadata.tool_name === "string" ? metadata.tool_name : null) !== null
  }
  return true
}

export function buildConversationRenderableMessages(messages: ChatMessage[]): ChatMessage[] {
  return buildConversationProjectionMessages(messages, isConversationRenderableMessage)
}

/**
 * Whether a renderable message may resolve or supersede a pending interaction.
 *
 * A task boundary is visible to users but is a timeline fact rather than a reply, so
 * it must never become the interaction's successor.
 */
export function isInteractionSuccessorMessage(message: ChatMessage): boolean {
  return isConversationRenderableMessage(message) && !isTaskBoundaryMessage(message)
}

export function buildInteractionSuccessorMessages(messages: ChatMessage[]): ChatMessage[] {
  return buildConversationProjectionMessages(messages, isInteractionSuccessorMessage)
}

function buildConversationProjectionMessages(
  messages: ChatMessage[],
  predicate: (message: ChatMessage) => boolean,
 ): ChatMessage[] {
  return uniqueConversationProjectionMessages(messages.filter(predicate))
}

export function conversationProjectionMessageIdentity(message: ChatMessage): string {
  const scope = conversationProjectionMessageScope(message)
  if (message.clientMessageId) return `${scope}:client:${message.clientMessageId}`
  const pendingMessageId = message.content.metadata?.chat_bubble_pending_message_id
  if (typeof pendingMessageId === "string" && pendingMessageId.length > 0) {
    return `${scope}:pending:${pendingMessageId}`
  }
  if (message.backendMessageId) return `${scope}:backend:${message.backendMessageId}`
  return `${scope}:id:${message.id}`
}

export function uniqueConversationProjectionMessages(messages: ChatMessage[]): ChatMessage[] {
  let uniqueMessages: ChatMessage[] = []
  for (const message of messages) {
    const messageAliases = new Set(conversationProjectionMessageAliases(message))
    const matchingIndices: number[] = []
    for (let index = 0; index < uniqueMessages.length; index += 1) {
      if (conversationProjectionMessageAliases(uniqueMessages[index]).some((alias) => messageAliases.has(alias))) {
        matchingIndices.push(index)
      }
    }
    if (matchingIndices.length === 0) {
      uniqueMessages.push(message)
      continue
    }

    const firstIndex = matchingIndices[0]
    let canonical = uniqueMessages[firstIndex]
    for (let index = 1; index < matchingIndices.length; index += 1) {
      canonical = authoritativeConversationProjectionAtStableOccurrence(canonical, uniqueMessages[matchingIndices[index]])
    }
    canonical = authoritativeConversationProjectionAtStableOccurrence(canonical, message)
    const matchingIndexSet = new Set(matchingIndices)
    const nextMessages = uniqueMessages.filter((_, index) => !matchingIndexSet.has(index))
    nextMessages.splice(firstIndex, 0, canonical)
    uniqueMessages = nextMessages
  }
  return uniqueMessages
}

function conversationProjectionMessageScope(message: ChatMessage): string {
  const bubbleKind = message.content.metadata?.bubble_kind
  if (typeof bubbleKind === "string" && bubbleKind.length > 0) return bubbleKind
  if (message.role === "user") return "user_message"
  if (message.role === "local_agent") return "local_agent_message"
  if (message.role === "remote_agent") return "remote_agent_message"
  return message.role
}

function conversationProjectionMessageAliases(message: ChatMessage): string[] {
  const scope = conversationProjectionMessageScope(message)
  const aliases = [`${scope}:id:${message.id}`]
  if (message.clientMessageId) aliases.push(`${scope}:client:${message.clientMessageId}`)
  if (message.backendMessageId) aliases.push(`${scope}:backend:${message.backendMessageId}`)
  const pendingMessageId = message.content.metadata?.chat_bubble_pending_message_id
  if (typeof pendingMessageId === "string" && pendingMessageId.length > 0) {
    aliases.push(`${scope}:pending:${pendingMessageId}`)
  }
  return aliases
}

function authoritativeConversationProjectionAtStableOccurrence(current: ChatMessage, candidate: ChatMessage): ChatMessage {
  if (!isMoreAuthoritativeConversationProjection(candidate, current)) return current
  return {
    ...candidate,
    createdAt: current.createdAt,
    clientMessageId: candidate.clientMessageId ?? current.clientMessageId,
    backendMessageId: candidate.backendMessageId ?? current.backendMessageId,
  }
}

function isMoreAuthoritativeConversationProjection(candidate: ChatMessage, current: ChatMessage): boolean {
  const candidateAuthority = conversationProjectionAuthority(candidate)
  const currentAuthority = conversationProjectionAuthority(current)
  if (candidateAuthority !== currentAuthority) return candidateAuthority > currentAuthority
  return conversationProjectionCommunicationSeq(candidate) > conversationProjectionCommunicationSeq(current)
}

function conversationProjectionAuthority(message: ChatMessage): number {
  const metadata = message.content.metadata ?? {}
  const sortOrder = typeof metadata.chat_bubble_sort_order === "number" ? metadata.chat_bubble_sort_order : 0
  if (sortOrder > 0) return 3
  const communicationMessageId = typeof metadata.communication_message_id === "string"
    ? metadata.communication_message_id
    : null
  if (communicationMessageId || conversationProjectionCommunicationSeq(message) > 0) return 2
  if (message.backendMessageId || message.clientMessageId) return 1
  return 0
}

function conversationProjectionCommunicationSeq(message: ChatMessage): number {
  const communicationSeq = message.content.metadata?.communication_seq
  return typeof communicationSeq === "number" && Number.isFinite(communicationSeq)
    ? communicationSeq
    : 0
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
