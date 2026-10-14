import { requestJson } from "@/shared/api/httpClient"

export type LlmModelMetadata = {
  model_id: string
  group: string
  source: string
  context_window: number
  max_output_tokens: number
  compression_threshold: number | null
  supports_tool_calling: boolean
  supports_structured_output: boolean
  supported_input_modalities: string[]
}

export type LlmApiKey = {
  key: string
  name: string | null
}

export type LlmRetryPolicy = {
  max_retries_per_key: number
  initial_delay_seconds: number
  max_delay_seconds: number
  retryable_status_codes: number[]
}

export type LlmProviderModelBinding = {
  id: string
  model_id: string
  model_alias: string
  api_format: string
  tool_choice: string | null
  thinking: string | null
  custom_request_params: string | null
  api_base_url: string | null
  custom_headers: Record<string, string>
  api_keys: LlmApiKey[]
}

export type LlmProviderDefinition = {
  provider_id: string
  group: string
  provider_type: "custom" | "builtin" | string
  auth_type: "api_key" | "oauth" | string
  builtin: boolean
  managed: boolean
  api_base_url: string
  custom_headers: Record<string, string>
  api_keys: LlmApiKey[]
  retry: LlmRetryPolicy
  models: LlmProviderModelBinding[]
}

export type LlmExecutionPolicyCandidate = {
  id: string
  provider_id: string
  model_binding_id: string
  enabled: boolean
}

export type LlmExecutionPolicy = {
  policy_group_id: string
  name: string | null
  description: string | null
  group: string
  enabled: boolean
  unsupported_input_modality_strategy: string
  candidates: LlmExecutionPolicyCandidate[]
}

export type LlmModelMetadataBody = Omit<LlmModelMetadata, "model_id" | "source">
export type LlmProviderDefinitionBody = Omit<LlmProviderDefinition, "provider_id" | "provider_type" | "auth_type" | "builtin" | "managed">
export type LlmExecutionPolicyBody = Omit<LlmExecutionPolicy, "policy_group_id">

export type LlmRegistryMetadata = {
  api_formats: string[]
  input_modalities: string[]
  unsupported_input_modality_strategies: string[]
}

export type CodexProxySummary = {
  configured: boolean
  scheme: string | null
  host: string | null
  port: number | null
}

export type CodexDiagnosticDetails = {
  field?: string
  path?: Array<string | number>
  validator?: string
  parameter?: string
  reason_code?: string
  validator_value?: { type: string; length?: number }
  total?: number
  enabled?: number
  disabled?: number
  available?: number
  rate_limited?: number
  exhausted?: number
  error?: number
  unknown?: number
  earliest_retry_at?: string
}

export type CodexErrorSummary = {
  code: string
  message: string
  retryable: boolean
  http_status: number | null
  retry_at: string | null
  stage?: string | null
  error_type?: string | null
  details?: CodexDiagnosticDetails | null
  transport_subtype?: string | null
  request_id?: string | null
  attempt_id?: string | null
  account_id?: string | null
  upstream_request_id?: string | null
  partial_output?: boolean
  proxy?: CodexProxySummary | null
}

export type CodexQuotaWindow = {
  kind: "five_hour" | "weekly" | string
  used_percent: number
  remaining_percent: number
  resets_at: string | null
  exhausted: boolean
}

export type CodexQuotaRateLimitWindow = {
  used_percent?: number | null
  limit_window_seconds?: number | null
  window_minutes?: number | null
  reset_after_seconds?: number | null
  resets_at?: string | null
}

export type CodexQuotaRateLimitBucket = {
  limit_id?: string
  limit_name?: string | null
  allowed?: boolean | null
  limit_reached?: boolean | null
  primary?: CodexQuotaRateLimitWindow | null
  secondary?: CodexQuotaRateLimitWindow | null
}

export type CodexQuotaCredits = {
  has_credits?: boolean | null
  unlimited?: boolean | null
  balance?: string | null
}

export type CodexQuotaSpendControlLimit = {
  source?: string | null
  limit?: string
  used?: string
  remaining?: string
  used_percent?: number
  remaining_percent?: number
  reset_after_seconds?: number
  resets_at?: string | null
}

