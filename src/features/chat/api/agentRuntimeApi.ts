import { requestJson } from "@/shared/api/httpClient"
import { SseClient, type SseActivity } from "@/shared/api/sseClient"
import {
  appendRuntimeAccessToken,
  detectRuntimeClientKind,
  getOrCreateRuntimeDeviceId,
  getRuntimeAccessToken,
  resolveRuntimeApiUrl,
  runtimeAuthHeaders,
} from "@/shared/api/runtimeAccess"
import {
  notifyRuntimeAuthInvalid,
  runtimeAuthInvalidCodeFromBody,
  type RuntimeAuthInvalidCode,
} from "@/shared/api/runtimeAuthInvalidation"
import { COMMUNICATION_SSE_EVENT_TYPE, type AgentEvent } from "@/features/chat/model/agentEvents"
import type { TokenUsage } from "@/features/chat/model/agentEvents"

const BACKEND_HEALTH_TIMEOUT_MS = 3000
const SCENE_ATTACH_TIMEOUT_MS = 15000
export const COMMUNICATION_SSE_PING_EVENT_TYPE = "communication.ping"
export const COMMUNICATION_SSE_AUTH_INVALID_EVENT_TYPE = "communication.auth_invalid"

export type BackendHealthResponse = {
  status: string
  event_loop?: Record<string, unknown>
}

export type RuntimeAuthStatusResponse = {
  configured: boolean
  bootstrap_required: boolean
  auth_required: boolean
}

export type RuntimeAuthAccount = {
  account_id: string
  username: string
  status: string
  created_at: string
  updated_at: string
}

export type RuntimeAuthDeviceSession = {
  session_id: string
  device_id?: string | null
  client_kind: string
  created_at: string
  last_seen_at: string
  expires_at: string
}

export type RuntimeAuthLoginResponse = {
  access_token: string
  token_type: "bearer" | string
  account: RuntimeAuthAccount
  session: RuntimeAuthDeviceSession
}

export type RuntimeAuthMeResponse = {
  authenticated: boolean
  account?: RuntimeAuthAccount | null
  session?: RuntimeAuthDeviceSession | null
  code?: string | null
}

export type RuntimeAuthRequest = {
  username: string
  password: string
}

export type RuntimeBootstrapCloudDatabaseStatus = {
  configured: boolean
  active_at_start: boolean
  shared_config_snapshot_ready: boolean
  completed: boolean
  updated_at?: string | null
  snapshot_updated_at?: string | null
  error_message?: string | null
}

export type RuntimeBootstrapObjectStorageStatus = {
  configured: boolean
  skipped: boolean
  configured_or_skipped: boolean
  updated_at?: string | null
  error_message?: string | null
}

export type RuntimeBootstrapStatusResponse = {
  ready: boolean
  bootstrap_required: boolean
  restricted: boolean
  repair_required: boolean
  restart_required: boolean
  missing_required_items: string[]
  warnings: string[]
  cloud_user_config_database: RuntimeBootstrapCloudDatabaseStatus
  object_storage: RuntimeBootstrapObjectStorageStatus
}

export type RuntimeBootstrapConfigureRequest = {
  cloud_user_config_database?: {
    enabled: boolean
    backend: string
    host: string
    port: number
    database: string
    username: string
    password: string
    sslmode: string
    connect_timeout_seconds: number
  } | null
  object_storage_settings?: {
    gateway_provider: string
    object_storage_endpoint: string
    object_storage_region: string
    object_storage_bucket_name: string
    object_storage_public_base_url: string
    object_storage_object_key_prefix: string
    object_storage_access_key_id?: string | null
    object_storage_access_key_secret?: string | null
    connect_timeout_seconds: number
  } | null
  object_storage_skipped?: boolean
}

export type AgentRuntimeTask = {
  task_id: string
  root_agent_instance_id: string
  agent_instance_ids: string[]
  status: string
  created_at: string
  updated_at: string
}

