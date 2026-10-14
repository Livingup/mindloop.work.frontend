import type {
  CodexAccountStatus,
  CodexErrorSummary,
  CodexOperation,
  CodexQuota,
  CodexQuotaRateLimitBucket,
  CodexQuotaRateLimitWindow,
  LlmExecutionPolicyCandidate,
  LlmProviderDefinition,
  LlmProviderModelBinding,
} from "@/features/settings/settingsApi"

export const CODEX_PROVIDER_ID = "openai_codex"

export type CodexAccountIdentity = {
  title: string
  subtitle: string | null
}

export type CodexAccountHealthView = {
  label: string
  retryLabel: string | null
  tone: "success" | "warning" | "muted"
}

export type CodexQuotaLine = {
  label: string
  value: string | null
  status: string | null
  resetsAt: string | null
}

export type CodexQuotaGroup = {
  title: string
  status: string | null
  lines: CodexQuotaLine[]
}

export type CodexQuotaViewModel = {
  primary: CodexQuotaGroup | null
  legacy: CodexQuotaLine[]
  supplemental: CodexQuotaLine[]
  additional: CodexQuotaGroup[]
  emptyLabel: string | null
  sourceLabel: string | null
  updatedAtLabel: string | null
}

export function getCodexAccountIdentity(account: { alias?: string | null; email?: string | null }): CodexAccountIdentity {
  const alias = nonEmptyText(account.alias)
  const email = nonEmptyText(account.email)
  if (alias) return { title: alias, subtitle: email }
  if (email) return { title: email, subtitle: null }
  return { title: "Codex 账号", subtitle: null }
}

export function getCodexAccountName(account: { alias?: string | null; email?: string | null }) {
  return getCodexAccountIdentity(account).title
}

export function formatCodexEnabledStatus(enabled: boolean) {
  return enabled ? "已启用" : "已停用"
}

export function getCodexAccountHealthView(status: CodexAccountStatus): CodexAccountHealthView {
  const health = status.health
  const reason = status.reason_code
  let label = "状态未知"
  let tone: CodexAccountHealthView["tone"] = "muted"

  if (health === "available") {
    label = "可用"
    tone = "success"
  } else if (health === "auth_error") {
    label = "授权已失效"
    tone = "warning"
  } else if (health === "rate_limited") {
    tone = "warning"
    if (reason === "five_hour_exhausted") label = "5 小时额度已用完"
    else if (reason === "weekly_exhausted") label = "每周额度已用完"
    else if (reason === "multiple_windows_exhausted") label = "当前额度已用完"
    else if (reason === "frequency_limited") label = "请求过于频繁"
    else label = "额度暂不可用"
  } else if (health === "transient_unavailable") {
    tone = "warning"
    if (reason === "proxy_error") label = "网络代理不可用"
    else if (reason === "quota_verification_pending") label = "正在确认额度"
    else label = "暂时不可用"
  }

  return {
    label,
    tone,
    retryLabel: status.retry_at ? `可在 ${formatLocalTime(status.retry_at)} 后重试` : null,
  }
}

export function formatCodexPlanLabel(planType: string | null | undefined) {
  const normalized = nonEmptyText(planType)?.toLowerCase()
  const labels: Record<string, string> = {
    free: "Free",
    go: "Go",
    plus: "Plus",
    pro: "Pro",
    prolite: "Pro Lite",
    team: "Team",
    business: "Business",
    enterprise: "Enterprise",
    edu: "Education",
  }
  return normalized ? labels[normalized] ?? null : null
}

export function formatCodexAuthStatus(value: string | undefined) {
  const labels: Record<string, string> = {
    waiting_for_user: "等待完成授权",
    exchanging_token: "正在完成授权",
    pending: "等待完成授权",
    slow_down: "等待完成授权",
    completed: "授权已完成",
    authorized: "授权已完成",
    cancelled: "授权已取消",
    expired: "授权已过期",
    failed: "授权未完成",
  }
  return value ? labels[value] ?? "授权进行中" : "尚未开始"
}

