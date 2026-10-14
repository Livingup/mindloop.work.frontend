import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, CheckCircle2, Loader2, Save } from "lucide-react"

import {
  getLacpClientStatus,
  getLacpSettings,
  updateLacpSettings,
  type LacpClientStatusResponse,
  type LacpSettingsResponse,
} from "@/features/chat/api/agentRuntimeApi"

export function LacpPage() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: ["lacp", "settings"], queryFn: getLacpSettings })
  const statusQuery = useQuery({
    queryKey: ["chat", "lacp-status"],
    queryFn: getLacpClientStatus,
    refetchInterval: 3000,
  })
  const saveMutation = useMutation({
    mutationFn: updateLacpSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(["lacp", "settings"], next)
      queryClient.invalidateQueries({ queryKey: ["chat", "lacp-status"] })
    },
  })

  return (
    <div className="h-full overflow-auto bg-app-bg px-8 py-7 text-app-primary">
      <header className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">LACP 设置</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-app-secondary">
            配置 AgentRuntime 进程级唯一的 LACP WebSocket 客户端。启用后，本地已注册的 Agent 实例可以被 Registry 发现并接收远程 Agent 消息。
          </p>
        </div>
        <LacpStatusCard status={statusQuery.data} isLoading={statusQuery.isLoading} error={statusQuery.error} />
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,0.8fr)]">
        <LacpSettingsPanel
          settings={settingsQuery.data}
          isLoading={settingsQuery.isLoading}
          error={settingsQuery.error}
          saving={saveMutation.isPending}
          saveError={saveMutation.error}
          onSave={(body) => saveMutation.mutate(body)}
        />
        <LacpHelpPanel settings={settingsQuery.data} status={statusQuery.data} />
      </div>
    </div>
  )
}