export type PendingAgentUserMessage = {
  message_id: string
  user_text: string
  client_message_id?: string | null
  attachments?: UserMessageAttachmentRequest[]
  received_at: string
  metadata?: Record<string, unknown>
}

export type UserMessageAttachmentRequest = {
  kind: "image" | "pdf"
  resource_id: string
  name?: string | null
  mime_type?: string | null
  size_in_bytes?: number | null
  width?: number | null
  height?: number | null
  page_count?: number | null
}

export type AgentContextUsage = {
  token_usage?: TokenUsage | null
  context_window_used_tokens: number
  context_window_max?: number | null
  provider_id?: string | null
  binding_id?: string | null
  model_id?: string | null
  model_alias?: string | null
}

export type FileInputLimits = {
  max_image_inputs_per_request: number
  max_total_image_bytes_per_request: number
  max_single_input_file_bytes: number
  max_total_input_file_bytes_per_request: number
}

export type FileInputStats = {
  file_count: number
  total_file_bytes: number
  pdf_file_count: number
  image_file_count: number
  total_pdf_pages: number
  total_image_bytes: number
  total_input_file_bytes: number
}

export type AgentFileInputState = {
  limits: FileInputLimits
  next_request_file_stats: FileInputStats
}

export type AgentRuntimeInstance = {
  instance_id: string
  task_id: string
  thread_id: string
  current_working_directory: string
  agent_definition_id: string
  llm_policy_group_id: string | null
  llm_provider_id: string
  llm_model_binding_id: string
  conversation_id: string | null
  trace_id: string
  status: string
  pending_user_message_count: number
  pending_user_messages: PendingAgentUserMessage[]
  context_usage?: AgentContextUsage | null
  created_at: string
  updated_at: string
}

export type ChatBubbleInteractionOptionDto = {
  id: string
  label: string
  description?: string | null
}

export type ChatBubbleInteractionState = "none" | "pending" | "answered"

export type ChatBubbleMessageDto = {
  bubble_id: string
  scene_id: string
  agent_instance_id: string
  task_id?: string | null
  conversation_id?: string | null
  role: "user" | "agent" | "local_agent" | "remote_agent" | "system" | "assistant"
  status: "sending" | "accepted" | "completed" | "streaming" | "failed" | "cancelled"
  text: string
  text_format: "plain_text" | "markdown" | "json" | "html" | "diff"
  channel?: string | null
  client_message_id?: string | null
  backend_message_id?: string | null
  pending_message_id?: string | null
  interaction_options: ChatBubbleInteractionOptionDto[]
  interaction_state: ChatBubbleInteractionState
  selected_option_id?: string | null
  sort_order: number
  created_at: string
  updated_at: string
  metadata: Record<string, unknown>
}

export type ListChatBubbleMessagesResponse = {
  messages: ChatBubbleMessageDto[]
  limit: number
  before_sort_order?: number | null
}

export type CreateChatBubbleMessageRequest = {
  bubble_id?: string | null
  agent_instance_id: string
  task_id?: string | null
  conversation_id?: string | null
  role: ChatBubbleMessageDto["role"]
  status?: ChatBubbleMessageDto["status"]
  text: string
  text_format?: ChatBubbleMessageDto["text_format"]
  channel?: string | null
  client_message_id?: string | null
  backend_message_id?: string | null
  pending_message_id?: string | null
  interaction_options?: ChatBubbleInteractionOptionDto[]
  interaction_state?: ChatBubbleInteractionState
  selected_option_id?: string | null
  sort_order?: number | null
  metadata?: Record<string, unknown>
}

export type PatchChatBubbleMessageRequest = Partial<Omit<CreateChatBubbleMessageRequest, "bubble_id" | "agent_instance_id" | "task_id" | "conversation_id" | "role" | "sort_order">>

export type CreateRootAgentInstanceRequest = {
  thread_id: string
  current_working_directory: string
  agent_definition_id: string
  llm_policy_group_id?: string | null
  llm_provider_id?: string | null
  llm_model_binding_id?: string | null
  scene_id?: string | null
}

