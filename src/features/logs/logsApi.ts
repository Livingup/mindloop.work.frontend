import { requestJson } from "@/shared/api/httpClient"

export type LlmHttpTraceLifecycleEvent = {
  sequence: number
  kind: string
  timestamp: string
  redacted: boolean
  byte_count: number | null
  data_byte_count: number | null
  status: string | null
  error_code: string | null
}

export type LlmHttpTraceCallbackEvent = {
  request_id: string
  attempt_id: string
  account_id: string | null
  scope: string
  origin: string | null
  kind: string
  sequence: number
  timestamp: string
  payload: Record<string, unknown>
}

export type LlmHttpTraceUpstreamAttempt = {
  sdk_request_id: string
  attempt_id: string
  attempt_index: number
  attempt_kind: string
  account_fingerprint: string | null
  status: string
  method: string
  url: string
  request_headers: Record<string, string>
  request_body_text: string
  request_body_bytes: number
  request_body_truncated: boolean
  request_body_redacted: boolean
  status_code: number | null
  response_headers: Record<string, string>
  response_body_text: string | null
  response_body_bytes: number
  response_body_truncated: boolean
  response_body_redacted: boolean
  response_content_type: string | null
  is_stream: boolean
  sse_event_count: number
  error_type: string | null
  error_message: string | null
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  raw_request_text: string | null
  raw_response_text: string | null
  lifecycle_events: LlmHttpTraceLifecycleEvent[]
  lifecycle_event_count: number
  lifecycle_truncated: boolean
  account_id: string | null
  request_header_pairs: Array<[string, string]>
  request_body_base64: string | null
  response_header_pairs: Array<[string, string]>
  response_body_chunks_base64: string[]
  sse_frames_base64: string[]
  sse_data_base64: Array<string | null>
  sse_frame_bytes: number
  sse_data_bytes: number
  terminal_error: Record<string, unknown> | null
  callback_events: LlmHttpTraceCallbackEvent[]
  capture_complete: boolean
  capture_error: string | null
  capture_source: string
  socket_level_wire: boolean | null
}

export type LlmHttpTrace = {
  llm_request_id: string
  llm_call_id: string
  conversation_id: string | null
  task_id: string | null
  instance_id: string | null
  trace_id: string | null
  provider_id: string | null
  binding_id: string | null
  model_id: string | null
  model_alias: string | null
  api_format: string | null
  candidate_index: number | null
  api_key_index: number | null
  retry_index: number | null
  attempt_count: number | null
  status: string
  method: string
  url: string
  request_headers: Record<string, string>
  request_body_text: string
  request_body_bytes: number
  request_body_truncated: boolean
  status_code: number | null
  response_headers: Record<string, string>
  response_body_text: string | null
  response_body_bytes: number
  response_body_truncated: boolean
  response_content_type: string | null
  is_stream: boolean
  sse_event_count: number | null
  error_type: string | null
  error_message: string | null
  started_at: string
  completed_at: string | null
  duration_ms: number | null
  raw_request_text: string | null
  raw_response_text: string | null
  request_body_redacted: boolean
  response_body_redacted: boolean
  upstream_attempts: LlmHttpTraceUpstreamAttempt[]
  truncated: boolean
  request_body_json: unknown | null
  response_body_json: unknown | null
}

export type LogsOverviewItem = {
  store_id: string
  title: string
  size_bytes: number
  record_count: number
  path: string
  available: boolean
}

export type LogsOverview = {
  items: LogsOverviewItem[]
  total_size_bytes: number
}

export type LogsCleanupCategory =
  | "communication_messages"
  | "chat_bubbles"
  | "llm_http_trace"
  | "context_compression_archive"
  | "terminal_history"

export type LogsLifecycleFilter = "ended_tasks" | "archived_scenes"

export type LogsSpaceReleaseMode = "logical_only" | "safe_physical_release"

export type LogsCleanupRequest = {
  lifecycle_filters: LogsLifecycleFilter[]
  categories: LogsCleanupCategory[]
  space_release_mode: LogsSpaceReleaseMode
  release_only?: boolean
}