function LacpSettingsPanel({
  settings,
  isLoading,
  error,
  saving,
  saveError,
  onSave,
}: {
  settings: LacpSettingsResponse | undefined
  isLoading: boolean
  error: unknown
  saving: boolean
  saveError: unknown
  onSave: (body: { enabled: boolean; registry_url: string; api_key?: string | null }) => void
}) {
  const [enabled, setEnabled] = useState(false)
  const [registryUrl, setRegistryUrl] = useState("")
  const [apiKey, setApiKey] = useState("")

  useEffect(() => {
    if (!settings) return
    setEnabled(settings.enabled)
    setRegistryUrl(settings.registry_url)
    setApiKey(settings.api_key ?? "")
  }, [settings])

  const dirty = settings
    ? (
    enabled !== settings.enabled ||
    registryUrl !== settings.registry_url ||
    apiKey !== (settings.api_key ?? "")
    )
    : false
  const validationError = enabled && !registryUrl.trim()
    ? "启用 LACP 前必须填写 Registry URL。"
    : enabled && !apiKey.trim()
      ? "启用 LACP 前必须填写 API Key。"
      : null

  if (isLoading) {
    return (
      <div className="flex h-48 items-center justify-center gap-2 rounded-2xl border border-app-border/80 bg-app-surface/80 text-sm text-app-secondary">
        <Loader2 size={16} className="animate-spin" />
        正在加载 LACP 设置
      </div>
    )
  }

  if (error || !settings) {
    return (
      <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-100">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <AlertCircle size={16} />
          设置加载失败
        </div>
        <div>{error instanceof Error ? error.message : "无法加载 LACP 设置。"}</div>
      </div>
    )
  }

  return (
    <section className="rounded-2xl border border-app-border/80 bg-app-surface/80">
      <div className="border-b border-app-border/80 px-5 py-4">
        <h2 className="text-lg font-semibold text-app-primary">Registry 服务配置</h2>
        <p className="mt-1 text-sm leading-6 text-app-secondary">保存后端会写入运行时数据库并热重载 LACP client；API Key 不写入 YAML。</p>
      </div>
      <div className="space-y-5 p-5">
        <label className="flex items-center justify-between gap-4 rounded-xl border border-app-border/80 bg-white/[0.025] px-4 py-3">
          <div>
            <div className="text-sm font-medium text-app-primary">启用 LACP 客户端</div>
            <div className="mt-1 text-xs text-app-muted">启用后才会连接 Registry WebSocket。</div>
          </div>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
            className="h-4 w-4 accent-cyan-500"
          />
        </label>

        <Field label="Registry URL" hint="示例：https://lacp.mindloop.chat:48831 或 wss://host/ws">
          <input
            value={registryUrl}
            onChange={(event) => setRegistryUrl(event.target.value)}
            placeholder="https://lacp.example.com:48831"
            className="h-10 w-full rounded-lg border border-app-border/80 bg-app-surface/85 px-3 font-mono text-sm text-app-primary outline-none placeholder:text-app-subtle focus:border-cyan-400/50"
          />
        </Field>

        <Field
          label="API Key"
          hint={settings.api_key_configured ? "已配置，可重新输入覆盖。" : "尚未配置。启用 LACP 前必须填写。"}
        >
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="输入 LACP API Key"
            type="text"
            className="h-10 w-full rounded-lg border border-app-border/80 bg-app-surface/85 px-3 font-mono text-sm text-app-primary outline-none placeholder:text-app-subtle focus:border-cyan-400/50"
          />
        </Field>

        {validationError ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-500/10 p-3 text-xs text-amber-100">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {validationError}
          </div>
        ) : null}
        {saveError ? (
          <div className="flex items-start gap-2 rounded-lg border border-red-400/20 bg-red-500/10 p-3 text-xs text-red-100">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            {saveError instanceof Error ? saveError.message : "保存失败。"}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-app-border/80 pt-5">
          <button
            type="button"
            disabled={!dirty || saving || Boolean(validationError)}
            onClick={() => onSave({
              enabled,
              registry_url: registryUrl.trim(),
              api_key: apiKey,
            })}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-cyan-600 px-3 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            保存设置
          </button>
          <span className="text-xs text-app-muted">设置数据库：<span className="font-mono">{settings.db_path}</span></span>
        </div>
      </div>
    </section>
  )
}

function LacpStatusCard({
  status,
  isLoading,
  error,
}: {
  status: LacpClientStatusResponse | undefined
  isLoading: boolean
  error: unknown
}) {
  const view = useMemo(() => lacpStatusView(status), [status])
  return (
    <section className="min-w-[18rem] rounded-2xl border border-app-border/80 bg-app-surface/80 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-app-muted">WebSocket 状态</div>
        {isLoading ? <Loader2 size={13} className="animate-spin text-app-muted" /> : <StatusDot tone={view.tone} />}
      </div>
      <div className="mt-2 text-sm font-medium text-app-primary">{error ? "状态加载失败" : view.label}</div>
      <div className="mt-1 text-xs leading-5 text-app-secondary">{error instanceof Error ? error.message : view.detail}</div>
    </section>
  )
}

function LacpHelpPanel({ settings, status }: { settings: LacpSettingsResponse | undefined; status: LacpClientStatusResponse | undefined }) {
  return (
    <aside className="space-y-4">
      <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-5">
        <h2 className="text-sm font-semibold text-app-primary">注册前校验</h2>
        <div className="mt-4 space-y-3 text-sm">
          <CheckItem ok={settings?.enabled === true} label="LACP 客户端已启用" />
          <CheckItem ok={Boolean(settings?.registry_url?.trim())} label="Registry URL 已配置" />
          <CheckItem ok={settings?.api_key_configured === true} label="API Key 已配置" />
          <CheckItem ok={status?.connected === true} label="WebSocket 已连接" />
        </div>
      </section>
      <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-5 text-sm leading-6 text-app-secondary">
        <h2 className="mb-2 text-sm font-semibold text-app-primary">说明</h2>
        <p>只有完成启用、Registry URL 和 API Key 配置后，前端或后端才允许注册 Agent 实例到 LACP Registry。</p>
      </section>
    </aside>
  )
}

function Field({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-app-primary">{label}</span>
        <span className="text-xs text-app-muted">{hint}</span>
      </div>
      {children}
    </label>
  )
}

function CheckItem({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      {ok ? <CheckCircle2 size={14} className="text-emerald-400" /> : <AlertCircle size={14} className="text-amber-400" />}
      <span className={ok ? "text-app-primary" : "text-app-muted"}>{label}</span>
    </div>
  )
}

function StatusDot({ tone }: { tone: "ok" | "pending" | "danger" | "neutral" }) {
  const className = tone === "ok"
    ? "bg-emerald-400"
    : tone === "pending"
      ? "bg-amber-400"
      : tone === "danger"
        ? "bg-red-400"
        : "bg-slate-500"
  return <span className={`h-2 w-2 rounded-full ${className}`} />
}

function lacpStatusView(status: LacpClientStatusResponse | undefined): { label: string; detail: string; tone: "ok" | "pending" | "danger" | "neutral" } {
  if (!status) return { label: "未知", detail: "尚未读取 LACP 状态。", tone: "neutral" }
  if (!status.enabled) return { label: "未启用", detail: "LACP 客户端未启用。", tone: "neutral" }
  if (status.connected) return { label: "已连接", detail: `已注册 ${status.registered_count}/${status.registration_count} 个实例。`, tone: "ok" }
  if (status.last_error) return { label: "连接异常", detail: status.last_error, tone: "danger" }
  return { label: "连接中", detail: status.reconnect_attempt > 0 ? `正在第 ${status.reconnect_attempt} 次重连。` : "正在连接 Registry。", tone: "pending" }
}
