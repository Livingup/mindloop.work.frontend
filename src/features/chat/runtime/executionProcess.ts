/**
 * Execution Process metadata 模型与权威 reducer/parser。
 *
 * 角色定位
 * - 此模块是「Agent 执行过程」（LLM 思考 + 工具调用聚合气泡）的唯一权威：
 *   - 持久化 metadata 类型（snake_case，对齐后端 chat bubble metadata 字段命名）
 *   - 事件 → metadata 的 reducer（供 ChatPage 在 SSE 事件到达时构造或更新 bubble body）
 *   - metadata → 渲染视图模型的 parser（供 MessageList 渲染气泡）
 * - 在重构前，类型/reducer/parser 同时分散在 ChatPage、chatStore、MessageList 三处，
 *   字段命名风格也三套并存。本模块作为唯一来源，避免字段在多处漂移导致渲染/持久化不一致。
 *
 * 设计决策
 * - 持久化 metadata 是「权威源」（方案 A）：所有 LLM/工具事件聚合状态最终都体现在
 *   chat bubble 的 metadata 字段中；前端不再独立维护 ExecutionBlock 内存模型。
 * - parser 输出的 view-model（camelCase）只取渲染需要的最小字段集，避免渲染层依赖
 *   metadata 中持久化语义字段（如 communication_seq、token_usage 等）。
 */

import type {
  AgentEvent,
  ContextCompressionPayload,
  LlmCallFailedPayload,
  LlmRequestCancelledPayload,
  LlmSemanticStreamPayload,
  LlmRequestFailedPayload,
  LlmRequestStartedPayload,
  LlmResponseCompletedPayload,
  LlmResponseStartedPayload,
  LlmStreamDeltaPayload,
  LlmToolCallArgumentsPayload,
  LlmToolCallStartedPayload,
  ToolCallCancelledPayload,
  ToolCallCompletedPayload,
  ToolCallFailedPayload,
  ToolCallProgressPayload,
  ToolCallStartedPayload,
} from "@/features/chat/model/agentEvents"
import type { ChatMessage } from "@/features/chat/model/chatTypes"

// ── 内部辅助 ──────────────────────────────────────────────────────────

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
}

function previewRecord(value: unknown): Record<string, unknown> | null {
  const record = recordValue(value)
  if (record) return record
  if (value === undefined || value === null) return {}
  return { input: value }
}

function defaultLlmLabel(status: "waiting" | "thinking" | "completed" | "failed" | "cancelled"): string {
  if (status === "cancelled") return "LLM 请求已取消"
  if (status === "failed") return "LLM 请求失败"
  if (status === "completed") return "LLM 响应完成"
  if (status === "thinking") return "LLM 响应中..."
  return "等待 LLM 响应..."
}

function reasoningTokenCount(tokenUsage: unknown): number | undefined {
  const usage = recordValue(tokenUsage)
  return usage ? numberValue(usage.reasoning_tokens) : undefined
}

function retryOrdinalLabel(retryIndex: number): string {
  const labels = ["", "第一次", "第二次", "第三次", "第四次", "第五次", "第六次", "第七次", "第八次", "第九次", "第十次"]
  return labels[retryIndex] ?? `第${retryIndex}次`
}

function contextCompressionLabel(status: ExecutionProcessContextCompressionMetadata["status"]): string {
  if (status === "completed") return "上下文压缩完成"
  if (status === "failed") return "上下文压缩失败"
  if (status === "cancelled") return "上下文压缩已取消"
  if (status === "skipped") return "上下文压缩已跳过"
  return "上下文压缩中..."
}

function taskBoundaryLabel(status: TaskBoundaryStatus): string {
  return status === "cancelled" ? "任务已取消" : status === "failed" ? "任务失败" : "任务完成"
}

function contextCompressionStageLabel(stage: string): string {
  if (stage === "started") return "准备上下文压缩"
  if (stage === "range_planned") return "规划压缩范围"
  if (stage === "workers") return "并发压缩"
  if (stage === "assembly") return "生成压缩草稿"
  if (stage === "verification") return "校验并编辑压缩结果"
  if (stage === "conversation_rebind") return "切换压缩后会话"
  if (stage === "completed") return "压缩完成"
  if (stage === "failed") return "压缩失败"
  if (stage === "cancelled") return "已取消"
  if (stage === "skipped") return "已跳过"
  return "准备上下文压缩"
}

const CONTEXT_COMPRESSION_SECTION_WORKER_NAMES: Record<string, string> = {
  requirements_constraints: "RequirementConstraintWorker",
  progress_plan: "ProgressPlanWorker",
  code_architecture: "CodeArchitectureWorker",
  observations_evidence: "ObservationEvidenceWorker",
  decisions_rationale: "DecisionRationaleWorker",
  todos_risks: "TodoRiskWorker",
}

const CONTEXT_COMPRESSION_WORKER_ORDER = [
  "RequirementConstraintWorker",
  "ProgressPlanWorker",
  "CodeArchitectureWorker",
  "ObservationEvidenceWorker",
  "DecisionRationaleWorker",
  "TodoRiskWorker",
  "FinalAssemblerWorker",
  "FinalVerifierWorker",
] as const

const CONTEXT_COMPRESSION_WORKER_ORDER_INDEX: ReadonlyMap<string, number> = new Map(
  CONTEXT_COMPRESSION_WORKER_ORDER.map((id, index) => [id, index]),
)

const CONTEXT_COMPRESSION_WORKER_TITLES: Record<string, string> = {
  RequirementConstraintWorker: "用户需求与硬约束",
  ProgressPlanWorker: "任务计划与执行进度",
  CodeArchitectureWorker: "代码结构与架构事实",
  ObservationEvidenceWorker: "工具观察与外部事实",
  DecisionRationaleWorker: "决策与理由",
  TodoRiskWorker: "待办与风险",
  requirements_constraints: "用户需求与硬约束",
  progress_plan: "任务计划与执行进度",
  code_architecture: "代码结构与架构事实",
  observations_evidence: "工具观察与外部事实",
  decisions_rationale: "决策与理由",
  todos_risks: "待办与风险",
  FinalAssemblerWorker: "最终汇编（兼容）",
  FinalVerifierWorker: "压缩结果校验与编辑",
}

const CONTEXT_COMPRESSION_TRANSLATED_WORKER_TITLES = new Set(Object.values(CONTEXT_COMPRESSION_WORKER_TITLES))

function contextCompressionCanonicalWorkerId(worker: Record<string, unknown>, fallback: string): string {
  const name = textValue(worker.name)
  if (name && !CONTEXT_COMPRESSION_TRANSLATED_WORKER_TITLES.has(name)) return name
  const outputSection = textValue(worker.output_section)
  if (outputSection && CONTEXT_COMPRESSION_SECTION_WORKER_NAMES[outputSection]) {
    return CONTEXT_COMPRESSION_SECTION_WORKER_NAMES[outputSection]
  }
  const workerId = textValue(worker.worker_id) ?? textValue(worker.id)
  if (workerId) return CONTEXT_COMPRESSION_SECTION_WORKER_NAMES[workerId] ?? workerId
  if (name) return name
  return fallback
}

function contextCompressionWorkerDisplayName(worker: Record<string, unknown>, fallback: string): string {
  const title = textValue(worker.title)
  if (title) return title
  const name = textValue(worker.name)
  if (name) {
    if (CONTEXT_COMPRESSION_WORKER_TITLES[name]) return CONTEXT_COMPRESSION_WORKER_TITLES[name]
    if (CONTEXT_COMPRESSION_TRANSLATED_WORKER_TITLES.has(name)) return name
  }
  const outputSection = textValue(worker.output_section)
  if (outputSection && CONTEXT_COMPRESSION_WORKER_TITLES[outputSection]) {
    return CONTEXT_COMPRESSION_WORKER_TITLES[outputSection]
  }
  const workerId = textValue(worker.worker_id) ?? textValue(worker.id)
  if (workerId && CONTEXT_COMPRESSION_WORKER_TITLES[workerId]) {
    return CONTEXT_COMPRESSION_WORKER_TITLES[workerId]
  }
  return name ?? outputSection ?? workerId ?? fallback
}

function contextCompressionWorkerId(event: AgentEvent, payload: ContextCompressionPayload): string {
  const worker = recordValue(payload.worker)
  return worker ? contextCompressionCanonicalWorkerId(worker, `worker-${event.message_id}`) : `worker-${event.message_id}`
}

function contextCompressionWorkerOrderIndex(workerId: string): number {
  const normalizedId = CONTEXT_COMPRESSION_SECTION_WORKER_NAMES[workerId] ?? workerId
  return CONTEXT_COMPRESSION_WORKER_ORDER_INDEX.get(normalizedId) ?? Number.MAX_SAFE_INTEGER
}

function compareContextCompressionWorkersByStableOrder(
  left: { id: string; name: string },
  right: { id: string; name: string },
): number {
  const leftOrder = contextCompressionWorkerOrderIndex(left.id)
  const rightOrder = contextCompressionWorkerOrderIndex(right.id)
  if (leftOrder !== rightOrder) return leftOrder - rightOrder

  const idOrder = left.id.localeCompare(right.id)
  if (idOrder !== 0) return idOrder

  return left.name.localeCompare(right.name)
}

function sortContextCompressionWorkersByStableOrder<T extends { id: string; name: string }>(
  workers: T[],
): T[] {
  return [...workers].sort(compareContextCompressionWorkersByStableOrder)
}

function llmAttemptLabel(
  apiKeyIndex: number | undefined,
  apiKeyLabel: string | null,
  retryIndex: number | undefined,
): string | undefined {
  const apiKeyText = apiKeyLabel ?? (apiKeyIndex !== undefined ? `#${apiKeyIndex + 1}` : null)
  if (apiKeyIndex !== undefined && apiKeyIndex > 0 && (!retryIndex || retryIndex === 0)) {
    return apiKeyText ? `切换apikey：${apiKeyText} 重试` : "切换apikey重试"
  }
  if (retryIndex !== undefined && retryIndex > 0) {
    const retryLabel = `${retryOrdinalLabel(retryIndex)}重试`
    return apiKeyText ? `服务商 apikey：${apiKeyText} ${retryLabel}` : retryLabel
  }
  return undefined
}

