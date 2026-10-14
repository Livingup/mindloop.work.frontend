import type { AskUserRequestedPayload, FrontendMessage, InteractionState, TerminalOutputDeltaPayload, TextFormat } from "@/features/chat/model/agentEvents"
import type { UserMessageAttachment } from "@/features/chat/api/fileResourceApi"

export type InteractionOption = {
  id: string
  label: string
  description?: string
}

export type InteractionSelection = {
  interactionMessageId: string
  optionId?: string
}

export type ChatMessageRole = "user" | "agent" | "local_agent" | "remote_agent" | "system" | "assistant"

export type ChatMessage = {
  id: string
  role: ChatMessageRole
  createdAt: string
  status: "sending" | "accepted" | "completed" | "streaming" | "failed" | "cancelled"
  content: FrontendMessage
  attachments?: UserMessageAttachment[]
  clientMessageId?: string
  backendMessageId?: string | null
  interactionOptions?: InteractionOption[]
  interactionState?: InteractionState
  selectedOptionId?: string
  agentInstanceId?: string
}

export type QueuedUserMessage = {
  id: string
  clientMessageId: string
  pendingMessageId: string
  text: string
  attachments?: UserMessageAttachment[]
  createdAt: string
  status: "queued" | "failed"
  errorMessage?: string
  agentInstanceId?: string
  interactionSelection?: InteractionSelection
}

export type TerminalSession = {
  id: string
  terminalId?: string
  commandVisible?: boolean
  toolCallId: string
  commandLine: string
  cwd: string
  shell: string
  status: "running" | "completed" | "failed"
  output: TerminalOutputDeltaPayload[]
  exitCode?: number | null
  agentInstanceId?: string
}

export type PendingInteraction = AskUserRequestedPayload & {
  eventId: string
}

export function makeTextMessage(id: string, text: string, text_format: TextFormat = "markdown"): ChatMessage {
  return {
    id,
    role: "agent",
    createdAt: new Date().toISOString(),
    status: "completed",
    content: {
      text,
      text_format,
      channel: "web",
    },
  }
}
