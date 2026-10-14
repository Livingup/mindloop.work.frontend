import { useCallback, useEffect, useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, ChevronUp, RefreshCw, ShieldCheck, Trash2 } from "lucide-react"

import {
  cancelCodexAuthAttempt,
  deleteCodexAccount,
  disableCodexAccount,
  enableCodexAccount,
  getCodexAuthAttempt,
  getCodexOperation,
  getCodexRouting,
  listCodexAccounts,
  pollCodexDeviceAuth,
  recoverCodexAccount,
  refreshCodexQuota,
  reorderCodexAccounts,
  startCodexBrowserAuth,
  startCodexDeviceAuth,
  submitCodexBrowserCallback,
  setCodexRouting,
  updateCodexAccount,
  type CodexAccount,
  type CodexDeviceAuthStart,
  type CodexDevicePoll,
  type CodexOperation,
} from "@/features/settings/settingsApi"
import {
  CODEX_ROUTING_OPTIONS,
  describeCodexRoutingStrategy,
  formatCodexAuthStatus,
  formatCodexEnabledStatus,
  formatCodexOperationStatus,
  formatCodexPlanLabel,
  formatCodexUserError,
  getCodexAccountHealthView,
  getCodexAccountIdentity,
  getCodexAccountName,
  getCodexQuotaViewModel,
  isCodexAuthTerminalError,
  isCodexTerminalAuthStatus,
  type CodexQuotaGroup,
  type CodexQuotaLine,
} from "@/features/llm/codexPresentation"
import { DarkSelect } from "@/shared/components/DarkSelect"
import { useAppConfirm, useAppNotification } from "@/shared/interaction/AppInteractionProvider"

const ACCOUNT_QUERY_KEY = ["codex-oauth", "accounts"] as const
const ROUTING_QUERY_KEY = ["codex-oauth", "routing"] as const
const CODEX_ACCOUNT_PAGE_SIZE = 10

type AuthMode = "browser" | "device"
type ProxyEditMode = "keep" | "replace" | "clear"