export type LogsPendingCompactionSummary = {
  store_id: LogsCleanupCategory | string
  status: string
  error_code: string | null
  message: string | null
  epoch: string | null
  compact_target_size_bytes: number | null
  available_bytes: number | null
  freelist_potential_bytes: number | null
  auto_vacuum_mode: string | null
  page_size_bytes: number | null
  page_count: number | null
  freelist_count: number | null
}

export type LogsCapabilities = {
  supported_space_release_modes: LogsSpaceReleaseMode[]
  release_only_retry_supported: boolean
  pending_compaction_count: number
  pending_compactions: LogsPendingCompactionSummary[]
}

export type LogsCleanupCategoryResult = {
  category: LogsCleanupCategory
  label: string
  matched_count: number
  deleted_count: number
  archive_files_deleted_count: number
}

export type LogsCleanupStoreSpaceRelease = {
  store_id: LogsCleanupCategory
  eligible: boolean
  status: "released" | "completed" | "skipped_no_changes" | "not_available" | "busy" | "timeout" | "insufficient_disk_space" | "permission_denied" | "io_error" | "failed" | "preview_only" | "requires_runtime_restart" | "requires_more_space"
  vacuum_started: boolean
  compaction_pending: boolean
  compact_copy_started: boolean
  compact_output_size_bytes: number | null
  compact_target_size_bytes: number | null
  required_compact_target_size_bytes: number | null
  pending_manifest_epoch: string | null
  required_working_bytes: number | null
  available_bytes: number | null
  page_size_bytes: number | null
  page_count: number | null
  freelist_count: number | null
  auto_vacuum_mode: string | null
  freelist_potential_bytes: number | null
  before_size_bytes: number | null
  after_size_bytes: number | null
  reclaimed_size_bytes: number
  net_size_change_bytes: number
  before_db_size_bytes: number | null
  after_db_size_bytes: number | null
  before_wal_size_bytes: number | null
  after_wal_size_bytes: number | null
  before_shm_size_bytes: number | null
  after_shm_size_bytes: number | null
  error_code: string | null
  message: string | null
}

export type LogsCleanupSpaceRelease = {
  requested_mode: LogsSpaceReleaseMode
  status: "not_requested" | "preview_only" | "completed" | "partial" | "skipped_no_changes" | "deferred_busy" | "failed" | "requires_runtime_restart" | "requires_more_space"
  eligible_store_count: number
  before_total_size_bytes: number | null
  after_total_size_bytes: number | null
  reclaimed_size_bytes: number
  net_size_change_bytes: number
  freelist_potential_bytes: number
  compact_target_size_bytes: number | null
  required_compact_target_size_bytes: number | null
  compact_output_size_bytes: number | null
  compaction_pending: boolean
  pending_compaction_count: number
  stores: LogsCleanupStoreSpaceRelease[]
  warnings: string[]
}

export type LogsCleanupMode = "preview" | "execute"

export type LogsCleanupResponse = {
  mode: LogsCleanupMode
  space_release_mode: LogsSpaceReleaseMode
  release_only: boolean
  lifecycle_filters: LogsLifecycleFilter[]
  categories: LogsCleanupCategory[]
  scope: {
    task_count: number
    scene_count: number
  }
  category_results: LogsCleanupCategoryResult[]
  total_matched_count: number
  total_deleted_count: number
  logical_delete_committed: boolean
  cleanup_outcome: string
  space_release: LogsCleanupSpaceRelease | null
}

export type LogsCleanupJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled"

export type LogsCleanupJob = {
  job_id: string
  mode: LogsCleanupMode
  status: LogsCleanupJobStatus
  space_release_mode: LogsSpaceReleaseMode
  phase: "resolving_scope" | "deleting_data" | "releasing_space" | "compact_copying" | "swapping" | "reopening" | "completed" | "failed"
  active_store_id: LogsCleanupCategory | null
  release_only: boolean
  lifecycle_filters: LogsLifecycleFilter[]
  categories: LogsCleanupCategory[]
  created_at: string
  updated_at: string
  started_at: string | null
  completed_at: string | null
  result: LogsCleanupResponse | null
  error_message: string | null
}

