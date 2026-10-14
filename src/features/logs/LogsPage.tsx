import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle, Check, ChevronDown, ChevronRight, Clipboard, Database, FileSearch, RefreshCw, Search, ShieldAlert, Trash2 } from "lucide-react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"

import {
  createLogsCleanupJob,
  getLlmHttpTrace,
  getLogsCleanupJob,
  getLogsCleanupJobs,
  getLogsCapabilities,
  getLogsOverview,
  type LlmHttpTrace,
  type LlmHttpTraceUpstreamAttempt,
  type LogsCapabilities,
  type LogsCleanupCategory,
  type LogsCleanupJob,
  type LogsCleanupMode,
  type LogsCleanupRequest,
  type LogsCleanupResponse,
  type LogsCleanupStoreSpaceRelease,
  type LogsLifecycleFilter,
  type LogsSpaceReleaseMode,
} from "@/features/logs/logsApi"
import { HttpError } from "@/shared/api/httpClient"
import { useAppConfirm, useAppNotification } from "@/shared/interaction/AppInteractionProvider"

type MessageKind = "request" | "response"
type ViewMode = "raw" | "pretty"
type PrettyPayload = {
  value: unknown
  text: string
}
type PrettyPayloadOptions = {
  parseSse?: boolean
}
type PrettySseEvent = {
  index: number
  event?: string
  id?: string
  retry?: number | string
  data?: unknown
  comments?: string[]
}
type JsonExpansionOverrides = Record<string, boolean>
type HttpResponseEvidence = {
  kind: "status-received" | "no-response" | "status-not-received"
  label: string
}
type HttpResponseEvidenceSource = {
  status_code: number | null
  response_headers: Record<string, string>
  response_body_text: string | null
  response_body_bytes: number
  response_body_truncated: boolean
  response_body_redacted: boolean
  sse_event_count: number | null
}
type SdkTerminalStatus = "completed" | "incomplete" | "failed" | "cancelled" | "pending"

const JSON_STRING_PREVIEW_LENGTH = 160
const JSON_INDENT_PX = 18
const NO_HTTP_RESPONSE_RECEIVED = "NO HTTP RESPONSE RECEIVED"
const HTTP_RESPONSE_STATUS_NOT_RECEIVED = "HTTP RESPONSE STATUS NOT RECEIVED"

type LogsWorkspaceTab = "overview" | "cleanup" | "llm-http"

const LOGS_WORKSPACE_TABS: Array<{ id: LogsWorkspaceTab; label: string; path: string }> = [
  { id: "overview", label: "日志统计总览", path: "/logs/overview" },
  { id: "cleanup", label: "日志清理", path: "/logs/cleanup" },
  { id: "llm-http", label: "LLM HTTP Trace", path: "/logs/llm-http" },
]

const CLEANUP_LIFECYCLE_OPTIONS: Array<{ value: LogsLifecycleFilter; label: string }> = [
  { value: "ended_tasks", label: "已结束任务" },
  { value: "archived_scenes", label: "已归档 Scene" },
]

const CLEANUP_CATEGORY_OPTIONS: Array<{ value: LogsCleanupCategory; label: string }> = [
  { value: "communication_messages", label: "Communication messages" },
  { value: "chat_bubbles", label: "Chat Bubbles" },
  { value: "llm_http_trace", label: "LLM HTTP Trace" },
  { value: "context_compression_archive", label: "Context Compression archive" },
  { value: "terminal_history", label: "Terminal history" },
]

export function LogsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeTab = resolveLogsWorkspaceTab(location.pathname)

  const handleNavigate = (tab: LogsWorkspaceTab) => {
    const target = LOGS_WORKSPACE_TABS.find((item) => item.id === tab)?.path ?? "/logs/overview"
    navigate(tab === "llm-http" ? `${target}${location.search}` : target)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg text-app-primary">
      <header className="shrink-0 border-b border-app-border/80 bg-app-bg px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-sm font-semibold text-app-primary">日志工作区</h1>
          <nav className="flex flex-wrap items-center gap-2">
            {LOGS_WORKSPACE_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => handleNavigate(tab.id)}
                className={[
                  "inline-flex h-8 items-center gap-2 rounded-md px-3 text-xs transition",
                  activeTab === tab.id ? "bg-app-selected-strong text-white" : "border border-app-border/70 text-app-secondary hover:bg-app-surface-hover hover:text-app-primary",
                ].join(" ")}
              >
                {tab.id === "overview" ? <Database size={14} /> : tab.id === "cleanup" ? <Trash2 size={14} /> : <FileSearch size={14} />}
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <section className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "overview" ? <LogsOverviewPanel /> : activeTab === "cleanup" ? <LogsCleanupPanel /> : <LlmHttpTracePanel />}
      </section>
    </div>
  )
}

function resolveLogsWorkspaceTab(pathname: string): LogsWorkspaceTab {
  if (pathname.startsWith("/logs/cleanup")) return "cleanup"
  if (pathname.startsWith("/logs/llm-http")) return "llm-http"
  return "overview"
}