function llmLabelFromState({
  status,
  responseStarted,
  thinkingStarted,
  thinkingCompleted,
  contentStarted,
  contentCompleted,
  latestOutputKind,
  tokenUsage,
}: {
  status: "waiting" | "thinking" | "completed" | "failed" | "cancelled"
  responseStarted: boolean
  thinkingStarted: boolean
  thinkingCompleted: boolean
  contentStarted: boolean
  contentCompleted: boolean
  latestOutputKind?: "text" | "tool"
  tokenUsage: unknown
}): string {
  if (status === "cancelled") return "LLM 请求已取消"
  if (status === "failed") return "LLM 请求失败"
  const tokens = reasoningTokenCount(tokenUsage)
  const hasThinkingPhase = thinkingStarted || tokens !== undefined
  const thinkingDoneLabel = tokens !== undefined ? `思考结束 ${tokens} tokens` : "思考结束"
  const finalThinkingLabel = tokens !== undefined ? `思考 ${tokens} tokens` : hasThinkingPhase ? "思考" : null
  if (status === "completed") {
    return finalThinkingLabel ? `${finalThinkingLabel} · 响应结束` : "响应结束"
  }
  if (latestOutputKind === "tool") {
    return hasThinkingPhase ? `${thinkingDoneLabel} · 回复中...` : "回复中..."
  }
  if (latestOutputKind === "text" && contentStarted) {
    if (contentCompleted) {
      return hasThinkingPhase ? `${thinkingDoneLabel} · 普通回复完成，等待响应结束...` : "普通回复完成，等待响应结束..."
    }
    return hasThinkingPhase ? `${thinkingDoneLabel} · 回复中...` : "回复中..."
  }
  if (thinkingStarted && !thinkingCompleted) return "思考中..."
  if (thinkingStarted && thinkingCompleted) return `${thinkingDoneLabel} · 等待后续输出...`
  if (responseStarted) return "LLM开始响应..."
  return "开始请求LLM等待响应..."
}

// ── 持久化 metadata 类型（snake_case，对齐 chat bubble metadata 语义） ─

export type ExecutionProcessLlmMetadata = {
  id: string
  status: "waiting" | "thinking" | "completed" | "failed" | "cancelled"
  label: string
  model_alias?: string
  started_at?: string
  completed_at?: string
  duration_ms?: number
  tool_use_count?: number
  error_message?: string
  token_usage?: unknown
  context_window_max?: number
  response_started?: boolean
  thinking_started?: boolean
  thinking_completed?: boolean
  content_started?: boolean
  content_completed?: boolean
  latest_output_kind?: "text" | "tool"
  generated_tool_call_count?: number
  llm_call_id?: string
  llm_request_id?: string
  candidate_index?: number
  api_key_index?: number | null
  api_key_label?: string | null
  retry_index?: number | null
  attempt_count?: number
  communication_message_id: string
  communication_seq: number
}

export type ExecutionProcessToolMetadata = {
  tool_call_id: string
  tool_name: string
  title: string
  status: "running" | "completed" | "failed" | "cancelled"
  started_at?: string
  completed_at?: string
  duration_ms?: number
  error_message?: string | null
  arguments_preview?: Record<string, unknown> | null
  result_preview?: unknown
  ui_preview?: Record<string, unknown> | null
  terminal_session_id?: string | null
  source?: string | null
  communication_message_id?: string
  communication_seq?: number
}

export type ExecutionProcessContextCompressionWorkerActivityMetadata = {
  kind?: string | null
  text: string
  provider_id?: string | null
  model_id?: string | null
  model_alias?: string | null
  api_key_index?: number | null
  api_key_label?: string | null
  retry_index?: number | null
  attempt_count?: number | null
  error_type?: string | null
  error_message?: string | null
}

export type ExecutionProcessContextCompressionWorkerMetadata = {
  id: string
  name: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  role?: string | null
  output_section?: string | null
  input_mode?: string | null
  round_index?: number | null
  max_rounds?: number | null
  provider_id?: string | null
  model_binding_id?: string | null
  reason?: string | null
  waited_ms?: number
  duration_ms?: number
  error_message?: string | null
  activity?: ExecutionProcessContextCompressionWorkerActivityMetadata | null
  communication_message_id: string
  communication_seq: number
}

export type ExecutionProcessContextCompressionMetadata = {
  id: string
  job_id: string
  status: "running" | "completed" | "failed" | "cancelled" | "skipped"
  stage: string
  label: string
  started_at?: string
  completed_at?: string
  duration_ms?: number
  reason?: string | null
  source_conversation_id?: string | null
  target_conversation_id?: string | null
  compression_index?: number | null
  input_mode?: string | null
  source_message_count?: number | null
  compressed_range_start?: number | null
  compressed_range_end?: number | null
  retained_tail_range_start?: number | null
  retained_tail_range_end?: number | null
  retained_tail_message_count?: number | null
  assembly_status?: "running" | "completed"
  verification_status?: "running" | "completed"
  rebind_completed?: boolean
  workers: ExecutionProcessContextCompressionWorkerMetadata[]
  summary_message_id?: string | null
  summary_message_index?: number | null
  archive_job_id?: string | null
  final_markdown?: string | null
  final_markdown_status?: "idle" | "loading" | "loaded" | "failed"
  final_markdown_error?: string | null
  error_type?: string | null
  error_message?: string | null
  communication_message_id: string
  communication_seq: number
}

export type ExecutionProcessIterationMetadata = {
  id: string
  index: number
  llm?: ExecutionProcessLlmMetadata
  tools: ExecutionProcessToolMetadata[]
}

export type ExecutionProcessMetadata = Record<string, unknown> & {
  bubble_kind: "execution_process"
  process_status: "streaming" | "completed" | "failed"
  execution_round?: number
  execution_round_end?: number
  iterations: ExecutionProcessIterationMetadata[]
}

/**
 * 上下文压缩气泡 metadata。
 *
 * 上下文压缩气泡是一个独立 bubble_kind，在聊天流中起天然分隔符作用，
 * 与用户消息、Agent 普通对话消息地位相同。每个 compression job 唯一对应一个独立气泡，
 * 由 job_id 标识；同 job 的所有 `context_compression.*` 事件聚合到同一气泡，
 * 不与前后的 execution_process 气泡合并，从而保证压缩成功后的新 LLM/tool 事件
 * 在视觉上必然出现在压缩气泡的下方。
 */
export type ContextCompressionBubbleMetadata = Record<string, unknown> & {
  bubble_kind: "context_compression"
  process_status: "streaming" | "completed" | "failed"
  compression: ExecutionProcessContextCompressionMetadata
}

export type TaskBoundaryStatus = "completed" | "failed" | "cancelled"

/**
 * 任务终态边界气泡 metadata。
 *
 * 任务边界是独立 bubble_kind=task_boundary，用 agent.task.completed / agent.task.failed
 * 终态事件在共享聊天流中落一个硬隔断点，避免同一 scene / agent instance 的后续任务继续
 * 合并到上一个 execution_process 气泡。
 */
export type TaskBoundaryMetadata = Record<string, unknown> & {
  bubble_kind: "task_boundary"
  boundary_kind: "task_terminal"
  task_status: TaskBoundaryStatus
  label: string
  completed_at: string
  task_id?: string | null
  agent_instance_id?: string | null
  conversation_id?: string | null
  failure_message?: string | null
  communication_message_id: string
  communication_seq: number
}

// ── 渲染视图类型（camelCase，metadata 的渲染投影） ────────────────────

export type ExecutionProcessLlmView = {
  id: string
  status: "waiting" | "thinking" | "completed" | "failed" | "cancelled"
  label: string
  modelAlias?: string
  durationMs?: number
  errorMessage?: string
  responseStarted: boolean
  thinkingStarted: boolean
  thinkingCompleted: boolean
  contentStarted: boolean
  contentCompleted: boolean
  latestOutputKind?: "text" | "tool"
  attemptLabel?: string
  llmRequestId?: string
}

export type ExecutionProcessToolView = {
  toolCallId: string
  toolName: string
  title: string
  status: "running" | "completed" | "failed" | "cancelled"
  durationMs?: number
  errorMessage?: string
  argumentsPreview?: Record<string, unknown> | null
  resultPreview?: unknown
  uiPreview?: Record<string, unknown> | null
  source?: string | null
}

export type ExecutionProcessIterationView = {
  id: string
  index: number
  llm?: ExecutionProcessLlmView
  tools: ExecutionProcessToolView[]
}

export type ExecutionProcessContextCompressionWorkerView = {
  id: string
  name: string
  status: "queued" | "running" | "completed" | "failed" | "cancelled"
  role?: string | null
  outputSection?: string | null
  inputMode?: string | null
  providerId?: string | null
  modelBindingId?: string | null
  reason?: string | null
  waitedMs?: number
  durationMs?: number
  errorMessage?: string | null
  activityText?: string | null
}

export type ExecutionProcessContextCompressionView = {
  id: string
  jobId: string
  status: "running" | "completed" | "failed" | "cancelled" | "skipped"
  stage: string
  label: string
  stageLabel: string
  durationMs?: number
  reason?: string | null
  sourceConversationId?: string | null
  targetConversationId?: string | null
  compressionIndex?: number | null
  inputMode?: string | null
  sourceMessageCount?: number | null
  compressedRangeStart?: number | null
  compressedRangeEnd?: number | null
  retainedTailRangeStart?: number | null
  retainedTailRangeEnd?: number | null
  retainedTailMessageCount?: number | null
  assemblyStatus?: "running" | "completed"
  verificationStatus?: "running" | "completed"
  rebindCompleted: boolean
  workers: ExecutionProcessContextCompressionWorkerView[]
  summaryMessageId?: string | null
  summaryMessageIndex?: number | null
  archiveJobId?: string | null
  finalMarkdown?: string | null
  finalMarkdownStatus: "idle" | "loading" | "loaded" | "failed"
  finalMarkdownError?: string | null
  errorMessage?: string | null
}

export type TaskBoundaryView = {
  status: TaskBoundaryStatus
  label: string
  completedAt: string
  taskId?: string | null
  agentInstanceId?: string | null
  conversationId?: string | null
  failureMessage?: string | null
}

// ── 事件归属判断 ──────────────────────────────────────────────────────

/** 判断 AgentEvent 是否属于「执行过程」类（LLM/工具调用），属于则进入 execution_process metadata reducer。
 *  注意：context_compression.* 事件不属于执行过程聚合范畴，由独立的 context compression bubble 处理。 */
export function isExecutionProcessEvent(event: AgentEvent): boolean {
  return event.type === "llm.request.started" ||
    event.type === "llm.request.cancelled" ||
    event.type === "llm.request.failed" ||
    event.type === "llm.call.failed" ||
    event.type === "llm.response.started" ||
    event.type === "llm.response.completed" ||
    event.type === "llm.thinking.started" ||
    event.type === "llm.thinking.delta" ||
    event.type === "llm.thinking.completed" ||
    event.type === "llm.content.started" ||
    event.type === "llm.content.delta" ||
    event.type === "llm.content.completed" ||
    event.type === "llm.tool_call.started" ||
    event.type === "llm.tool_call.arguments.delta" ||
    event.type === "llm.tool_call.completed" ||
    event.type === "tool.call.started" ||
    event.type === "tool.call.progress" ||
    event.type === "tool.call.completed" ||
    event.type === "tool.call.cancelled" ||
    event.type === "tool.call.failed"
}