export type CreateRootAgentInstanceResponse = {
  task: AgentRuntimeTask
  root_agent_instance: AgentRuntimeInstance
}

export type SendAgentInstanceMessageRequest = {
  user_message: string
  attachments?: UserMessageAttachmentRequest[]
  client_message_id?: string | null
  render_options?: Record<string, unknown>
  request_overrides?: Record<string, unknown>
  communication_stream_id?: string | null
  message_metadata?: Record<string, unknown>
}

export type AgentMessageSubmissionResponse = {
  status: string
  task_id: string
  agent_instance_id: string
  conversation_id: string | null
  communication_stream_id: string
  event_stream_url: string
  pending_message_id: string
  client_message_id?: string | null
  queued_for_later: boolean
  root_agent_instance?: AgentRuntimeInstance | null
  message_metadata?: Record<string, unknown>
}

export type RemovePendingUserMessageResponse = {
  status: string
  agent_instance: AgentRuntimeInstance
  removed_message: PendingAgentUserMessage
}

export type SwitchAgentInstanceLlmPolicyRequest = {
  llm_policy_group_id: string
}

export type InterruptAgentInstanceRequest = {
  reason?: string
}

export type AgentInterruptResponse = {
  status: string
  task_id: string
  agent_instance_id: string
  conversation_id: string | null
  interrupt_requested: boolean
  reason: string
}

export type LacpRegistrationResponse = {
  instance_id: string
  role_name: string
  description: string
  workspace?: string | null
  enabled: boolean
  status: string
  error_code?: string | null
  error_message?: string | null
  updated_at: string
}

export type LacpRegistrationListResponse = {
  registrations: LacpRegistrationResponse[]
}

export type LacpClientStatusResponse = {
  enabled: boolean
  running: boolean
  connected: boolean
  registry_url: string
  ws_endpoint?: string | null
  last_error?: string | null
  last_connected_at?: string | null
  last_disconnected_at?: string | null
  reconnect_attempt: number
  registration_count: number
  registered_count: number
}

export type LacpSettingsResponse = {
  enabled: boolean
  registry_url: string
  api_key?: string | null
  api_key_configured: boolean
  db_path: string
  updated_at?: string | null
}

export type LacpSettingsUpdateRequest = {
  enabled: boolean
  registry_url: string
  api_key?: string | null
}

export type AttachSceneRequest = {
  /**
   * 项目目录绝对路径。必填：后端据此路由到 <workspace>/.spread-ai/ 下的 manifest 与
   * scenes.db；同时作为 mode=created 时新建任务的工作目录。
   */
  workspace_path: string
  llm_policy_group_id?: string | null
  llm_provider_id?: string | null
  llm_model_binding_id?: string | null
  client_session_id?: string | null
  device_id?: string | null
  client_kind?: string | null
}

export type AgentParentChildRelationResponse = {
  relation_id: string
  task_id: string
  parent_instance_id: string
  child_instance_id: string
  created_at: string
  released_at?: string | null
  release_reason?: string | null
  released_by_agent_instance_id?: string | null
  released: boolean
}

export type AttachSceneResponse = {
  // resumed | created；recreated 仅为旧后端兼容值
  mode: string
  task: AgentRuntimeTask
  root_agent_instance: AgentRuntimeInstance
  agent_instances?: AgentRuntimeInstance[]
  parent_child_relations?: AgentParentChildRelationResponse[]
  communication_stream_id: string
  event_stream_url: string
  client_session_id?: string | null
  active_client_count?: number
}

export type SceneTerminal = {
  terminal_id: string
  cwd?: string | null
  shell: string
  status: string
  current_command_id?: string | null
  created_at: string
  updated_at: string
  last_active_at: string
  metadata: Record<string, unknown>
  latest_command?: SceneTerminalCommand | null
}

export type SceneTerminalCommand = {
  command_id: string
  terminal_id: string
  command_line: string
  actual_cwd: string
  shell: string
  status: string
  requested_cwd?: string | null
  tool_call_id?: string | null
  started_at?: string | null
  completed_at?: string | null
  exit_code?: number | null
  duration_ms?: number | null
  stdout_bytes: number
  stderr_bytes: number
  error_message?: string | null
  metadata?: Record<string, unknown> | null
}

