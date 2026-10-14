export type TextFormat = "plain_text" | "markdown" | "json" | "html" | "diff"

export type AgentRuntimeStatus = "created" | "ready" | "running" | "paused" | "completed" | "failed" | "cancelled"

export type LoopDecision = "continue" | "pause" | "complete" | "terminate" | "fail"

export type InteractionState = "none" | "pending" | "answered"

export const COMMUNICATION_SSE_EVENT_TYPE = "communication.message"

export const KNOWN_AGENT_EVENT_TYPES = [
  "user.message.accepted",
  "agent.task.started",
  "agent.task.paused",
  "agent.task.completed",
  "agent.task.failed",
  "agent.task.cancelled",
  "agent.subagent.created",
  "agent.subagent.completed",
  "agent.subagent.failed",
  "agent.subagent.released",
  "agent.execution.interrupted",
  "agent.assistant.message.received",
  "agent.lifecycle.message",
  "agent.interaction.requested",
  "llm.request.started",
  "llm.request.cancelled",
  "llm.request.failed",
  "llm.call.failed",
  "llm.thinking.started",
  "llm.thinking.delta",
  "llm.thinking.completed",
  "llm.content.started",
  "llm.content.delta",
  "llm.content.completed",
  "llm.tool_call.started",
  "llm.tool_call.arguments.delta",
  "llm.tool_call.completed",
  "llm.response.started",
  "llm.response.completed",
  "context_compression.started",
  "context_compression.range_planned",
  "context_compression.worker.queued",
  "context_compression.worker.started",
  "context_compression.worker.activity",
  "context_compression.worker.progress",
  "context_compression.worker.completed",
  "context_compression.worker.failed",
  "context_compression.worker.cancelled",
  "context_compression.section.started",
  "context_compression.section.completed",
  "context_compression.assembly.started",
  "context_compression.assembly.completed",
  "context_compression.verification.started",
  "context_compression.verification.completed",
  "context_compression.conversation.rebind.completed",
  "context_compression.completed",
  "context_compression.failed",
  "context_compression.cancelled",
  "context_compression.skipped",
  "tool.call.started",
  "tool.call.progress",
  "tool.call.completed",
  "tool.call.cancelled",
  "tool.call.failed",
  "terminal.created",
  "terminal.session.started",
  "terminal.output.delta",
  "terminal.session.completed",
  "terminal.deleted",
  "frontend.debug.element.selected",
  "task_note.updated",
] as const

export type KnownAgentEventType = (typeof KNOWN_AGENT_EVENT_TYPES)[number]

export type AgentEvent<TPayload = unknown> = {
  message_id: string
  stream_id: string
  seq: number
  type: string
  topic: string
  source?: string | null
  actor_id?: string | null
  correlation_id?: string | null
  parent_message_id?: string | null
  payload: TPayload
  metadata: {
    task_id?: string
    thread_id?: string
    conversation_id?: string
    agent_instance_id?: string
    agent_definition_id?: string
    actor_type?: string
    trace_id?: string
    run_id?: string
    [key: string]: unknown
  }
  created_at: string
  schema_version: string
}

export type FrontendMessage = {
  text: string
  text_format: TextFormat
  channel?: string | null
  metadata?: Record<string, unknown>
}

export type SubagentCreatedPayload = {
  task_id: string
  parent_agent_instance_id: string
  child_agent_instance_id: string
  child_agent_definition_id: string
  relation_id: string
  released: boolean
  created_at: string
  agent_instance?: unknown
}

export type SubagentReleasedPayload = {
  task_id: string
  parent_agent_instance_id: string
  child_agent_instance_id: string
  released_agent_instance_ids?: string[]
  reason?: string | null
}

export type UserMessageAcceptedPayload = {
  pending_message_id?: string | null
  client_message_id?: string | null
  user_message_id?: string | null
  text: string
  attachments?: Array<{
    kind: "image" | "pdf"
    resource_id: string
    name?: string | null
    mime_type?: string | null
    size_in_bytes?: number | null
    width?: number | null
    height?: number | null
    page_count?: number | null
  }>
  channel?: string | null
  metadata?: Record<string, unknown>
  part_count?: number
  queued_received_at?: string | null
}

export type LlmRequestStartedPayload = {
  llm_call_id?: string
  llm_request_id?: string
  candidate_index?: number
  provider_id: string
  binding_id: string
  model_id?: string
  model_alias: string
  api_format: string
  api_key_index?: number | null
  api_key_label?: string | null
  retry_index?: number | null
  attempt_count?: number
  tool_count: number
  api_key_count: number
}

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_tokens: number
  reasoning_tokens?: number
  cache_creation_tokens?: number
}