/** 判断 ChatMessage 的 metadata.bubble_kind 是否为执行过程聚合气泡。 */
export function isExecutionProcessMessage(message: ChatMessage): boolean {
  return message.content.metadata?.bubble_kind === "execution_process"
}

/** 判断 AgentEvent 是否属于「上下文压缩」类，进入独立的 context compression bubble reducer。 */
export function isContextCompressionEvent(event: AgentEvent): boolean {
  return event.type.startsWith("context_compression.")
}

/** 判断 ChatMessage 的 metadata.bubble_kind 是否为独立的上下文压缩气泡。 */
export function isContextCompressionMessage(message: ChatMessage): boolean {
  return message.content.metadata?.bubble_kind === "context_compression"
}

export function findContextCompressionMessageByJob(
  messages: ChatMessage[],
  jobId: string,
  agentInstanceId: string | null,
): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isContextCompressionMessage(message)) continue
    if (agentInstanceId && message.agentInstanceId && message.agentInstanceId !== agentInstanceId) continue
    const metadata = recordValue(message.content.metadata)
    const compression = recordValue(metadata?.compression)
    if (textValue(compression?.job_id) === jobId) return message
  }
  return null
}

/** 判断 AgentEvent 是否为任务终态事件，属于则进入独立 task_boundary bubble。 */
export function isTaskBoundaryEvent(event: AgentEvent): boolean {
  return event.type === "agent.task.completed" || event.type === "agent.task.failed" || event.type === "agent.task.cancelled"
}

/** 判断 ChatMessage 的 metadata.bubble_kind 是否为任务终态边界气泡。 */
export function isTaskBoundaryMessage(message: ChatMessage): boolean {
  return message.content.metadata?.bubble_kind === "task_boundary"
}

/** 从 `context_compression.*` 事件 payload 中解析出 job_id；不存在时回退到 correlation_id / message_id。 */
export function contextCompressionEventJobId(event: AgentEvent): string {
  const payload = event.payload as ContextCompressionPayload
  return payload.job_id ?? event.correlation_id ?? event.message_id
}

// ── metadata 规范化（旧 metadata → 规范 metadata） ─────────────────────

/**
 * 把任意来源的 metadata（已持久化的旧版本、初始空对象等）规范为 ExecutionProcessMetadata。
 * 用途：reducer 操作前先 normalize，确保字段齐全可下游修改。
 */
export function normalizeExecutionProcessMetadata(metadata: unknown): ExecutionProcessMetadata {
  const source = recordValue(metadata) ?? {}
  const rawIterations = Array.isArray(source.iterations) ? source.iterations : []
  const iterations = rawIterations.flatMap((item, index) => {
    const iteration = recordValue(item)
    if (!iteration) return []
    const tools = Array.isArray(iteration.tools)
      ? iteration.tools.flatMap((tool) => normalizeExecutionProcessTool(tool))
      : []
    const llm = normalizeExecutionProcessLlm(iteration.llm)
    return [{
      id: textValue(iteration.id) ?? `iteration-${index + 1}`,
      index: numberValue(iteration.index) ?? index + 1,
      ...(llm ? { llm } : {}),
      tools,
    }]
  })
  // 上下文压缩已迁移到独立的 context_compression bubble。这里有意丢弃旧 execution_process metadata
  // 中可能残留的 context_compressions 字段，避免在新模型中继续渲染。历史持久化数据中遗留的压缩条目
  // 会失去在 execution_process 气泡中的渲染入口；这是模型迁移的一次性视觉损失，可接受。
  const { context_compressions: _legacyContextCompressions, ...rest } = source
  return {
    ...rest,
    bubble_kind: "execution_process",
    process_status: rest.process_status === "failed"
      ? "failed"
      : rest.process_status === "completed"
        ? "completed"
        : "streaming",
    iterations,
  }
}

/**
 * 把任意来源的 metadata 规范为 ContextCompressionBubbleMetadata。
 * 持久化恢复场景下 metadata 中应已存在 `compression` 字段；若不存在则返回 null，
 * 调用方应使用 buildInitialContextCompressionBubbleMetadata 基于事件构造新 metadata。
 */
export function normalizeContextCompressionBubbleMetadata(metadata: unknown): ContextCompressionBubbleMetadata | null {
  const source = recordValue(metadata)
  if (!source) return null
  const compressions = normalizeExecutionProcessContextCompression(source.compression)
  if (compressions.length === 0) return null
  return {
    ...source,
    bubble_kind: "context_compression",
    process_status: source.process_status === "failed"
      ? "failed"
      : source.process_status === "completed"
        ? "completed"
        : "streaming",
    compression: compressions[0],
  }
}

function taskBoundaryStatusFromEvent(eventType: string): TaskBoundaryStatus | null {
  if (eventType === "agent.task.completed") return "completed"
  if (eventType === "agent.task.failed") return "failed"
  if (eventType === "agent.task.cancelled") return "cancelled"
  return null
}

export function buildTaskBoundaryMetadata(
  event: AgentEvent,
  agentInstanceId: string | null,
  taskId: string | null,
  conversationId: string | null,
  ): TaskBoundaryMetadata | null {
  const status = taskBoundaryStatusFromEvent(event.type)
  if (!status) return null
  const payload = recordValue(event.payload) ?? {}
  const boundaryTaskId = taskId ?? textValue(payload.task_id) ?? textValue(event.metadata.task_id)
  const boundaryAgentInstanceId = agentInstanceId ?? textValue(payload.agent_instance_id) ?? textValue(event.metadata.agent_instance_id)
  const boundaryConversationId = conversationId ?? textValue(payload.conversation_id) ?? textValue(event.metadata.conversation_id)
  return {
    bubble_kind: "task_boundary",
    boundary_kind: "task_terminal",
    task_status: status,
    label: taskBoundaryLabel(status),
    completed_at: event.created_at,
    task_id: boundaryTaskId,
    agent_instance_id: boundaryAgentInstanceId,
    conversation_id: boundaryConversationId,
    failure_message: status === "failed"
      ? textValue(payload.failure_message) ?? textValue(payload.error_message) ?? textValue(payload.reason)
      : null,
    communication_message_id: event.message_id,
    communication_seq: event.seq,
  }
}

function normalizeExecutionProcessLlm(value: unknown): ExecutionProcessLlmMetadata | undefined {
  const llm = recordValue(value)
  if (!llm) return undefined
  const id = textValue(llm.id)
  const communicationMessageId = textValue(llm.communication_message_id)
  const communicationSeq = numberValue(llm.communication_seq)
  const status = llm.status === "cancelled"
    ? "cancelled"
    : llm.status === "failed"
      ? "failed"
      : llm.status === "completed"
        ? "completed"
        : llm.status === "thinking"
          ? "thinking"
          : "waiting"
  if (!id || !communicationMessageId || communicationSeq === undefined) return undefined
  return {
    id,
    status,
    label: textValue(llm.label) ?? defaultLlmLabel(status),
    model_alias: textValue(llm.model_alias) ?? undefined,
    started_at: textValue(llm.started_at) ?? undefined,
    completed_at: textValue(llm.completed_at) ?? undefined,
    duration_ms: numberValue(llm.duration_ms),
    tool_use_count: numberValue(llm.tool_use_count),
    error_message: textValue(llm.error_message) ?? undefined,
    token_usage: llm.token_usage,
    context_window_max: numberValue(llm.context_window_max),
    response_started: llm.response_started === true,
    thinking_started: llm.thinking_started === true,
    thinking_completed: llm.thinking_completed === true,
    content_started: llm.content_started === true,
    content_completed: llm.content_completed === true,
    latest_output_kind: llm.latest_output_kind === "tool" ? "tool" : llm.latest_output_kind === "text" ? "text" : undefined,
    generated_tool_call_count: numberValue(llm.generated_tool_call_count),
    llm_call_id: textValue(llm.llm_call_id) ?? undefined,
    llm_request_id: textValue(llm.llm_request_id) ?? undefined,
    candidate_index: numberValue(llm.candidate_index),
    api_key_index: numberValue(llm.api_key_index) ?? null,
    api_key_label: textValue(llm.api_key_label),
    retry_index: numberValue(llm.retry_index) ?? null,
    attempt_count: numberValue(llm.attempt_count),
    communication_message_id: communicationMessageId,
    communication_seq: communicationSeq,
  }
}

function normalizeExecutionProcessTool(value: unknown): ExecutionProcessToolMetadata[] {
  const tool = recordValue(value)
  if (!tool) return []
  const toolCallId = textValue(tool.tool_call_id)
  const toolName = textValue(tool.tool_name)
  if (!toolCallId || !toolName) return []
  return [{
    tool_call_id: toolCallId,
    tool_name: toolName,
    title: textValue(tool.title) ?? toolName,
    status: tool.status === "cancelled" ? "cancelled" : tool.status === "failed" ? "failed" : tool.status === "completed" ? "completed" : "running",
    started_at: textValue(tool.started_at) ?? undefined,
    completed_at: textValue(tool.completed_at) ?? undefined,
    duration_ms: numberValue(tool.duration_ms),
    error_message: textValue(tool.error_message),
    arguments_preview: recordValue(tool.arguments_preview) ?? null,
    result_preview: tool.result_preview ?? null,
    ui_preview: recordValue(tool.ui_preview) ?? null,
    terminal_session_id: textValue(tool.terminal_session_id),
    source: textValue(tool.source),
    communication_message_id: textValue(tool.communication_message_id) ?? undefined,
    communication_seq: numberValue(tool.communication_seq),
  }]
}