export function isCodexTerminalAuthStatus(value: string | undefined) {
  return value === "completed" || value === "authorized" || value === "cancelled" || value === "expired" || value === "failed"
}

export const CODEX_ROUTING_OPTIONS = [
  { value: "priority_drain", label: "优先使用" },
  { value: "round_robin", label: "轮流使用" },
]

export function formatCodexRoutingStrategy(value: string | undefined) {
  return value === "round_robin" ? "轮流使用" : "优先使用"
}

export function describeCodexRoutingStrategy(value: string | undefined) {
  return value === "round_robin"
    ? "按列表顺序轮流选择可用账号。"
    : "优先使用使用优先级最高且可用的账号；同优先级时按列表顺序选择。"
}

export function isCodexProviderId(providerId: string | null | undefined) {
  return providerId === CODEX_PROVIDER_ID
}

export function formatLlmProviderName(providerId: string) {
  return isCodexProviderId(providerId) ? "Codex" : providerId
}

export function formatLlmProviderGroup(provider: LlmProviderDefinition) {
  return isCodexProviderId(provider.provider_id) ? "Codex" : provider.group || "default"
}

export function formatLlmBindingName(provider: LlmProviderDefinition | undefined, binding: LlmProviderModelBinding) {
  return provider && isCodexProviderId(provider.provider_id) ? binding.model_id : binding.id
}

export function formatLlmCandidateName(candidate: LlmExecutionPolicyCandidate, providers: LlmProviderDefinition[]) {
  const provider = providers.find((item) => item.provider_id === candidate.provider_id)
  if (isCodexProviderId(candidate.provider_id)) {
    const model = provider?.models.find((binding) => binding.id === candidate.model_binding_id)?.model_id
    return `Codex / ${nonEmptyText(model) ?? "模型不可用"}`
  }
  return `${formatLlmProviderName(candidate.provider_id)} / ${candidate.model_binding_id}`
}

export function getCodexProviderModelIds(provider: LlmProviderDefinition | undefined) {
  if (!provider) return []
  return Array.from(new Set(provider.models.map((binding) => nonEmptyText(binding.model_id)).filter((value): value is string => Boolean(value))))
}

export function getCodexQuotaViewModel(quota: CodexQuota | null): CodexQuotaViewModel {
  if (!quota) {
    return {
      primary: null,
      legacy: [],
      supplemental: [],
      additional: [],
      emptyLabel: "尚未获取额度",
      sourceLabel: null,
      updatedAtLabel: null,
    }
  }

  const primary = quota.rate_limit ? quotaBucketView(quota.rate_limit, "使用额度") : null
  const legacy: CodexQuotaLine[] = []
  if (!primary) {
    if (quota.five_hour) legacy.push(legacyQuotaLine("5 小时", quota.five_hour.remaining_percent, quota.five_hour.exhausted, quota.five_hour.resets_at))
    if (quota.weekly) legacy.push(legacyQuotaLine("每周", quota.weekly.remaining_percent, quota.weekly.exhausted, quota.weekly.resets_at))
  }

  const supplemental: CodexQuotaLine[] = []
  const credits = quota.credits
  if (credits?.unlimited === true) {
    supplemental.push(simpleQuotaLine("额外额度", "不限额"))
  } else if (nonEmptyText(credits?.balance)) {
    supplemental.push(simpleQuotaLine("额外额度余额", nonEmptyText(credits?.balance)))
  } else if (credits?.has_credits === false) {
    supplemental.push(simpleQuotaLine("额外额度", "暂无额外额度"))
  }

  const spendControl = quota.spend_control
  if (spendControl?.reached === true) {
    supplemental.push({ label: "消费额度", value: null, status: "已达到消费上限", resetsAt: null })
  }
  const individualLimit = spendControl?.individual_limit
  if (individualLimit) {
    const values = [
      nonEmptyText(individualLimit.limit) ? `上限 ${individualLimit.limit}` : null,
      nonEmptyText(individualLimit.used) ? `已使用 ${individualLimit.used}` : null,
      nonEmptyText(individualLimit.remaining) ? `剩余 ${individualLimit.remaining}` : null,
    ].filter((value): value is string => Boolean(value))
    if (values.length > 0) supplemental.push(simpleQuotaLine("个人消费额度", values.join(" · "), individualLimit.resets_at))
  }

  const reachedReason = formatRateLimitReachedType(quota.rate_limit_reached_type)
  if (reachedReason && !supplemental.some((line) => line.status === reachedReason || line.value === reachedReason)) {
    supplemental.push({ label: "额度状态", value: null, status: reachedReason, resetsAt: null })
  }

  const additional = (quota.additional_rate_limits ?? [])
    .map((bucket) => quotaBucketView(bucket, "其他使用额度"))
    .filter((group): group is CodexQuotaGroup => group !== null)

  const hasSummary = primary !== null || legacy.length > 0 || supplemental.length > 0
  return {
    primary,
    legacy,
    supplemental,
    additional,
    emptyLabel: hasSummary ? null : additional.length > 0 ? "展开查看其他额度" : "额度详情暂不可用",
    sourceLabel: formatQuotaSource(quota.source),
    updatedAtLabel: quota.fetched_at ? formatLocalTime(quota.fetched_at) : null,
  }
}