export type LlmResponseCompletedPayload = {
  llm_call_id?: string
  llm_request_id?: string
  candidate_index?: number
  provider_id: string
  binding_id: string
  model_id?: string
  model_alias: string
  api_format?: string
  api_key_index?: number | null
  api_key_label?: string | null
  retry_index?: number | null
  attempt_count: number
  assistant_part_count: number
  thinking_part_count: number
  tool_use_part_count: number
  duration_ms?: number
  call_duration_ms?: number
  token_usage?: TokenUsage
  context_window_max?: number
}

export type LlmRequestFailedPayload = {
  llm_call_id?: string
  llm_request_id?: string
  candidate_index?: number
  provider_id?: string
  binding_id?: string
  model_id?: string
  model_alias?: string
  api_format?: string
  api_key_index?: number | null
  api_key_label?: string | null
  retry_index?: number | null
  attempt_count?: number
  failed_stage?: string
  partial_response?: boolean
  retryable?: boolean
  will_retry?: boolean
  final?: boolean
  next_candidate_index?: number
  next_provider_id?: string
  next_binding_id?: string
  next_model_id?: string
  next_model_alias?: string
  next_api_format?: string
  next_api_key_index?: number | null
  next_retry_index?: number | null
  duration_ms?: number
  error_type: string
  error_message: string
}

export type LlmRequestCancelledPayload = LlmRequestStartedPayload & {
  cancelled_by?: string
  cancelled_stage?: string
  partial_response?: boolean
  duration_ms?: number
  reason?: string
}

export type LlmCallFailedPayload = {
  llm_call_id?: string
  candidate_index?: number
  attempt_count?: number
  duration_ms?: number
  error_type: string
  error_message: string
}

export type LlmResponseStartedPayload = LlmRequestStartedPayload & {
  content_type?: string | null
}

export type ContextCompressionMessageRange = {
  start_index?: number | null
  end_index?: number | null
  anchor?: string | null
}

export type ContextCompressionWorkerPayload = {
  worker_id?: string | null
  id?: string | null
  name?: string | null
  title?: string | null
  role?: string | null
  output_section?: string | null
  input_mode?: string | null
  round_index?: number | null
  max_rounds?: number | null
  provider_id?: string | null
  model_binding_id?: string | null
  concurrency?: {
    global_limit?: number | null
    provider_key?: string | null
    provider_limit?: number | null
    waited_ms?: number | null
  } | null
  prompt_revision?: {
    use_default?: boolean | null
    revision?: number | null
  } | null
  progress?: {
    section_items_appended?: number | null
    total_section_items?: number | null
    final_markdown_chunks_appended?: number | null
  } | null
  reason?: string | null
  error_type?: string | null
  error_message?: string | null
  duration_ms?: number | null
  activity?: {
    kind?: string | null
    text?: string | null
    provider_id?: string | null
    model_id?: string | null
    model_alias?: string | null
    api_key_index?: number | null
    api_key_label?: string | null
    retry_index?: number | null
    attempt_count?: number | null
    error_type?: string | null
    error_message?: string | null
  } | null
}

export type ContextCompressionPayload = {
  payload_version?: string
  job_id?: string | null
  task_id?: string | null
  agent_instance_id?: string | null
  root_conversation_id?: string | null
  source_conversation_id?: string | null
  target_conversation_id?: string | null
  compression_index?: number | null
  input_mode?: string | null
  phase?: string | null
  status?: string | null
  reason?: string | null
  compressed_range?: ContextCompressionMessageRange | null
  retained_tail_range?: ContextCompressionMessageRange | null
  worker?: ContextCompressionWorkerPayload | null
  metrics?: Record<string, unknown> | null
  source_message_count?: number | null
  target_message_count?: number | null
  compressed_message_count?: number | null
  retained_tail_message_count?: number | null
  summary_message_id?: string | null
  summary_message_index?: number | null
  archive_job_id?: string | null
  final_markdown?: string | null
  token_usage_before?: Record<string, unknown> | null
  estimated_token_usage_after?: Record<string, unknown> | null
  error_type?: string | null
  error_message?: string | null
}

export type LlmSemanticStreamPayload = {
  llm_call_id?: string
  llm_request_id?: string
  candidate_index?: number
  provider_id: string
  binding_id: string
  model_id?: string
  model_alias: string
  api_format: string
  api_key_index?: number | null
  api_key_label?: string | null
  retry_index?: number | null
  attempt_count?: number
  provider_event_type?: string
  part_id?: string | null
}

export type LlmStreamDeltaPayload = LlmSemanticStreamPayload & {
  delta: string
}

export type LlmToolCallStartedPayload = LlmSemanticStreamPayload & {
  tool_call_id: string
  tool_name: string
  provider_tool_call_id?: string | null
  tool_call_index?: number | null
  output_index?: number | null
  item_id?: string | null
}

export type LlmToolCallArgumentsPayload = LlmToolCallStartedPayload & {
  delta?: string
  arguments_partial?: string
  arguments?: string
  arguments_preview?: Record<string, unknown> | null
}