function normalizeExecutionProcessContextCompression(value: unknown): ExecutionProcessContextCompressionMetadata[] {
  const compression = recordValue(value)
  if (!compression) return []
  const id = textValue(compression.id)
  const jobId = textValue(compression.job_id) ?? id
  const communicationMessageId = textValue(compression.communication_message_id)
  const communicationSeq = numberValue(compression.communication_seq)
  if (!id || !jobId || !communicationMessageId || communicationSeq === undefined) return []
  const status = compression.status === "completed"
    ? "completed"
    : compression.status === "failed"
      ? "failed"
      : compression.status === "cancelled"
        ? "cancelled"
        : compression.status === "skipped"
          ? "skipped"
          : "running"
  const rawWorkers = Array.isArray(compression.workers) ? compression.workers : []
  return [{
    id,
    job_id: jobId,
    status,
    stage: textValue(compression.stage) ?? "started",
    label: textValue(compression.label) ?? contextCompressionLabel(status),
    started_at: textValue(compression.started_at) ?? undefined,
    completed_at: textValue(compression.completed_at) ?? undefined,
    duration_ms: numberValue(compression.duration_ms),
    reason: textValue(compression.reason),
    source_conversation_id: textValue(compression.source_conversation_id),
    target_conversation_id: textValue(compression.target_conversation_id),
    compression_index: numberValue(compression.compression_index) ?? null,
    input_mode: textValue(compression.input_mode),
    source_message_count: numberValue(compression.source_message_count) ?? null,
    compressed_range_start: numberValue(compression.compressed_range_start) ?? null,
    compressed_range_end: numberValue(compression.compressed_range_end) ?? null,
    retained_tail_range_start: numberValue(compression.retained_tail_range_start) ?? null,
    retained_tail_range_end: numberValue(compression.retained_tail_range_end) ?? null,
    retained_tail_message_count: numberValue(compression.retained_tail_message_count) ?? null,
    assembly_status: compression.assembly_status === "completed" ? "completed" : compression.assembly_status === "running" ? "running" : undefined,
    verification_status: compression.verification_status === "completed" ? "completed" : compression.verification_status === "running" ? "running" : undefined,
    rebind_completed: compression.rebind_completed === true,
    workers: normalizeContextCompressionWorkers(rawWorkers.flatMap((worker) => normalizeExecutionProcessContextCompressionWorker(worker))),
    summary_message_id: textValue(compression.summary_message_id),
    summary_message_index: numberValue(compression.summary_message_index) ?? null,
    archive_job_id: textValue(compression.archive_job_id),
    final_markdown: textValue(compression.final_markdown),
    final_markdown_status: compression.final_markdown_status === "loaded"
      ? "loaded"
      : compression.final_markdown_status === "loading"
        ? "loading"
        : compression.final_markdown_status === "failed"
          ? "failed"
          : "idle",
    final_markdown_error: textValue(compression.final_markdown_error),
    error_type: textValue(compression.error_type),
    error_message: textValue(compression.error_message),
    communication_message_id: communicationMessageId,
    communication_seq: communicationSeq,
  }]
}

function normalizeExecutionProcessContextCompressionWorker(value: unknown): ExecutionProcessContextCompressionWorkerMetadata[] {
  const worker = recordValue(value)
  if (!worker) return []
  const rawId = textValue(worker.id) ?? textValue(worker.name) ?? textValue(worker.output_section)
  const communicationMessageId = textValue(worker.communication_message_id)
  const communicationSeq = numberValue(worker.communication_seq)
  if (!rawId || !communicationMessageId || communicationSeq === undefined) return []
  const id = contextCompressionCanonicalWorkerId(worker, rawId)
  const status = worker.status === "completed"
    ? "completed"
    : worker.status === "failed"
      ? "failed"
      : worker.status === "cancelled"
        ? "cancelled"
        : worker.status === "running"
          ? "running"
          : "queued"
  return [{
    id,
    name: contextCompressionWorkerDisplayName(worker, id),
    status,
    role: textValue(worker.role),
    output_section: textValue(worker.output_section),
    input_mode: textValue(worker.input_mode),
    round_index: numberValue(worker.round_index) ?? null,
    max_rounds: numberValue(worker.max_rounds) ?? null,
    provider_id: textValue(worker.provider_id),
    model_binding_id: textValue(worker.model_binding_id),
    reason: textValue(worker.reason),
    waited_ms: numberValue(worker.waited_ms),
    duration_ms: numberValue(worker.duration_ms),
    error_message: textValue(worker.error_message),
    activity: normalizeContextCompressionWorkerActivity(worker.activity),
    communication_message_id: communicationMessageId,
    communication_seq: communicationSeq,
  }]
}

function normalizeContextCompressionWorkerActivity(value: unknown): ExecutionProcessContextCompressionWorkerActivityMetadata | null {
  const activity = recordValue(value)
  if (!activity) return null
  const text = textValue(activity.text)
  if (!text) return null
  return {
    kind: textValue(activity.kind),
    text,
    provider_id: textValue(activity.provider_id),
    model_id: textValue(activity.model_id),
    model_alias: textValue(activity.model_alias),
    api_key_index: numberValue(activity.api_key_index) ?? null,
    api_key_label: textValue(activity.api_key_label),
    retry_index: numberValue(activity.retry_index) ?? null,
    attempt_count: numberValue(activity.attempt_count) ?? null,
    error_type: textValue(activity.error_type),
    error_message: textValue(activity.error_message),
  }
}

function cascadeTerminateRunningTools(
  metadata: ExecutionProcessMetadata,
  llmId: string,
  targetStatus: "cancelled" | "failed",
  completedAt: string,
  reason: string,
): ExecutionProcessMetadata {
  let changed = false
  const iterations = metadata.iterations.map((iteration) => {
    if (
      iteration.llm?.id !== llmId &&
      iteration.id !== `iteration-${llmId}` &&
      iteration.llm?.llm_call_id !== llmId &&
      (!llmId.startsWith("llm-") || iteration.llm?.id !== `llm-${llmId}`)
    ) {
      return iteration
    }
    const hasRunning = iteration.tools.some((t) => t.status === "running")
    if (!hasRunning) return iteration
    changed = true
    return {
      ...iteration,
      tools: iteration.tools.map((tool) => {
        if (tool.status !== "running") return tool
        return {
          ...tool,
          status: targetStatus,
          completed_at: completedAt,
          error_message: tool.error_message ?? reason,
        }
      }),
    }
  })
  return changed ? { ...metadata, iterations } : metadata
}

// ── 事件 → metadata reducer ───────────────────────────────────────────

/**
 * 给定当前规范化的 metadata 与一个 AgentEvent，返回新的 metadata。
 * 入参 metadata 必须已经过 normalizeExecutionProcessMetadata 规范化。
 */