export type LogsCleanupJobsResponse = {
  items: LogsCleanupJob[]
  active_count: number
  volatile: boolean
  retention_note: string
}

export function getLlmHttpTrace(llmRequestId: string): Promise<LlmHttpTrace> {
  return requestJson<LlmHttpTrace>(`/api/llm-http-traces/${encodeURIComponent(llmRequestId)}`)
}

export function getLogsOverview(): Promise<LogsOverview> {
  return requestJson<LogsOverview>("/api/logs/overview")
}

export function getLogsCapabilities(): Promise<LogsCapabilities> {
  return requestJson<LogsCapabilities>("/api/logs/capabilities")
}

export function createLogsCleanupJob(mode: LogsCleanupMode, request: LogsCleanupRequest): Promise<LogsCleanupJob> {
  return requestJson<unknown>("/api/logs/cleanup/jobs", {
    method: "POST",
    body: { mode, ...request },
  }).then(normalizeLogsCleanupJob)
}

export function getLogsCleanupJobs(options: { limit?: number; activeOnly?: boolean } = {}): Promise<LogsCleanupJobsResponse> {
  const params = new URLSearchParams()
  if (options.limit !== undefined) params.set("limit", String(options.limit))
  if (options.activeOnly !== undefined) params.set("active_only", String(options.activeOnly))
  const query = params.toString()
  return requestJson<unknown>(`/api/logs/cleanup/jobs${query ? `?${query}` : ""}`).then((payload) => {
    const record = asRecord(payload)
    const items = Array.isArray(record?.items) ? record.items.map(normalizeLogsCleanupJob) : []
    return {
      items,
      active_count: numberValue(record?.active_count),
      volatile: record?.volatile !== false,
      retention_note: stringValue(record?.retention_note) ?? "仅显示当前 Runtime 进程内的未完成清理任务。",
    }
  })
}

export function getLogsCleanupJob(jobId: string): Promise<LogsCleanupJob> {
  return requestJson<unknown>(`/api/logs/cleanup/jobs/${encodeURIComponent(jobId)}`).then(normalizeLogsCleanupJob)
}

function normalizeLogsCleanupJob(payload: unknown): LogsCleanupJob {
  const record = asRecord(payload) ?? {}
  const status = cleanupJobStatusValue(record.status)
  const mode = cleanupModeValue(record.mode)
  return {
    job_id: stringValue(record.job_id) ?? "",
    mode,
    status,
    space_release_mode: spaceReleaseModeValue(record.space_release_mode),
    phase: phaseValue(record.phase, status),
    active_store_id: categoryValue(record.active_store_id),
    release_only: record.release_only === true,
    lifecycle_filters: lifecycleFiltersValue(record.lifecycle_filters),
    categories: categoriesValue(record.categories),
    created_at: stringValue(record.created_at) ?? new Date(0).toISOString(),
    updated_at: stringValue(record.updated_at) ?? new Date(0).toISOString(),
    started_at: stringValue(record.started_at),
    completed_at: stringValue(record.completed_at),
    result: record.result == null ? null : normalizeLogsCleanupResponse(record.result),
    error_message: stringValue(record.error_message),
  }
}