export type CodexQuotaSpendControl = {
  reached?: boolean
  individual_limit?: CodexQuotaSpendControlLimit | null
}

export type CodexQuota = {
  account_id: string
  five_hour: CodexQuotaWindow | null
  weekly: CodexQuotaWindow | null
  fetched_at: string
  source: string
  plan_type?: string | null
  rate_limit?: CodexQuotaRateLimitBucket | null
  additional_rate_limits?: CodexQuotaRateLimitBucket[]
  credits?: CodexQuotaCredits | null
  spend_control?: CodexQuotaSpendControl | null
  rate_limit_reached_type?: string | null
  active_fetched_at?: string | null
  passive_observed_at?: string | null
  rate_limits_by_limit_id?: Record<string, CodexQuotaRateLimitBucket>
}

export type CodexAccountStatus = {
  health: string
  reason_code: string
  reason_message: string | null
  since: string
  retry_at: string | null
  last_error: CodexErrorSummary | null
  exhausted_windows: string[]
  failure_count: number
  last_http_status: number | null
}

export type CodexAccount = {
  account_id: string
  display_label: string
  alias: string | null
  email?: string | null
  enabled: boolean
  status: CodexAccountStatus
  priority: number
  order: number
  proxy: CodexProxySummary
  plan_type: string | null
  quota: CodexQuota | null
  active_requests: number
  created_at: string
  updated_at: string
  version: number
}

export type CodexBrowserAuthStart = {
  attempt_id: string
  authorization_url: string
  callback_url: string
  expires_at: string
}

export type CodexDeviceAuthStart = {
  attempt_id: string
  verification_url: string
  user_code: string
  interval_seconds: number
  expires_at: string
}

export type CodexAuthResult = {
  attempt_id: string
  account: CodexAccount
  created: boolean
}

export type CodexAuthAttempt = {
  attempt_id: string
  kind: string
  status: string
  created_at: string
  expires_at: string
  result: CodexAuthResult | null
  last_error: CodexErrorSummary | null
}

export type CodexDevicePoll = {
  attempt_id: string
  status: string
  next_poll_at: string | null
  auth_result: CodexAuthResult | null
  error: CodexErrorSummary | null
}

export type CodexAccountPatch = {
  expected_version: number
  alias?: string | null
  priority?: number
  proxy?: { action: "replace"; proxy_url: string } | { action: "clear" }
}

export type CodexOperation = {
  operation_id: string
  kind: string
  account_id: string
  status: string
  force: boolean
  started_at: string
  completed_at: string | null
  remaining_active_requests: number
  error: CodexErrorSummary | null
}

export type CodexRecoveryCheck = {
  kind: string
  passed: boolean
  error: CodexErrorSummary | null
}

export type CodexRecovery = {
  account: CodexAccount
  recovered: boolean
  checks: CodexRecoveryCheck[]
}

export type CodexRouting = {
  strategy: "priority_drain" | "round_robin" | string
}

export type PersistenceInventoryItem = {
  item_id: string
  title: string
  scope: "user_global_reusable_config" | "machine_local_config" | "project_workspace_data" | "runtime_history_diagnostic_state" | string
  storage_medium: string
  storage_location: string
  persisted_data: string[]
  config_sections: string[]
  server_sync_candidate: boolean
  sync_recommendation: string
  rationale: string
  secret_handling: string | null
  migration_notes: string | null
}

export type SystemSettingsSnapshot = {
  config_path: string
  env_file_path: string | null
  raw_yaml: string
  raw_config: Record<string, unknown>
  section_names: string[]
  loaded_section_names: string[]
  watch_enabled: boolean
  persistence_inventory: PersistenceInventoryItem[]
}

export type ObjectStorageSettings = {
  gateway_provider: string
  object_storage_endpoint: string
  object_storage_region: string
  object_storage_bucket_name: string
  object_storage_public_base_url: string
  object_storage_object_key_prefix: string
  object_storage_access_key_id: string | null
  object_storage_access_key_secret: string | null
  object_storage_access_key_id_configured: boolean
  object_storage_access_key_secret_configured: boolean
  connect_timeout_seconds: number
  db_path: string
  updated_at: string | null
}