export function reduceExecutionProcessMetadata(metadata: ExecutionProcessMetadata, event: AgentEvent): ExecutionProcessMetadata {
  if (event.type === "llm.request.started") {
    const payload = event.payload as LlmRequestStartedPayload
    const llmId = llmIdFromPayload(event, payload)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "waiting",
      label: "开始请求LLM等待响应...",
      model_alias: payload.model_alias,
      response_started: false,
      started_at: event.created_at,
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.response.started") {
    const payload = event.payload as LlmResponseStartedPayload
    const llmId = llmIdFromPayload(event, payload)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "LLM开始响应...",
      model_alias: payload.model_alias,
      response_started: true,
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.thinking.started") {
    const payload = event.payload as LlmSemanticStreamPayload
    const llmId = llmIdFromPayload(event, payload)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "思考中...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_started: true,
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.thinking.delta") {
    const payload = event.payload as LlmStreamDeltaPayload
    const llmId = llmIdFromPayload(event, payload)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "思考中...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_started: true,
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.thinking.completed") {
    const payload = event.payload as LlmSemanticStreamPayload
    const llmId = llmIdFromPayload(event, payload)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "思考结束，等待后续输出...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_started: true,
      thinking_completed: true,
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.content.started") {
    const payload = event.payload as LlmSemanticStreamPayload
    const llmId = llmIdFromPayload(event, payload)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "LLM开始普通回复...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_completed: true,
      content_started: true,
      latest_output_kind: "text",
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.content.delta") {
    const payload = event.payload as LlmStreamDeltaPayload
    const llmId = llmIdFromPayload(event, payload)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "LLM开始普通回复...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_completed: true,
      content_started: true,
      latest_output_kind: "text",
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.content.completed") {
    const payload = event.payload as LlmSemanticStreamPayload
    const llmId = llmIdFromPayload(event, payload)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "普通回复完成，等待响应结束...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_completed: true,
      content_started: true,
      content_completed: true,
      latest_output_kind: "text",
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.tool_call.started") {
    const payload = event.payload as LlmToolCallStartedPayload
    const llmId = llmIdFromPayload(event, payload)
    const currentLlm = findExecutionProcessLlm(metadata, llmId)
    const metadataWithLlm = upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "LLM开始回复工具调用...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_completed: currentLlm?.thinking_started || undefined,
      latest_output_kind: "tool",
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
    const toolName = payload.tool_name || payload.tool_call_id
    return upsertExecutionProcessTool(metadataWithLlm, {
      tool_call_id: payload.tool_call_id,
      tool_name: toolName,
      title: toolName,
      status: "running",
      started_at: event.created_at,
      arguments_preview: null,
      source: "llm_generated",
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    }, llmId)
  }
  if (event.type === "llm.tool_call.arguments.delta") {
    const payload = event.payload as LlmToolCallArgumentsPayload
    const llmId = llmIdFromPayload(event, payload)
    const currentLlm = findExecutionProcessLlm(metadata, llmId)
    const metadataWithLlm = upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "LLM开始回复工具调用...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_completed: currentLlm?.thinking_started || undefined,
      latest_output_kind: "tool",
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
    const toolName = payload.tool_name || payload.tool_call_id
    return upsertExecutionProcessTool(metadataWithLlm, {
      tool_call_id: payload.tool_call_id,
      tool_name: toolName,
      title: toolName,
      status: "running",
      arguments_preview: argumentsPreviewFromPayload(payload),
      source: "llm_generated",
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    }, llmId)
  }
  if (event.type === "llm.tool_call.completed") {
    const payload = event.payload as LlmToolCallArgumentsPayload
    const llmId = llmIdFromPayload(event, payload)
    const currentLlm = findExecutionProcessLlm(metadata, llmId)
    const metadataWithLlm = upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "thinking",
      label: "LLM开始回复工具调用...",
      model_alias: payload.model_alias,
      response_started: true,
      thinking_completed: currentLlm?.thinking_started || undefined,
      latest_output_kind: "tool",
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
    const toolName = payload.tool_name || payload.tool_call_id
    return upsertExecutionProcessTool(metadataWithLlm, {
      tool_call_id: payload.tool_call_id,
      tool_name: toolName,
      title: toolName,
      status: "running",
      arguments_preview: argumentsPreviewFromPayload(payload),
      source: "llm_generated",
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    }, llmId)
  }
  if (event.type === "llm.response.completed") {
    const payload = event.payload as LlmResponseCompletedPayload
    const llmId = llmIdFromPayload(event, payload)
    const currentLlm = findExecutionProcessLlm(metadata, llmId)
    return upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "completed",
      label: "响应结束",
      model_alias: payload.model_alias,
      response_started: true,
      completed_at: event.created_at,
      duration_ms: payload.duration_ms,
      tool_use_count: payload.tool_use_part_count,
      token_usage: payload.token_usage,
      context_window_max: payload.context_window_max,
      thinking_started: currentLlm?.thinking_started || payload.thinking_part_count > 0,
      thinking_completed: currentLlm?.thinking_started || payload.thinking_part_count > 0,
      content_completed: currentLlm?.content_started,
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "llm.request.failed") {
    const payload = event.payload as LlmRequestFailedPayload
    const llmId = llmIdFromPayload(event, payload)
    const nextMeta = upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: payload.will_retry ? "waiting" : "failed",
      label: payload.will_retry ? "LLM 请求失败，准备重试..." : "LLM 请求失败",
      model_alias: payload.model_alias,
      completed_at: event.created_at,
      error_message: payload.error_message,
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
    if (!payload.will_retry) {
      return cascadeTerminateRunningTools(nextMeta, llmId, "failed", event.created_at, payload.error_message ?? "LLM 请求失败")
    }
    return nextMeta
  }
  if (event.type === "llm.request.cancelled") {
    const payload = event.payload as LlmRequestCancelledPayload
    const llmId = llmIdFromPayload(event, payload)
    const nextMeta = upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "cancelled",
      label: "LLM 请求已取消",
      model_alias: payload.model_alias,
      completed_at: event.created_at,
      duration_ms: payload.duration_ms,
      error_message: payload.reason ?? "用户已取消本次 LLM 请求。",
      llm_call_id: payload.llm_call_id,
      llm_request_id: payload.llm_request_id,
      candidate_index: payload.candidate_index,
      api_key_index: payload.api_key_index ?? null,
      api_key_label: payload.api_key_label ?? null,
      retry_index: payload.retry_index ?? null,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
    return cascadeTerminateRunningTools(nextMeta, llmId, "cancelled", event.created_at, payload.reason ?? "LLM 请求已取消")
  }
  if (event.type === "llm.call.failed") {
    const payload = event.payload as LlmCallFailedPayload
    const llmId = llmIdFromPayload(event, payload)
    const nextMeta = upsertExecutionProcessLlm(metadata, {
      id: llmId,
      status: "failed",
      label: "LLM 调用失败",
      completed_at: event.created_at,
      duration_ms: payload.duration_ms,
      error_message: payload.error_message,
      llm_call_id: payload.llm_call_id,
      candidate_index: payload.candidate_index,
      attempt_count: payload.attempt_count,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
    return cascadeTerminateRunningTools(nextMeta, llmId, "failed", event.created_at, payload.error_message ?? "LLM 调用失败")
  }
  if (event.type === "tool.call.started") {
    const payload = event.payload as ToolCallStartedPayload
    const ownerLlmId = payload.llm_call_id ? `llm-${payload.llm_call_id}` : undefined
    return upsertExecutionProcessTool(metadata, {
      tool_call_id: payload.tool_call_id,
      tool_name: payload.tool_name,
      title: payload.title ?? payload.tool_name,
      status: "running",
      started_at: event.created_at,
      arguments_preview: payload.arguments_preview ?? previewRecord(payload.input),
      terminal_session_id: payload.terminal_session_id ?? null,
      source: payload.source ?? payload.tool_source ?? null,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    }, ownerLlmId)
  }
  if (event.type === "tool.call.progress") {
    const payload = event.payload as ToolCallProgressPayload
    return upsertExecutionProcessTool(metadata, {
      tool_call_id: payload.tool_call_id,
      tool_name: payload.tool_call_id,
      title: payload.message || payload.tool_call_id,
      status: "running",
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    })
  }
  if (event.type === "tool.call.completed") {
    const payload = event.payload as ToolCallCompletedPayload
    const ownerLlmId = payload.llm_call_id ? `llm-${payload.llm_call_id}` : undefined
    return upsertExecutionProcessTool(metadata, {
      tool_call_id: payload.tool_call_id,
      tool_name: payload.tool_name,
      title: payload.tool_name,
      status: payload.success ? "completed" : "failed",
      completed_at: event.created_at,
      duration_ms: payload.duration_ms,
      result_preview: payload.result_preview ?? null,
      ui_preview: payload.ui_preview ?? null,
      error_message: payload.error_message ?? null,
      source: payload.source ?? payload.tool_source ?? null,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    }, ownerLlmId)
  }
  if (event.type === "tool.call.cancelled") {
    const payload = event.payload as ToolCallCancelledPayload
    const ownerLlmId = payload.llm_call_id ? `llm-${payload.llm_call_id}` : undefined
    return upsertExecutionProcessTool(metadata, {
      tool_call_id: payload.tool_call_id,
      tool_name: payload.tool_name,
      title: payload.tool_name,
      status: "cancelled",
      completed_at: event.created_at,
      error_message: payload.reason ?? "用户已取消工具执行。",
      result_preview: payload.result_preview ?? null,
      source: payload.source ?? payload.tool_source ?? null,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    }, ownerLlmId)
  }
  if (event.type === "tool.call.failed") {
    const payload = event.payload as ToolCallFailedPayload
    const ownerLlmId = payload.llm_call_id ? `llm-${payload.llm_call_id}` : undefined
    return upsertExecutionProcessTool(metadata, {
      tool_call_id: payload.tool_call_id,
      tool_name: payload.tool_name,
      title: payload.tool_name,
      status: "failed",
      completed_at: event.created_at,
      duration_ms: payload.duration_ms,
      error_message: payload.error_message,
      result_preview: payload.result_preview ?? {
        error_type: payload.error_type,
        error_message: payload.error_message,
      },
      source: payload.source ?? payload.tool_source ?? null,
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    }, ownerLlmId)
  }
  return metadata
}

/**
 * 基于首个 `context_compression.*` 事件构造初始 ContextCompressionBubbleMetadata。
 * 调用时机：ChatPage 在未找到同 jobId 的现有压缩气泡时，用本函数生成初始 metadata，
 * 再交给 reduceContextCompressionBubbleMetadata 进一步合并该事件的 patch。
 */
export function buildInitialContextCompressionBubbleMetadata(event: AgentEvent): ContextCompressionBubbleMetadata {
  const jobId = contextCompressionEventJobId(event)
  return {
    bubble_kind: "context_compression",
    process_status: "streaming",
    compression: {
      id: `context-compression-${jobId}`,
      job_id: jobId,
      status: "running",
      stage: "started",
      label: contextCompressionLabel("running"),
      started_at: event.created_at,
      workers: [],
      final_markdown_status: "idle",
      communication_message_id: event.message_id,
      communication_seq: event.seq,
    },
  }
}

/**
 * 给定当前 ContextCompressionBubbleMetadata 与一个 `context_compression.*` AgentEvent，返回新 metadata。
 * 入参 metadata.compression 必须与 event 属于同一 job_id；调用方负责隔离不同 jobId 的事件。
 */
export function reduceContextCompressionBubbleMetadata(
  metadata: ContextCompressionBubbleMetadata,
  event: AgentEvent,
): ContextCompressionBubbleMetadata {
  const payload = event.payload as ContextCompressionPayload
  const jobId = contextCompressionEventJobId(event)
  const current = metadata.compression
  const id = current.id || `context-compression-${jobId}`
  let status: ExecutionProcessContextCompressionMetadata["status"] = current.status
  let stage = current.stage
  let assemblyStatus = current.assembly_status
  let verificationStatus = current.verification_status
  let rebindCompleted = current.rebind_completed
  let completedAt = current.completed_at
  const currentIsTerminal = current.status !== "running"
  const workerPatch = contextCompressionWorkerPatch(event, payload)

  if (event.type === "context_compression.range_planned") stage = "range_planned"
  if (event.type.startsWith("context_compression.worker.") || event.type.startsWith("context_compression.section.")) stage = "workers"
  if (event.type === "context_compression.assembly.started") {
    stage = "assembly"
    assemblyStatus = "running"
  }
  if (event.type === "context_compression.assembly.completed") {
    stage = "assembly"
    assemblyStatus = "completed"
  }
  if (event.type === "context_compression.verification.started") {
    stage = "verification"
    verificationStatus = "running"
  }
  if (event.type === "context_compression.verification.completed") {
    stage = "verification"
    verificationStatus = "completed"
  }
  if (event.type === "context_compression.conversation.rebind.completed") {
    stage = "conversation_rebind"
    rebindCompleted = true
  }
  if (event.type === "context_compression.completed") {
    status = "completed"
    stage = "completed"
    completedAt = event.created_at
  }
  if (event.type === "context_compression.failed") {
    status = "failed"
    stage = "failed"
    completedAt = event.created_at
  }
  if (event.type === "context_compression.cancelled") {
    status = "cancelled"
    stage = "cancelled"
    completedAt = event.created_at
  }
  if (event.type === "context_compression.skipped") {
    status = "skipped"
    stage = "skipped"
    completedAt = event.created_at
  }
  if (currentIsTerminal && !isContextCompressionTerminalEvent(event.type)) {
    status = current.status
    stage = current.stage
    completedAt = current.completed_at
  }

  const compressedRange = recordValue(payload.compressed_range)
  const retainedTailRange = recordValue(payload.retained_tail_range)
  const currentWorkers = normalizeContextCompressionWorkers(current.workers)
  const incomingWorkers = workerPatch
    ? upsertContextCompressionWorker(currentWorkers, workerPatch)
    : currentWorkers
  const patch: ExecutionProcessContextCompressionMetadata = {
    id,
    job_id: jobId,
    status,
    stage,
    label: contextCompressionLabel(status),
    started_at: current.started_at ?? event.created_at,
    completed_at: completedAt,
    duration_ms: numberValue(payload.metrics?.duration_ms) ?? current.duration_ms,
    reason: payload.reason ?? current.reason ?? null,
    source_conversation_id: payload.source_conversation_id ?? current.source_conversation_id ?? null,
    target_conversation_id: payload.target_conversation_id ?? current.target_conversation_id ?? null,
    compression_index: payload.compression_index ?? current.compression_index ?? null,
    input_mode: payload.input_mode ?? payload.worker?.input_mode ?? current.input_mode ?? null,
    source_message_count: payload.source_message_count ?? current.source_message_count ?? null,
    compressed_range_start: numberValue(compressedRange?.start_index) ?? current.compressed_range_start ?? null,
    compressed_range_end: numberValue(compressedRange?.end_index) ?? current.compressed_range_end ?? null,
    retained_tail_range_start: numberValue(retainedTailRange?.start_index) ?? current.retained_tail_range_start ?? null,
    retained_tail_range_end: numberValue(retainedTailRange?.end_index) ?? current.retained_tail_range_end ?? null,
    retained_tail_message_count: payload.retained_tail_message_count ?? current.retained_tail_message_count ?? null,
    assembly_status: assemblyStatus,
    verification_status: verificationStatus,
    rebind_completed: rebindCompleted,
    workers: incomingWorkers,
    summary_message_id: payload.summary_message_id ?? current.summary_message_id ?? null,
    summary_message_index: payload.summary_message_index ?? current.summary_message_index ?? null,
    archive_job_id: payload.archive_job_id ?? current.archive_job_id ?? null,
    final_markdown: payload.final_markdown ?? current.final_markdown ?? null,
    final_markdown_status: payload.final_markdown
      ? "loaded"
      : current.final_markdown_status ?? "idle",
    final_markdown_error: current.final_markdown_error ?? null,
    error_type: payload.error_type ?? current.error_type ?? null,
    error_message: payload.error_message ?? current.error_message ?? null,
    communication_message_id: event.message_id,
    communication_seq: event.seq,
  }
  const merged = mergeExecutionProcessContextCompression(current, patch)
  return {
    ...metadata,
    bubble_kind: "context_compression",
    process_status: contextCompressionStatusToProcessStatus(merged.status),
    compression: merged,
  }
}

function contextCompressionStatusToProcessStatus(
  status: ExecutionProcessContextCompressionMetadata["status"],
): "streaming" | "completed" | "failed" {
  if (status === "running") return "streaming"
  if (status === "failed") return "failed"
  return "completed"
}

function contextCompressionWorkerPatch(
  event: AgentEvent,
  payload: ContextCompressionPayload,
): ExecutionProcessContextCompressionWorkerMetadata | null {
  if (!event.type.startsWith("context_compression.worker.")) return null
  const worker = payload.worker
  if (!worker) return null
  const id = contextCompressionWorkerId(event, payload)
  const status = event.type === "context_compression.worker.completed"
    ? "completed"
    : event.type === "context_compression.worker.failed"
      ? "failed"
      : event.type === "context_compression.worker.cancelled"
        ? "cancelled"
        : event.type === "context_compression.worker.started" || event.type === "context_compression.worker.progress" || event.type === "context_compression.worker.activity"
          ? "running"
          : "queued"
  const activity = normalizeContextCompressionWorkerActivity(worker.activity)
  const terminalWorkerEvent = status === "completed" || status === "cancelled" || status === "failed"
  return {
    id,
    name: contextCompressionWorkerDisplayName(worker as unknown as Record<string, unknown>, id),
    status,
    role: worker.role ?? null,
    output_section: worker.output_section ?? null,
    input_mode: worker.input_mode ?? null,
    round_index: worker.round_index ?? null,
    max_rounds: worker.max_rounds ?? null,
    provider_id: worker.provider_id ?? null,
    model_binding_id: worker.model_binding_id ?? null,
    reason: terminalWorkerEvent ? null : textValue(worker.reason),
    waited_ms: worker.concurrency?.waited_ms ?? undefined,
    duration_ms: terminalWorkerEvent ? worker.duration_ms ?? undefined : undefined,
    error_message: worker.error_message ?? null,
    activity: status === "running" ? activity : null,
    communication_message_id: event.message_id,
    communication_seq: event.seq,
  }
}

function isContextCompressionTerminalEvent(eventType: string): boolean {
  return eventType === "context_compression.completed" ||
    eventType === "context_compression.failed" ||
    eventType === "context_compression.cancelled" ||
    eventType === "context_compression.skipped"
}

function argumentsPreviewFromPayload(payload: LlmToolCallArgumentsPayload): Record<string, unknown> | null {
  if (payload.arguments_preview !== undefined) return payload.arguments_preview
  const argumentsText = payload.arguments ?? payload.arguments_partial
  if (!argumentsText) return null
  try {
    const parsed = JSON.parse(argumentsText)
    return recordValue(parsed) ?? { arguments: parsed }
  } catch {
    return { arguments: argumentsText }
  }
}

function llmIdFromPayload(event: AgentEvent, payload: { llm_request_id?: string; llm_call_id?: string }): string {
  return `llm-${payload.llm_call_id ?? payload.llm_request_id ?? event.message_id}`
}

export function executionProcessEventLlmId(event: AgentEvent): string | null {
  if (!event.type.startsWith("llm.") && !event.type.startsWith("tool.call.")) return null
  const payload = recordValue(event.payload)
  if (!payload) return null
  const llmCallId = textValue(payload.llm_call_id)
  const llmRequestId = textValue(payload.llm_request_id)
  if (!llmCallId && !llmRequestId) {
    if (!event.type.startsWith("llm.")) return null
  }
  return llmIdFromPayload(event, {
    llm_request_id: llmRequestId ?? undefined,
    llm_call_id: llmCallId ?? undefined,
  })
}

export function executionProcessHasLlm(metadata: ExecutionProcessMetadata, llmId: string): boolean {
  return metadata.iterations.some((iteration) => iteration.llm?.id === llmId)
}

export function executionProcessEventToolCallId(event: AgentEvent): string | null {
  if (!event.type.startsWith("llm.tool_call.") && !event.type.startsWith("tool.call.")) return null
  const payload = recordValue(event.payload)
  return textValue(payload?.tool_call_id)
}

export function executionProcessHasTool(metadata: ExecutionProcessMetadata, toolCallId: string): boolean {
  return metadata.iterations.some((iteration) => (
    iteration.tools.some((tool) => tool.tool_call_id === toolCallId)
  ))
}

export function executionProcessHasOpenActivity(metadata: ExecutionProcessMetadata): boolean {
  return metadata.iterations.some((iteration) => {
    const llm = iteration.llm
    if (llm && (llm.status === "waiting" || llm.status === "thinking")) return true
    return iteration.tools.some((tool) => tool.status === "running")
  })
}

export function findExecutionProcessMessageForEvent(
  messages: ChatMessage[],
  event: AgentEvent,
): ChatMessage | null {
  const llmId = executionProcessEventLlmId(event)
  const toolCallId = executionProcessEventToolCallId(event)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!isExecutionProcessMessage(message)) continue
    const metadata = normalizeExecutionProcessMetadata(message.content.metadata)
    if (llmId && executionProcessHasLlm(metadata, llmId)) return message
    if (toolCallId && executionProcessHasTool(metadata, toolCallId)) return message
  }
  return null
}