function normalizeLogsCleanupResponse(payload: unknown): LogsCleanupResponse {
  const record = asRecord(payload) ?? {}
  const mode = cleanupModeValue(record.mode)
  const spaceReleaseMode = spaceReleaseModeValue(record.space_release_mode)
  const categories = categoriesValue(record.categories)
  const rawCategoryResults = Array.isArray(record.category_results) ? record.category_results : []
  const categoryResults = rawCategoryResults.map((item) => {
    const categoryRecord = asRecord(item) ?? {}
    const category = categoryValue(categoryRecord.category) ?? "communication_messages"
    return {
      category,
      label: stringValue(categoryRecord.label) ?? category,
      matched_count: numberValue(categoryRecord.matched_count),
      deleted_count: numberValue(categoryRecord.deleted_count),
      archive_files_deleted_count: numberValue(categoryRecord.archive_files_deleted_count),
    }
  })
  const spaceRelease = record.space_release == null
    ? spaceReleaseMode === "logical_only"
      ? normalizeLogsCleanupSpaceRelease(null, spaceReleaseMode)
      : null
    : normalizeLogsCleanupSpaceRelease(record.space_release, spaceReleaseMode)
  return {
    mode,
    space_release_mode: spaceReleaseMode,
    release_only: record.release_only === true,
    lifecycle_filters: lifecycleFiltersValue(record.lifecycle_filters),
    categories,
    scope: {
      task_count: numberValue(asRecord(record.scope)?.task_count),
      scene_count: numberValue(asRecord(record.scope)?.scene_count),
    },
    category_results: categoryResults,
    total_matched_count: numberValue(record.total_matched_count),
    total_deleted_count: numberValue(record.total_deleted_count),
    logical_delete_committed: record.logical_delete_committed === true || (mode === "execute" && record.release_only !== true),
    cleanup_outcome: stringValue(record.cleanup_outcome) ?? (mode === "execute" && record.release_only !== true ? "completed" : "preview"),
    space_release: spaceRelease,
  }
}