export type AgentExecutionInterruptedPayload = {
  task_id: string
  agent_instance_id: string
  error_type: string
  error_message: string
  resumable: boolean
  retryable: boolean
}

export type ToolCallStartedPayload = {
  tool_call_id: string
  tool_name: string
  title?: string
  source?: "local" | "mcp"
  tool_source?: "local" | "mcp"
  input?: unknown
  arguments_preview?: Record<string, unknown>
  terminal_session_id?: string
  llm_call_id?: string | null
  llm_request_id?: string | null
}

export type ToolCallProgressPayload = {
  tool_call_id: string
  message: string
  text_format?: TextFormat
  progress?: {
    current: number
    total?: number
    unit?: string
  }
}

export type ToolCallCompletedPayload = {
  tool_call_id: string
  tool_name: string
  source?: "local" | "mcp"
  tool_source?: "local" | "mcp"
  success: boolean
  execution_status: string
  loop_decision: LoopDecision
  duration_ms?: number
  result_preview?: unknown
  ui_preview?: Record<string, unknown> | null
  error_code?: string | null
  error_message?: string | null
  llm_call_id?: string | null
  llm_request_id?: string | null
}

export type ToolCallFailedPayload = {
  tool_call_id: string
  tool_name: string
  source?: "local" | "mcp"
  tool_source?: "local" | "mcp"
  error_type: string
  error_message: string
  duration_ms?: number
  result_preview?: unknown
  llm_call_id?: string | null
  llm_request_id?: string | null
}

export type ToolCallCancelledPayload = {
  tool_call_id: string
  tool_name: string
  source?: "local" | "mcp"
  tool_source?: "local" | "mcp"
  cancelled_by?: string
  phase?: string
  reason?: string
  result_preview?: unknown
  llm_call_id?: string | null
  llm_request_id?: string | null
}

export type LifecycleFrontendMessagePayload = {
  tool_call_id?: string
  lifecycle_action?: "notify" | "request_response" | "ask_user" | "pause" | "complete" | "terminate" | "fail" | null
  frontend_message: FrontendMessage
  requires_user_response?: boolean
  interaction_state?: InteractionState
  loop_control: {
    decision: LoopDecision
    reason?: string | null
  }
}

export type AskUserRequestedPayload = {
  interaction_id: string
  tool_call_id?: string
  question: {
    text: string
    text_format: TextFormat
  }
  options: Array<{
    id: string
    label: string
    description?: string
  }>
  allow_free_text: boolean
  requires_user_response: boolean
  interaction_state: "pending"
  loop_control: {
    decision: "pause"
    reason?: string | null
  }
}

export type TerminalCreatedPayload = {
  terminal_id: string
  cwd: string
  shell: string
  status: string
  created_at?: string | null
}

export type TerminalSessionStartedPayload = {
  terminal_session_id: string
  terminal_id?: string
  tool_call_id: string
  command_line: string
  cwd: string
  shell: string
  started_at: string
}

export type TerminalOutputDeltaPayload = {
  terminal_session_id: string
  terminal_id?: string
  tool_call_id: string
  stream: "stdout" | "stderr" | "pty"
  chunk: string
  chunk_index: number
  encoding: string
}

export type TerminalSessionCompletedPayload = {
  terminal_session_id: string
  terminal_id?: string
  tool_call_id: string
  exit_code: number | null
  duration_ms: number
  stdout_bytes: number
  stderr_bytes: number
  completed_at: string
}

export type TerminalDeletedPayload = {
  terminal_id: string
  status: string
}

export type FrontendDebugElementInfo = {
  session_id?: string
  page_url?: string
  document_title?: string
  selector?: string
  xpath?: string
  tag_name?: string
  id?: string | null
  class_name?: string | null
  text?: string
  outer_html?: string
  attributes?: Record<string, string>
  bounding_rect?: {
    x?: number
    y?: number
    width?: number
    height?: number
    top?: number
    left?: number
    bottom?: number
    right?: number
  }
  viewport?: { width?: number; height?: number }
  [key: string]: unknown
}

export type FrontendDebugElementSelectedPayload = {
  session_id: string
  session_name?: string | null
  target_url: string
  debug_url: string
  selected_at: string
  element: FrontendDebugElementInfo
}

export type TaskNoteUpdatedPayload = {
  task_id: string | null
  agent_instance_id: string
  scene_id?: string | null
  tool_name: string
  updated_at: string
}

export function isKnownAgentEventType(type: string): type is KnownAgentEventType {
  return (KNOWN_AGENT_EVENT_TYPES as readonly string[]).includes(type)
}

export function isEvent<TPayload>(event: AgentEvent, type: KnownAgentEventType): event is AgentEvent<TPayload> {
  return event.type === type
}