export function nextExecutionRound(previousTimelineMessage: ChatMessage | null | undefined): number {
  if (!previousTimelineMessage || isTaskBoundaryMessage(previousTimelineMessage)) return 1
  if (!isExecutionProcessMessage(previousTimelineMessage)) return 1
  const metadata = normalizeExecutionProcessMetadata(previousTimelineMessage.content.metadata)
  const storedEndRound = numberValue(metadata.execution_round_end)
  if (storedEndRound !== undefined && storedEndRound > 0) return storedEndRound + 1
  const storedRound = numberValue(metadata.execution_round)
  if (storedRound !== undefined && storedRound > 0) {
    return storedRound + Math.max(1, metadata.iterations.length)
  }
  return 1
}

function findExecutionProcessLlm(
  metadata: ExecutionProcessMetadata,
  llmId: string,
): ExecutionProcessLlmMetadata | undefined {
  return metadata.iterations.find((iteration) => (
    iteration.llm?.id === llmId
  ))?.llm
}

function upsertExecutionProcessLlm(
  metadata: ExecutionProcessMetadata,
  llm: ExecutionProcessLlmMetadata,
): ExecutionProcessMetadata {
  let updated = false
  const iterations = metadata.iterations.map((iteration) => {
    if (iteration.llm?.id !== llm.id) return iteration
    updated = true
    return { ...iteration, llm: mergeExecutionProcessLlm(iteration.llm, llm) }
  })
  if (updated) return { ...metadata, iterations }
  const openIterationIndex = iterations.findIndex(
    (iteration) => (
      (iteration.llm?.status === "waiting" || iteration.llm?.status === "thinking") &&
      !iteration.llm.llm_request_id &&
      !iteration.llm.llm_call_id
    ),
  )
  if (openIterationIndex >= 0) {
    const target = iterations[openIterationIndex]
    iterations[openIterationIndex] = {
      ...target,
      llm: mergeExecutionProcessLlm(target.llm, llm),
    }
    return { ...metadata, iterations }
  }
  const lastIteration = iterations[iterations.length - 1]
  if (lastIteration && !lastIteration.llm) {
    iterations[iterations.length - 1] = { ...lastIteration, llm }
    return { ...metadata, iterations }
  }
  const iteration: ExecutionProcessIterationMetadata = {
    id: `iteration-${llm.id}`,
    index: iterations.length + 1,
    llm,
    tools: [],
  }
  iterations.push(iteration)
  return { ...metadata, iterations }
}

function mergeExecutionProcessLlm(
  current: ExecutionProcessLlmMetadata | undefined,
  patch: ExecutionProcessLlmMetadata,
): ExecutionProcessLlmMetadata {
  if (!current) return patch
  const startsNewAttempt = patch.status === "waiting"
    && !!patch.llm_request_id
    && patch.llm_request_id !== current.llm_request_id
  return {
    ...current,
    ...patch,
    id: current.id,
    model_alias: patch.model_alias ?? current.model_alias,
    started_at: current.started_at ?? patch.started_at,
    completed_at: startsNewAttempt ? patch.completed_at : patch.completed_at ?? current.completed_at,
    duration_ms: startsNewAttempt ? patch.duration_ms : patch.duration_ms ?? current.duration_ms,
    tool_use_count: patch.tool_use_count ?? current.tool_use_count,
    token_usage: patch.token_usage ?? current.token_usage,
    context_window_max: patch.context_window_max ?? current.context_window_max,
    response_started: current.response_started || patch.response_started,
    thinking_started: current.thinking_started || patch.thinking_started,
    thinking_completed: current.thinking_completed || patch.thinking_completed,
    content_started: current.content_started || patch.content_started,
    content_completed: current.content_completed || patch.content_completed,
    latest_output_kind: patch.latest_output_kind ?? current.latest_output_kind,
    generated_tool_call_count: patch.generated_tool_call_count ?? current.generated_tool_call_count,
    error_message: startsNewAttempt ? patch.error_message : patch.error_message ?? current.error_message,
    llm_call_id: patch.llm_call_id ?? current.llm_call_id,
    llm_request_id: patch.llm_request_id ?? current.llm_request_id,
    candidate_index: patch.candidate_index ?? current.candidate_index,
    api_key_index: patch.api_key_index ?? current.api_key_index,
    api_key_label: patch.api_key_label ?? current.api_key_label,
    retry_index: mergeMonotonicAttemptNumber(current.retry_index, patch.retry_index),
    attempt_count: mergeMonotonicAttemptNumber(current.attempt_count, patch.attempt_count) ?? undefined,
    communication_message_id: patch.communication_message_id,
    communication_seq: patch.communication_seq,
  }
}

function mergeMonotonicAttemptNumber(
  current: number | null | undefined,
  patch: number | null | undefined,
): number | null | undefined {
  if (typeof current === "number" && typeof patch === "number") return Math.max(current, patch)
  if (typeof patch === "number") return patch
  return current ?? patch
}