export function CodexAccountPanel() {
  const queryClient = useQueryClient()
  const accountsQuery = useQuery({ queryKey: ACCOUNT_QUERY_KEY, queryFn: () => listCodexAccounts(true) })
  const routingQuery = useQuery({ queryKey: ROUTING_QUERY_KEY, queryFn: getCodexRouting })
  const [authMode, setAuthMode] = useState<AuthMode>("browser")
  const [proxyUrl, setProxyUrl] = useState("")
  const [attemptId, setAttemptId] = useState("")
  const [callbackUrl, setCallbackUrl] = useState("")
  const [authNotice, setAuthNotice] = useState("")
  const [authError, setAuthError] = useState("")
  const [deviceStart, setDeviceStart] = useState<CodexDeviceAuthStart | null>(null)
  const [devicePoll, setDevicePoll] = useState<CodexDevicePoll | null>(null)
  const [browserAuthorizationUrl, setBrowserAuthorizationUrl] = useState("")
  const [manualCallbackOpen, setManualCallbackOpen] = useState(false)
  const clearSensitiveAuthState = useCallback(() => {
    setAttemptId("")
    setProxyUrl("")
    setCallbackUrl("")
    setBrowserAuthorizationUrl("")
    setManualCallbackOpen(false)
    setDeviceStart(null)
    setDevicePoll(null)
  }, [])

  const browserStartMutation = useMutation({
    mutationFn: () => startCodexBrowserAuth(proxyUrl),
    onSuccess: (result) => {
      setAttemptId(result.attempt_id)
      setProxyUrl("")
      setBrowserAuthorizationUrl(result.authorization_url)
      setCallbackUrl("")
      setManualCallbackOpen(false)
      setAuthError("")
      setAuthNotice("浏览器授权已开始。请复制下方链接，在你选择的浏览器中完成授权；本页会自动更新状态。")
    },
    onError: (error) => {
      setAuthError(formatCodexUserError(error, "authorization"))
      clearSensitiveAuthState()
    },
  })
  const deviceStartMutation = useMutation({
    mutationFn: () => startCodexDeviceAuth(proxyUrl),
    onSuccess: (result) => {
      setAttemptId(result.attempt_id)
      setProxyUrl("")
      setDeviceStart(result)
      setDevicePoll(null)
      setAuthError("")
      setAuthNotice("设备授权已开始。请复制下方验证地址和授权代码，在你选择的环境中完成授权；本页会自动更新状态。")
    },
    onError: (error) => {
      setAuthError(formatCodexUserError(error, "authorization"))
      clearSensitiveAuthState()
    },
  })
  const attemptQuery = useQuery({
    queryKey: ["codex-oauth", "attempt", attemptId],
    queryFn: () => getCodexAuthAttempt(attemptId),
    enabled: Boolean(attemptId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return authMode === "browser" && attemptId && !isCodexTerminalAuthStatus(status) ? 1000 : false
    },
    refetchIntervalInBackground: true,
  })
  const callbackMutation = useMutation({
    mutationFn: () => submitCodexBrowserCallback(attemptId, callbackUrl.trim()),
    onSuccess: (result) => {
      setAuthNotice(`授权完成：${getCodexAccountName(result.account)}`)
      setAuthError("")
      clearSensitiveAuthState()
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
    },
    onError: (error) => {
      setAuthError(formatCodexUserError(error, "authorization"))
      if (isCodexAuthTerminalError(error)) clearSensitiveAuthState()
    },
  })
  const pollMutation = useMutation({
    mutationFn: () => pollCodexDeviceAuth(attemptId),
    onSuccess: (result) => {
      if (result.auth_result) {
        setAuthNotice(`授权完成：${getCodexAccountName(result.auth_result.account)}`)
        setAuthError("")
        clearSensitiveAuthState()
        void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
      } else if (isCodexTerminalAuthStatus(result.status)) {
        if (result.status === "cancelled") {
          setAuthNotice("授权已取消。")
          setAuthError("")
        } else {
          setAuthNotice("")
          setAuthError(result.error ? formatCodexUserError(result.error, "authorization") : "本次授权已结束，请重新开始。")
        }
        clearSensitiveAuthState()
      } else {
        setDevicePoll(result)
        if (result.error) setAuthError(formatCodexUserError(result.error, "authorization"))
      }
    },
    onError: (error) => {
      setAuthError(formatCodexUserError(error, "authorization"))
      if (isCodexAuthTerminalError(error)) clearSensitiveAuthState()
    },
  })
  const cancelMutation = useMutation({
    mutationFn: () => cancelCodexAuthAttempt(attemptId),
    onSuccess: () => {
      setAuthNotice("授权已取消。")
      setAuthError("")
      clearSensitiveAuthState()
    },
    onError: (error) => {
      setAuthError(formatCodexUserError(error, "authorization"))
      if (isCodexAuthTerminalError(error)) clearSensitiveAuthState()
    },
  })
  const routingMutation = useMutation({
    mutationFn: (strategy: string) => setCodexRouting(strategy),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ROUTING_QUERY_KEY }),
  })
  const reorderMutation = useMutation({
    mutationFn: (payload: { accountIds: string[]; versions: Record<string, number> }) => reorderCodexAccounts(payload.accountIds, payload.versions),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY }),
  })

  useEffect(() => {
    const attempt = attemptQuery.data
    if (authMode !== "browser" || !attempt || !isCodexTerminalAuthStatus(attempt.status)) return
    if (attempt.status === "completed" && attempt.result) {
      setAuthNotice(`授权完成：${getCodexAccountName(attempt.result.account)}`)
      setAuthError("")
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
    } else if (attempt.status === "cancelled") {
      setAuthNotice("授权已取消。")
      setAuthError("")
    } else {
      setAuthNotice("")
      setAuthError(attempt.last_error ? formatCodexUserError(attempt.last_error, "authorization") : "本次授权已结束，请重新开始。")
    }
    clearSensitiveAuthState()
  }, [attemptQuery.data, authMode, clearSensitiveAuthState, queryClient])

  useEffect(() => {
    if (!attemptQuery.error || !isCodexAuthTerminalError(attemptQuery.error)) return
    setAuthNotice("")
    setAuthError(formatCodexUserError(attemptQuery.error, "authorization"))
    clearSensitiveAuthState()
  }, [attemptQuery.error, clearSensitiveAuthState])

  useEffect(() => {
    if (authMode !== "device" || !attemptId || !deviceStart || pollMutation.isPending || devicePoll?.auth_result) return
    if (isCodexTerminalAuthStatus(devicePoll?.status)) return
    const nextAt = devicePoll?.next_poll_at ? Date.parse(devicePoll.next_poll_at) : Date.now() + deviceStart.interval_seconds * 1000
    const delay = Math.max(250, Number.isFinite(nextAt) ? nextAt - Date.now() : deviceStart.interval_seconds * 1000)
    const timer = window.setTimeout(() => pollMutation.mutate(), delay)
    return () => window.clearTimeout(timer)
  }, [authMode, attemptId, devicePoll?.auth_result, devicePoll?.next_poll_at, devicePoll?.status, deviceStart, pollMutation.isPending])

  const routingStrategy = routingQuery.data?.strategy ?? "priority_drain"
  const [accountPage, setAccountPage] = useState(0)
  const sortedAccounts = useMemo(() => {
    const accounts = [...(accountsQuery.data ?? [])]
    return accounts.sort((left, right) => {
      if (routingStrategy === "round_robin") {
        return left.order - right.order || left.account_id.localeCompare(right.account_id)
      }
      return right.priority - left.priority || left.order - right.order || left.account_id.localeCompare(right.account_id)
    })
  }, [accountsQuery.data, routingStrategy])
  const totalAccountPages = Math.max(1, Math.ceil(sortedAccounts.length / CODEX_ACCOUNT_PAGE_SIZE))
  const safeAccountPage = Math.min(accountPage, totalAccountPages - 1)
  const visibleAccounts = sortedAccounts.slice(
    safeAccountPage * CODEX_ACCOUNT_PAGE_SIZE,
    (safeAccountPage + 1) * CODEX_ACCOUNT_PAGE_SIZE,
  )
  const authBusy = browserStartMutation.isPending || deviceStartMutation.isPending || callbackMutation.isPending || pollMutation.isPending || cancelMutation.isPending
  const currentAttempt = attemptQuery.data
  const displayedAuthError = authError
    || (currentAttempt?.last_error ? formatCodexUserError(currentAttempt.last_error, "authorization") : "")
    || (attemptQuery.error ? formatCodexUserError(attemptQuery.error, "authorization") : "")
  useEffect(() => {
    setAccountPage(0)
  }, [routingStrategy])
  useEffect(() => {
    if (accountPage !== safeAccountPage) setAccountPage(safeAccountPage)
  }, [accountPage, safeAccountPage])

  function startAuth() {
    if (authBusy || attemptId) return
    setAuthError("")
    setAuthNotice("")
    setAttemptId("")
    setCallbackUrl("")
    setBrowserAuthorizationUrl("")
    setManualCallbackOpen(false)
    setDeviceStart(null)
    setDevicePoll(null)
    if (authMode === "browser") {
      browserStartMutation.mutate()
    } else {
      deviceStartMutation.mutate()
    }
  }

  function moveAccount(account: CodexAccount, direction: -1 | 1) {
    const index = sortedAccounts.findIndex((item) => item.account_id === account.account_id)
    const target = index + direction
    if (index < 0 || target < 0 || target >= sortedAccounts.length || reorderMutation.isPending) return
    const next = [...sortedAccounts]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    reorderMutation.mutate({
      accountIds: next.map((item) => item.account_id),
      versions: Object.fromEntries(sortedAccounts.map((item) => [item.account_id, item.version]))
    })
  }

  return (
    <section className="space-y-4 rounded-lg border border-app-accent-muted/25 bg-app-selected/20 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-app-accent"><ShieldCheck size={15} />Codex 账号</div>
          <p className="mt-1 max-w-3xl text-xs leading-5 text-app-secondary">通过浏览器或设备授权连接 Codex。授权后无需填写 API Key；每个账号只有一个网络代理，该账号的授权、账号信息与凭证刷新、额度和 LLM 等所有 Codex 上游请求统一使用这个代理。</p>
        </div>
        <button type="button" onClick={() => void accountsQuery.refetch()} disabled={accountsQuery.isFetching} className="inline-flex items-center gap-1 rounded border border-app-border/80 px-2.5 py-1.5 text-xs text-app-secondary hover:bg-app-selected disabled:opacity-40"><RefreshCw size={13} className={accountsQuery.isFetching ? "animate-spin" : ""} />刷新</button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded border border-app-border/80 bg-app-surface/60 p-3 xl:grid-cols-[12rem_minmax(0,1fr)_auto]">
        <label className="block">
          <span className="mb-1.5 block text-xs text-app-muted">授权方式</span>
          <DarkSelect
            value={authMode}
            onChange={(value) => setAuthMode(value as AuthMode)}
            disabled={Boolean(attemptId) || authBusy}
            options={[
              { value: "browser", label: "浏览器授权" },
              { value: "device", label: "设备授权" },
            ]}
          />
        </label>
        <label className="block"><span className="mb-1.5 block text-xs text-app-muted">账号网络代理（可选）</span><input value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} disabled={Boolean(attemptId) || authBusy} placeholder="例如 http://host:port" className={inputClass(true)} /><span className="mt-1 block text-[11px] text-app-muted">授权成功后绑定到该账号；取消或失败不会保存。</span></label>
        <div className="flex items-end"><button type="button" onClick={startAuth} disabled={Boolean(attemptId) || authBusy} className="rounded bg-app-accent px-3 py-2 text-xs font-medium text-white hover:bg-app-accent-hover disabled:opacity-40">开始授权</button></div>
      </div>
      {(authNotice || displayedAuthError) && <div className={displayedAuthError ? "rounded border border-red-300/40 bg-red-50 px-3 py-2 text-xs text-red-700" : "rounded border border-app-accent-muted/25 bg-app-selected/50 px-3 py-2 text-xs text-app-accent"}>{displayedAuthError || authNotice}</div>}

      {attemptId && (
        <div className="space-y-3 rounded border border-app-border/80 bg-app-surface-muted/65 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-xs text-app-secondary">{formatCodexAuthStatus(authMode === "device" ? devicePoll?.status ?? currentAttempt?.status : currentAttempt?.status)}</div><button type="button" onClick={() => cancelMutation.mutate()} disabled={authBusy || isCodexTerminalAuthStatus(currentAttempt?.status)} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-40">取消授权</button></div>
          {browserAuthorizationUrl && (
            <div className="space-y-3">
              <div className="rounded border border-app-border/80 bg-app-surface/80 p-3">
                <div className="mb-1 text-[11px] text-app-muted">授权链接（请复制到浏览器中打开）</div>
                <div className="break-all font-mono text-xs leading-5 text-app-secondary">{browserAuthorizationUrl}</div>
                <button type="button" onClick={() => void navigator.clipboard.writeText(browserAuthorizationUrl)} className="mt-2 rounded border border-app-border/80 px-3 py-1.5 text-xs text-app-secondary hover:bg-app-selected">复制授权链接</button>
              </div>
              <button type="button" onClick={() => setManualCallbackOpen((value) => !value)} className="text-xs text-app-accent hover:text-app-accent-hover">授权未自动完成？</button>
              {manualCallbackOpen && (
                <div className="space-y-2 rounded border border-app-border/80 bg-app-surface/70 p-3">
                  <label className="block"><span className="mb-1.5 block text-xs text-app-muted">粘贴浏览器最终跳转的完整地址</span><input value={callbackUrl} onChange={(event) => setCallbackUrl(event.target.value)} placeholder="粘贴完整地址" className={inputClass(true)} /></label>
                  <button type="button" onClick={() => callbackMutation.mutate()} disabled={!callbackUrl.trim() || authBusy} className="rounded border border-app-accent-muted/35 px-3 py-1.5 text-xs text-app-accent hover:bg-app-selected disabled:opacity-40">提交授权结果</button>
                </div>
              )}
            </div>
          )}
          {deviceStart && (
            <div className="space-y-2">
              <div className="rounded border border-app-border/80 bg-app-surface/80 p-3">
                <div className="mb-1 text-[11px] text-app-muted">验证地址（请复制到浏览器中打开）</div>
                <div className="break-all font-mono text-xs leading-5 text-app-secondary">{deviceStart.verification_url}</div>
                <button type="button" onClick={() => void navigator.clipboard.writeText(deviceStart.verification_url)} className="mt-2 rounded border border-app-border/80 px-3 py-1.5 text-xs text-app-secondary hover:bg-app-selected">复制验证地址</button>
              </div>
              <div className="rounded border border-app-border/80 bg-app-surface/80 p-3"><div className="text-[11px] text-app-muted">授权代码</div><code className="font-mono text-lg text-app-primary">{deviceStart.user_code}</code><button type="button" onClick={() => void navigator.clipboard.writeText(deviceStart.user_code)} className="ml-3 rounded border border-app-border/80 px-3 py-1.5 align-middle text-xs text-app-secondary hover:bg-app-selected">复制授权代码</button></div>
              <div className="text-xs text-app-muted">请完成授权，本页会自动更新状态。</div>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-app-border/80 bg-app-surface/60 p-3">
        <div>
          <div className="text-xs font-medium text-app-primary">账号选择方式</div>
          <div className="mt-1 text-[11px] text-app-muted">{describeCodexRoutingStrategy(routingStrategy)}</div>
        </div>
        <DarkSelect
          value={routingStrategy}
          onChange={(value) => routingMutation.mutate(value)}
          disabled={routingMutation.isPending || routingQuery.isLoading}
          containerClassName="w-44"
          className="py-1.5 text-xs"
          options={CODEX_ROUTING_OPTIONS}
        />
      </div>

      {accountsQuery.isLoading && <div className="text-xs text-app-muted">正在加载 Codex 账号</div>}
      {accountsQuery.error && <div className="rounded border border-red-300/40 bg-red-50 px-3 py-2 text-xs text-red-700">{formatCodexUserError(accountsQuery.error)}</div>}
      {!accountsQuery.isLoading && !accountsQuery.error && sortedAccounts.length === 0 && <div className="rounded border border-dashed border-app-border/80 p-4 text-xs text-app-muted">暂无 Codex 账号。请选择一种授权方式开始添加。</div>}
      {sortedAccounts.length > 0 && <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-app-border/80 bg-app-surface/60 px-3 py-2 text-xs text-app-muted"><span>第 {safeAccountPage + 1} / {totalAccountPages} 页 · 共 {sortedAccounts.length} 个账号</span><div className="flex items-center gap-2"><button type="button" onClick={() => setAccountPage((page) => Math.max(0, page - 1))} disabled={safeAccountPage === 0} className="rounded border border-app-border/80 px-2 py-1 text-app-secondary hover:bg-app-selected disabled:opacity-40">上一页</button><button type="button" onClick={() => setAccountPage((page) => Math.min(totalAccountPages - 1, page + 1))} disabled={safeAccountPage >= totalAccountPages - 1} className="rounded border border-app-border/80 px-2 py-1 text-app-secondary hover:bg-app-selected disabled:opacity-40">下一页</button></div></div>}
      <div className="space-y-3">{visibleAccounts.map((account, index) => <CodexAccountRow key={account.account_id} account={account} index={safeAccountPage * CODEX_ACCOUNT_PAGE_SIZE + index} total={sortedAccounts.length} routingStrategy={routingStrategy} onMove={moveAccount} />)}</div>
      {reorderMutation.error && <div className="text-xs text-red-400">排序失败：{formatCodexUserError(reorderMutation.error)}</div>}
      {routingMutation.error && <div className="text-xs text-red-400">选择方式更新失败：{formatCodexUserError(routingMutation.error)}</div>}
    </section>
  )
}

function CodexAccountRow({
  account,
  index,
  total,
  routingStrategy,
  onMove,
}: {
  account: CodexAccount
  index: number
  total: number
  routingStrategy: string
  onMove: (account: CodexAccount, direction: -1 | 1) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const [expanded, setExpanded] = useState(false)
  const [alias, setAlias] = useState(account.alias ?? "")
  const [priority, setPriority] = useState(String(account.priority))
  const [proxyMode, setProxyMode] = useState<ProxyEditMode>("keep")
  const [proxyUrl, setProxyUrl] = useState("")
  const [operation, setOperation] = useState<CodexOperation | null>(null)
  const priorityMode = routingStrategy !== "round_robin"
  const identity = getCodexAccountIdentity(account)
  const healthView = getCodexAccountHealthView(account.status)
  const healthStatusClass = healthView.tone === "success"
    ? "rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-700"
    : healthView.tone === "warning"
      ? "rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-700"
      : "rounded bg-slate-500/10 px-1.5 py-0.5 text-[11px] text-app-muted"
  const planLabel = formatCodexPlanLabel(account.plan_type)
  const quotaView = getCodexQuotaViewModel(account.quota)
  useEffect(() => {
    setAlias(account.alias ?? "")
    setPriority(String(account.priority))
  }, [account.alias, account.priority, account.version])
  const updateMutation = useMutation({
    mutationFn: () => updateCodexAccount(account.account_id, {
      expected_version: account.version,
      alias: alias.trim() || null,
      ...(priorityMode ? { priority: Number(priority) } : {}),
      ...(proxyMode === "replace" ? { proxy: { action: "replace" as const, proxy_url: proxyUrl.trim() } } : proxyMode === "clear" ? { proxy: { action: "clear" as const } } : {}),
    }),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
      notify({ title: "账号已更新", message: getCodexAccountName(updated), tone: "success" })
      setProxyMode("keep")
      setProxyUrl("")
    },
  })
  const enableMutation = useMutation({
    mutationFn: () => enableCodexAccount(account.account_id),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY }),
  })
  const recoverMutation = useMutation({
    mutationFn: () => recoverCodexAccount(account.account_id),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
      notify({
        title: result.recovered ? "账号已恢复" : "账号仍不可用",
        message: getCodexAccountName(result.account),
        tone: result.recovered ? "success" : "warning",
      })
    },
  })
  const quotaMutation = useMutation({
    mutationFn: () => refreshCodexQuota(account.account_id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
      notify({ title: "额度已更新", message: identity.title, tone: "success" })
    },
  })
  const disableMutation = useMutation({
    mutationFn: (force: boolean) => disableCodexAccount(account.account_id, force),
    onSuccess: (result) => setOperation(result),
  })
  const deleteMutation = useMutation({
    mutationFn: (force: boolean) => deleteCodexAccount(account.account_id, force),
    onSuccess: (result) => setOperation(result),
  })
  const operationQuery = useQuery({
    queryKey: ["codex-oauth", "operation", operation?.operation_id],
    queryFn: () => getCodexOperation(operation!.operation_id),
    enabled: Boolean(operation?.operation_id),
    refetchInterval: (query) => query.state.data?.status === "pending" ? 1000 : false,
    refetchIntervalInBackground: true,
  })
  useEffect(() => {
    if (operationQuery.data && operationQuery.data.status !== "pending") {
      setOperation(operationQuery.data)
      void queryClient.invalidateQueries({ queryKey: ACCOUNT_QUERY_KEY })
    }
  }, [operationQuery.data, queryClient])

  async function requestDisable(force: boolean) {
    if (force && !(await confirm({ title: "强制停用 Codex 账号", description: `强制停用“${identity.title}”会停止正在使用此账号的任务。确认继续？`, confirmLabel: "强制停用", cancelLabel: "取消", tone: "danger" }))) return
    disableMutation.mutate(force)
  }
  async function requestDelete(force: boolean) {
    const description = force
      ? `强制删除“${identity.title}”会停止正在使用此账号的任务，并立即移除账号，且不可恢复。`
      : `删除“${identity.title}”后将移除此账号及相关会话关联，且不可恢复。`
    if (!(await confirm({ title: force ? "强制删除 Codex 账号" : "删除 Codex 账号", description, confirmLabel: force ? "强制删除" : "删除", cancelLabel: "取消", tone: "danger" }))) return
    deleteMutation.mutate(force)
  }
  const busy = updateMutation.isPending || enableMutation.isPending || recoverMutation.isPending || quotaMutation.isPending || disableMutation.isPending || deleteMutation.isPending
  const generalError = updateMutation.error || enableMutation.error || recoverMutation.error || disableMutation.error || deleteMutation.error || operationQuery.error
  const errorText = quotaMutation.error
    ? formatCodexUserError(quotaMutation.error, "quota")
    : generalError
      ? formatCodexUserError(generalError)
      : ""

  return (
    <article className="rounded-lg border border-app-border/80 bg-app-surface/65 p-3">
      <div className="flex flex-wrap items-start gap-3">
        <div className="flex items-center gap-1 pt-1"><button type="button" onClick={() => onMove(account, -1)} disabled={index === 0} className="rounded p-1 text-app-muted hover:bg-app-selected hover:text-app-primary disabled:opacity-30" title="上移"><ChevronUp size={14} /></button><button type="button" onClick={() => onMove(account, 1)} disabled={index === total - 1} className="rounded p-1 text-app-muted hover:bg-app-selected hover:text-app-primary disabled:opacity-30" title="下移"><ChevronDown size={14} /></button></div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-app-primary">{identity.title}</span>
            <span className={account.enabled ? "rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] text-emerald-700" : "rounded bg-slate-500/15 px-1.5 py-0.5 text-[11px] text-slate-600"}>{formatCodexEnabledStatus(account.enabled)}</span>
            <span className={healthStatusClass}>{healthView.label}</span>
            {planLabel && <span className="rounded bg-app-surface/80 px-1.5 py-0.5 text-[11px] text-app-muted">{planLabel}</span>}
            <span className="rounded bg-app-surface/80 px-1.5 py-0.5 text-[11px] text-app-muted">{priorityMode ? `优先级 ${account.priority}` : `顺序第 ${index + 1}`}</span>
          </div>
          {identity.subtitle && <div className="mt-1 truncate text-xs text-app-secondary">{identity.subtitle}</div>}
          {healthView.retryLabel && <div className="mt-1 text-[11px] text-app-muted">{healthView.retryLabel}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5"><button type="button" onClick={() => setExpanded((value) => !value)} className="rounded border border-app-border/80 px-2 py-1 text-xs text-app-secondary hover:bg-app-selected">{expanded ? "收起" : "编辑"}</button>{account.enabled ? <button type="button" onClick={() => void requestDisable(false)} disabled={busy} className="rounded px-2 py-1 text-xs text-amber-700 hover:bg-amber-500/10 disabled:opacity-40">停用</button> : <button type="button" onClick={() => enableMutation.mutate()} disabled={busy} className="rounded px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-40">启用</button>}<button type="button" onClick={() => recoverMutation.mutate()} disabled={busy} className="rounded px-2 py-1 text-xs text-app-accent hover:bg-app-selected disabled:opacity-40">检查状态</button><button type="button" onClick={() => quotaMutation.mutate()} disabled={busy} className="rounded px-2 py-1 text-xs text-app-accent hover:bg-app-selected disabled:opacity-40">更新额度</button><button type="button" onClick={() => void requestDelete(false)} disabled={busy} title="删除账号" className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-40"><Trash2 size={13} /></button></div>
      </div>
      <CodexQuotaSummary view={quotaView} />
      <div className="mt-2 text-[11px] text-app-muted">网络代理：{proxyLabel(account.proxy)}</div>
      {operation && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded border border-amber-300/40 bg-amber-50 px-2 py-1.5 text-xs text-amber-800">
          <span>{formatCodexOperationStatus(operation)}{operation.status === "pending" ? " · 正在等待当前任务结束" : ""}{operation.status === "pending" && operation.remaining_active_requests > 0 ? ` · 仍有 ${operation.remaining_active_requests} 个任务正在使用此账号` : ""}{operation.status !== "failed" && operation.error ? ` · ${formatCodexUserError(operation.error)}` : ""}</span>
          {operation.status === "pending" && <><button type="button" onClick={() => void requestDisable(true)} disabled={busy || operation.kind !== "disable"} className="rounded px-2 py-1 text-[11px] text-amber-800 hover:bg-amber-100 disabled:opacity-40">强制停用</button><button type="button" onClick={() => void requestDelete(true)} disabled={busy || operation.kind !== "delete"} className="rounded px-2 py-1 text-[11px] text-red-700 hover:bg-red-100 disabled:opacity-40">强制删除</button></>}
        </div>
      )}
      {expanded && (
        <div className="mt-3 grid grid-cols-1 gap-3 border-t border-app-border/80 pt-3 lg:grid-cols-2">
          {quotaView.additional.length > 0 && <div className="lg:col-span-2"><CodexAdditionalQuota groups={quotaView.additional} /></div>}
          <label className={priorityMode ? "block" : "block lg:col-span-2"}>
            <span className="mb-1.5 block text-xs text-app-muted">显示名称（可选）</span>
            <input value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="例如 工作账号" className={inputClass(false)} />
          </label>
          {priorityMode && (
            <label className="block">
              <span className="mb-1.5 block text-xs text-app-muted">使用优先级</span>
              <input type="number" value={priority} onChange={(event) => setPriority(event.target.value)} className={inputClass(true)} />
              <span className="mt-1 block text-[11px] text-app-muted">数字越大越优先使用。</span>
            </label>
          )}
          <label className="block lg:col-span-2">
            <span className="mb-1.5 block text-xs text-app-muted">网络代理</span>
            <div className="flex flex-wrap gap-2">
              <DarkSelect
                value={proxyMode}
                onChange={(value) => setProxyMode(value as ProxyEditMode)}
                containerClassName="min-w-[12rem]"
                options={[
                  { value: "keep", label: "保持当前设置" },
                  { value: "replace", label: "更换网络代理" },
                  { value: "clear", label: "不使用网络代理" },
                ]}
              />
              {proxyMode === "replace" && (
                <input value={proxyUrl} onChange={(event) => setProxyUrl(event.target.value)} placeholder="例如 http://host:port" className={`${inputClass(true)} min-w-[18rem] flex-1`} />
              )}
            </div>
          </label>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => updateMutation.mutate()} disabled={busy || (priorityMode && (!priority.trim() || !Number.isFinite(Number(priority)))) || (proxyMode === "replace" && !proxyUrl.trim())} className="rounded bg-app-accent px-3 py-2 text-xs font-medium text-white hover:bg-app-accent-hover disabled:opacity-40">{updateMutation.isPending ? "保存中" : "保存账号"}</button>
          </div>
        </div>
      )}
      {errorText && <div className="mt-2 text-xs text-red-400">{errorText}</div>}
    </article>
  )
}