export type ReadSceneTerminalOutputResponse = {
  terminal_id: string
  command_id?: string | null
  status: string
  text: string
  chunks_returned: number
  truncated: boolean
  start_chunk_index?: number | null
  end_chunk_index?: number | null
  next_chunk_index?: number | null
  has_more: boolean
}

export function createRootAgentInstance(body: CreateRootAgentInstanceRequest) {
  return requestJson<CreateRootAgentInstanceResponse>("/api/agent-runtime/root-instances", {
    method: "POST",
    body,
  })
}

/**
 * 进入 scene 的统一入口：自动恢复已有 root instance 或首次创建 root instance。
 *
 * - mode=resumed：scene 下已有长期 root instance，直接复用或由后端恢复为待命态；
 * - mode=created：scene 下首次创建 root instance（需要 fallback LLM）。
 *
 * body 中的 LLM 字段仅在 mode=created 时实际生效。
 */
export function attachScene(sceneId: string, body: AttachSceneRequest) {
  return requestJson<AttachSceneResponse>(`/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/attach`, {
    method: "POST",
    body,
    timeoutMs: SCENE_ATTACH_TIMEOUT_MS,
  })
}

export function healthCheck() {
  return requestJson<BackendHealthResponse>("/api/health", {
    timeoutMs: BACKEND_HEALTH_TIMEOUT_MS,
  })
}

export function getRuntimeAuthStatus() {
  return requestJson<RuntimeAuthStatusResponse>("/api/auth/status")
}

export function getRuntimeAuthMe() {
  return requestJson<RuntimeAuthMeResponse>("/api/auth/me")
}

export function runtimeAuthLogin(body: RuntimeAuthRequest) {
  return requestJson<RuntimeAuthLoginResponse>("/api/auth/login", {
    method: "POST",
    body: runtimeAuthRequestBody(body),
  })
}

export function runtimeAuthBootstrap(body: RuntimeAuthRequest) {
  return requestJson<RuntimeAuthLoginResponse>("/api/auth/bootstrap", {
    method: "POST",
    body: runtimeAuthRequestBody(body),
  })
}

export function runtimeAuthLogout() {
  return requestJson<null>("/api/auth/logout", {
    method: "POST",
  })
}

export function getRuntimeBootstrapStatus() {
  return requestJson<RuntimeBootstrapStatusResponse>("/api/runtime-bootstrap/status")
}

export function configureRuntimeBootstrap(body: RuntimeBootstrapConfigureRequest) {
  return requestJson<RuntimeBootstrapStatusResponse>("/api/runtime-bootstrap/configure", {
    method: "POST",
    body,
  })
}

function runtimeAuthRequestBody(body: RuntimeAuthRequest) {
  return {
    username: body.username,
    password: body.password,
    device_id: getOrCreateRuntimeDeviceId(),
    client_kind: detectRuntimeClientKind(),
  }
}

/** 后端 scene session 心跳超时秒数（与 DEFAULT_STALE_TIMEOUT_SECONDS 一致）。 */
export const SCENE_HEARTBEAT_STALE_TIMEOUT_SECONDS = 120

/** 前端心跳发送间隔：stale_timeout / 3。 */
export const SCENE_HEARTBEAT_INTERVAL_MS = (SCENE_HEARTBEAT_STALE_TIMEOUT_SECONDS / 3) * 1000
const SCENE_HEARTBEAT_REQUEST_TIMEOUT_MS = 10000

export type HeartbeatResult = "ok" | "expired" | "error"

/**
 * 发送 scene 心跳，维持后端 session 活跃状态。
 * - "ok"：心跳成功（204）；
 * - "expired"：session 不存在（404），前端应重新 attach；
 * - "error"：网络异常或其他 HTTP 错误，不触发 re-attach。
 */