function upsertExecutionProcessTool(
  metadata: ExecutionProcessMetadata,
  patch: ExecutionProcessToolMetadata,
  ownerLlmId?: string,
): ExecutionProcessMetadata {
  let updated = false
  const iterations = metadata.iterations.map((iteration) => {
    const toolIndex = iteration.tools.findIndex((tool) => tool.tool_call_id === patch.tool_call_id)
    if (toolIndex < 0) return iteration
    const tools = [...iteration.tools]
    const current = tools[toolIndex]
    tools[toolIndex] = {
      ...current,
      ...patch,
      tool_name: patch.tool_name === patch.tool_call_id ? current.tool_name : patch.tool_name,
      title: patch.title === patch.tool_call_id ? current.title : patch.title,
      started_at: patch.started_at ?? current.started_at,
      arguments_preview: patch.arguments_preview ?? current.arguments_preview,
      result_preview: patch.result_preview ?? current.result_preview,
      ui_preview: patch.ui_preview ?? current.ui_preview,
      terminal_session_id: patch.terminal_session_id ?? current.terminal_session_id,
      source: patch.source ?? current.source,
    }
    updated = true
    return { ...iteration, tools }
  })
  if (updated) return { ...metadata, iterations }
  if (!ownerLlmId) {
    const lastIteration = iterations[iterations.length - 1]
    if (lastIteration) {
      iterations[iterations.length - 1] = {
        ...lastIteration,
        tools: [...lastIteration.tools, patch],
      }
      return { ...metadata, iterations }
    }
    return metadata
  }
  const rawId = ownerLlmId.startsWith("llm-") ? ownerLlmId.slice(4) : ownerLlmId
  const ownerIndex = iterations.findIndex((iteration) => (
    iteration.llm?.id === ownerLlmId ||
    iteration.llm?.llm_call_id === ownerLlmId ||
    iteration.llm?.llm_call_id === rawId ||
    iteration.id === `iteration-${ownerLlmId}` ||
    iteration.id === `iteration-${rawId}`
  ))
  if (ownerIndex < 0) {
    const lastIteration = iterations[iterations.length - 1]
    if (lastIteration) {
      iterations[iterations.length - 1] = {
        ...lastIteration,
        tools: [...lastIteration.tools, patch],
      }
      return { ...metadata, iterations }
    }
    return metadata
  }
  const owner = iterations[ownerIndex]
  iterations[ownerIndex] = { ...owner, tools: [...owner.tools, patch] }
  return { ...metadata, iterations }
}

function mergeExecutionProcessContextCompression(
  current: ExecutionProcessContextCompressionMetadata,
  patch: ExecutionProcessContextCompressionMetadata,
): ExecutionProcessContextCompressionMetadata {
  const workers = mergeContextCompressionWorkerCollections(current.workers, patch.workers)
  if (patch.communication_seq < current.communication_seq) {
    return { ...current, workers }
  }
  return {
    ...current,
    ...patch,
    id: current.id,
    job_id: current.job_id,
    started_at: current.started_at ?? patch.started_at,
    completed_at: patch.completed_at ?? current.completed_at,
    duration_ms: patch.duration_ms ?? current.duration_ms,
    reason: patch.reason ?? current.reason,
    source_conversation_id: patch.source_conversation_id ?? current.source_conversation_id,
    target_conversation_id: patch.target_conversation_id ?? current.target_conversation_id,
    compression_index: patch.compression_index ?? current.compression_index,
    input_mode: patch.input_mode ?? current.input_mode,
    source_message_count: patch.source_message_count ?? current.source_message_count,
    compressed_range_start: patch.compressed_range_start ?? current.compressed_range_start,
    compressed_range_end: patch.compressed_range_end ?? current.compressed_range_end,
    retained_tail_range_start: patch.retained_tail_range_start ?? current.retained_tail_range_start,
    retained_tail_range_end: patch.retained_tail_range_end ?? current.retained_tail_range_end,
    retained_tail_message_count: patch.retained_tail_message_count ?? current.retained_tail_message_count,
    assembly_status: patch.assembly_status ?? current.assembly_status,
    verification_status: patch.verification_status ?? current.verification_status,
    rebind_completed: current.rebind_completed || patch.rebind_completed,
    workers,
    summary_message_id: patch.summary_message_id ?? current.summary_message_id,
    summary_message_index: patch.summary_message_index ?? current.summary_message_index,
    archive_job_id: patch.archive_job_id ?? current.archive_job_id,
    final_markdown: patch.final_markdown ?? current.final_markdown,
    final_markdown_status: patch.final_markdown_status ?? current.final_markdown_status,
    final_markdown_error: patch.final_markdown_error ?? current.final_markdown_error,
    error_type: patch.error_type ?? current.error_type,
    error_message: patch.error_message ?? current.error_message,
    communication_message_id: patch.communication_message_id,
    communication_seq: patch.communication_seq,
  }
}

function mergeContextCompressionWorkerCollections(
  currentWorkers: ExecutionProcessContextCompressionWorkerMetadata[],
  patchWorkers: ExecutionProcessContextCompressionWorkerMetadata[],
): ExecutionProcessContextCompressionWorkerMetadata[] {
  return normalizeContextCompressionWorkers([...currentWorkers, ...patchWorkers])
}

function upsertContextCompressionWorker(
  workers: ExecutionProcessContextCompressionWorkerMetadata[],
  patch: ExecutionProcessContextCompressionWorkerMetadata,
): ExecutionProcessContextCompressionWorkerMetadata[] {
  const normalizedWorkers = normalizeContextCompressionWorkers(workers)
  const normalizedPatch = normalizeContextCompressionWorker(patch)
  let updated = false
  const next = normalizedWorkers.map((worker) => {
    if (worker.id !== normalizedPatch.id) return worker
    updated = true
    return mergeContextCompressionWorker(worker, normalizedPatch)
  })
  if (!updated) next.push(normalizedPatch)
  return next
}

function normalizeContextCompressionWorkers(
  workers: ExecutionProcessContextCompressionWorkerMetadata[],
): ExecutionProcessContextCompressionWorkerMetadata[] {
  const sortedByEventSeq = workers
    .map((worker) => normalizeContextCompressionWorker(worker))
    .sort((left, right) => left.communication_seq - right.communication_seq)
  const merged: ExecutionProcessContextCompressionWorkerMetadata[] = []
  for (const worker of sortedByEventSeq) {
    const index = merged.findIndex((item) => item.id === worker.id)
    if (index < 0) {
      merged.push(worker)
    } else {
      merged[index] = mergeContextCompressionWorker(merged[index], worker)
    }
  }
  // Worker 状态仍按事件序号合并，但展示顺序必须按业务流程固定，避免 activity/progress 刷新导致卡片跳位。
  return sortContextCompressionWorkersByStableOrder(merged)
}

function normalizeContextCompressionWorker(
  worker: ExecutionProcessContextCompressionWorkerMetadata,
): ExecutionProcessContextCompressionWorkerMetadata {
  const record: Record<string, unknown> = {
    id: worker.id,
    name: worker.name,
    role: worker.role,
    output_section: worker.output_section,
  }
  const id = contextCompressionCanonicalWorkerId(record, worker.id)
  return {
    ...worker,
    id,
    name: contextCompressionWorkerDisplayName(record, id),
  }
}

function mergeContextCompressionWorker(
  worker: ExecutionProcessContextCompressionWorkerMetadata,
  patch: ExecutionProcessContextCompressionWorkerMetadata,
): ExecutionProcessContextCompressionWorkerMetadata {
  if (patch.communication_seq < worker.communication_seq) return worker
  const mergedStatus = mergeContextCompressionWorkerStatus(worker.status, patch.status)
  const staleRunningPatch = worker.status !== "running" && patch.status === "running"
  const terminalPatch = patch.status === "completed" || patch.status === "cancelled" || patch.status === "failed"
  return {
    ...worker,
    ...patch,
    status: mergedStatus,
    name: patch.name ?? worker.name,
    role: patch.role ?? worker.role,
    output_section: patch.output_section ?? worker.output_section,
    input_mode: patch.input_mode ?? worker.input_mode,
    round_index: patch.round_index ?? worker.round_index,
    max_rounds: patch.max_rounds ?? worker.max_rounds,
    provider_id: patch.provider_id ?? worker.provider_id,
    model_binding_id: patch.model_binding_id ?? worker.model_binding_id,
    reason: patch.reason === undefined ? worker.reason : patch.reason,
    waited_ms: patch.waited_ms ?? worker.waited_ms,
    duration_ms: terminalPatch && !staleRunningPatch ? patch.duration_ms ?? worker.duration_ms : worker.duration_ms,
    error_message: staleRunningPatch ? worker.error_message : patch.error_message ?? worker.error_message,
    activity: mergedStatus === "running" ? patch.activity ?? worker.activity : null,
    communication_message_id: patch.communication_message_id,
    communication_seq: patch.communication_seq,
  }
}

function mergeContextCompressionWorkerStatus(
  current: ExecutionProcessContextCompressionWorkerMetadata["status"],
  patch: ExecutionProcessContextCompressionWorkerMetadata["status"],
): ExecutionProcessContextCompressionWorkerMetadata["status"] {
  if (current === "failed") return "failed"
  if (current === "cancelled") return "cancelled"
  if (current === "completed" && (patch === "queued" || patch === "running")) return "completed"
  return patch
}

// ── metadata 派生属性 ─────────────────────────────────────────────────

/** 计算 ExecutionProcess metadata 的 process_status。 */
export function executionProcessStatus(metadata: ExecutionProcessMetadata): "streaming" | "completed" | "failed" {
  const tools = metadata.iterations.flatMap((iteration) => iteration.tools)
  if (tools.some((tool) => tool.status === "running")) return "streaming"
  const llms = metadata.iterations.flatMap((iteration) => (iteration.llm ? [iteration.llm] : []))
  if (llms.some((llm) => llm.status === "waiting" || llm.status === "thinking")) return "streaming"
  if (tools.some((tool) => tool.status === "failed" || tool.status === "cancelled")) return "failed"
  if (llms.some((llm) => llm.status === "failed" || llm.status === "cancelled")) return "failed"
  return "completed"
}

/** 生成执行过程气泡的纯文本摘要，用于 chat bubble 的 text 字段。 */
export function executionProcessText(metadata: ExecutionProcessMetadata): string {
  const iterationCount = metadata.iterations.length
  const toolCount = metadata.iterations.reduce((sum, iteration) => sum + iteration.tools.length, 0)
  if (iterationCount > 0 && toolCount > 0) return `Agent 执行过程：${iterationCount} 轮 LLM 响应，${toolCount} 个工具调用`
  if (iterationCount > 0) return `Agent 执行过程：${iterationCount} 轮 LLM 响应`
  return "Agent 执行过程"
}

/** 计算上下文压缩气泡的 process_status，用于 chat bubble status 字段。 */
export function contextCompressionBubbleStatus(metadata: ContextCompressionBubbleMetadata): "streaming" | "completed" | "failed" {
  return contextCompressionStatusToProcessStatus(metadata.compression.status)
}

/** 生成上下文压缩气泡的纯文本摘要，用于 chat bubble 的 text 字段。 */
export function contextCompressionBubbleText(metadata: ContextCompressionBubbleMetadata): string {
  const indexLabel = metadata.compression.compression_index !== null && metadata.compression.compression_index !== undefined
    ? `（#${metadata.compression.compression_index}）`
    : ""
  return `${metadata.compression.label}${indexLabel}`
}

export function taskBoundaryBubbleText(metadata: TaskBoundaryMetadata): string {
  return metadata.failure_message ? `${metadata.label}：${metadata.failure_message}` : metadata.label
}