function LogsOverviewPanel() {
  const overviewQuery = useQuery({ queryKey: ["logs", "overview"], queryFn: getLogsOverview })

  return (
    <div className="h-full overflow-auto p-5">
      <section className="overflow-hidden rounded-lg border border-app-border/80 bg-app-surface/80">
        <div className="flex items-center justify-between gap-3 border-b border-app-border/80 px-4 py-3">
          <h2 className="text-sm font-semibold text-app-primary">日志统计总览</h2>
          <button
            type="button"
            onClick={() => void overviewQuery.refetch()}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-app-border/80 px-3 text-xs text-app-secondary transition hover:bg-app-surface-hover hover:text-app-primary"
          >
            <RefreshCw size={14} />
            刷新
          </button>
        </div>
        {overviewQuery.isError ? (
          <div className="p-4 text-xs text-red-300">{errorText(overviewQuery.error)}</div>
        ) : (
          <div className="overflow-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-app-border/80 text-app-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">存储</th>
                  <th className="px-4 py-3 font-medium">大小</th>
                  <th className="px-4 py-3 font-medium">记录</th>
                  <th className="px-4 py-3 font-medium">路径</th>
                </tr>
              </thead>
              <tbody>
                {(overviewQuery.data?.items ?? []).map((item) => (
                  <tr key={item.store_id} className="border-b border-app-border/50 last:border-0">
                    <td className="px-4 py-3 text-app-primary">{item.title}</td>
                    <td className="px-4 py-3 font-mono text-app-secondary">{formatBytes(item.size_bytes)}</td>
                    <td className="px-4 py-3 font-mono text-app-secondary">{item.record_count}</td>
                    <td className="break-all px-4 py-3 font-mono text-app-muted">{item.path}</td>
                  </tr>
                ))}
                <tr className="bg-app-surface-muted/60">
                  <td className="px-4 py-3 font-semibold text-app-primary">Total</td>
                  <td className="px-4 py-3 font-mono font-semibold text-app-primary">{formatBytes(overviewQuery.data?.total_size_bytes ?? 0)}</td>
                  <td className="px-4 py-3" />
                  <td className="px-4 py-3" />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function isLogsCapabilitiesResponse(value: unknown): value is LogsCapabilities {
  if (!value || typeof value !== "object") return false
  const record = value as Record<string, unknown>
  return (
    Array.isArray(record.supported_space_release_modes)
    && record.supported_space_release_modes.every((mode) => mode === "logical_only" || mode === "safe_physical_release")
    && typeof record.release_only_retry_supported === "boolean"
    && typeof record.pending_compaction_count === "number"
    && Number.isFinite(record.pending_compaction_count)
    && Array.isArray(record.pending_compactions)
  )
}

function normalizeLogsCapabilities(value: LogsCapabilities | undefined): LogsCapabilities {
  if (!isLogsCapabilitiesResponse(value)) {
    return {
      supported_space_release_modes: ["logical_only"],
      release_only_retry_supported: false,
      pending_compaction_count: 0,
      pending_compactions: [],
    }
  }
  return {
    supported_space_release_modes: value.supported_space_release_modes,
    release_only_retry_supported: value.release_only_retry_supported,
    pending_compaction_count: Math.max(0, Math.trunc(value.pending_compaction_count)),
    pending_compactions: value.pending_compactions.filter((item) => Boolean(item && typeof item === "object")),
  }
}

function LogsCleanupPanel() {
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const queryClient = useQueryClient()
  const executeConfirmationRef = useRef(false)
  const [selectedLifecycle, setSelectedLifecycle] = useState<LogsLifecycleFilter[]>([])
  const [selectedCategories, setSelectedCategories] = useState<LogsCleanupCategory[]>([])
  const [spaceReleaseMode, setSpaceReleaseMode] = useState<LogsSpaceReleaseMode>("logical_only")
  const [currentJobId, setCurrentJobId] = useState<string | null>(null)
  const [lastPreviewJob, setLastPreviewJob] = useState<LogsCleanupJob | null>(null)
  const [lastExecuteJob, setLastExecuteJob] = useState<LogsCleanupJob | null>(null)
  const [jobError, setJobError] = useState<unknown>(null)
  const [overviewRefreshError, setOverviewRefreshError] = useState<unknown>(null)
  const [jobStatusTick, setJobStatusTick] = useState(() => Date.now())
  const capabilitiesQuery = useQuery({
    queryKey: ["logs", "capabilities"],
    queryFn: getLogsCapabilities,
    retry: false,
  })
  const capabilities = normalizeLogsCapabilities(capabilitiesQuery.data)
  const safeReleaseSupported = capabilities.supported_space_release_modes.includes("safe_physical_release")
  const capabilitiesFallback = !isLogsCapabilitiesResponse(capabilitiesQuery.data)
  const request: LogsCleanupRequest = useMemo(() => ({
    lifecycle_filters: selectedLifecycle,
    categories: selectedCategories,
    space_release_mode: spaceReleaseMode,
    release_only: false,
  }), [selectedCategories, selectedLifecycle, spaceReleaseMode])
  const requestKey = JSON.stringify(request)
  const previewKey = lastPreviewJob?.result ? JSON.stringify({
    lifecycle_filters: lastPreviewJob.result.lifecycle_filters,
    categories: lastPreviewJob.result.categories,
    space_release_mode: lastPreviewJob.result.space_release_mode,
    release_only: lastPreviewJob.result.release_only,
  }) : ""
  const previewMatchesRequest = Boolean(
    lastPreviewJob?.result
    && previewKey === requestKey
    && lastPreviewJob.result.space_release_mode === spaceReleaseMode
    && lastPreviewJob.result.release_only === false
  )
  useEffect(() => {
    if (!safeReleaseSupported && spaceReleaseMode !== "logical_only") {
      setSpaceReleaseMode("logical_only")
      setLastPreviewJob(null)
      setLastExecuteJob(null)
      notify({
        title: "已降级为仅删除数据",
        message: "当前 Runtime 不提供安全空间释放能力；为避免静默降级，已禁用安全释放并要求重新预览。",
        tone: "warning",
      })
    }
  }, [notify, safeReleaseSupported, spaceReleaseMode])
  useEffect(() => {
    setLastPreviewJob(null)
    setLastExecuteJob(null)
  }, [selectedLifecycle, selectedCategories, spaceReleaseMode])
  const pendingExecuteJobsQuery = useQuery({
    queryKey: ["logs", "cleanup-jobs", "pending-execute"],
    queryFn: () => getLogsCleanupJobs({ limit: 5, activeOnly: true }),
    refetchInterval: (query) => {
      const hasPendingExecuteJob = (query.state.data?.items ?? []).some((job) => job.status === "queued" || job.status === "running")
      return hasPendingExecuteJob && !currentJobId ? 2000 : false
    },
    refetchIntervalInBackground: true,
    retry: 2,
  })
  const pendingExecuteJobs = pendingExecuteJobsQuery.data?.items ?? []
  const activeJobQuery = useQuery({
    queryKey: ["logs", "cleanup-job", currentJobId],
    queryFn: () => getLogsCleanupJob(currentJobId ?? ""),
    enabled: Boolean(currentJobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === "queued" || status === "running" ? 1000 : false
    },
    refetchIntervalInBackground: true,
    retry: 2,
  })
  const activeJob = activeJobQuery.data
  const isActiveJobVisible = activeJob?.status === "queued" || activeJob?.status === "running"
  const displayedJob = isActiveJobVisible ? activeJob : null
  const isJobRunning = isActiveJobVisible
  const lastJobRefreshAt = activeJobQuery.dataUpdatedAt > 0 ? activeJobQuery.dataUpdatedAt : null
  const activeJobElapsedMs = activeJob ? Math.max(0, jobStatusTick - new Date(activeJob.created_at).getTime()) : 0
  const activeJobRefreshLagMs = lastJobRefreshAt ? Math.max(0, jobStatusTick - lastJobRefreshAt) : null
  const isPollingJob = Boolean(currentJobId && isJobRunning)
  const createJobMutation = useMutation({
    mutationFn: ({ mode, request }: { mode: LogsCleanupMode; request: LogsCleanupRequest }) =>
      createLogsCleanupJob(mode, request),
    onSuccess: (job, variables) => {
      if (
        job.mode !== variables.mode
        || job.space_release_mode !== variables.request.space_release_mode
        || job.release_only !== Boolean(variables.request.release_only)
      ) {
        setJobError(new Error("Runtime 未回显与请求一致的清理模式或空间释放策略，任务结果已拒绝展示。"))
        return
      }
      setCurrentJobId(job.job_id)
      setJobError(null)
      if (job.mode === "preview") setLastExecuteJob(null)
    },
    onError: (error) => setJobError(error),
  })
  useEffect(() => {
    if (!isPollingJob) return
    const timerId = window.setInterval(() => setJobStatusTick(Date.now()), 1000)
    return () => window.clearInterval(timerId)
  }, [isPollingJob])

  useEffect(() => {
    if (currentJobId) return
    const recoverableJob = pendingExecuteJobs.find((job) => job.status === "queued" || job.status === "running")
    if (!recoverableJob) return
    setCurrentJobId(recoverableJob.job_id)
    setJobError(null)
    setJobStatusTick(Date.now())
  }, [currentJobId, pendingExecuteJobs])

  useEffect(() => {
    if (!activeJob || activeJob.status === "queued" || activeJob.status === "running") return
    const resultMatchesJob = !activeJob.result || (
      activeJob.result.mode === activeJob.mode
      && activeJob.result.space_release_mode === activeJob.space_release_mode
      && activeJob.result.release_only === activeJob.release_only
      && JSON.stringify(activeJob.result.lifecycle_filters) === JSON.stringify(activeJob.lifecycle_filters)
      && JSON.stringify(activeJob.result.categories) === JSON.stringify(activeJob.categories)
      && (
        activeJob.space_release_mode !== "safe_physical_release"
        || (
          activeJob.result.space_release?.requested_mode === "safe_physical_release"
          && !(activeJob.mode === "execute" && activeJob.result.space_release?.status === "preview_only")
          && !(activeJob.mode === "execute" && activeJob.result.space_release.stores.some((store) => store.status === "preview_only"))
        )
      )
    )
    if (!resultMatchesJob) {
      setJobError(new Error("Runtime 未回显完整且与任务一致的清理/空间释放结果，已拒绝展示。"))
    } else if (activeJob.mode === "preview") {
      const previewResultKey = activeJob.result ? JSON.stringify({
        lifecycle_filters: activeJob.result.lifecycle_filters,
        categories: activeJob.result.categories,
        space_release_mode: activeJob.result.space_release_mode,
        release_only: activeJob.result.release_only,
      }) : ""
      if (previewResultKey === requestKey && activeJob.space_release_mode === spaceReleaseMode) {
        setLastPreviewJob(activeJob)
      } else {
        setLastPreviewJob(null)
      }
    } else if (activeJob.mode === "execute") {
      if (activeJob.space_release_mode !== spaceReleaseMode && !activeJob.release_only) {
        setJobError(new Error("任务完成时空间释放模式已变化，结果已拒绝展示；请重新预览。"))
      } else {
        setLastExecuteJob(activeJob)
        if (activeJob.space_release_mode === "safe_physical_release") {
          void queryClient.refetchQueries({ queryKey: ["logs", "overview"] }).catch((error) => setOverviewRefreshError(error))
        }
      }
    }
    if (activeJob.status === "failed") setJobError(activeJob.error_message ? new Error(activeJob.error_message) : new Error("日志清理任务失败"))
    setCurrentJobId(null)
    void pendingExecuteJobsQuery.refetch()
  }, [activeJob, pendingExecuteJobsQuery, queryClient, requestKey, spaceReleaseMode])
  const canPreview = selectedLifecycle.length > 0 && selectedCategories.length > 0 && !createJobMutation.isPending && !isJobRunning
  const canExecute = Boolean(
    previewMatchesRequest
    && lastPreviewJob?.result
    && (
      lastPreviewJob.result.total_matched_count > 0
      || (
        spaceReleaseMode === "safe_physical_release"
        && (lastPreviewJob.result.space_release?.eligible_store_count ?? 0) > 0
      )
    )
    && !createJobMutation.isPending
    && !isJobRunning
  )
  const canReleaseOnlyRetry = Boolean(
    spaceReleaseMode === "safe_physical_release"
    && capabilities.release_only_retry_supported
    && lastExecuteJob?.result?.space_release
    && ["partial", "deferred_busy", "failed", "requires_runtime_restart", "requires_more_space"].includes(lastExecuteJob.result.space_release.status)
    && lastExecuteJob.result.space_release.stores.some((store) => store.eligible && !["released", "completed", "skipped_no_changes"].includes(store.status))
    && !createJobMutation.isPending
    && !isJobRunning
  )
  const cleanupInteractionStateRef = useRef({
    requestKey,
    previewKey,
    previewJobId: lastPreviewJob?.job_id ?? null,
    executeJobId: lastExecuteJob?.job_id ?? null,
    canExecute,
    canReleaseOnlyRetry,
    mutationPending: createJobMutation.isPending,
    jobRunning: isJobRunning,
  })
  cleanupInteractionStateRef.current = {
    requestKey,
    previewKey,
    previewJobId: lastPreviewJob?.job_id ?? null,
    executeJobId: lastExecuteJob?.job_id ?? null,
    canExecute,
    canReleaseOnlyRetry,
    mutationPending: createJobMutation.isPending,
    jobRunning: isJobRunning,
  }
  const result = lastExecuteJob?.result ?? lastPreviewJob?.result ?? undefined

  const handlePreview = () => {
    setLastExecuteJob(null)
    setJobError(null)
    setOverviewRefreshError(null)
    createJobMutation.mutate({ mode: "preview", request })
  }

  const handleExecute = async () => {
    if (!canExecute || executeConfirmationRef.current) return
    const targetRequest: LogsCleanupRequest = {
      lifecycle_filters: [...request.lifecycle_filters],
      categories: [...request.categories],
      space_release_mode: request.space_release_mode,
      release_only: false,
    }
    const targetRequestKey = requestKey
    const targetPreviewKey = previewKey
    const targetPreviewJobId = lastPreviewJob?.job_id ?? null
    executeConfirmationRef.current = true
    try {
      const confirmed = await confirm({
        title: "执行日志清理",
        description: spaceReleaseMode === "safe_physical_release"
          ? "将先删除当前预览命中的数据，再按选中日志库执行安全空间维护。空间充足时可执行 checkpoint/VACUUM；低磁盘或连接未完全退出时会保留已提交删除并延期到 Runtime 停止后重启的离线紧凑副本，不会强制关闭连接。"
          : "该操作只删除当前预览命中的已勾选类别；SQLite 文件空间不会压缩，删除形成的空闲页可供后续写入复用。受保护存储不会被删除。",
        confirmLabel: spaceReleaseMode === "safe_physical_release" ? "删除并安全释放空间" : "执行删除",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = cleanupInteractionStateRef.current
      if (
        !latest.canExecute
        || latest.mutationPending
        || latest.jobRunning
        || latest.requestKey !== targetRequestKey
        || latest.previewKey !== targetPreviewKey
        || latest.previewJobId !== targetPreviewJobId
      ) {
        notify({
          title: "未执行日志清理",
          message: "确认期间筛选条件、删除模式、预览结果或任务状态已变化，请重新预览后再执行。",
          tone: "warning",
        })
        return
      }
      setJobError(null)
      setOverviewRefreshError(null)
      createJobMutation.mutate({ mode: "execute", request: targetRequest })
    } finally {
      executeConfirmationRef.current = false
    }
  }
  const handleReleaseOnlyRetry = async () => {
    if (!canReleaseOnlyRetry || executeConfirmationRef.current || !lastExecuteJob) return
    const targetJobId = lastExecuteJob.job_id
    const targetMode = lastExecuteJob.space_release_mode
    executeConfirmationRef.current = true
    try {
      const confirmed = await confirm({
        title: "重试安全空间释放",
        description: "本次只重试已选日志库的安全空间维护，不会重复删除任何数据；仍会等待 SQLite 空闲并按实际完成后的 DB/WAL/SHM 文件测量结果展示。",
        confirmLabel: "仅释放空间",
        cancelLabel: "取消",
        tone: "warning",
      })
      if (!confirmed) return
      const latest = cleanupInteractionStateRef.current
      if (!latest.canReleaseOnlyRetry || latest.executeJobId !== targetJobId || spaceReleaseMode !== targetMode || latest.mutationPending || latest.jobRunning) {
        notify({
          title: "未重试空间释放",
          message: "确认期间任务、模式或状态已变化，请重新查看安全释放结果。",
          tone: "warning",
        })
        return
      }
      setJobError(null)
      setOverviewRefreshError(null)
      createJobMutation.mutate({
        mode: "execute",
        request: {
          lifecycle_filters: [...lastExecuteJob.lifecycle_filters],
          categories: [...lastExecuteJob.categories],
          space_release_mode: "safe_physical_release",
          release_only: true,
        },
      })
    } finally {
      executeConfirmationRef.current = false
    }
  }

  return (
    <div className="h-full overflow-auto p-5">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <section className="rounded-lg border border-app-border/80 bg-app-surface/80 p-4">
          <h2 className="text-sm font-semibold text-app-primary">日志清理</h2>
          <div className="mt-4 space-y-5">
            <div>
              <div className="text-xs font-medium text-app-secondary">生命周期过滤</div>
              <div className="mt-2 space-y-2">
                {CLEANUP_LIFECYCLE_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-app-secondary">
                    <input
                      type="checkbox"
                      checked={selectedLifecycle.includes(option.value)}
                      onChange={() => setSelectedLifecycle((current) => toggleSelection(current, option.value))}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-app-secondary">清理类别</div>
              <div className="mt-2 space-y-2">
                {CLEANUP_CATEGORY_OPTIONS.map((option) => (
                  <label key={option.value} className="flex items-center gap-2 text-sm text-app-secondary">
                    <input
                      type="checkbox"
                      checked={selectedCategories.includes(option.value)}
                      onChange={() => setSelectedCategories((current) => toggleSelection(current, option.value))}
                    />
                    {option.label}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="text-xs font-medium text-app-secondary">数据删除模式</div>
              <div className="mt-2 space-y-2">
                <label className="flex items-start gap-2 rounded-md border border-app-border/70 bg-app-surface-muted/30 px-3 py-2 text-sm text-app-secondary">
                  <input
                    type="radio"
                    name="logs-space-release-mode"
                    value="logical_only"
                    checked={spaceReleaseMode === "logical_only"}
                    onChange={() => setSpaceReleaseMode("logical_only")}
                  />
                  <span><strong className="text-app-primary">仅删除数据（默认）</strong><span className="mt-0.5 block text-xs text-app-muted">真实 DELETE；不压缩 SQLite 文件空间，空闲页留给后续写入复用。</span></span>
                </label>
                <label className={["flex items-start gap-2 rounded-md border px-3 py-2 text-sm", safeReleaseSupported ? "border-app-border/70 bg-app-surface-muted/30 text-app-secondary" : "cursor-not-allowed border-app-border/50 bg-app-surface-muted/20 text-app-muted"].join(" ")}>
                  <input
                    type="radio"
                    name="logs-space-release-mode"
                    value="safe_physical_release"
                    checked={spaceReleaseMode === "safe_physical_release"}
                    disabled={!safeReleaseSupported}
                    onChange={() => setSpaceReleaseMode("safe_physical_release")}
                  />
                  <span><strong className="text-app-primary">删除数据并安全释放空间</strong><span className="mt-0.5 block text-xs text-app-muted">可能更耗时；等待日志 I/O/数据库空闲，并需要 VACUUM 临时磁盘空间。安全条件不足时只报告/跳过。</span></span>
                </label>
              </div>
              {capabilitiesFallback ? <div className="mt-2 text-xs text-app-warning">当前 Runtime 未提供完整能力协商，已仅提供逻辑删除；为避免误报物理释放，请升级 Runtime。</div> : null}
              {!capabilitiesFallback && capabilities.pending_compaction_count > 0 ? (
                <div className="mt-2 rounded-md border border-app-warning-border bg-app-warning-surface px-3 py-2 text-xs leading-5 text-app-warning">
                  <div className="font-semibold">检测到 {capabilities.pending_compaction_count} 个待处理离线紧凑副本</div>
                  <div className="mt-1">数据删除可以已经提交，但源库尚未证明已缩小；请停止全部 Runtime worker 后重启，再由受控维护窗口完成校验、替换和重开。</div>
                  <div className="mt-1">{capabilities.pending_compactions.map((item) => `${item.store_id}：目标 ${formatOptionalBytes(item.compact_target_size_bytes)}，可用 ${formatOptionalBytes(item.available_bytes)}${item.error_code ? `（${item.error_code}）` : ""}`).join("；")}</div>
                </div>
              ) : null}
            </div>
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-950">
              <div className="flex items-center gap-2 font-semibold text-amber-950"><ShieldAlert size={14} className="text-amber-700" />受保护存储不会删除</div>
              <div className="mt-1 text-amber-900">Conversation history / Agent Trace Markdown / File resources/archive</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canPreview}
                onClick={handlePreview}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-app-accent px-4 text-sm font-medium text-white transition hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:bg-app-selected disabled:text-app-muted"
              >
                {createJobMutation.isPending || (isJobRunning && activeJob?.mode === "preview") ? <RefreshCw size={15} className="animate-spin" /> : <Search size={15} />}
                {createJobMutation.isPending || (isJobRunning && activeJob?.mode === "preview") ? "预览任务运行中" : "预览影响"}
              </button>
              <button
                type="button"
                disabled={!canExecute}
                onClick={handleExecute}
                className="inline-flex h-9 items-center gap-2 rounded-md bg-app-danger px-4 text-sm font-medium text-white transition hover:bg-app-danger-hover disabled:cursor-not-allowed disabled:bg-app-selected disabled:text-app-muted"
              >
                {createJobMutation.isPending || (isJobRunning && activeJob?.mode === "execute") ? <RefreshCw size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {createJobMutation.isPending || (isJobRunning && activeJob?.mode === "execute") ? "清理任务运行中" : spaceReleaseMode === "safe_physical_release" ? "删除并安全释放空间" : "执行删除"}
              </button>
              {canReleaseOnlyRetry ? (
                <button
                  type="button"
                  onClick={handleReleaseOnlyRetry}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-app-warning-border bg-app-warning-surface px-4 text-sm font-medium text-app-warning transition hover:bg-app-surface-hover"
                >
                  <RefreshCw size={15} />
                  仅重试空间释放
                </button>
              ) : null}
            </div>
            <CleanupRecoveryStatus
              isLoading={pendingExecuteJobsQuery.isLoading}
              isError={pendingExecuteJobsQuery.isError}
              error={pendingExecuteJobsQuery.error}
              activeCount={pendingExecuteJobsQuery.data?.active_count ?? pendingExecuteJobs.length}
              retentionNote={pendingExecuteJobsQuery.data?.retention_note}
              onRetry={() => void pendingExecuteJobsQuery.refetch()}
            />
            <CleanupJobStatus
              job={displayedJob}
              isPolling={isPollingJob}
              isFetching={activeJobQuery.isFetching}
              isError={activeJobQuery.isError}
              lastRefreshAt={lastJobRefreshAt}
              elapsedMs={activeJobElapsedMs}
              refreshLagMs={activeJobRefreshLagMs}
              onRetry={() => void activeJobQuery.refetch()}
            />
            {jobError ? <InlineError error={jobError} /> : null}
            {activeJobQuery.isError ? <InlineError error={activeJobQuery.error} prefix="轮询任务状态失败" /> : null}
            {overviewRefreshError ? <InlineError error={overviewRefreshError} prefix="日志容量总览刷新失败；空间维护结果不受此网络刷新错误影响" /> : null}
          </div>
        </section>
        <CleanupResultPanel
          result={result}
          activeJob={displayedJob}
          isPolling={isPollingJob}
          elapsedMs={activeJobElapsedMs}
          canReleaseOnlyRetry={canReleaseOnlyRetry}
          onReleaseOnlyRetry={handleReleaseOnlyRetry}
        />
      </div>
    </div>
  )
}

function CleanupRecoveryStatus({
  isLoading,
  isError,
  error,
  activeCount,
  retentionNote,
  onRetry,
}: {
  isLoading: boolean
  isError: boolean
  error: unknown
  activeCount: number
  retentionNote: string | undefined
  onRetry: () => void
}) {
  if (isError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-5 text-red-950">
        <div className="flex flex-wrap items-center gap-2">
          <AlertTriangle size={14} className="text-red-700" />
          <span className="font-semibold">查询未完成删除任务失败：{errorText(error)}</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-red-300 bg-white px-2 text-[11px] font-medium text-red-800 transition hover:bg-red-100"
          >
            <RefreshCw size={12} />
            重试查询
          </button>
        </div>
      </div>
    )
  }
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-800">
        <RefreshCw size={14} className="animate-spin text-slate-600" />
        正在查询未完成的数据删除任务…
      </div>
    )
  }
  if (activeCount <= 0) return null
  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-950">
      <div className="flex items-center gap-2 font-semibold"><RefreshCw size={14} className="animate-spin text-blue-700" />已恢复 {activeCount} 个未完成删除任务，正在继续轮询。</div>
      {retentionNote ? <div className="mt-1 text-blue-900">{retentionNote}</div> : null}
    </div>
  )
}

function CleanupJobStatus({
  job,
  isPolling,
  isFetching,
  isError,
  lastRefreshAt,
  elapsedMs,
  refreshLagMs,
  onRetry,
}: {
  job: LogsCleanupJob | null | undefined
  isPolling: boolean
  isFetching: boolean
  isError: boolean
  lastRefreshAt: number | null
  elapsedMs: number
  refreshLagMs: number | null
  onRetry: () => void
}) {
  if (!job) return null
  const statusLabel = job.status === "queued" ? "排队中" : job.status === "running" ? "运行中" : job.status === "succeeded" ? "已完成" : job.status === "cancelled" ? "已取消" : "失败"
  const isActive = job.status === "queued" || job.status === "running"
  const jobTitle = job.mode === "execute" ? "未完成删除任务" : "预览任务"
  const phaseText = formatCleanupPhase(job)
  const pollingText = isPolling
    ? isFetching
      ? "正在轮询任务状态…本次刷新中"
      : `正在轮询任务状态…每 1 秒自动刷新${refreshLagMs !== null ? `，距上次响应 ${formatDuration(refreshLagMs)}` : ""}`
    : job.status === "succeeded"
      ? "任务已完成，轮询已停止"
      : job.status === "failed"
        ? "任务失败，轮询已停止"
        : job.status === "cancelled"
          ? "任务已取消，轮询已停止"
          : "等待任务状态"
  return (
    <div
      className={[
        "rounded-md border px-3 py-2 text-xs leading-5",
        isActive ? "border-blue-200 bg-blue-50 text-blue-950" : job.status === "failed" ? "border-red-200 bg-red-50 text-red-950" : "border-app-border/70 bg-app-surface-muted/40 text-app-secondary",
      ].join(" ")}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-2 font-semibold text-blue-950">
          {isActive ? <RefreshCw size={14} className="animate-spin text-blue-700" /> : job.status === "succeeded" ? <Check size={14} className="text-emerald-700" /> : <AlertTriangle size={14} className="text-red-700" />}
          {jobTitle}：{statusLabel}
        </div>
        {isPolling ? <span className="rounded-full border border-blue-300 bg-white px-2 py-0.5 font-mono text-[10px] font-medium text-blue-800">自动轮询中</span> : null}
      </div>
      <div className="mt-1 font-mono text-blue-900">ID {job.job_id}</div>
      <div className="mt-1 text-blue-900">
        模式 {job.mode === "execute" ? job.release_only ? "仅释放空间" : "执行删除" : "预览影响"} · 空间模式 {job.space_release_mode === "safe_physical_release" ? "安全释放" : "仅删除数据"} · 状态 {job.status}
      </div>
      <div className="mt-1 text-blue-900">阶段 {phaseText} · 条件 {formatLifecycleFilters(job.lifecycle_filters)} · 类别 {formatCleanupCategories(job.categories)}</div>
      <div className="mt-1 text-blue-950">
        {pollingText} · 已耗时 {formatDuration(elapsedMs)}
        {lastRefreshAt ? ` · 上次刷新 ${formatTime(lastRefreshAt)}` : " · 尚未收到首次状态"}
      </div>
      {isError ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-red-950">
          <span>轮询请求失败，可能是网络波动或后端暂不可达。</span>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-red-300 bg-white px-2 text-[11px] font-medium text-red-800 transition hover:bg-red-100"
          >
            <RefreshCw size={12} />
            立即重试
          </button>
        </div>
      ) : null}
    </div>
  )
}

function CleanupResultPanel({
  result,
  activeJob,
  isPolling,
  elapsedMs,
  canReleaseOnlyRetry,
  onReleaseOnlyRetry,
}: {
  result: LogsCleanupResponse | undefined
  activeJob: LogsCleanupJob | null | undefined
  isPolling: boolean
  elapsedMs: number
  canReleaseOnlyRetry: boolean
  onReleaseOnlyRetry: () => void
}) {
  if (!result) {
    return (
      <section className="rounded-lg border border-app-border/80 bg-app-surface/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-app-primary">预览结果</div>
          {isPolling && activeJob ? <ActiveJobBadge job={activeJob} elapsedMs={elapsedMs} /> : null}
        </div>
        {isPolling && activeJob ? (
          <div className="mt-4 rounded-md border border-app-border/80 bg-app-surface-muted/50 px-3 py-2 text-xs leading-5 text-app-secondary">
            <div className="inline-flex items-center gap-2 font-semibold"><RefreshCw size={14} className="animate-spin text-app-accent" />{formatCleanupPhase(activeJob)}</div>
            <div className="mt-1 text-app-muted">当前状态 {activeJob.status}，前端正在轮询任务状态，结果会在任务完成后自动刷新显示。</div>
          </div>
        ) : null}
      </section>
    )
  }
  return (
    <section className="overflow-hidden rounded-lg border border-app-border/80 bg-app-surface/80">
      <div className="flex items-center justify-between gap-3 border-b border-app-border/80 px-4 py-3">
        <div className="text-sm font-semibold text-app-primary">{result.release_only ? "仅空间释放结果" : result.mode === "execute" ? "删除结果" : "预览结果"}</div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isPolling && activeJob ? <ActiveJobBadge job={activeJob} elapsedMs={elapsedMs} /> : null}
          <div className="font-mono text-xs text-app-muted">Task {result.scope.task_count} · Scene {result.scope.scene_count}</div>
        </div>
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-app-border/80 text-app-muted">
            <tr>
              <th className="px-4 py-3 font-medium">类别</th>
              <th className="px-4 py-3 font-medium">命中</th>
              <th className="px-4 py-3 font-medium">SQLite 行删除</th>
              <th className="px-4 py-3 font-medium">归档文件删除</th>
            </tr>
          </thead>
          <tbody>
            {result.category_results.map((item) => (
              <tr key={item.category} className="border-b border-app-border/50 last:border-0">
                <td className="px-4 py-3 text-app-primary">{item.label}</td>
                <td className="px-4 py-3 font-mono text-app-secondary">{item.matched_count}</td>
                <td className="px-4 py-3 font-mono text-app-secondary">{item.deleted_count}</td>
                <td className="px-4 py-3 font-mono text-app-secondary">{item.archive_files_deleted_count || "—"}</td>
              </tr>
            ))}
            <tr className="bg-app-surface-muted/60">
              <td className="px-4 py-3 font-semibold text-app-primary">Total</td>
              <td className="px-4 py-3 font-mono font-semibold text-app-primary">{result.total_matched_count}</td>
              <td className="px-4 py-3 font-mono font-semibold text-app-primary">{result.total_deleted_count}</td>
              <td className="px-4 py-3 font-mono font-semibold text-app-primary">{result.category_results.reduce((count, item) => count + item.archive_files_deleted_count, 0) || "—"}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className={["border-t px-4 py-3 text-xs leading-5", result.logical_delete_committed ? "border-app-warning-border bg-app-warning-surface text-app-warning" : "border-app-border/70 bg-app-surface-muted/40 text-app-muted"].join(" ")}>
        {result.release_only
          ? "本次为仅空间释放重试：没有重复 DELETE。"
          : result.logical_delete_committed
            ? result.cleanup_outcome === "completed"
              ? "逻辑 DELETE 已提交；物理空间释放结果见下方实测。"
              : "数据删除已提交；当前维护/VACUUM 未完成或仍待离线重启，不代表删除失败。"
            : "当前结果不是已提交的逻辑删除。"}
      </div>
      {result.space_release ? <CleanupSpaceReleaseSummary spaceRelease={result.space_release} releaseOnly={result.release_only} canReleaseOnlyRetry={canReleaseOnlyRetry} onReleaseOnlyRetry={onReleaseOnlyRetry} /> : null}
    </section>
  )
}

function CleanupSpaceReleaseSummary({
  spaceRelease,
  releaseOnly,
  canReleaseOnlyRetry,
  onReleaseOnlyRetry,
}: {
  spaceRelease: NonNullable<LogsCleanupResponse["space_release"]>
  releaseOnly: boolean
  canReleaseOnlyRetry: boolean
  onReleaseOnlyRetry: () => void
}) {
  const isLogicalOnly = spaceRelease.requested_mode === "logical_only"
  const statusText = formatSpaceReleaseStatus(spaceRelease.status)
  const sourceVolumeWorkspaceDeferredStores = spaceRelease.stores.filter(
    (store) => store.error_code === "source_volume_workspace_insufficient",
  )
  const pendingCompactionStores = spaceRelease.stores.filter((store) => (
    store.compaction_pending
    || store.status === "requires_runtime_restart"
    || store.status === "requires_more_space"
  ))
  const targetSpaceInsufficientStores = pendingCompactionStores.filter((store) => (
    store.error_code === "compact_target_space_insufficient"
    || store.status === "requires_more_space"
  ))
  return (
    <div className="border-t border-app-border/80 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-app-primary">SQLite 空间释放</div>
          <div className="mt-1 text-xs text-app-muted">模式：{isLogicalOnly ? "仅删除数据" : "删除数据并安全释放空间"} · 状态：{statusText}</div>
        </div>
        {canReleaseOnlyRetry ? (
          <button
            type="button"
            onClick={onReleaseOnlyRetry}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-app-warning-border bg-app-warning-surface px-3 text-xs font-medium text-app-warning transition hover:bg-app-surface-hover"
          >
            <RefreshCw size={13} />
            仅重试空间释放
          </button>
        ) : null}
      </div>
      {canReleaseOnlyRetry ? (
        <div className="mt-2 text-xs leading-5 text-app-muted">“仅重试空间释放”只重新尝试安全维护，不会重复删除任何数据。</div>
      ) : null}
      {isLogicalOnly ? (
        <div className="mt-3 rounded-md border border-app-warning-border bg-app-warning-surface px-3 py-2 text-xs leading-5 text-app-warning">
          SQLite 文件空间未压缩。删除的 SQLite 行形成空闲页，可供后续写入复用；删除数量不是释放字节。
        </div>
      ) : (
        <>
          {sourceVolumeWorkspaceDeferredStores.length > 0 ? (
            <div className="mt-3 rounded-md border border-app-warning-border bg-app-warning-surface px-3 py-2 text-xs leading-5 text-app-warning">
              <div className="font-semibold">
                {releaseOnly
                  ? "此前数据删除已提交；本次仅重试空间释放时源卷临时空间仍不足，当前维护未启动/未释放；这不代表删除失败。"
                  : "数据删除已提交；源卷临时空间不足，当前维护未启动/未释放；这不代表删除失败。"}
              </div>
              <div className="mt-1">VACUUM 未启动/未执行，实际回收为 0 B。{sourceVolumeWorkspaceDeferredStores.map((store) => `${formatCleanupCategories([store.store_id])}：当前 Runtime 保守预检需 ${formatOptionalBytes(store.required_working_bytes)}，可用 ${formatOptionalBytes(store.available_bytes)}；离线紧凑目标 ${formatOptionalBytes(store.required_compact_target_size_bytes ?? store.compact_target_size_bytes)}。`).join(" ")}</div>
              <div className="mt-1">请停止全部 Runtime worker 后重启，由受控离线维护完成 compact-copy、校验和替换；“仅重试空间释放”不会重复 DELETE。</div>
              <div className="mt-1">该预检阈值不是 SQLite 的固定必需值；VACUUM 在不同条件下可能需要约两倍数据库大小的临时空间。</div>
              <div className="mt-1">逻辑 DELETE 已提交；freelist 空闲页只表示 SQLite 可复用/可能缩减的页面，不是已释放字节。当前未启动 checkpoint 或 VACUUM，主库未压缩，WAL 与主库大小均以表中的实测值为准。</div>
            </div>
          ) : null}
          {pendingCompactionStores.length > 0 && sourceVolumeWorkspaceDeferredStores.length === 0 ? (
            <div className="mt-3 rounded-md border border-app-warning-border bg-app-warning-surface px-3 py-2 text-xs leading-5 text-app-warning">
              <div className="font-semibold">数据删除已提交；当前源库尚未证明已物理缩小，不代表删除失败。</div>
              <div className="mt-1">{targetSpaceInsufficientStores.length > 0 ? "紧凑副本目标空间不足，VACUUM INTO 未启动或未完成；请先释放/扩展源卷空间。" : "当前 Runtime presence/维护窗口未满足，未执行安全替换；请停止全部 Runtime worker 后重启。"}</div>
              <div className="mt-1">{pendingCompactionStores.map((store) => `${formatCleanupCategories([store.store_id])}：目标 ${formatOptionalBytes(store.required_compact_target_size_bytes ?? store.compact_target_size_bytes)}，可用 ${formatOptionalBytes(store.available_bytes)}${store.pending_manifest_epoch ? `，manifest ${store.pending_manifest_epoch}` : ""}${store.error_code ? `（${store.error_code}）` : ""}`).join("；")}</div>
              <div className="mt-1">当前实测回收 {formatBytes(spaceRelease.reclaimed_size_bytes)}；生成临时副本本身不代表 live DB 已释放空间。请使用“仅重试空间释放”时注意不会重复 DELETE。</div>
            </div>
          ) : null}
          <div className={["mt-3 rounded-md border px-3 py-2 text-xs leading-5", spaceRelease.status === "completed" || spaceRelease.status === "skipped_no_changes" ? "border-app-success-border bg-app-success-surface text-app-success" : "border-app-warning-border bg-app-warning-surface text-app-warning"].join(" ")}>
            {releaseOnly
              ? "本次未重复删除数据，仅尝试安全释放已有 SQLite 空闲空间。"
              : spaceRelease.status === "completed" || spaceRelease.status === "skipped_no_changes"
                ? "数据删除阶段已完成；SQLite 空间维护结果以实际 DB/WAL/SHM 文件测量为准。"
                : "数据删除阶段已完成；空间释放未完成或仅部分完成，详见各日志库原因。"}
          </div>
          <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">
            <div><dt className="text-app-muted">Eligible stores</dt><dd className="mt-0.5 font-mono text-app-primary">{spaceRelease.eligible_store_count}</dd></div>
            <div><dt className="text-app-muted">待处理库</dt><dd className="mt-0.5 font-mono text-app-primary">{spaceRelease.pending_compaction_count}</dd></div>
            <div><dt className="text-app-muted">实际回收</dt><dd className="mt-0.5 font-mono text-app-primary">{formatBytes(spaceRelease.reclaimed_size_bytes)}</dd></div>
            <div><dt className="text-app-muted">freelist 潜在可复用量</dt><dd className="mt-0.5 font-mono text-app-primary">{formatOptionalBytes(spaceRelease.freelist_potential_bytes)}</dd></div>
            <div><dt className="text-app-muted">紧凑目标大小</dt><dd className="mt-0.5 font-mono text-app-primary">{formatOptionalBytes(spaceRelease.required_compact_target_size_bytes ?? spaceRelease.compact_target_size_bytes)}</dd></div>
            <div><dt className="text-app-muted">紧凑副本输出</dt><dd className="mt-0.5 font-mono text-app-primary">{formatOptionalBytes(spaceRelease.compact_output_size_bytes)}</dd></div>
            <div><dt className="text-app-muted">维护前总大小</dt><dd className="mt-0.5 font-mono text-app-primary">{formatOptionalBytes(spaceRelease.before_total_size_bytes)}</dd></div>
            <div><dt className="text-app-muted">维护后总大小</dt><dd className="mt-0.5 font-mono text-app-primary">{formatOptionalBytes(spaceRelease.after_total_size_bytes)}</dd></div>
            <div><dt className="text-app-muted">有符号净变化</dt><dd className="mt-0.5 font-mono text-app-primary">{formatSignedBytes(spaceRelease.net_size_change_bytes)}</dd></div>
          </dl>
          {spaceRelease.stores.length > 0 ? (
            <div className="mt-4 overflow-auto rounded-md border border-app-border/70">
              <table className="min-w-full text-left text-xs">
                <thead className="border-b border-app-border/80 bg-app-surface-muted/60 text-app-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">日志库</th>
                    <th className="px-3 py-2 font-medium">状态</th>
                    <th className="px-3 py-2 font-medium">DB（前 → 后）</th>
                    <th className="px-3 py-2 font-medium">WAL（前 → 后）</th>
                    <th className="px-3 py-2 font-medium">SHM（前 → 后）</th>
                    <th className="px-3 py-2 font-medium">实际回收 / 净变化</th>
                    <th className="px-3 py-2 font-medium">说明</th>
                  </tr>
                </thead>
                <tbody>
                  {spaceRelease.stores.map((store) => (
                    <tr key={store.store_id} className="border-b border-app-border/50 align-top last:border-0">
                      <td className="px-3 py-2 text-app-primary">{formatCleanupCategories([store.store_id])}</td>
                      <td className="px-3 py-2 font-medium text-app-secondary">{formatStoreReleaseStatus(store.status)}</td>
                      <td className="px-3 py-2 font-mono text-app-secondary">{formatOptionalBytes(store.before_db_size_bytes)} → {formatOptionalBytes(store.after_db_size_bytes)}</td>
                      <td className="px-3 py-2 font-mono text-app-secondary">{formatOptionalBytes(store.before_wal_size_bytes)} → {formatOptionalBytes(store.after_wal_size_bytes)}</td>
                      <td className="px-3 py-2 font-mono text-app-secondary">{formatOptionalBytes(store.before_shm_size_bytes)} → {formatOptionalBytes(store.after_shm_size_bytes)}</td>
                      <td className="px-3 py-2 font-mono text-app-secondary">{formatBytes(store.reclaimed_size_bytes)} / {formatSignedBytes(store.net_size_change_bytes)}</td>
                      <StoreReleaseExplanation store={store} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {spaceRelease.warnings.length > 0 ? (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs leading-5 text-app-warning">
              {spaceRelease.warnings.map((warning, index) => <li key={`${warning}-${index}`}>{warning}</li>)}
            </ul>
          ) : null}
        </>
      )}
    </div>
  )
}

function StoreReleaseExplanation({ store }: { store: LogsCleanupStoreSpaceRelease }) {
  const sourceVolumeWorkspaceInsufficient = store.error_code === "source_volume_workspace_insufficient"
  const compactTargetSpaceInsufficient = store.error_code === "compact_target_space_insufficient" || store.status === "requires_more_space"
  const pendingRestart = store.compaction_pending || store.status === "requires_runtime_restart" || store.status === "requires_more_space"
  const hasPageDiagnostics = (
    store.page_size_bytes !== null
    || store.page_count !== null
    || store.freelist_count !== null
    || store.auto_vacuum_mode !== null
    || store.freelist_potential_bytes !== null
  )
  return (
    <td className="max-w-xs px-3 py-2 text-app-muted">
      {sourceVolumeWorkspaceInsufficient ? (
        <>
          <div className="font-medium text-app-warning">源卷临时工作区不足（{store.error_code}）</div>
          <div className="mt-1">当前 Runtime 保守预检需 {formatOptionalBytes(store.required_working_bytes)}；可用 {formatOptionalBytes(store.available_bytes)}。</div>
          <div className="mt-1">VACUUM 未启动/未执行；实际回收为 0 B。该预检阈值不是 SQLite 的固定必需值。{store.message ? ` ${store.message}` : ""}</div>
        </>
      ) : (
        <>
          <div>{store.message ?? store.error_code ?? "—"}</div>
          {pendingRestart ? (
            <div className="mt-1 font-medium text-app-warning">
              {compactTargetSpaceInsufficient
                ? `紧凑副本目标空间不足：目标 ${formatOptionalBytes(store.required_compact_target_size_bytes ?? store.compact_target_size_bytes)}，可用 ${formatOptionalBytes(store.available_bytes)}；源库保持不变。`
                : "需要停止全部 Runtime worker 后重启，才能取得离线替换边界；当前未宣称 live DB 已释放空间。"}
            </div>
          ) : null}
          {store.compact_copy_started ? <div className="mt-1">已生成并校验紧凑副本 {formatOptionalBytes(store.compact_output_size_bytes)}；只有受控替换、重开和实测完成才计入物理回收。</div> : null}
          {store.vacuum_started ? <div className="mt-1">VACUUM/紧凑副本已启动；结果以完成后的 DB/WAL/SHM 文件实测为准。</div> : null}
        </>
      )}
      {hasPageDiagnostics ? (
        <div className="mt-1">SQLite 页面诊断：页大小 {formatOptionalBytes(store.page_size_bytes)}；总页 {store.page_count ?? "—"}；freelist 空闲页 {store.freelist_count ?? "—"}；auto_vacuum {store.auto_vacuum_mode ?? "—"}；freelist 潜在可复用量 {formatOptionalBytes(store.freelist_potential_bytes)}（不是已释放字节）。</div>
      ) : null}
    </td>
  )
}


function ActiveJobBadge({ job, elapsedMs }: { job: LogsCleanupJob; elapsedMs: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-50 px-2 py-1 text-[11px] font-medium text-blue-800">
      <RefreshCw size={12} className="animate-spin text-blue-700" />
      {job.mode === "execute" ? "删除" : "预览"} {job.status} · {formatDuration(elapsedMs)}
    </span>
  )
}

function InlineError({ error, prefix }: { error: unknown; prefix?: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-950">
      <AlertTriangle size={14} className="text-red-700" />
      {prefix ? `${prefix}：` : ""}{errorText(error)}
    </div>
  )
}

function toggleSelection<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function formatCleanupPhase(job: LogsCleanupJob): string {
  if (job.phase === "resolving_scope") return "正在解析生命周期范围"
  if (job.phase === "deleting_data") return "正在删除选中的日志数据"
  if (job.phase === "releasing_space") {
    return job.active_store_id ? `正在安全释放 ${formatCleanupCategories([job.active_store_id])} 的 SQLite 空间` : "正在安全释放 SQLite 空间"
  }
  if (job.phase === "compact_copying") return job.active_store_id ? `正在生成并校验 ${formatCleanupCategories([job.active_store_id])} 的紧凑副本` : "正在生成并校验紧凑副本"
  if (job.phase === "swapping") return "正在执行受控旧库备份与副本替换"
  if (job.phase === "reopening") return "正在重开数据库并执行 WAL checkpoint/quick_check"
  if (job.phase === "completed") return "任务已完成"
  return "任务失败"
}

function formatLifecycleFilters(filters: LogsLifecycleFilter[]): string {
  if (filters.length === 0) return "未选择"
  return filters.map((filter) => CLEANUP_LIFECYCLE_OPTIONS.find((option) => option.value === filter)?.label ?? filter).join(" / ")
}

function formatCleanupCategories(categories: LogsCleanupCategory[]): string {
  if (categories.length === 0) return "未选择"
  return categories.map((category) => CLEANUP_CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category).join(" / ")
}

function formatSpaceReleaseStatus(status: NonNullable<LogsCleanupResponse["space_release"]>["status"]): string {
  if (status === "not_requested") return "未请求"
  if (status === "preview_only") return "仅预览"
  if (status === "completed") return "已完成"
  if (status === "partial") return "部分完成"
  if (status === "skipped_no_changes") return "未检测到可测量缩减"
  if (status === "deferred_busy") return "因数据库忙而延期"
  if (status === "requires_runtime_restart") return "需重启 Runtime 后离线释放"
  if (status === "requires_more_space") return "紧凑目标空间不足"
  return "失败"
}

function formatStoreReleaseStatus(status: NonNullable<LogsCleanupResponse["space_release"]>["stores"][number]["status"]): string {
  if (status === "released" || status === "completed") return "已释放"
  if (status === "skipped_no_changes") return "未检测到缩减"
  if (status === "not_available") return "不可用"
  if (status === "busy") return "SQLite 忙"
  if (status === "timeout") return "等待超时"
  if (status === "insufficient_disk_space") return "源卷临时工作区不足"
  if (status === "permission_denied") return "权限不足"
  if (status === "io_error") return "I/O 错误"
  if (status === "preview_only") return "仅预览"
  if (status === "requires_runtime_restart") return "需重启 Runtime"
  if (status === "requires_more_space") return "目标空间不足"
  return "失败"
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 B"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let size = value
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`
}

function formatOptionalBytes(value: number | null): string {
  return value === null ? "—" : formatBytes(value)
}

function formatSignedBytes(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0 B"
  return `${value > 0 ? "+" : "−"}${formatBytes(Math.abs(value))}`
}

function formatDuration(valueMs: number): string {
  if (!Number.isFinite(valueMs) || valueMs <= 0) return "0 秒"
  const totalSeconds = Math.floor(valueMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} 分 ${seconds} 秒` : `${seconds} 秒`
}

function formatTime(valueMs: number): string {
  return new Date(valueMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}

function errorText(error: unknown): string {
  if (error instanceof HttpError) return error.message
  if (error instanceof Error) return error.message
  return "请求失败"
}

function LlmHttpTracePanel() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialId = searchParams.get("id") ?? ""
  const [requestId, setRequestId] = useState(initialId)
  const [selectedKind, setSelectedKind] = useState<MessageKind>("request")
  const [viewMode, setViewMode] = useState<ViewMode>("raw")
  const [copied, setCopied] = useState(false)
  const [jsonExpansionOverrides, setJsonExpansionOverrides] = useState<JsonExpansionOverrides>({})
  const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null)
  const traceMutation = useMutation({ mutationFn: getLlmHttpTrace })
  const trace = traceMutation.data
  const upstreamAttempts = useMemo(() => trace?.upstream_attempts ?? [], [trace])
  const selectedAttempt = (
    upstreamAttempts.find((item) => item.attempt_id === selectedAttemptId)
    ?? upstreamAttempts[upstreamAttempts.length - 1]
    ?? null
  )
  const hasCanonicalCallbackSnapshot = isCanonicalSdkCallbackAttempt(selectedAttempt)
  const traceSourceDescription = hasCanonicalCallbackSnapshot
    ? "查看 SDK upstream-attempt callback 快照；它不是 socket-level HTTP wire，SDK 内部重试可逐次切换。"
    : selectedAttempt
      ? "旧 Codex Trace 历史记录；其内容可能已脱敏或由旧逻辑重建，无法恢复为 SDK callback 原文。"
      : "查看 LLM 请求关联的 HTTP Trace；普通 API-key Provider 保持原有请求/响应日志语义。"
  const activeTrace = useMemo(
    () => trace ? projectTraceAttempt(trace, selectedAttempt) : undefined,
    [selectedAttempt, trace],
  )
  const activeResponseEvidence = useMemo(
    () => activeTrace
      ? describeHttpResponseEvidence(activeTrace, selectedAttempt?.lifecycle_events)
      : null,
    [activeTrace, selectedAttempt],
  )

  useEffect(() => {
    if (initialId.trim()) {
      traceMutation.mutate(initialId.trim())
    }
  }, [])

  useEffect(() => {
    if (upstreamAttempts.length === 0) {
      setSelectedAttemptId(null)
      return
    }
    setSelectedAttemptId((current) => (
      current && upstreamAttempts.some((item) => item.attempt_id === current)
        ? current
        : upstreamAttempts[upstreamAttempts.length - 1].attempt_id
    ))
  }, [trace?.llm_request_id, upstreamAttempts])

  useEffect(() => {
    setJsonExpansionOverrides({})
  }, [selectedAttempt?.attempt_id, selectedKind, trace?.llm_request_id, viewMode])

  const prettyPayload = useMemo(() => {
    if (!activeTrace || viewMode !== "pretty") return null
    if (selectedKind === "request") return resolvePrettyPayload(activeTrace.request_body_json, activeTrace.request_body_text)
    if (activeResponseEvidence?.kind === "no-response") return null
    if (activeResponseEvidence?.kind === "status-not-received" && !activeTrace.response_body_text) return null
    return resolvePrettyPayload(activeTrace.response_body_json, activeTrace.response_body_text ?? "", {
      parseSse: activeTrace.is_stream || activeTrace.response_content_type?.includes("text/event-stream") === true,
    })
  }, [activeResponseEvidence, activeTrace, selectedKind, viewMode])

  const displayedText = useMemo(() => {
    if (!activeTrace) return ""
    if (selectedKind === "request") {
      if (viewMode === "raw") return activeTrace.raw_request_text ?? buildRawRequest(activeTrace)
      return prettyPayload?.text ?? ""
    }
    if (!activeResponseEvidence) return ""
    if (viewMode === "raw") {
      return activeTrace.raw_response_text ?? buildRawResponse(activeTrace, activeResponseEvidence)
    }
    if (activeResponseEvidence.kind !== "status-received" && !prettyPayload?.text) {
      return responseEvidenceMarker(activeResponseEvidence)
    }
    return prettyPayload?.text ?? ""
  }, [activeResponseEvidence, activeTrace, prettyPayload, selectedKind, viewMode])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const id = requestId.trim()
    if (!id) return
    setSearchParams({ id })
    traceMutation.mutate(id)
  }

  const handleCopy = () => {
    if (!displayedText) return
    void navigator.clipboard.writeText(displayedText).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    })
  }

  const handleToggleJsonNode = (path: string, value: unknown) => {
    setJsonExpansionOverrides((current) => ({
      ...current,
      [path]: !jsonNodeExpanded(path, value, current),
    }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg text-app-primary">
      <header className="shrink-0 border-b border-app-border/80 bg-app-bg px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-sm font-semibold text-app-primary">LLM HTTP Request Trace</h1>
            <p className="mt-0.5 text-xs text-app-muted">{traceSourceDescription}</p>
          </div>
          {activeTrace ? <TraceStatus trace={activeTrace} /> : null}
        </div>
        <form onSubmit={handleSubmit} className="mt-4 flex min-w-0 items-center gap-2">
          <label className="sr-only" htmlFor="llm-request-id">
            LLM Request ID
          </label>
          <input
            id="llm-request-id"
            type="text"
            value={requestId}
            onChange={(event) => setRequestId(event.target.value)}
            placeholder="llm-call-...:candidate-0:key-0:retry-0"
            className="block h-9 min-w-0 flex-1 rounded-md border border-app-border/80 bg-app-surface/85 px-3 font-mono text-xs text-app-primary outline-none placeholder:text-app-subtle focus:border-app-border-strong"
          />
          <button
            type="submit"
            disabled={!requestId.trim() || traceMutation.isPending}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-app-selected disabled:text-app-muted"
          >
            <Search size={15} />
            {traceMutation.isPending ? "查询中" : "查询"}
          </button>
        </form>
      </header>
      <main className="min-h-0 flex-1 overflow-auto p-5">
        {traceMutation.isError ? <ErrorPanel error={traceMutation.error} /> : trace && activeTrace ? (
          <div className="space-y-4">
            {upstreamAttempts.length > 1 ? (
              <UpstreamAttemptSelector
                attempts={upstreamAttempts}
                selectedAttemptId={selectedAttempt?.attempt_id ?? ""}
                onChange={setSelectedAttemptId}
              />
            ) : null}
            <TraceSummary
              trace={activeTrace}
              selectedAttempt={selectedAttempt}
              upstreamAttemptCount={upstreamAttempts.length}
            />
            <section className="overflow-hidden rounded-lg border border-app-border/80 bg-app-surface/80">
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SegmentedButton<MessageKind>
                    value={selectedKind}
                    onChange={setSelectedKind}
                    options={[
                      { value: "request", label: "Request" },
                      { value: "response", label: "Response" },
                    ]}
                  />
                  <SegmentedButton<ViewMode>
                    value={viewMode}
                    onChange={setViewMode}
                    options={[
                      { value: "raw", label: "Raw" },
                      { value: "pretty", label: "Pretty" },
                    ]}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex h-8 items-center gap-2 rounded-md border border-app-border/80 px-3 text-xs text-app-secondary transition hover:bg-app-surface-hover hover:text-app-primary"
                >
                  {copied ? <Check size={14} /> : <Clipboard size={14} />}
                  {copied ? "已复制" : "复制"}
                </button>
              </div>
              <div className="break-all border-y border-app-border/80 bg-app-bg px-4 py-2 font-mono text-[11px] text-app-muted">
                {selectedKind === "request" ? activeTrace.method : activeResponseEvidence?.label} · {viewMode.toUpperCase()} · {activeTrace.llm_request_id}
                {selectedAttempt ? ` · upstream attempt #${selectedAttempt.attempt_index}` : ""}
                {` · ${hasCanonicalCallbackSnapshot ? "SDK CALLBACK SNAPSHOT · NOT SOCKET WIRE" : selectedAttempt ? "LEGACY CODEX TRACE · CALLBACK ORIGINAL UNAVAILABLE" : "PROVIDER HTTP TRACE"}`}
              </div>
              {viewMode === "pretty" && prettyPayload ? (
                <JsonTree
                  value={prettyPayload.value}
                  expansionOverrides={jsonExpansionOverrides}
                  onToggle={handleToggleJsonNode}
                />
              ) : (
                <pre className="min-h-[24rem] whitespace-pre-wrap break-words bg-app-surface-muted p-4 font-mono text-xs leading-5 text-app-secondary">
                  {displayedText || "无内容"}
                </pre>
              )}
            </section>
          </div>
        ) : (
          <EmptyState />
        )}
      </main>
    </div>
  )
}

function UpstreamAttemptSelector({
  attempts,
  selectedAttemptId,
  onChange,
}: {
  attempts: LlmHttpTraceUpstreamAttempt[]
  selectedAttemptId: string
  onChange: (attemptId: string) => void
}) {
  const canonicalCount = attempts.filter(isCanonicalSdkCallbackAttempt).length
  const provenanceNote = canonicalCount === attempts.length
    ? `共 ${attempts.length} 次 SDK callback attempts；按 callback sequence 保存完整 envelope/payload，且明确不是 socket-level wire。`
    : canonicalCount === 0
      ? `共 ${attempts.length} 次旧 Codex attempts；这些历史内容可能已脱敏或重建，不能恢复或称为 callback 原文。`
      : `共 ${attempts.length} 次 attempts，其中 ${canonicalCount} 次具有 canonical SDK callback ledger；其余为不可恢复的 legacy trace。`
  return (
    <section className="rounded-lg border border-app-border/80 bg-app-surface/80 p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs font-medium text-app-secondary">SDK upstream HTTP attempt</div>
          <div className="mt-1 text-[11px] leading-4 text-app-muted">
            {provenanceNote}
          </div>
        </div>
        <label className="min-w-[18rem] text-[11px] uppercase tracking-wide text-app-muted">
          Attempt
          <select
            value={selectedAttemptId}
            onChange={(event) => onChange(event.target.value)}
            className="mt-1 block h-9 w-full rounded-md border border-app-border/80 bg-app-bg px-3 font-mono text-xs normal-case tracking-normal text-app-primary outline-none focus:border-app-border-strong"
          >
            {attempts.map((attempt) => (
              <option key={attempt.attempt_id} value={attempt.attempt_id}>
                #{attempt.attempt_index} · {attempt.attempt_kind} · {attempt.method} · {describeHttpResponseEvidence(attempt, attempt.lifecycle_events).label} · SDK terminal {deriveSdkTerminalStatus(attempt)} · {isCanonicalSdkCallbackAttempt(attempt) ? attempt.capture_complete ? "snapshot complete" : attempt.capture_error ? "capture incomplete" : "capturing" : "legacy trace"} · trace {attempt.status} · {attempt.duration_ms == null ? "duration -" : `${attempt.duration_ms}ms`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}


function TraceStatus({ trace }: { trace: LlmHttpTrace }) {
  const tone = trace.status === "completed" ? "bg-green-500/20 text-green-400" : trace.status === "failed" ? "bg-red-500/20 text-red-400" : "bg-blue-500/20 text-blue-300"
  return <span className={["rounded-full px-2.5 py-1 text-xs font-medium", tone].join(" ")}>trace {trace.status}</span>
}

function TraceSummary({
  trace,
  selectedAttempt,
  upstreamAttemptCount,
}: {
  trace: LlmHttpTrace
  selectedAttempt: LlmHttpTraceUpstreamAttempt | null
  upstreamAttemptCount: number
}) {
  const responseEvidence = describeHttpResponseEvidence(trace, selectedAttempt?.lifecycle_events)
  const items = [
    ["Provider", trace.provider_id],
    ["Model", trace.model_alias ?? trace.model_id],
    ["API", trace.api_format],
    ["HTTP", `${trace.method} · ${responseEvidence.label}`],
    ["SDK Terminal", selectedAttempt ? deriveSdkTerminalStatus(selectedAttempt) : "-"],
    ["Duration", trace.duration_ms == null ? "-" : `${trace.duration_ms}ms`],
    ["Stream", trace.is_stream ? `yes${trace.sse_event_count == null ? "" : ` · ${trace.sse_event_count} ${selectedAttempt ? "frames" : "events"}`}` : "no"],
    ["Started", formatDateTime(trace.started_at)],
    ["Completed", trace.completed_at ? formatDateTime(trace.completed_at) : "-"],
  ]
  return (
    <section className="rounded-lg border border-app-border/80 bg-app-surface/80 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <SummaryField
          label="Request ID"
          value={trace.llm_request_id}
          helper={upstreamAttemptCount > 0 ? "逻辑 LLM Request ID；关联全部 SDK 上游 HTTP attempts。" : "单次 HTTP 请求尝试；用于精确查询日志。"}
        />
        <SummaryField
          label={selectedAttempt ? `Upstream Attempt ${selectedAttempt.attempt_index}/${upstreamAttemptCount}` : "Call ID"}
          value={selectedAttempt?.attempt_id ?? trace.llm_call_id}
          helper={selectedAttempt ? `${selectedAttempt.attempt_kind} · SDK request ${selectedAttempt.sdk_request_id}` : "一次逻辑 LLM 调用；同一 call 下可包含多次 candidate/key/retry 请求。"}
          muted
        />
      </div>
      <div className="mt-4 grid gap-x-5 gap-y-3 md:grid-cols-2 xl:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <div className="text-[11px] uppercase tracking-wide text-app-muted">{label}</div>
            <div className="mt-1 truncate font-mono text-xs text-app-primary" title={String(value ?? "-")}>{value ?? "-"}</div>
          </div>
        ))}
      </div>
      {trace.error_message ? (
        <div className="mt-4 rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2">
          <div className="text-[11px] uppercase tracking-wide text-red-300">{trace.error_type ?? "Error"}</div>
          <div className="mt-1 text-xs leading-5 text-red-100">{trace.error_message}</div>
        </div>
      ) : null}
    </section>
  )
}

function SummaryField({
  label,
  value,
  helper,
  muted = false,
}: {
  label: string
  value: string
  helper: string
  muted?: boolean
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] uppercase tracking-wide text-app-muted">{label}</div>
      <div className={["mt-1 break-all font-mono text-xs", muted ? "text-app-secondary" : "text-app-primary"].join(" ")} title={value}>
        {value}
      </div>
      <div className="mt-1 text-[11px] leading-4 text-slate-600">{helper}</div>
    </div>
  )
}

function JsonTree({
  value,
  expansionOverrides,
  onToggle,
}: {
  value: unknown
  expansionOverrides: JsonExpansionOverrides
  onToggle: (path: string, value: unknown) => void
}) {
  return (
    <div className="min-h-[24rem] bg-app-surface-muted p-4 font-mono text-xs leading-5 text-app-secondary">
      <JsonNode
        value={value}
        path="$"
        depth={0}
        expansionOverrides={expansionOverrides}
        onToggle={onToggle}
      />
    </div>
  )
}

function JsonNode({
  value,
  path,
  depth,
  name,
  trailingComma = false,
  expansionOverrides,
  onToggle,
}: {
  value: unknown
  path: string
  depth: number
  name?: string
  trailingComma?: boolean
  expansionOverrides: JsonExpansionOverrides
  onToggle: (path: string, value: unknown) => void
}) {
  if (Array.isArray(value)) {
    return (
      <JsonArrayNode
        value={value}
        path={path}
        depth={depth}
        name={name}
        trailingComma={trailingComma}
        expansionOverrides={expansionOverrides}
        onToggle={onToggle}
      />
    )
  }
  if (isJsonObject(value)) {
    return (
      <JsonObjectNode
        value={value}
        path={path}
        depth={depth}
        name={name}
        trailingComma={trailingComma}
        expansionOverrides={expansionOverrides}
        onToggle={onToggle}
      />
    )
  }
  if (typeof value === "string") {
    return (
      <JsonStringNode
        value={value}
        path={path}
        depth={depth}
        name={name}
        trailingComma={trailingComma}
        expansionOverrides={expansionOverrides}
        onToggle={onToggle}
      />
    )
  }
  return <JsonPrimitiveLine value={value} depth={depth} name={name} trailingComma={trailingComma} />
}

function JsonObjectNode({
  value,
  path,
  depth,
  name,
  trailingComma,
  expansionOverrides,
  onToggle,
}: {
  value: Record<string, unknown>
  path: string
  depth: number
  name?: string
  trailingComma: boolean
  expansionOverrides: JsonExpansionOverrides
  onToggle: (path: string, value: unknown) => void
}) {
  const entries = Object.entries(value)
  const expanded = jsonNodeExpanded(path, value, expansionOverrides)
  if (!expanded) {
    return (
      <JsonToggleLine
        depth={depth}
        name={name}
        expanded={false}
        onToggle={() => onToggle(path, value)}
      >
        <span className="text-app-secondary">{`{ … }`}</span>
        <span className="ml-2 text-slate-600">{entries.length} fields</span>
        {trailingComma ? <span className="text-app-muted">,</span> : null}
      </JsonToggleLine>
    )
  }
  return (
    <>
      <JsonToggleLine depth={depth} name={name} expanded onToggle={() => onToggle(path, value)}>
        <span className="text-app-secondary">{"{"}</span>
      </JsonToggleLine>
      {entries.map(([key, child], index) => (
        <JsonNode
          key={jsonChildPath(path, key)}
          value={child}
          path={jsonChildPath(path, key)}
          depth={depth + 1}
          name={key}
          trailingComma={index < entries.length - 1}
          expansionOverrides={expansionOverrides}
          onToggle={onToggle}
        />
      ))}
      <JsonClosingLine depth={depth} token="}" trailingComma={trailingComma} />
    </>
  )
}

function JsonArrayNode({
  value,
  path,
  depth,
  name,
  trailingComma,
  expansionOverrides,
  onToggle,
}: {
  value: unknown[]
  path: string
  depth: number
  name?: string
  trailingComma: boolean
  expansionOverrides: JsonExpansionOverrides
  onToggle: (path: string, value: unknown) => void
}) {
  const expanded = jsonNodeExpanded(path, value, expansionOverrides)
  if (!expanded) {
    return (
      <JsonToggleLine
        depth={depth}
        name={name}
        expanded={false}
        onToggle={() => onToggle(path, value)}
      >
        <span className="text-app-secondary">[ … ]</span>
        <span className="ml-2 text-slate-600">{value.length} items</span>
        {trailingComma ? <span className="text-app-muted">,</span> : null}
      </JsonToggleLine>
    )
  }
  return (
    <>
      <JsonToggleLine depth={depth} name={name} expanded onToggle={() => onToggle(path, value)}>
        <span className="text-app-secondary">[</span>
      </JsonToggleLine>
      {value.map((child, index) => (
        <JsonNode
          key={jsonChildPath(path, index)}
          value={child}
          path={jsonChildPath(path, index)}
          depth={depth + 1}
          trailingComma={index < value.length - 1}
          expansionOverrides={expansionOverrides}
          onToggle={onToggle}
        />
      ))}
      <JsonClosingLine depth={depth} token="]" trailingComma={trailingComma} />
    </>
  )
}

function JsonStringNode({
  value,
  path,
  depth,
  name,
  trailingComma,
  expansionOverrides,
  onToggle,
}: {
  value: string
  path: string
  depth: number
  name?: string
  trailingComma: boolean
  expansionOverrides: JsonExpansionOverrides
  onToggle: (path: string, value: unknown) => void
}) {
  const expanded = jsonNodeExpanded(path, value, expansionOverrides)
  const displayedValue = expanded ? value : shortJsonString(value)
  return (
    <JsonToggleLine depth={depth} name={name} expanded={expanded} onToggle={() => onToggle(path, value)}>
      <span className="break-all font-medium text-green-600">{JSON.stringify(displayedValue)}</span>
      {!expanded && value.length > displayedValue.length ? <span className="ml-2 text-slate-600">{value.length} chars</span> : null}
      {trailingComma ? <span className="text-app-muted">,</span> : null}
    </JsonToggleLine>
  )
}

function JsonPrimitiveLine({
  value,
  depth,
  name,
  trailingComma,
}: {
  value: unknown
  depth: number
  name?: string
  trailingComma: boolean
}) {
  return (
    <div className="flex min-w-0 items-start gap-1" style={{ paddingLeft: depth * JSON_INDENT_PX }}>
      <span className="inline-block w-4 shrink-0" />
      {name !== undefined ? <JsonKey name={name} /> : null}
      <span className={jsonPrimitiveClassName(value)}>{String(value)}</span>
      {trailingComma ? <span className="text-app-muted">,</span> : null}
    </div>
  )
}

function JsonToggleLine({
  depth,
  name,
  expanded,
  onToggle,
  children,
}: {
  depth: number
  name?: string
  expanded: boolean
  onToggle: () => void
  children: ReactNode
}) {
  return (
    <div className="flex min-w-0 items-start gap-1" style={{ paddingLeft: depth * JSON_INDENT_PX }}>
      <button
        type="button"
        onClick={onToggle}
        className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded text-app-muted transition hover:bg-app-selected hover:text-app-primary"
        aria-label={expanded ? "折叠字段" : "展开字段"}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
      </button>
      {name !== undefined ? <JsonKey name={name} /> : null}
      <span className="min-w-0">{children}</span>
    </div>
  )
}

function JsonClosingLine({ depth, token, trailingComma }: { depth: number; token: string; trailingComma: boolean }) {
  return (
    <div className="flex items-start gap-1" style={{ paddingLeft: depth * JSON_INDENT_PX }}>
      <span className="inline-block w-4 shrink-0" />
      <span className="text-app-secondary">{token}</span>
      {trailingComma ? <span className="text-app-muted">,</span> : null}
    </div>
  )
}

function JsonKey({ name }: { name: string }) {
  return <span className="shrink-0 font-medium text-purple-700">{JSON.stringify(name)}:<span className="text-app-muted"> </span></span>
}

function SegmentedButton<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T
  onChange: (value: T) => void
  options: Array<{ value: T; label: string }>
}) {
  return (
    <div className="inline-flex rounded-md border border-app-border/80 bg-app-surface/80 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={[
            "rounded px-2.5 py-1 text-xs transition",
            value === option.value ? "bg-app-selected-strong text-white" : "text-app-muted hover:text-app-secondary",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function ErrorPanel({ error }: { error: unknown }) {
  const message = error instanceof HttpError ? error.message : error instanceof Error ? error.message : "查询失败"
  return (
    <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
      {message}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full min-h-[24rem] items-center justify-center rounded-lg border border-dashed border-app-border/80 bg-app-surface/70">
      <div className="max-w-sm text-center">
        <FileSearch className="mx-auto text-slate-600" size={34} />
        <div className="mt-3 text-sm font-medium text-app-secondary">输入 LLM Request ID 查询 HTTP 报文</div>
        <div className="mt-1 text-xs leading-5 text-slate-600">从 LLM 调用事件中复制 `llm_request_id`，在上方输入后精确查询。</div>
      </div>
    </div>
  )
}

function resolvePrettyPayload(parsed: unknown | null, fallback: string, options: PrettyPayloadOptions = {}): PrettyPayload {
  if (options.parseSse) {
    const sseValue = parseSsePayload(fallback) ?? (typeof parsed === "string" ? parseSsePayload(parsed) : null)
    if (sseValue) return { value: sseValue, text: JSON.stringify(sseValue, null, 2) }
  }
  if (parsed !== null && parsed !== undefined) {
    return { value: parsed, text: JSON.stringify(parsed, null, 2) }
  }
  try {
    const value = JSON.parse(fallback)
    return { value, text: JSON.stringify(value, null, 2) }
  } catch {
    return { value: fallback, text: fallback }
  }
}

function parseSsePayload(text: string): unknown | null {
  const trimmed = text.trim()
  if (trimmed.startsWith("\"")) {
    try {
      const decoded = JSON.parse(trimmed)
      if (typeof decoded === "string") {
        const decodedPayload = parseSsePayloadText(decoded)
        if (decodedPayload) return decodedPayload
      }
    } catch {
      return null
    }
  }
  const directPayload = parseSsePayloadText(text)
  if (directPayload) return directPayload
  try {
    const decoded = JSON.parse(trimmed)
    if (typeof decoded === "string") return parseSsePayloadText(decoded)
  } catch {
    return null
  }
  return null
}

function parseSsePayloadText(text: string): unknown | null {
  if (!looksLikeSseText(text)) return null
  const normalized = normalizeSseText(text)
  const blocks = normalized.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean)
  const events = blocks.map(parseSseEventBlock).filter((event): event is PrettySseEvent => event !== null)
  if (events.length === 0) return null
  return {
    format: "text/event-stream",
    event_count: events.length,
    events,
  }
}

function normalizeSseText(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  if (normalized.includes("\n")) return normalized
  return normalized.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n")
}

function looksLikeSseText(text: string): boolean {
  const trimmed = normalizeSseText(text).trimStart()
  return trimmed.startsWith("event:") || trimmed.startsWith("data:") || trimmed.includes("\nevent:") || trimmed.includes("\ndata:")
}

function parseSseEventBlock(block: string, index: number): PrettySseEvent | null {
  const event: PrettySseEvent = { index }
  const dataLines: string[] = []
  const comments: string[] = []
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) {
      comments.push(line.slice(1).trimStart())
      continue
    }
    const separatorIndex = line.indexOf(":")
    const field = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line
    const rawValue = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : ""
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue
    if (field === "event") event.event = value
    if (field === "id") event.id = value
    if (field === "retry") event.retry = Number.isFinite(Number(value)) && value.trim() !== "" ? Number(value) : value
    if (field === "data") dataLines.push(value)
  }
  if (comments.length > 0) event.comments = comments
  if (dataLines.length > 0) event.data = parseSseData(dataLines.join("\n"))
  if (!event.event && event.data === undefined && !event.id && event.retry === undefined && !event.comments) return null
  return event
}

function parseSseData(data: string): unknown {
  const trimmed = data.trim()
  if (!trimmed || trimmed === "[DONE]") return data
  try {
    return JSON.parse(trimmed)
  } catch {
    return data
  }
}

function jsonNodeExpanded(path: string, value: unknown, expansionOverrides: JsonExpansionOverrides): boolean {
  if (Object.prototype.hasOwnProperty.call(expansionOverrides, path)) {
    return expansionOverrides[path]
  }
  if (typeof value === "string") return value.length <= JSON_STRING_PREVIEW_LENGTH
  return true
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function jsonChildPath(path: string, key: string | number): string {
  return typeof key === "number" ? `${path}[${key}]` : `${path}[${JSON.stringify(key)}]`
}

function shortJsonString(value: string): string {
  if (value.length <= JSON_STRING_PREVIEW_LENGTH) return value
  return `${value.slice(0, JSON_STRING_PREVIEW_LENGTH)}…`
}

function jsonPrimitiveClassName(value: unknown): string {
  if (value === null) return "text-app-muted"
  if (typeof value === "number") return "text-amber-300"
  if (typeof value === "boolean") return "text-blue-300"
  return "text-app-secondary"
}

function isCanonicalSdkCallbackAttempt(attempt: LlmHttpTraceUpstreamAttempt | null): boolean {
  return Boolean(
    attempt
    && attempt.capture_source === "louyi_sdk_upstream_attempt_callback"
    && attempt.socket_level_wire === false
    && attempt.callback_events.length > 0
  )
}


function projectTraceAttempt(
  trace: LlmHttpTrace,
  attempt: LlmHttpTraceUpstreamAttempt | null,
): LlmHttpTrace {
  if (!attempt) return trace
  return {
    ...trace,
    status: attempt.status,
    method: attempt.method,
    url: attempt.url,
    request_headers: attempt.request_headers,
    request_body_text: attempt.request_body_text,
    request_body_bytes: attempt.request_body_bytes,
    request_body_truncated: attempt.request_body_truncated,
    request_body_redacted: attempt.request_body_redacted,
    status_code: attempt.status_code,
    response_headers: attempt.response_headers,
    response_body_text: attempt.response_body_text,
    response_body_bytes: attempt.response_body_bytes,
    response_body_truncated: attempt.response_body_truncated,
    response_body_redacted: attempt.response_body_redacted,
    response_content_type: attempt.response_content_type,
    is_stream: attempt.is_stream,
    sse_event_count: attempt.sse_event_count,
    error_type: attempt.error_type,
    error_message: attempt.error_message,
    started_at: attempt.started_at,
    completed_at: attempt.completed_at,
    duration_ms: attempt.duration_ms,
    raw_request_text: attempt.raw_request_text,
    raw_response_text: attempt.raw_response_text,
    truncated: attempt.request_body_truncated || attempt.response_body_truncated,
    request_body_json: parseJsonText(attempt.request_body_text),
    response_body_json: parseJsonText(attempt.response_body_text),
  }
}


function parseJsonText(value: string | null): unknown | null {
  if (!value) return null
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}


function buildRawRequest(trace: LlmHttpTrace): string {
  const headers = Object.entries(trace.request_headers).map(([key, value]) => `${key}: ${value}`).join("\n")
  return `${trace.method} ${trace.url}\n${headers}\n\n${trace.request_body_text}`
}

function describeHttpResponseEvidence(
  trace: HttpResponseEvidenceSource,
  lifecycleEvents: LlmHttpTraceUpstreamAttempt["lifecycle_events"] = [],
): HttpResponseEvidence {
  if (trace.status_code != null) {
    return { kind: "status-received", label: `HTTP ${trace.status_code}` }
  }
  const hasLifecycleEvidence = lifecycleEvents.some((event) => (
    event.kind === "response_headers"
    || event.kind === "response_body_chunk"
    || event.kind === "sse_frame"
  ))
  const hasResponseEvidence = (
    Object.keys(trace.response_headers).length > 0
    || Boolean(trace.response_body_text)
    || trace.response_body_bytes > 0
    || trace.response_body_truncated
    || trace.response_body_redacted
    || (trace.sse_event_count ?? 0) > 0
    || hasLifecycleEvidence
  )
  if (!hasResponseEvidence) {
    return { kind: "no-response", label: NO_HTTP_RESPONSE_RECEIVED }
  }
  return { kind: "status-not-received", label: HTTP_RESPONSE_STATUS_NOT_RECEIVED }
}

function responseEvidenceMarker(evidence: HttpResponseEvidence): string {
  return `[${evidence.label}]`
}

function deriveSdkTerminalStatus(attempt: LlmHttpTraceUpstreamAttempt): SdkTerminalStatus {
  const terminalEvent = [...attempt.lifecycle_events].reverse().find((event) => event.kind === "terminal")
  if (
    terminalEvent?.status === "completed"
    || terminalEvent?.status === "incomplete"
    || terminalEvent?.status === "failed"
    || terminalEvent?.status === "cancelled"
  ) {
    return terminalEvent.status
  }
  return "pending"
}

function buildRawResponse(
  trace: LlmHttpTrace,
  evidence: HttpResponseEvidence = describeHttpResponseEvidence(trace),
): string {
  const headerEntries = Object.entries(trace.response_headers)
  const body = trace.response_body_text ?? ""
  if (evidence.kind === "no-response") {
    return responseEvidenceMarker(evidence)
  }
  const statusLine = evidence.kind === "status-received" ? evidence.label : responseEvidenceMarker(evidence)
  const headers = headerEntries.map(([key, value]) => `${key}: ${value}`).join("\n")
  return `${statusLine}\n${headers}\n\n${body}`
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}