export type ObjectStorageSettingsBody = {
  gateway_provider: string
  object_storage_endpoint: string
  object_storage_region: string
  object_storage_bucket_name: string
  object_storage_public_base_url: string
  object_storage_object_key_prefix: string
  object_storage_access_key_id?: string | null
  object_storage_access_key_secret?: string | null
  connect_timeout_seconds: number
}

export type CloudUserConfigDatabaseSettings = {
  configured: boolean
  enabled: boolean
  backend: string
  host: string
  port: number
  database: string
  username: string
  sslmode: string
  connect_timeout_seconds: number
  password_configured: boolean
  updated_at: string | null
  bootstrap_db_path: string
  shared_config_snapshot_ready: boolean
  snapshot_updated_at: string | null
  snapshot_revision: number | null
  active_at_start: boolean
  effective_target_matches_saved: boolean
  restart_required: boolean
  warnings: string[]
}

export type CloudUserConfigDatabaseSettingsBody = {
  enabled: boolean
  backend: string
  host: string
  port: number
  database: string
  username: string
  password?: string | null
  sslmode: string
  connect_timeout_seconds: number
}

export type SkillSettings = {
  skills_dir: string
  db_path: string
  updated_at: string | null
}

export type ImageGenerationSettings = {
  llm_policy_group_id: string | null
  llm_policy_group_status: string
  llm_policy_group_status_message: string | null
  updated_at: string | null
}

export type ImageGenerationSettingsBody = {
  llm_policy_group_id?: string | null
}

export type WebToolPolicyCandidate = {
  id: string
  provider_id: string
  model_binding_id: string
  enabled: boolean
}

export type WebToolsSettings = {
  candidates: WebToolPolicyCandidate[]
  status: string
  status_message: string | null
  supported_api_formats: string[]
  updated_at: string | null
}

export type WebToolsSettingsBody = {
  candidates: WebToolPolicyCandidate[]
}

export function getSystemSettings() {
  return requestJson<SystemSettingsSnapshot>("/api/system-settings")
}

export function getObjectStorageSettings() {
  return requestJson<ObjectStorageSettings>("/api/file-resources/object-storage-settings")
}

export function updateObjectStorageSettings(body: ObjectStorageSettingsBody) {
  return requestJson<ObjectStorageSettings>("/api/file-resources/object-storage-settings", {
    method: "PUT",
    body,
  })
}

export function getCloudUserConfigDatabaseSettings() {
  return requestJson<CloudUserConfigDatabaseSettings>("/api/runtime-bootstrap/database-settings")
}

export function updateCloudUserConfigDatabaseSettings(body: CloudUserConfigDatabaseSettingsBody) {
  return requestJson<CloudUserConfigDatabaseSettings>("/api/runtime-bootstrap/database-settings", {
    method: "PUT",
    body,
  })
}

export function getSkillSettings() {
  return requestJson<SkillSettings>("/api/skills/settings")
}

export function updateSkillSettings(body: { skills_dir: string }) {
  return requestJson<SkillSettings>("/api/skills/settings", {
    method: "PUT",
    body,
  })
}

export function getLlmRegistryMetadata() {
  return requestJson<LlmRegistryMetadata>("/api/llm-registry/metadata")
}

export function getImageGenerationLlmRegistryMetadata() {
  return requestJson<LlmRegistryMetadata>("/api/image-generation/llm-registry/metadata")
}

export function listLlmModels() {
  return requestJson<LlmModelMetadata[]>("/api/llm-registry/models")
}

export function listImageGenerationLlmModels() {
  return requestJson<LlmModelMetadata[]>("/api/image-generation/llm-registry/models")
}

export function listLlmProviders() {
  return requestJson<LlmProviderDefinition[]>("/api/llm-registry/providers")
}

export function listImageGenerationLlmProviders() {
  return requestJson<LlmProviderDefinition[]>("/api/image-generation/llm-registry/providers")
}

export function listCodexAccounts(includeDisabled = true) {
  return requestJson<CodexAccount[]>(`/api/codex-oauth/accounts?include_disabled=${includeDisabled ? "true" : "false"}`)
}