function CodexQuotaSummary({ view }: { view: ReturnType<typeof getCodexQuotaViewModel> }) {
  return (
    <div className="mt-2 space-y-1 text-[11px] text-app-muted">
      {view.emptyLabel && <div>额度：{view.emptyLabel}</div>}
      {view.primary && <CodexQuotaGroupView group={view.primary} />}
      {view.legacy.map((line, index) => <CodexQuotaLineView key={`${line.label}-${index}`} line={line} />)}
      {view.supplemental.map((line, index) => <CodexQuotaLineView key={`${line.label}-${index}`} line={line} />)}
      {(view.updatedAtLabel || view.sourceLabel) && <div>额度更新：{[view.updatedAtLabel, view.sourceLabel].filter(Boolean).join(" · ")}</div>}
    </div>
  )
}

function CodexAdditionalQuota({ groups }: { groups: CodexQuotaGroup[] }) {
  return (
    <section className="rounded border border-app-border/80 bg-app-surface/60 p-3">
      <div className="mb-2 text-xs font-medium text-app-primary">更多额度</div>
      <div className="space-y-2">{groups.map((group, index) => <CodexQuotaGroupView key={`${group.title}-${index}`} group={group} />)}</div>
    </section>
  )
}

function CodexQuotaGroupView({ group }: { group: CodexQuotaGroup }) {
  return (
    <div>
      <span className="font-medium text-app-secondary">{group.title}</span>
      {group.status && <span className="ml-2 text-amber-700">{group.status}</span>}
      {group.lines.map((line, index) => <CodexQuotaLineView key={`${line.label}-${index}`} line={line} />)}
    </div>
  )
}

function CodexQuotaLineView({ line }: { line: CodexQuotaLine }) {
  return <span className="ml-2">{line.label}{line.value ? ` · ${line.value}` : ""}{line.status ? ` · ${line.status}` : ""}{line.resetsAt ? ` · 重置时间 ${line.resetsAt}` : ""}</span>
}

function inputClass(mono: boolean) {
  return ["w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-2 text-sm text-app-primary outline-none placeholder:text-app-subtle focus:border-app-border-strong", mono ? "font-mono" : ""].join(" ")
}

function proxyLabel(proxy: CodexAccount["proxy"]) {
  if (!proxy.configured) return "未设置"
  return `${proxy.scheme ?? "proxy"}://${proxy.host ?? "已配置"}${proxy.port ? `:${proxy.port}` : ""}`
}
