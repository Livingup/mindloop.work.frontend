import { requestJson } from "@/shared/api/httpClient"
import { SseClient } from "@/shared/api/sseClient"
import type { AgentEvent } from "@/features/chat/model/agentEvents"

export type StartAgentRunRequest = {
  current_working_directory: string
  agent_definition_id: string
  llm_provider_id?: string
  llm_model_binding_id?: string
  user_message: string
  render_options: {
    channel: "web"
    preferred_text_format: "html" | "markdown" | "plain_text" | "json"
    supported_text_formats: Array<"html" | "markdown" | "plain_text" | "json">
  }
}

export type StartAgentRunResponse = {
  task_id: string
  thread_id: string
  conversation_id: string
  root_agent_instance_id: string
  event_stream_url: string
}

export function startAgentRun(body: StartAgentRunRequest) {
  return requestJson<StartAgentRunResponse>("/api/agent-runs", {
    method: "POST",
    body,
  })
}

/** @deprecated 主路径使用 scene communication SSE，勿在 Chat 主流程调用。 */
export function createAgentEventClient(taskId: string, onEvent: (event: AgentEvent) => void) {
  return new SseClient<AgentEvent>({
    url: `/api/agent-runs/${taskId}/events`,
    onEvent,
  })
}

/** @deprecated 主路径使用 scene communication SSE + terminalSessions 投影，勿在 Chat 主流程调用。 */
export function createTerminalEventClient(terminalSessionId: string, onEvent: (event: AgentEvent) => void) {
  return new SseClient<AgentEvent>({
    url: `/api/terminal-sessions/${terminalSessionId}/stream`,
    onEvent,
  })
}