export function formatCodexUserError(error: unknown, context: "general" | "authorization" | "quota" = "general") {
  if (context === "quota") return "暂时无法更新额度，已保留上次结果。"
  const summary = extractCodexError(error)
  const code = summary?.code?.toLowerCase() ?? ""
  const status = summary?.http_status

  if (["auth_attempt_expired", "auth_attempt_cancelled", "auth_attempt_already_completed", "auth_attempt_not_found"].includes(code)) {
    return "本次授权已结束，请重新开始。"
  }
  if (["oauth_state_mismatch", "oauth_callback_bind", "oauth_exchange", "auth_attempt_conflict", "oauth_error"].includes(code)) {
    return "授权未完成，请重新尝试；如浏览器授权仍失败，可改用设备授权。"
  }
  if (["credential_refresh", "credential_refresh_permanent", "credential_identity_mismatch", "invalid_credential", "refresh_failed"].includes(code)) {
    return "账号授权已失效，请删除此账号后重新添加。"
  }
  if (code === "account_conflict") return "账号信息已在其他位置更新，请刷新后重试。"
  if (code === "account_not_found") return "账号已不存在，请刷新列表。"
  if (code === "proxy_error") return "无法通过当前网络代理连接，请检查代理设置。"
  if (["connect_error", "request_timeout", "stream_idle_timeout", "transport_error", "upstream_http_error"].includes(code) || status === 502 || status === 503 || status === 504) {
    return "Codex 暂时不可用，请稍后重试。"
  }
  if (context === "authorization") {
    return "授权未完成，请重新尝试；如浏览器授权仍失败，可改用设备授权。"
  }
  return "操作未完成，请稍后重试。"
}

export function isCodexAuthTerminalError(error: unknown) {
  const code = extractCodexError(error)?.code
  return code === "auth_attempt_expired"
    || code === "auth_attempt_cancelled"
    || code === "auth_attempt_already_completed"
    || code === "auth_attempt_not_found"
    || code === "oauth_state_mismatch"
}

export function formatCodexOperationStatus(operation: CodexOperation) {
  if (operation.status === "failed") return "操作未完成"
  if (operation.status === "completed") return operation.kind === "delete" ? "账号已删除" : "账号已停用"
  return operation.kind === "delete" ? "正在删除" : "正在停用"
}

function quotaBucketView(bucket: CodexQuotaRateLimitBucket, fallbackName: string): CodexQuotaGroup | null {
  const status = bucket.limit_reached === true || bucket.allowed === false
    ? "已达上限"
    : bucket.allowed === true || bucket.limit_reached === false
      ? "可用"
      : null
  const lines = [
    quotaWindowLine(bucket.primary, "主要窗口"),
    quotaWindowLine(bucket.secondary, "次要窗口"),
  ].filter((line): line is CodexQuotaLine => line !== null)
  const limitName = nonEmptyText(bucket.limit_name)
  if (!status && lines.length === 0 && !limitName) return null
  return {
    title: limitName ?? fallbackName,
    status,
    lines,
  }
}