// ── metadata → view-model parser（渲染用） ────────────────────────────

/** 把 chat bubble metadata 解析为 MessageList 渲染需要的迭代视图列表。 */
export function parseExecutionProcessIterations(metadata: Record<string, unknown>): ExecutionProcessIterationView[] {
  const rawIterations = Array.isArray(metadata.iterations) ? metadata.iterations : []
  return rawIterations.flatMap((rawIteration, index) => {
    const iteration = recordValue(rawIteration)
    if (!iteration) return []
    const llm = parseExecutionProcessLlm(iteration.llm)
    const tools = Array.isArray(iteration.tools)
      ? iteration.tools.flatMap((tool) => parseExecutionProcessTool(tool))
      : []
    if (!llm && tools.length === 0) return []
    return [{
      id: textValue(iteration.id) ?? `iteration-${index + 1}`,
      index: numberValue(iteration.index) ?? index + 1,
      ...(llm ? { llm } : {}),
      tools,
    }]
  })
}

/**
 * 把上下文压缩气泡 metadata 解析为 MessageList 渲染需要的 view。
 * 返回 null 表示 metadata 中不含有效的 compression 字段。
 */
export function parseContextCompressionBubble(metadata: Record<string, unknown>): ExecutionProcessContextCompressionView | null {
  const compressions = parseContextCompressionFromRecord(metadata.compression)
  if (compressions.length === 0) return null
  return compressions[0]
}

export function parseTaskBoundary(metadata: Record<string, unknown>): TaskBoundaryView | null {
  const status = metadata.task_status === "cancelled" ? "cancelled" : metadata.task_status === "failed" ? "failed" : metadata.task_status === "completed" ? "completed" : null
  if (!status) return null
  const completedAt = textValue(metadata.completed_at)
  if (!completedAt) return null
  return {
    status,
    label: textValue(metadata.label) ?? taskBoundaryLabel(status),
    completedAt,
    taskId: textValue(metadata.task_id),
    agentInstanceId: textValue(metadata.agent_instance_id),
    conversationId: textValue(metadata.conversation_id),
    failureMessage: textValue(metadata.failure_message),
  }
}

function parseContextCompressionFromRecord(rawCompression: unknown): ExecutionProcessContextCompressionView[] {
  const compression = recordValue(rawCompression)
  if (!compression) return []
  const id = textValue(compression.id)
  const jobId = textValue(compression.job_id)
  if (!id || !jobId) return []
  const status = compression.status === "completed"
      ? "completed"
      : compression.status === "failed"
        ? "failed"
        : compression.status === "cancelled"
          ? "cancelled"
          : compression.status === "skipped"
            ? "skipped"
            : "running"
    const stage = textValue(compression.stage) ?? "started"
    const rawWorkers = Array.isArray(compression.workers) ? compression.workers : []
    return [{
      id,
      jobId,
      status,
      stage,
      label: textValue(compression.label) ?? contextCompressionLabel(status),
      stageLabel: contextCompressionStageLabel(stage),
      durationMs: numberValue(compression.duration_ms),
      reason: textValue(compression.reason),
      sourceConversationId: textValue(compression.source_conversation_id),
      targetConversationId: textValue(compression.target_conversation_id),
      compressionIndex: numberValue(compression.compression_index) ?? null,
      inputMode: textValue(compression.input_mode),
      sourceMessageCount: numberValue(compression.source_message_count) ?? null,
      compressedRangeStart: numberValue(compression.compressed_range_start) ?? null,
      compressedRangeEnd: numberValue(compression.compressed_range_end) ?? null,
      retainedTailRangeStart: numberValue(compression.retained_tail_range_start) ?? null,
      retainedTailRangeEnd: numberValue(compression.retained_tail_range_end) ?? null,
      retainedTailMessageCount: numberValue(compression.retained_tail_message_count) ?? null,
      assemblyStatus: compression.assembly_status === "completed" ? "completed" : compression.assembly_status === "running" ? "running" : undefined,
      verificationStatus: compression.verification_status === "completed" ? "completed" : compression.verification_status === "running" ? "running" : undefined,
      rebindCompleted: compression.rebind_completed === true,
      workers: normalizeContextCompressionWorkerViews(rawWorkers.flatMap((worker) => parseExecutionProcessContextCompressionWorker(worker))),
      summaryMessageId: textValue(compression.summary_message_id),
      summaryMessageIndex: numberValue(compression.summary_message_index) ?? null,
      archiveJobId: textValue(compression.archive_job_id),
      finalMarkdown: textValue(compression.final_markdown),
      finalMarkdownStatus: compression.final_markdown_status === "loaded"
        ? "loaded"
        : compression.final_markdown_status === "loading"
          ? "loading"
          : compression.final_markdown_status === "failed"
            ? "failed"
            : "idle",
      finalMarkdownError: textValue(compression.final_markdown_error),
      errorMessage: textValue(compression.error_message),
    }]
}

function parseExecutionProcessContextCompressionWorker(value: unknown): ExecutionProcessContextCompressionWorkerView[] {
  const worker = recordValue(value)
  if (!worker) return []
  const rawId = textValue(worker.id) ?? textValue(worker.name) ?? textValue(worker.output_section)
  if (!rawId) return []
  const id = contextCompressionCanonicalWorkerId(worker, rawId)
  const status = worker.status === "completed"
    ? "completed"
    : worker.status === "failed"
      ? "failed"
      : worker.status === "cancelled"
        ? "cancelled"
        : worker.status === "running"
          ? "running"
          : "queued"
  return [{
    id,
    name: contextCompressionWorkerDisplayName(worker, id),
    status,
    role: textValue(worker.role),
    outputSection: textValue(worker.output_section),
    inputMode: textValue(worker.input_mode),
    providerId: textValue(worker.provider_id),
    modelBindingId: textValue(worker.model_binding_id),
    reason: textValue(worker.reason),
    waitedMs: numberValue(worker.waited_ms),
    durationMs: numberValue(worker.duration_ms),
    errorMessage: textValue(worker.error_message),
    activityText: status === "running" ? textValue(recordValue(worker.activity)?.text) : null,
  }]
}

function normalizeContextCompressionWorkerViews(
  workers: ExecutionProcessContextCompressionWorkerView[],
): ExecutionProcessContextCompressionWorkerView[] {
  const merged: ExecutionProcessContextCompressionWorkerView[] = []
  for (const worker of workers) {
    const record: Record<string, unknown> = {
      id: worker.id,
      name: worker.name,
      role: worker.role,
      output_section: worker.outputSection,
    }
    const normalizedWorker: ExecutionProcessContextCompressionWorkerView = {
      ...worker,
      id: contextCompressionCanonicalWorkerId(record, worker.id),
      name: contextCompressionWorkerDisplayName(record, worker.id),
    }
    const index = merged.findIndex((item) => item.id === normalizedWorker.id)
    if (index < 0) {
      merged.push(normalizedWorker)
      continue
    }
    merged[index] = mergeContextCompressionWorkerView(merged[index], normalizedWorker)
  }
  return sortContextCompressionWorkersByStableOrder(merged)
}

function mergeContextCompressionWorkerView(
  worker: ExecutionProcessContextCompressionWorkerView,
  patch: ExecutionProcessContextCompressionWorkerView,
): ExecutionProcessContextCompressionWorkerView {
  const status = mergeContextCompressionWorkerStatus(worker.status, patch.status)
  return {
    ...worker,
    ...patch,
    status,
    name: patch.name ?? worker.name,
    role: patch.role ?? worker.role,
    outputSection: patch.outputSection ?? worker.outputSection,
    inputMode: patch.inputMode ?? worker.inputMode,
    providerId: patch.providerId ?? worker.providerId,
    modelBindingId: patch.modelBindingId ?? worker.modelBindingId,
    reason: patch.reason ?? worker.reason,
    waitedMs: patch.waitedMs ?? worker.waitedMs,
    durationMs: patch.durationMs ?? worker.durationMs,
    errorMessage: patch.errorMessage ?? worker.errorMessage,
    activityText: status === "running" ? patch.activityText ?? worker.activityText : null,
  }
}

function parseExecutionProcessLlm(value: unknown): ExecutionProcessLlmView | undefined {
  const llm = recordValue(value)
  if (!llm) return undefined
  const id = textValue(llm.id) ?? textValue(llm.communication_message_id)
  if (!id) return undefined
  const status = llm.status === "cancelled"
    ? "cancelled"
    : llm.status === "failed"
      ? "failed"
      : llm.status === "completed"
        ? "completed"
        : llm.status === "thinking"
          ? "thinking"
          : "waiting"
  const responseStarted = llm.response_started === true
  const thinkingStarted = llm.thinking_started === true
  const thinkingCompleted = llm.thinking_completed === true
  const contentStarted = llm.content_started === true
  const contentCompleted = llm.content_completed === true
  const latestOutputKind = llm.latest_output_kind === "tool" ? "tool" : llm.latest_output_kind === "text" ? "text" : undefined
  const tokenUsage = llm.token_usage
  const apiKeyIndex = numberValue(llm.api_key_index)
  const apiKeyLabel = textValue(llm.api_key_label)
  const retryIndex = numberValue(llm.retry_index)
  return {
    id,
    status,
    label: llmLabelFromState({
      status,
      responseStarted,
      thinkingStarted,
      thinkingCompleted,
      contentStarted,
      contentCompleted,
      latestOutputKind,
      tokenUsage,
    }),
    modelAlias: textValue(llm.model_alias) ?? undefined,
    durationMs: numberValue(llm.duration_ms),
    errorMessage: textValue(llm.error_message) ?? undefined,
    responseStarted,
    thinkingStarted,
    thinkingCompleted,
    contentStarted,
    contentCompleted,
    latestOutputKind,
    attemptLabel: llmAttemptLabel(apiKeyIndex, apiKeyLabel, retryIndex),
    llmRequestId: textValue(llm.llm_request_id) ?? undefined,
  }
}

function parseExecutionProcessTool(value: unknown): ExecutionProcessToolView[] {
  const tool = recordValue(value)
  if (!tool) return []
  const toolCallId = textValue(tool.tool_call_id)
  const toolName = textValue(tool.tool_name)
  if (!toolCallId || !toolName) return []
  const status = tool.status === "cancelled" ? "cancelled" : tool.status === "failed" ? "failed" : tool.status === "completed" ? "completed" : "running"
  return [{
    toolCallId,
    toolName,
    title: textValue(tool.title) ?? toolName,
    status,
    durationMs: numberValue(tool.duration_ms),
    errorMessage: textValue(tool.error_message) ?? undefined,
    argumentsPreview: recordValue(tool.arguments_preview) ?? null,
    resultPreview: tool.result_preview ?? null,
    uiPreview: recordValue(tool.ui_preview) ?? null,
    source: textValue(tool.source),
  }]
}
