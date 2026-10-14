import type { AgentEvent, AskUserRequestedPayload, FrontendMessage, TextFormat } from "@/features/chat/model/agentEvents"
import type { ChatMessage, ChatMessageRole, PendingInteraction } from "@/features/chat/model/chatTypes"
import { attachmentToRequest } from "@/features/chat/api/fileResourceApi"
import type { ChatBubbleMessageDto, CreateChatBubbleMessageRequest } from "@/features/chat/api/agentRuntimeApi"
import { normalizeAttachmentList } from "@/features/chat/model/attachments"
import {
  buildInitialContextCompressionBubbleMetadata,
  contextCompressionBubbleStatus,
  contextCompressionBubbleText,
  contextCompressionEventJobId,
  findContextCompressionMessageByJob,
  isContextCompressionEvent,
  normalizeContextCompressionBubbleMetadata,
  normalizeExecutionProcessMetadata,
  reduceContextCompressionBubbleMetadata,
} from "@/features/chat/runtime/executionProcess"
import {
  buildImageGenerationRequestPreview,
  buildUserVisibleToolResultMetadata,
  userVisibleToolResultText,
} from "@/features/chat/runtime/userVisibleToolResults"

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function textFormat(value: unknown, fallback: TextFormat = "markdown"): TextFormat {
  return value === "html" || value === "plain_text" || value === "markdown" || value === "json" || value === "diff" ? value : fallback
}

/** Only explicit payload/metadata owners are legal; never infer ownership from the selected panel. */
export function conversationEventOwner(event: AgentEvent): string | null {
  return text(record(event.payload).agent_instance_id)?.trim() || text(event.metadata?.agent_instance_id)?.trim() || null
}

function messageBase(event: AgentEvent, content: FrontendMessage): ChatMessage | null {
  const owner = conversationEventOwner(event)
  if (!owner) return null
  return {
    id: event.message_id, role: "agent", createdAt: event.created_at, status: "completed",
    backendMessageId: event.message_id, agentInstanceId: owner,
    content: { ...content, channel: content.channel ?? "web", metadata: {
      ...event.metadata, ...content.metadata, agent_instance_id: owner,
      communication_message_id: event.message_id, communication_seq: event.seq,
    } },
  }
}

export function buildAcceptedConversationMessage(event: AgentEvent, message: ChatMessage | null): ChatMessage | null {
  const owner = conversationEventOwner(event)
  if (message?.agentInstanceId) return message
  if (message && owner) return { ...message, agentInstanceId: owner }
  if (!owner) return null

  const payload = record(event.payload)
  const metadata = { ...event.metadata, ...record(payload.metadata) }
  const channel = text(payload.channel) ?? text(metadata.channel) ?? "web"

  let role: ChatMessageRole = "user"
  const sourceType = text(metadata.source_type)
  const transport = text(metadata.transport)
  if (sourceType === "local_agent" || transport === "subagent" || channel === "subagent") {
    role = "local_agent"
  } else if (sourceType === "remote_agent" || transport === "lacp" || channel === "lacp") {
    role = "remote_agent"
  } else if (metadata.role === "agent" || payload.role === "agent" || metadata.role === "assistant" || payload.role === "assistant") {
    role = "agent"
  } else if (metadata.role === "system" || payload.role === "system") {
    role = "system"
  }

  const rawFormat = text(metadata.text_format) ?? text(payload.text_format)
  const format: TextFormat = role === "user" ? textFormat(rawFormat, "plain_text") : textFormat(rawFormat, "markdown")
  const displayText = text(metadata.display_text) ?? text(payload.text) ?? ""
  const pendingMessageId = text(payload.pending_message_id)
  const clientMessageId = text(payload.client_message_id) ?? message?.clientMessageId
  const userMessageId = text(payload.user_message_id) ?? message?.backendMessageId

  const interactionMessageId = text(metadata.interaction_message_id) ?? message?.content.metadata?.interaction_message_id
  const interactionOptionId = text(metadata.interaction_option_id) ?? message?.content.metadata?.interaction_option_id

  const attachments = message?.attachments ?? normalizeAttachmentList(payload.attachments)

  return {
    id: event.message_id,
    role,
    createdAt: event.created_at,
    status: "accepted",
    clientMessageId,
    backendMessageId: userMessageId ?? event.message_id,
    agentInstanceId: owner,
    attachments,
    content: {
      text: displayText,
      text_format: format,
      channel,
      metadata: {
        ...event.metadata,
        ...record(payload.metadata),
        agent_instance_id: owner,
        communication_message_id: event.message_id,
        communication_seq: event.seq,
        ...(pendingMessageId ? { chat_bubble_pending_message_id: pendingMessageId } : {}),
        ...(interactionMessageId ? {
          interaction_message_id: interactionMessageId,
          ...(interactionOptionId ? { interaction_option_id: interactionOptionId } : {}),
        } : {}),
      },
    },
  }
}