function quotaWindowLine(window: CodexQuotaRateLimitWindow | null | undefined, windowName: string): CodexQuotaLine | null {
  if (!window) return null
  const value = typeof window.used_percent === "number" && Number.isFinite(window.used_percent)
    ? `已使用 ${formatPercent(window.used_percent)}`
    : null
  const resetsAt = window.resets_at ? formatLocalTime(window.resets_at) : null
  const hasDuration = finitePositiveInteger(window.limit_window_seconds) !== null
    || finitePositiveInteger(window.window_minutes) !== null
  if (!value && !resetsAt && !hasDuration) return null
  return {
    label: `${windowName} · ${quotaDurationLabel(window)}`,
    value,
    status: null,
    resetsAt,
  }
}

function quotaDurationLabel(window: CodexQuotaRateLimitWindow) {
  const seconds = finitePositiveInteger(window.limit_window_seconds)
  if (seconds !== null) {
    if (seconds % 86400 === 0) return `${seconds / 86400} 天周期`
    if (seconds % 3600 === 0) return `${seconds / 3600} 小时周期`
    if (seconds % 60 === 0) return `${seconds / 60} 分钟周期`
    return `${seconds} 秒周期`
  }
  const minutes = finitePositiveInteger(window.window_minutes)
  if (minutes !== null) return `${minutes} 分钟周期`
  return "周期未知"
}

function legacyQuotaLine(label: string, remainingPercent: number, exhausted: boolean, resetsAt: string | null): CodexQuotaLine {
  return {
    label: `${label}剩余 ${formatPercent(remainingPercent)}`,
    value: null,
    status: exhausted ? "已达上限" : null,
    resetsAt: resetsAt ? formatLocalTime(resetsAt) : null,
  }
}

function simpleQuotaLine(label: string, value: string | null, resetsAt?: string | null): CodexQuotaLine {
  return {
    label,
    value,
    status: null,
    resetsAt: resetsAt ? formatLocalTime(resetsAt) : null,
  }
}

function formatRateLimitReachedType(value: string | null | undefined) {
  const labels: Record<string, string> = {
    rate_limit_reached: "当前使用额度已达上限",
    workspace_owner_credits_depleted: "工作区额外额度已用完",
    workspace_member_credits_depleted: "个人额外额度已用完",
    workspace_owner_usage_limit_reached: "工作区使用额度已达上限",
    workspace_member_usage_limit_reached: "个人使用额度已达上限",
  }
  return value ? labels[value] ?? null : null
}

function formatQuotaSource(value: string) {
  const labels: Record<string, string> = {
    active_query: "已主动更新",
    response_headers: "最近使用时更新",
    merged: "已合并最近信息",
    legacy_cache: "历史额度信息，建议更新",
  }
  return labels[value] ?? null
}

function formatPercent(value: number) {
  return `${new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1 }).format(value)}%`
}

function formatLocalTime(value: string) {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return "未知时间"
  return new Date(timestamp).toLocaleString("zh-CN")
}

function finitePositiveInteger(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.round(value) : null
}

function nonEmptyText(value: string | null | undefined) {
  const text = typeof value === "string" ? value.trim() : ""
  return text || null
}

function extractCodexError(error: unknown): CodexErrorSummary | null {
  if (isCodexErrorSummary(error)) return error
  if (typeof error !== "object" || error === null || !("body" in error)) return null
  const body = (error as { body?: unknown }).body
  if (typeof body !== "object" || body === null || !("detail" in body)) return null
  const detail = (body as { detail?: unknown }).detail
  return isCodexErrorSummary(detail) ? detail : null
}

function isCodexErrorSummary(value: unknown): value is CodexErrorSummary {
  if (typeof value !== "object" || value === null) return false
  const candidate = value as { code?: unknown; message?: unknown }
  return typeof candidate.code === "string" && typeof candidate.message === "string"
}