function normalizeLogsCleanupSpaceRelease(payload: unknown, mode: LogsSpaceReleaseMode): LogsCleanupSpaceRelease {
  const record = asRecord(payload)
  if (!record) {
    return {
      requested_mode: mode,
      status: mode === "logical_only" ? "not_requested" : "preview_only",
      eligible_store_count: 0,
      before_total_size_bytes: mode === "logical_only" ? 0 : null,
      after_total_size_bytes: mode === "logical_only" ? 0 : null,
      reclaimed_size_bytes: 0,
      net_size_change_bytes: 0,
      freelist_potential_bytes: 0,
      compact_target_size_bytes: null,
      required_compact_target_size_bytes: null,
      compact_output_size_bytes: null,
      compaction_pending: false,
      pending_compaction_count: 0,
      stores: [],
      warnings: mode === "logical_only" ? ["SQLite 文件未压缩；空闲页可供后续写入复用。"] : [],
    }
  }
  const stores = Array.isArray(record.stores) ? record.stores.map((item) => {
    const store = asRecord(item) ?? {}
    return {
      store_id: categoryValue(store.store_id) ?? "communication_messages",
      eligible: store.eligible === true,
      status: storeStatusValue(store.status),
      vacuum_started: store.vacuum_started === true,
      compaction_pending: store.compaction_pending === true,
      compact_copy_started: store.compact_copy_started === true,
      compact_output_size_bytes: nullableNumber(store.compact_output_size_bytes),
      compact_target_size_bytes: nullableNumber(store.compact_target_size_bytes),
      required_compact_target_size_bytes: nullableNumber(store.required_compact_target_size_bytes),
      pending_manifest_epoch: stringValue(store.pending_manifest_epoch),
      required_working_bytes: nullableNumber(store.required_working_bytes),
      available_bytes: nullableNumber(store.available_bytes),
      page_size_bytes: nullableNumber(store.page_size_bytes),
      page_count: nullableNumber(store.page_count),
      freelist_count: nullableNumber(store.freelist_count),
      auto_vacuum_mode: stringValue(store.auto_vacuum_mode),
      freelist_potential_bytes: nullableNumber(store.freelist_potential_bytes),
      before_size_bytes: nullableNumber(store.before_size_bytes),
      after_size_bytes: nullableNumber(store.after_size_bytes),
      reclaimed_size_bytes: numberValue(store.reclaimed_size_bytes),
      net_size_change_bytes: numberValue(store.net_size_change_bytes),
      before_db_size_bytes: nullableNumber(store.before_db_size_bytes),
      after_db_size_bytes: nullableNumber(store.after_db_size_bytes),
      before_wal_size_bytes: nullableNumber(store.before_wal_size_bytes),
      after_wal_size_bytes: nullableNumber(store.after_wal_size_bytes),
      before_shm_size_bytes: nullableNumber(store.before_shm_size_bytes),
      after_shm_size_bytes: nullableNumber(store.after_shm_size_bytes),
      error_code: stringValue(store.error_code),
      message: stringValue(store.message),
    }
  }) : []
  return {
    requested_mode: spaceReleaseModeValue(record.requested_mode),
    status: spaceReleaseStatusValue(record.status),
    eligible_store_count: numberValue(record.eligible_store_count),
    before_total_size_bytes: nullableNumber(record.before_total_size_bytes),
    after_total_size_bytes: nullableNumber(record.after_total_size_bytes),
    reclaimed_size_bytes: numberValue(record.reclaimed_size_bytes),
    net_size_change_bytes: numberValue(record.net_size_change_bytes),
    freelist_potential_bytes: numberValue(record.freelist_potential_bytes),
    compact_target_size_bytes: nullableNumber(record.compact_target_size_bytes),
    required_compact_target_size_bytes: nullableNumber(record.required_compact_target_size_bytes),
    compact_output_size_bytes: nullableNumber(record.compact_output_size_bytes),
    compaction_pending: record.compaction_pending === true,
    pending_compaction_count: numberValue(record.pending_compaction_count),
    stores,
    warnings: Array.isArray(record.warnings) ? record.warnings.filter((item): item is string => typeof item === "string") : [],
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function nullableNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function cleanupModeValue(value: unknown): LogsCleanupMode {
  return value === "execute" ? "execute" : "preview"
}

function spaceReleaseModeValue(value: unknown): LogsSpaceReleaseMode {
  return value === "safe_physical_release" ? "safe_physical_release" : "logical_only"
}

function cleanupJobStatusValue(value: unknown): LogsCleanupJobStatus {
  return value === "running" || value === "succeeded" || value === "failed" || value === "cancelled" ? value : "queued"
}

function phaseValue(value: unknown, status: LogsCleanupJobStatus): LogsCleanupJob["phase"] {
  if (value === "resolving_scope" || value === "deleting_data" || value === "releasing_space" || value === "compact_copying" || value === "swapping" || value === "reopening" || value === "completed" || value === "failed") return value
  return status === "succeeded" ? "completed" : status === "failed" ? "failed" : "resolving_scope"
}

function categoryValue(value: unknown): LogsCleanupCategory | null {
  return value === "communication_messages" || value === "chat_bubbles" || value === "llm_http_trace" || value === "context_compression_archive" || value === "terminal_history" ? value : null
}

function categoriesValue(value: unknown): LogsCleanupCategory[] {
  return Array.isArray(value) ? value.map(categoryValue).filter((item): item is LogsCleanupCategory => item !== null) : []
}

function lifecycleFiltersValue(value: unknown): LogsLifecycleFilter[] {
  return Array.isArray(value) ? value.filter((item): item is LogsLifecycleFilter => item === "ended_tasks" || item === "archived_scenes") : []
}

function storeStatusValue(value: unknown): LogsCleanupStoreSpaceRelease["status"] {
  return value === "released" || value === "completed" || value === "skipped_no_changes" || value === "not_available" || value === "busy" || value === "timeout" || value === "insufficient_disk_space" || value === "permission_denied" || value === "io_error" || value === "failed" || value === "requires_runtime_restart" || value === "requires_more_space" ? value : "preview_only"
}

function spaceReleaseStatusValue(value: unknown): LogsCleanupSpaceRelease["status"] {
  return value === "completed" || value === "partial" || value === "skipped_no_changes" || value === "deferred_busy" || value === "failed" || value === "requires_runtime_restart" || value === "requires_more_space" ? value : value === "not_requested" ? "not_requested" : "preview_only"
}