export function buildAssistantConversationMessage(event: AgentEvent): ChatMessage | null {
  const payload = record(event.payload)
  const frontend = record(payload.frontend_message)
  // Runtime emits plain-text body on agent.assistant.message.received when the assistant turn contains text; tool-only turns have no body.
  const body = text(frontend.text) ?? text(payload.text) ?? text(payload.message)
  if (!body) return null
  const message = messageBase(event, {
    text: body, text_format: textFormat(frontend.text_format ?? payload.text_format),
    channel: text(frontend.channel) ?? text(payload.channel),
    metadata: { ...record(payload.metadata), ...record(frontend.metadata) },
  })
  if (!message) return null
  const sourceId = text(payload.assistant_message_id) ?? text(payload.message_id)
  return sourceId ? { ...message, id: sourceId, backendMessageId: sourceId } : message
}

export function buildLifecycleConversationMessage(event: AgentEvent): ChatMessage | null {
  const payload = record(event.payload)
  const frontend = record(payload.frontend_message)
  if (typeof frontend.text !== "string") return null
  const interactionState = payload.interaction_state === "answered" ? "answered"
    : payload.interaction_state === "pending" || payload.requires_user_response === true ? "pending" : "none"
  const decision = record(payload.loop_control).decision
  const message = messageBase(event, {
    text: frontend.text, text_format: textFormat(frontend.text_format), channel: text(frontend.channel),
    metadata: { ...record(frontend.metadata), lifecycle_action: payload.lifecycle_action ?? null,
      requires_user_response: payload.requires_user_response ?? false, interaction_state: interactionState, loop_decision: decision },
  })
  return message ? { ...message, status: decision === "fail" ? "failed" : "completed", interactionState } : null
}

export function buildInteractionConversationMessage(event: AgentEvent): { message: ChatMessage; pendingInteraction: PendingInteraction | null } | null {
  const payload = event.payload as AskUserRequestedPayload
  if (!payload?.question || typeof payload.question.text !== "string") return null
  const interactionState = payload.interaction_state ?? "pending"
  const message = messageBase(event, {
    text: payload.question.text, text_format: textFormat(payload.question.text_format), channel: "web",
    metadata: { interaction_id: payload.interaction_id, allow_free_text: payload.allow_free_text,
      requires_user_response: payload.requires_user_response ?? true, interaction_state: interactionState },
  })
  if (!message) return null
  return {
    message: { ...message, interactionOptions: payload.options ?? [], interactionState },
    pendingInteraction: interactionState === "pending"
      ? { ...payload, requires_user_response: payload.requires_user_response ?? true, interaction_state: interactionState, eventId: message.id }
      : null,
  }
}

export function buildInterruptedConversationMessage(event: AgentEvent): ChatMessage | null {
  const payload = record(event.payload)
  const message = messageBase(event, {
    text: `Agent 执行中断：${text(payload.error_message) ?? "未知错误"}`, text_format: "markdown", channel: "web",
    metadata: { error_type: payload.error_type, resumable: payload.resumable, retryable: payload.retryable },
  })
  return message ? { ...message, status: "failed" } : null
}

export function buildContextCompressionConversationMessage(event: AgentEvent, current?: ChatMessage | null): ChatMessage | null {
  const previous = normalizeContextCompressionBubbleMetadata(current?.content.metadata)
  if (previous && event.seq < previous.compression.communication_seq) return null
  const metadata = reduceContextCompressionBubbleMetadata(previous ?? buildInitialContextCompressionBubbleMetadata(event), event)
  metadata.process_status = contextCompressionBubbleStatus(metadata)
  metadata.communication_message_id = event.message_id
  metadata.communication_seq = event.seq
  metadata.updated_at = event.created_at
  const message = messageBase(event, { text: contextCompressionBubbleText(metadata), text_format: "plain_text", channel: "tool", metadata })
  return message ? { ...message, id: current?.id ?? `context-compression-${contextCompressionEventJobId(event)}`,
    createdAt: current?.createdAt ?? event.created_at, status: contextCompressionBubbleStatus(metadata) } : null
}