export async function sceneHeartbeat(sceneId: string, clientSessionId?: string | null): Promise<HeartbeatResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), SCENE_HEARTBEAT_REQUEST_TIMEOUT_MS)
  try {
    const sentToken = getRuntimeAccessToken()
    const search = new URLSearchParams()
    if (clientSessionId) search.set("client_session_id", clientSessionId)
    const queryString = search.toString()
    const path = `/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/heartbeat${queryString ? `?${queryString}` : ""}`
    const response = await fetch(resolveRuntimeApiUrl(path), {
      method: "POST",
      headers: runtimeAuthHeaders(),
      signal: controller.signal,
    })
    if (response.ok) return "ok"
    if (response.status === 404) return "expired"
    if (response.status === 401) {
      try {
        const text = await response.text()
        const body = text ? JSON.parse(text) : null
        const code = runtimeAuthInvalidCodeFromBody(response.status, body)
        if (code) {
          const detail =
            typeof body === "object" && body && "detail" in body && typeof (body as Record<string, unknown>).detail === "string"
              ? ((body as Record<string, unknown>).detail as string)
              : null
          notifyRuntimeAuthInvalid({ code, detail, source: "heartbeat" }, sentToken)
        }
      } catch (err) {
        console.warn("[sceneHeartbeat] failed to parse 401 response body:", err)
      }
      return "error"
    }
    return "error"
  } catch {
    return "error"
  } finally {
    clearTimeout(timeoutId)
  }
}

export type DetachSceneRequest = {
  workspace_path: string
  client_session_id?: string | null
}

export type DetachSceneResponse = {
  cancelled_task_count: number
  cancelled_instance_count: number
}

export type CompleteCurrentSceneTaskOutcome = "completed" | "task_ended" | "task_not_started" | "running_agents"

export type CompleteCurrentSceneTaskResponse = {
  outcome: CompleteCurrentSceneTaskOutcome
  message: string
  scene_id: string
  task_id: string | null
  root_agent_instance_id: string | null
}

/**
 * 当前客户端离开 scene：仅释放对应 client_session_id 的 presence，不取消任务。
 * 用于关闭前端 Tab、workspace 切换或 beforeunload；显式取消任务请使用 stopScene()。
 */
export function detachScene(sceneId: string, body: DetachSceneRequest) {
  return requestJson<DetachSceneResponse>(`/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/detach`, {
    method: "POST",
    body,
  })
}

/**
 * 通过 sendBeacon 发送当前客户端 detach 请求（用于 beforeunload，不保证响应）。
 * sendBeacon 不能设置 Authorization header，所以使用 query-token 传输；该操作不取消任务。
 */
export function detachSceneBeacon(sceneId: string, workspacePath: string, clientSessionId?: string | null): boolean {
  const url = appendRuntimeAccessToken(`/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/detach`)
  const blob = new Blob([JSON.stringify({
    workspace_path: workspacePath,
    client_session_id: clientSessionId ?? null,
  })], { type: "application/json" })
  return navigator.sendBeacon(url, blob)
}

/** 显式停止 scene：用于用户主动取消/停止任务，不等同于客户端关闭或离开。 */
export function stopScene(sceneId: string, body: DetachSceneRequest) {
  return requestJson<DetachSceneResponse>(`/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/stop`, {
    method: "POST",
    body,
  })
}

/** 用户从 root Agent 面板直接成功完成 Scene 当前 Task；不经过 LLM。 */
export function completeCurrentSceneTask(sceneId: string, workspacePath: string) {
  return requestJson<CompleteCurrentSceneTaskResponse>(
    `/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/tasks/current/complete`,
    {
      method: "POST",
      body: { workspace_path: workspacePath },
    },
  )
}

export function getLacpInstanceRegistration(instanceId: string): Promise<LacpRegistrationResponse> {
  return requestJson<LacpRegistrationResponse>(`/api/lacp/instances/${encodeURIComponent(instanceId)}/registration`)
}