export function getCodexAccount(accountId: string) {
  return requestJson<CodexAccount>(`/api/codex-oauth/accounts/${encodeURIComponent(accountId)}`)
}

export function updateCodexAccount(accountId: string, body: CodexAccountPatch) {
  return requestJson<CodexAccount>(`/api/codex-oauth/accounts/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    body,
  })
}

export function reorderCodexAccounts(accountIds: string[], expectedVersions: Record<string, number> | null = null) {
  return requestJson<CodexAccount[]>("/api/codex-oauth/accounts/reorder", {
    method: "POST",
    body: { account_ids: accountIds, expected_versions: expectedVersions },
  })
}

export function enableCodexAccount(accountId: string) {
  return requestJson<CodexAccount>(`/api/codex-oauth/accounts/${encodeURIComponent(accountId)}/enable`, { method: "POST" })
}

export function disableCodexAccount(accountId: string, force = false) {
  return requestJson<CodexOperation>(`/api/codex-oauth/accounts/${encodeURIComponent(accountId)}/disable`, {
    method: "POST",
    body: force ? { force: true } : {},
  })
}

export function recoverCodexAccount(accountId: string) {
  return requestJson<CodexRecovery>(`/api/codex-oauth/accounts/${encodeURIComponent(accountId)}/recover`, { method: "POST" })
}

export function refreshCodexQuota(accountId: string) {
  return requestJson<CodexQuota>(`/api/codex-oauth/accounts/${encodeURIComponent(accountId)}/quota/refresh`, { method: "POST" })
}

export function getCodexQuota(accountId: string) {
  return requestJson<CodexQuota | null>(`/api/codex-oauth/accounts/${encodeURIComponent(accountId)}/quota`)
}

export function deleteCodexAccount(accountId: string, force = false) {
  const suffix = force ? "?force=true" : ""
  return requestJson<CodexOperation>(`/api/codex-oauth/accounts/${encodeURIComponent(accountId)}${suffix}`, { method: "DELETE" })
}

export function getCodexOperation(operationId: string) {
  return requestJson<CodexOperation>(`/api/codex-oauth/operations/${encodeURIComponent(operationId)}`)
}

export function waitCodexOperation(operationId: string, timeoutSeconds = 30) {
  return requestJson<CodexOperation>(`/api/codex-oauth/operations/${encodeURIComponent(operationId)}/wait?timeout_seconds=${timeoutSeconds}`, { method: "POST" })
}

export function getCodexRouting() {
  return requestJson<CodexRouting>("/api/codex-oauth/routing")
}

export function setCodexRouting(strategy: string) {
  return requestJson<CodexRouting>("/api/codex-oauth/routing", { method: "PUT", body: { strategy } })
}

export function startCodexBrowserAuth(proxyUrl?: string) {
  return requestJson<CodexBrowserAuthStart>("/api/codex-oauth/auth/browser/start", {
    method: "POST",
    body: proxyUrl?.trim() ? { proxy_url: proxyUrl.trim() } : {},
  })
}

export function startCodexDeviceAuth(proxyUrl?: string) {
  return requestJson<CodexDeviceAuthStart>("/api/codex-oauth/auth/device/start", {
    method: "POST",
    body: proxyUrl?.trim() ? { proxy_url: proxyUrl.trim() } : {},
  })
}

export function getCodexAuthAttempt(attemptId: string) {
  return requestJson<CodexAuthAttempt>(`/api/codex-oauth/auth/attempts/${encodeURIComponent(attemptId)}`)
}

export function pollCodexDeviceAuth(attemptId: string) {
  return requestJson<CodexDevicePoll>(`/api/codex-oauth/auth/device/${encodeURIComponent(attemptId)}/poll`, { method: "POST" })
}

export function submitCodexBrowserCallback(attemptId: string, callbackUrl: string) {
  return requestJson<CodexAuthResult>(`/api/codex-oauth/auth/browser/${encodeURIComponent(attemptId)}/callback`, {
    method: "POST",
    body: { callback_url: callbackUrl },
  })
}

export function cancelCodexAuthAttempt(attemptId: string) {
  return requestJson<CodexAuthAttempt>(`/api/codex-oauth/auth/attempts/${encodeURIComponent(attemptId)}/cancel`, { method: "POST" })
}

export function ensureCodexOAuthProvider() {
  return requestJson<null>("/api/codex-oauth/provider/ensure", { method: "POST" })
}

export function listLlmExecutionPolicies() {
  return requestJson<LlmExecutionPolicy[]>("/api/llm-registry/execution-policies")
}

export function listImageGenerationLlmExecutionPolicies() {
  return requestJson<LlmExecutionPolicy[]>("/api/image-generation/llm-registry/execution-policies")
}

export function saveLlmExecutionPolicy(policyGroupId: string, body: LlmExecutionPolicyBody) {
  return requestJson<LlmExecutionPolicy>(`/api/llm-registry/execution-policies/${encodeURIComponent(policyGroupId)}`, {
    method: "PUT",
    body,
  })
}

export function saveImageGenerationLlmExecutionPolicy(policyGroupId: string, body: LlmExecutionPolicyBody) {
  return requestJson<LlmExecutionPolicy>(`/api/image-generation/llm-registry/execution-policies/${encodeURIComponent(policyGroupId)}`, {
    method: "PUT",
    body,
  })
}

export function saveLlmModel(modelId: string, body: LlmModelMetadataBody) {
  return requestJson<LlmModelMetadata>(`/api/llm-registry/models/${encodeURIComponent(modelId)}`, {
    method: "PUT",
    body,
  })
}

export function saveImageGenerationLlmModel(modelId: string, body: LlmModelMetadataBody) {
  return requestJson<LlmModelMetadata>(`/api/image-generation/llm-registry/models/${encodeURIComponent(modelId)}`, {
    method: "PUT",
    body,
  })
}

export function deleteLlmModel(modelId: string) {
  return requestJson<null>(`/api/llm-registry/models/${encodeURIComponent(modelId)}`, { method: "DELETE" })
}

export function deleteImageGenerationLlmModel(modelId: string) {
  return requestJson<null>(`/api/image-generation/llm-registry/models/${encodeURIComponent(modelId)}`, { method: "DELETE" })
}

export function saveLlmProvider(providerId: string, body: LlmProviderDefinitionBody) {
  return requestJson<LlmProviderDefinition>(`/api/llm-registry/providers/${encodeURIComponent(providerId)}`, {
    method: "PUT",
    body,
  })
}

export function saveImageGenerationLlmProvider(providerId: string, body: LlmProviderDefinitionBody) {
  return requestJson<LlmProviderDefinition>(`/api/image-generation/llm-registry/providers/${encodeURIComponent(providerId)}`, {
    method: "PUT",
    body,
  })
}

export function deleteLlmProvider(providerId: string) {
  return requestJson<null>(`/api/llm-registry/providers/${encodeURIComponent(providerId)}`, { method: "DELETE" })
}

export function deleteImageGenerationLlmProvider(providerId: string) {
  return requestJson<null>(`/api/image-generation/llm-registry/providers/${encodeURIComponent(providerId)}`, { method: "DELETE" })
}

export function deleteLlmExecutionPolicy(policyGroupId: string) {
  return requestJson<null>(`/api/llm-registry/execution-policies/${encodeURIComponent(policyGroupId)}`, { method: "DELETE" })
}

export function deleteImageGenerationLlmExecutionPolicy(policyGroupId: string) {
  return requestJson<null>(`/api/image-generation/llm-registry/execution-policies/${encodeURIComponent(policyGroupId)}`, { method: "DELETE" })
}

export function getImageGenerationSettings() {
  return requestJson<ImageGenerationSettings>("/api/image-generation/settings")
}

export function updateImageGenerationSettings(body: ImageGenerationSettingsBody) {
  return requestJson<ImageGenerationSettings>("/api/image-generation/settings", {
    method: "PUT",
    body,
  })
}

export function getWebToolsSettings() {
  return requestJson<WebToolsSettings>("/api/web-tools/settings")
}

export function updateWebToolsSettings(body: WebToolsSettingsBody) {
  return requestJson<WebToolsSettings>("/api/web-tools/settings", {
    method: "PUT",
    body,
  })
}