export function buildUserVisibleToolConversationMessage(event: AgentEvent, messages: ChatMessage[] = []): ChatMessage | null {
  const metadata = buildUserVisibleToolResultMetadata(event)
  if (!metadata) return null
  if (metadata.result_kind === "image_generation") {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const source = messages[index]
      if (source.agentInstanceId !== conversationEventOwner(event) || source.content.metadata?.bubble_kind !== "execution_process") continue
      const tool = normalizeExecutionProcessMetadata(source.content.metadata).iterations.flatMap((iteration) => iteration.tools)
        .find((candidate) => candidate.tool_call_id === metadata.tool_call_id)
      if (!tool) continue
      metadata.image_request = buildImageGenerationRequestPreview(tool.arguments_preview)
      break
    }
  }
  const message = messageBase(event, { text: userVisibleToolResultText(metadata), text_format: "plain_text", channel: "web", metadata })
  return message ? { ...message, id: `user-visible-tool-result-${metadata.tool_call_id}`, backendMessageId: null } : null
}

export function findOpenProjectedMessage(messages: ChatMessage[], kind: string, jobId?: string): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.content.metadata?.bubble_kind !== kind) continue
    if (!jobId) return message
    const compression = record(message.content.metadata?.compression)
    if (compression.job_id === jobId) return message
  }
  return null
}

/** A pure event-to-conversation snapshot. Execution aggregation and accepted mapping live elsewhere. */
export function projectConversationEvent(event: AgentEvent, messages: ChatMessage[]): ChatMessage | null {
  if (event.type === "agent.assistant.message.received") return buildAssistantConversationMessage(event)
  if (event.type === "agent.lifecycle.message") return buildLifecycleConversationMessage(event)
  if (event.type === "agent.interaction.requested") return buildInteractionConversationMessage(event)?.message ?? null
  if (event.type === "agent.execution.interrupted") return buildInterruptedConversationMessage(event)
  if (isContextCompressionEvent(event)) return buildContextCompressionConversationMessage(event,
    findContextCompressionMessageByJob(messages, contextCompressionEventJobId(event), conversationEventOwner(event)))
  if (event.type === "tool.call.completed") return buildUserVisibleToolConversationMessage(event, messages)
  return null
}

/** Serialize an already canonical message; never duplicate accepted-message business field mapping. */
export function conversationMessageToBubble(sceneId: string, message: ChatMessage): ChatBubbleMessageDto {
  const metadata = message.content.metadata ?? {}
  return {
    bubble_id: message.id, scene_id: sceneId, agent_instance_id: message.agentInstanceId ?? "",
    task_id: text(metadata.task_id) ?? null, conversation_id: text(metadata.conversation_id) ?? null,
    role: message.role, status: message.status, text: message.content.text, text_format: message.content.text_format,
    channel: message.content.channel ?? "web", client_message_id: message.clientMessageId ?? null,
    backend_message_id: message.backendMessageId ?? null, pending_message_id: text(metadata.chat_bubble_pending_message_id) ?? null,
    interaction_options: message.interactionOptions ?? [], interaction_state: message.interactionState ?? "none",
    selected_option_id: message.selectedOptionId ?? null, sort_order: typeof metadata.chat_bubble_sort_order === "number" ? metadata.chat_bubble_sort_order : 0,
    created_at: message.createdAt, updated_at: text(metadata.updated_at) ?? message.createdAt,
    metadata: { ...metadata, ...(message.attachments ? { attachments: message.attachments.map(attachmentToRequest) } : {}) },
  }
}

export function conversationMessageToCreateRequest(sceneId: string, message: ChatMessage): CreateChatBubbleMessageRequest {
  const bubble = conversationMessageToBubble(sceneId, message)
  return {
    bubble_id: bubble.bubble_id,
    agent_instance_id: bubble.agent_instance_id,
    task_id: bubble.task_id,
    conversation_id: bubble.conversation_id,
    role: bubble.role,
    status: bubble.status,
    text: bubble.text,
    text_format: bubble.text_format,
    channel: bubble.channel,
    client_message_id: bubble.client_message_id,
    backend_message_id: bubble.backend_message_id,
    pending_message_id: bubble.pending_message_id,
    interaction_options: bubble.interaction_options,
    interaction_state: bubble.interaction_state,
    selected_option_id: bubble.selected_option_id,
    ...(bubble.sort_order > 0 ? { sort_order: bubble.sort_order } : {}),
    metadata: bubble.metadata,
  }
}