export function setLacpInstanceRegistration(instanceId: string, enabled: boolean) {
  return requestJson<LacpRegistrationResponse>(`/api/lacp/instances/${encodeURIComponent(instanceId)}/registration`, {
    method: "PUT",
    body: { enabled },
  })
}

export function getLacpClientStatus() {
  return requestJson<LacpClientStatusResponse>("/api/lacp/status")
}

export function getLacpSettings() {
  return requestJson<LacpSettingsResponse>("/api/lacp/settings")
}

export function updateLacpSettings(body: LacpSettingsUpdateRequest) {
  return requestJson<LacpSettingsResponse>("/api/lacp/settings", {
    method: "PUT",
    body,
  })
}

export function sendAgentInstanceMessage(instanceId: string, body: SendAgentInstanceMessageRequest) {
  return requestJson<AgentMessageSubmissionResponse>(`/api/agent-runtime/instances/${encodeURIComponent(instanceId)}/messages`, {
    method: "POST",
    body,
  })
}

export function getAgentInstanceFileInputState(instanceId: string) {
  return requestJson<AgentFileInputState>(`/api/agent-runtime/instances/${encodeURIComponent(instanceId)}/file-input-state`)
}

export function removeAgentInstancePendingUserMessage(instanceId: string, pendingMessageId: string) {
  return requestJson<RemovePendingUserMessageResponse>(`/api/agent-runtime/instances/${encodeURIComponent(instanceId)}/pending-user-messages/${encodeURIComponent(pendingMessageId)}`, {
    method: "DELETE",
  })
}

export function switchAgentInstanceLlmPolicy(instanceId: string, body: SwitchAgentInstanceLlmPolicyRequest) {
  return requestJson<AgentRuntimeInstance>(`/api/agent-runtime/instances/${encodeURIComponent(instanceId)}/llm-policy`, {
    method: "PATCH",
    body,
  })
}

export function interruptAgentInstance(instanceId: string, body: InterruptAgentInstanceRequest = {}) {
  return requestJson<AgentInterruptResponse>(`/api/agent-runtime/instances/${encodeURIComponent(instanceId)}/interrupt`, {
    method: "POST",
    body,
  })
}

type RequestOptions = {
  signal?: AbortSignal
  timeoutMs?: number
}

function requireAgentInstanceId(agentInstanceId: string): string {
  const value = typeof agentInstanceId === "string" ? agentInstanceId.trim() : ""
  if (!value) throw new Error("agent_instance_id is required for Agent-scoped Runtime requests")
  return value
}

export function listSceneTerminals(
  sceneId: string,
  workspacePath: string,
  agentInstanceId: string,
  options: RequestOptions = {},
) {
  const search = new URLSearchParams({
    workspace_path: workspacePath,
    agent_instance_id: requireAgentInstanceId(agentInstanceId),
  })
  return requestJson<SceneTerminal[]>(`/api/scene/${encodeURIComponent(sceneId)}/terminals?${search.toString()}`, {
    timeoutMs: options.timeoutMs,
  })
}

export function readSceneTerminalOutput(
  sceneId: string,
  terminalId: string,
  query: {
    workspace_path: string
    agent_instance_id: string
    command_id?: string | null
    mode?: "tail" | "page" | "since" | "search"
    tail_lines?: number
    limit_chars?: number
  },
  options: RequestOptions = {},
) {
  const search = new URLSearchParams({
    workspace_path: query.workspace_path,
    agent_instance_id: requireAgentInstanceId(query.agent_instance_id),
  })
  if (query.command_id) search.set("command_id", query.command_id)
  if (query.mode) search.set("mode", query.mode)
  if (typeof query.tail_lines === "number") search.set("tail_lines", String(query.tail_lines))
  if (typeof query.limit_chars === "number") search.set("limit_chars", String(query.limit_chars))
  return requestJson<ReadSceneTerminalOutputResponse>(
    `/api/scene/${encodeURIComponent(sceneId)}/terminals/${encodeURIComponent(terminalId)}/output?${search.toString()}`,
    { timeoutMs: options.timeoutMs },
  )
}

export function deleteSceneTerminal(
  sceneId: string,
  terminalId: string,
  workspacePath: string,
  agentInstanceId: string,
) {
  const search = new URLSearchParams({
    workspace_path: workspacePath,
    agent_instance_id: requireAgentInstanceId(agentInstanceId),
  })
  return requestJson<SceneTerminal>(
    `/api/scene/${encodeURIComponent(sceneId)}/terminals/${encodeURIComponent(terminalId)}?${search.toString()}`,
    { method: "DELETE" },
  )
}

export function listSceneChatBubbles(
  sceneId: string,
  query: { limit?: number; before_sort_order?: number | null; agent_instance_id: string },
  options: RequestOptions = {},
) {
  const search = new URLSearchParams({
    agent_instance_id: requireAgentInstanceId(query.agent_instance_id),
  })
  if (typeof query.limit === "number") search.set("limit", String(query.limit))
  if (typeof query.before_sort_order === "number") search.set("before_sort_order", String(query.before_sort_order))
  const queryString = search.toString()
  const url = `/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/chat-bubbles${
    queryString ? `?${queryString}` : ""
  }`
  return requestJson<ListChatBubbleMessagesResponse>(url, { timeoutMs: options.timeoutMs })
}

export function createSceneChatBubble(
  sceneId: string,
  body: CreateChatBubbleMessageRequest,
  options: { signal?: AbortSignal } = {},
) {
  return requestJson<ChatBubbleMessageDto>(`/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/chat-bubbles`, {
    method: "POST",
    body,
    signal: options.signal,
  })
}

export function patchSceneChatBubble(
  sceneId: string,
  bubbleId: string,
  body: PatchChatBubbleMessageRequest,
  options: { signal?: AbortSignal } = {},
) {
  return requestJson<ChatBubbleMessageDto>(
    `/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/chat-bubbles/${encodeURIComponent(bubbleId)}`,
    {
      method: "PATCH",
      body,
      signal: options.signal,
    },
  )
}

export function deleteSceneChatBubble(sceneId: string, bubbleId: string) {
  return requestJson<null>(`/api/agent-runtime/scenes/${encodeURIComponent(sceneId)}/chat-bubbles/${encodeURIComponent(bubbleId)}`, {
    method: "DELETE",
  }).then(() => undefined)
}

export function createAgentCommunicationClient(
  eventStreamUrl: string,
  onEvent: (event: AgentEvent) => void,
  options: {
    getAfterSeq?: () => number
    onOpen?: () => void
    onError?: (error: Event) => void
    onActivity?: (activity: SseActivity) => void
  } = {},
) {
  return new SseClient<AgentEvent>({
    buildUrl: () => buildEventStreamUrl(eventStreamUrl, options.getAfterSeq?.() ?? 0),
    eventTypes: [COMMUNICATION_SSE_EVENT_TYPE],
    activityEventTypes: [COMMUNICATION_SSE_PING_EVENT_TYPE],
    terminalEventTypes: [COMMUNICATION_SSE_AUTH_INVALID_EVENT_TYPE],
    onTerminalEvent: (_eventType, data) => {
      if (data && typeof data === "object") {
        const payload = data as Record<string, unknown>
        const code = typeof payload.code === "string" ? payload.code : ""
        if (code.startsWith("auth_")) {
          const detail = typeof payload.detail === "string" ? payload.detail : null
          notifyRuntimeAuthInvalid(
            {
              code: code as RuntimeAuthInvalidCode,
              detail,
              source: "sse",
            },
            getRuntimeAccessToken(),
          )
        }
      }
    },
    onEvent,
    onOpen: options.onOpen,
    onError: options.onError,
    onActivity: options.onActivity,
  })
}

function buildEventStreamUrl(baseUrl: string, afterSeq: number): string {
  if (!afterSeq || afterSeq <= 0) return baseUrl
  const separator = baseUrl.includes("?") ? "&" : "?"
  return `${baseUrl}${separator}after_seq=${afterSeq}`
}



