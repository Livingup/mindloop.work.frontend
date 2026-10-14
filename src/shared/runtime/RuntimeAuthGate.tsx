import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

import {
  configureRuntimeBootstrap,
  getRuntimeAuthMe,
  getRuntimeAuthStatus,
  getRuntimeBootstrapStatus,
  runtimeAuthBootstrap,
  runtimeAuthLogin,
  runtimeAuthLogout,
  type RuntimeAuthMeResponse,
  type RuntimeAuthStatusResponse,
  type RuntimeBootstrapStatusResponse,
} from "@/features/chat/api/agentRuntimeApi"
import {
  getRuntimeAccessToken,
  getRuntimeApiBaseUrl,
  isRuntimeApiBaseUrlManagedByBrowserReleaseOrigin,
  isRuntimeApiBaseUrlManagedByDesktop,
  normalizeRuntimeApiBaseUrl,
  setRuntimeAccessToken,
  setRuntimeApiBaseUrl,
} from "@/shared/api/runtimeAccess"
import { queryClient } from "@/shared/api/queryClient"
import {
  subscribeRuntimeAuthInvalid,
  type RuntimeAuthInvalidSignal,
} from "@/shared/api/runtimeAuthInvalidation"

type RuntimeAuthMode = "loading" | "ready" | "login" | "auth-bootstrap" | "runtime-bootstrap" | "offline"

type RuntimeBootstrapStep = "postgresql" | "oss"

type RuntimeBootstrapCompletionAction = "save-oss" | "skip-oss"

type CloudDatabaseBootstrapForm = {
  host: string
  port: string
  database: string
  username: string
  password: string
  sslmode: string
  connectTimeoutSeconds: string
}

type ObjectStorageBootstrapForm = {
  accessKeyId: string
  accessKeySecret: string
}

const DEFAULT_CLOUD_DATABASE_FORM: CloudDatabaseBootstrapForm = {
  host: "",
  port: "",
  database: "",
  username: "",
  password: "",
  sslmode: "",
  connectTimeoutSeconds: "10",
}

const DEFAULT_OBJECT_STORAGE_FORM: ObjectStorageBootstrapForm = {
  accessKeyId: "",
  accessKeySecret: "",
}

const RUNTIME_BOOTSTRAP_PASSWORD_MIN_LENGTH = 12
const RUNTIME_BOOTSTRAP_PASSWORD_REQUIRED_CLASSES = 3
const RUNTIME_BOOTSTRAP_PASSWORD_HINT = "密码至少 12 位，并需包含小写字母、大写字母、数字、符号中的 3 类。"

function isRuntimeBootstrapPasswordStrong(password: string): boolean {
  if (password.length < RUNTIME_BOOTSTRAP_PASSWORD_MIN_LENGTH) return false
  const classCount = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length
  return classCount >= RUNTIME_BOOTSTRAP_PASSWORD_REQUIRED_CLASSES
}

export type RuntimeSessionContextValue = {
  authenticated: boolean
  account: RuntimeAuthMeResponse["account"]
  runtimeLabel: string
  logout: () => Promise<void>
  logoutPending: boolean
}

const RuntimeSessionContext = createContext<RuntimeSessionContextValue>({
  authenticated: false,
  account: null,
  runtimeLabel: "同源 Runtime",
  logout: async () => undefined,
  logoutPending: false,
})

export function useRuntimeSession(): RuntimeSessionContextValue {
  return useContext(RuntimeSessionContext)
}

export function RuntimeAuthGate({ children }: { children: ReactNode }) {
  const [runtimeBaseVersion, setRuntimeBaseVersion] = useState(0)
  const [runtimeBaseInput, setRuntimeBaseInput] = useState(() => getRuntimeApiBaseUrl() ?? "")
  const [status, setStatus] = useState<RuntimeAuthStatusResponse | null>(null)
  const [bootstrapStatus, setBootstrapStatus] = useState<RuntimeBootstrapStatusResponse | null>(null)
  const [me, setMe] = useState<RuntimeAuthMeResponse | null>(null)
  const [mode, setMode] = useState<RuntimeAuthMode>("loading")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [cloudDatabaseForm, setCloudDatabaseForm] = useState<CloudDatabaseBootstrapForm>(DEFAULT_CLOUD_DATABASE_FORM)
  const [objectStorageForm, setObjectStorageForm] = useState<ObjectStorageBootstrapForm>(DEFAULT_OBJECT_STORAGE_FORM)
  const [runtimeBootstrapStep, setRuntimeBootstrapStep] = useState<RuntimeBootstrapStep>("postgresql")
  const [submitPending, setSubmitPending] = useState(false)
  const runtimeBaseManagedByDesktop = isRuntimeApiBaseUrlManagedByDesktop()
  const runtimeBaseManagedByBrowserReleaseOrigin = isRuntimeApiBaseUrlManagedByBrowserReleaseOrigin()
  const runtimeBaseLocked = runtimeBaseManagedByDesktop || runtimeBaseManagedByBrowserReleaseOrigin

  const runtimeLabel = useMemo(() => {
    const baseUrl = getRuntimeApiBaseUrl()
    return baseUrl || "同源 Runtime"
  }, [runtimeBaseVersion])

  const applyBootstrapStatus = useCallback((nextStatus: RuntimeBootstrapStatusResponse) => {
    setBootstrapStatus(nextStatus)
  }, [])

  const refreshRuntimeBootstrap = useCallback(async (): Promise<boolean> => {
    const nextBootstrapStatus = await getRuntimeBootstrapStatus()
    applyBootstrapStatus(nextBootstrapStatus)
    if (nextBootstrapStatus.ready) {
      return true
    }
    if (!nextBootstrapStatus.cloud_user_config_database.configured || nextBootstrapStatus.repair_required) {
      setRuntimeBootstrapStep("postgresql")
    } else {
      setRuntimeBootstrapStep("oss")
    }
    setMode("runtime-bootstrap")
    return false
  }, [applyBootstrapStatus])

  const completeRuntimeBootstrap = useCallback(async (
    latestStatus: RuntimeBootstrapStatusResponse,
    _action: RuntimeBootstrapCompletionAction,
  ) => {
    applyBootstrapStatus(latestStatus)
    setObjectStorageForm(DEFAULT_OBJECT_STORAGE_FORM)
    setErrorMessage(null)
    if (latestStatus.ready) {
      setMode("ready")
      return
    }
    if (!latestStatus.cloud_user_config_database.configured || latestStatus.repair_required) {
      setRuntimeBootstrapStep("postgresql")
      if (latestStatus.repair_required) {
        setErrorMessage("本机共享配置快照缺失、不匹配或损坏；请重新校验 PostgreSQL 并拉取权威快照。")
      }
    } else {
      setRuntimeBootstrapStep("oss")
    }
    setMode("runtime-bootstrap")
  }, [applyBootstrapStatus])

  const refreshRuntimeAuth = useCallback(async () => {
    setMode("loading")
    setErrorMessage(null)
    try {
      const nextStatus = await getRuntimeAuthStatus()
      setStatus(nextStatus)

      if (nextStatus.bootstrap_required) {
        setMe(null)
        setMode("auth-bootstrap")
        return
      }

      if (!nextStatus.auth_required) {
        setMe(null)
        const bootstrapReady = await refreshRuntimeBootstrap()
        if (bootstrapReady) setMode("ready")
        return
      }

      if (getRuntimeAccessToken()) {
        try {
          const nextMe = await getRuntimeAuthMe()
          if (nextMe.authenticated) {
            setMe(nextMe)
            const bootstrapReady = await refreshRuntimeBootstrap()
            if (bootstrapReady) setMode("ready")
            return
          }
          setRuntimeAccessToken(null)
          if (nextMe.code === "auth_session_expired" || nextMe.code === "auth_session_revoked") {
            setErrorMessage("登录已过期，请重新登录。")
          }
        } catch {
          setRuntimeAccessToken(null)
        }
      }

      setMe(null)
      setMode("login")
    } catch (error) {
      setMe(null)
      setStatus(null)
      setBootstrapStatus(null)
      setMode("offline")
      setErrorMessage(error instanceof Error ? error.message : "无法连接 Runtime")
    }
  }, [refreshRuntimeBootstrap])

  const handleRuntimeAuthInvalid = useCallback(
    (signal: RuntimeAuthInvalidSignal) => {
      if (signal.code === "auth_bootstrap_required") {
        void refreshRuntimeAuth()
        return
      }
      setRuntimeAccessToken(null)
      setMe(null)
      void queryClient.cancelQueries()
      queryClient.clear()
      setErrorMessage(signal.detail ?? "登录已过期，请重新登录。")
      setMode("login")
    },
    [refreshRuntimeAuth],
  )

  useEffect(() => {
    return subscribeRuntimeAuthInvalid(handleRuntimeAuthInvalid)
  }, [handleRuntimeAuthInvalid])

  useEffect(() => {
    void refreshRuntimeAuth()
  }, [refreshRuntimeAuth, runtimeBaseVersion])

  useEffect(() => {
    if (runtimeBaseLocked) setRuntimeBaseInput(getRuntimeApiBaseUrl() ?? "")
  }, [runtimeBaseLocked, runtimeBaseVersion])

  const applyRuntimeBase = () => {
    if (runtimeBaseLocked) {
      setRuntimeBaseInput(getRuntimeApiBaseUrl() ?? "")
      setErrorMessage(
        runtimeBaseManagedByDesktop
          ? "正式桌面版 Runtime 地址由 agent_runtime.yaml 启动元数据管理，不能在前端覆盖。"
          : "浏览器/移动端 release Runtime 地址由当前页面 HTTP origin 管理，不能在前端覆盖。",
      )
      return
    }
    const normalized = normalizeRuntimeApiBaseUrl(runtimeBaseInput)
    if (runtimeBaseInput.trim() && !normalized) {
      setErrorMessage("Runtime 地址必须是合法的 http(s) URL，或留空使用同源 Runtime。")
      return
    }
    setRuntimeApiBaseUrl(normalized)
    setRuntimeAccessToken(null)
    setMe(null)
    setBootstrapStatus(null)
    setRuntimeBaseInput(normalized ?? "")
    setRuntimeBaseVersion((value) => value + 1)
  }

  const submitCredentials = async () => {
    const trimmedUsername = username.trim()
    if (!trimmedUsername || !password) {
      setErrorMessage("请输入用户名和密码。")
      return
    }
    if (mode === "auth-bootstrap" && !isRuntimeBootstrapPasswordStrong(password)) {
      setErrorMessage(RUNTIME_BOOTSTRAP_PASSWORD_HINT)
      return
    }
    setSubmitPending(true)
    setErrorMessage(null)
    try {
      const response = mode === "auth-bootstrap"
        ? await runtimeAuthBootstrap({ username: trimmedUsername, password })
        : await runtimeAuthLogin({ username: trimmedUsername, password })
      setRuntimeAccessToken(response.access_token)
      setMe({ authenticated: true, account: response.account, session: response.session })
      setStatus((current) => current ? { ...current, bootstrap_required: false, auth_required: true, configured: true } : current)
      setPassword("")
      const bootstrapReady = await refreshRuntimeBootstrap()
      if (bootstrapReady) setMode("ready")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "认证失败")
    } finally {
      setSubmitPending(false)
    }
  }

  const submitRuntimeBootstrap = async () => {
    if (runtimeBootstrapStep === "postgresql") {
      const port = Number.parseInt(cloudDatabaseForm.port, 10)
      const connectTimeoutSeconds = Number.parseInt(cloudDatabaseForm.connectTimeoutSeconds, 10)
      if (!cloudDatabaseForm.host.trim() || !cloudDatabaseForm.database.trim() || !cloudDatabaseForm.username.trim() || !cloudDatabaseForm.password.trim()) {
        setErrorMessage("请填写 PostgreSQL Host、Database、Username 和 Password。")
        return
      }
      if (!Number.isFinite(port) || port <= 0) {
        setErrorMessage("PostgreSQL Port 必须是大于 0 的数字。")
        return
      }
      if (!Number.isFinite(connectTimeoutSeconds) || connectTimeoutSeconds <= 0) {
        setErrorMessage("连接超时时间必须是大于 0 的数字。")
        return
      }
      setSubmitPending(true)
      setErrorMessage(null)
      try {
        const nextBootstrapStatus = await configureRuntimeBootstrap({
          cloud_user_config_database: {
            enabled: true,
            backend: "postgresql",
            host: cloudDatabaseForm.host.trim(),
            port,
            database: cloudDatabaseForm.database.trim(),
            username: cloudDatabaseForm.username.trim(),
            password: cloudDatabaseForm.password.trim(),
            sslmode: cloudDatabaseForm.sslmode.trim() || "require",
            connect_timeout_seconds: connectTimeoutSeconds,
          },
          object_storage_settings: null,
        })
        applyBootstrapStatus(nextBootstrapStatus)
        setCloudDatabaseForm((current) => ({ ...current, password: "" }))
        setRuntimeBootstrapStep("oss")
        setMode("runtime-bootstrap")
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "PostgreSQL 初始化失败")
      } finally {
        setSubmitPending(false)
      }
      return
    }

    const accessKeyId = objectStorageForm.accessKeyId.trim()
    const accessKeySecret = objectStorageForm.accessKeySecret.trim()
    if (!accessKeyId || !accessKeySecret) {
      setErrorMessage("如需现在配置 OSS，请填写 AccessKey ID 和 AccessKey Secret；也可以跳过 OSS，进入工作区后再配置。")
      return
    }
    setSubmitPending(true)
    setErrorMessage(null)
    try {
      const nextBootstrapStatus = await configureRuntimeBootstrap({
        cloud_user_config_database: null,
        object_storage_settings: {
          gateway_provider: "aliyun_oss",
          object_storage_endpoint: "https://oss-cn-hongkong.aliyuncs.com",
          object_storage_region: "cn-hongkong",
          object_storage_bucket_name: "agent-runtime-resources",
          object_storage_public_base_url: "https://agent-runtime-resources.oss-cn-hongkong.aliyuncs.com/agent-runtime/file-resource",
          object_storage_object_key_prefix: "agent-runtime/file-resource",
          object_storage_access_key_id: accessKeyId,
          object_storage_access_key_secret: accessKeySecret,
          connect_timeout_seconds: 120,
        },
        object_storage_skipped: false,
      })
      await completeRuntimeBootstrap(nextBootstrapStatus, "save-oss")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "OSS 初始化失败")
    } finally {
      setSubmitPending(false)
    }
  }

  const skipObjectStorageBootstrap = () => {
    if (!bootstrapStatus) {
      void refreshRuntimeAuth()
      return
    }
    setSubmitPending(true)
    setErrorMessage(null)
    void configureRuntimeBootstrap({
      cloud_user_config_database: null,
      object_storage_settings: null,
      object_storage_skipped: true,
    })
      .then((nextBootstrapStatus) => completeRuntimeBootstrap(nextBootstrapStatus, "skip-oss"))
      .catch((error) => {
        setErrorMessage(error instanceof Error ? error.message : "跳过 OSS 失败，请稍后重试。")
        setMode("runtime-bootstrap")
      })
      .finally(() => setSubmitPending(false))
  }

  const logout = useCallback(async () => {
    setSubmitPending(true)
    setErrorMessage(null)
    try {
      await runtimeAuthLogout()
    } catch (error) {
      console.warn("[runtime-auth] logout failed:", error)
    } finally {
      setRuntimeAccessToken(null)
      setMe(null)
      void queryClient.cancelQueries()
      queryClient.clear()
      setSubmitPending(false)
      void refreshRuntimeAuth()
    }
  }, [refreshRuntimeAuth])

  const runtimeSessionContextValue = useMemo<RuntimeSessionContextValue>(() => ({
    authenticated: Boolean(status?.auth_required && me?.authenticated),
    account: status?.auth_required && me?.authenticated ? me.account ?? null : null,
    runtimeLabel,
    logout,
    logoutPending: submitPending,
  }), [logout, me?.account, me?.authenticated, runtimeLabel, status?.auth_required, submitPending])

  if (mode === "ready") {
    return (
      <RuntimeSessionContext.Provider value={runtimeSessionContextValue}>
        <div className="fixed inset-0 overflow-hidden bg-app-bg text-app-primary">
          {children}
        </div>
      </RuntimeSessionContext.Provider>
    )
  }

  if (mode === "runtime-bootstrap") {
    return (
      <RuntimeBootstrapPanel
        runtimeLabel={runtimeLabel}
        runtimeBaseInput={runtimeBaseInput}
        setRuntimeBaseInput={setRuntimeBaseInput}
        applyRuntimeBase={applyRuntimeBase}
        runtimeBaseLocked={runtimeBaseLocked}
        bootstrapStatus={bootstrapStatus}
        cloudDatabaseForm={cloudDatabaseForm}
        setCloudDatabaseForm={setCloudDatabaseForm}
        objectStorageForm={objectStorageForm}
        setObjectStorageForm={setObjectStorageForm}
        runtimeBootstrapStep={runtimeBootstrapStep}
        submitPending={submitPending}
        errorMessage={errorMessage}
        submitRuntimeBootstrap={submitRuntimeBootstrap}
        skipObjectStorageBootstrap={skipObjectStorageBootstrap}
        refreshRuntimeAuth={refreshRuntimeAuth}
      />
    )
  }

  const isAuthBootstrap = mode === "auth-bootstrap"
  const isLoading = mode === "loading"

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-auto bg-app-bg p-3 text-app-primary sm:p-6">
      <section className="w-full max-w-md rounded-3xl border border-app-border/80 bg-app-surface/90 p-4 shadow-card backdrop-blur sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-app-subtle">Runtime Access</div>
        <h1 className="mt-2 text-xl font-semibold text-app-primary">{isAuthBootstrap ? "初始化本地 Runtime 账号" : "连接 Runtime"}</h1>
        <p className="mt-2 text-sm leading-6 text-app-secondary">
          {isAuthBootstrap
            ? "请先在运行 Runtime 的本机完成首账号创建；手机或其他局域网设备需等首账号完成后再登录。"
            : "先登录本地 Runtime。"}
        </p>

        <RuntimeBaseSelector
          runtimeBaseInput={runtimeBaseInput}
          setRuntimeBaseInput={setRuntimeBaseInput}
          applyRuntimeBase={applyRuntimeBase}
          disabled={isLoading || submitPending}
          runtimeBaseLocked={runtimeBaseLocked}
        />

        {isLoading ? (
          <div className="mt-5 rounded-2xl border border-app-border bg-app-surface-muted px-4 py-3 text-sm text-app-secondary">正在检查 Runtime 认证状态...</div>
        ) : (
          <>
            <label className="mt-5 block text-xs font-medium text-app-secondary">
              用户名
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-primary outline-none transition focus:border-app-accent-muted focus:ring-2 focus:ring-app-accent-muted/10"
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-app-secondary">
              密码
              <input
                value={password}
                type="password"
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void submitCredentials()
                }}
                autoComplete={isAuthBootstrap ? "new-password" : "current-password"}
                className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-primary outline-none transition focus:border-app-accent-muted focus:ring-2 focus:ring-app-accent-muted/10"
              />
            </label>
            {isAuthBootstrap ? (
              <p className="mt-2 text-xs leading-5 text-app-muted">{RUNTIME_BOOTSTRAP_PASSWORD_HINT}</p>
            ) : null}
            <button
              type="button"
              onClick={() => void submitCredentials()}
              disabled={submitPending}
              className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-app-accent px-4 py-2.5 text-sm font-medium text-white shadow-card transition hover:bg-app-accent-hover disabled:cursor-wait disabled:bg-app-selected disabled:text-app-muted disabled:shadow-none"
            >
              {submitPending ? "提交中..." : isAuthBootstrap ? "创建账号并继续初始化" : "登录 Runtime"}
            </button>
          </>
        )}

        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-app-danger-border bg-app-danger-surface px-4 py-3 text-sm leading-6 text-app-danger">{errorMessage}</div>
        ) : null}

        <div className="mt-4 text-xs leading-5 text-app-muted">当前目标：{runtimeLabel}</div>
      </section>
    </div>
  )
}

function RuntimeBootstrapPanel(props: {
  runtimeLabel: string
  runtimeBaseInput: string
  setRuntimeBaseInput: (value: string) => void
  applyRuntimeBase: () => void
  runtimeBaseLocked: boolean
  bootstrapStatus: RuntimeBootstrapStatusResponse | null
  cloudDatabaseForm: CloudDatabaseBootstrapForm
  setCloudDatabaseForm: (value: CloudDatabaseBootstrapForm | ((current: CloudDatabaseBootstrapForm) => CloudDatabaseBootstrapForm)) => void
  objectStorageForm: ObjectStorageBootstrapForm
  setObjectStorageForm: (value: ObjectStorageBootstrapForm | ((current: ObjectStorageBootstrapForm) => ObjectStorageBootstrapForm)) => void
  runtimeBootstrapStep: RuntimeBootstrapStep
  submitPending: boolean
  errorMessage: string | null
  submitRuntimeBootstrap: () => Promise<void>
  skipObjectStorageBootstrap: () => void
  refreshRuntimeAuth: () => Promise<void>
}) {
  const {
    runtimeLabel,
    runtimeBaseInput,
    setRuntimeBaseInput,
    applyRuntimeBase,
    runtimeBaseLocked,
    bootstrapStatus,
    cloudDatabaseForm,
    setCloudDatabaseForm,
    objectStorageForm,
    setObjectStorageForm,
    runtimeBootstrapStep,
    submitPending,
    errorMessage,
    submitRuntimeBootstrap,
    skipObjectStorageBootstrap,
    refreshRuntimeAuth,
  } = props

  const isPostgresStep = runtimeBootstrapStep === "postgresql"
  const primaryActionLabel = isPostgresStep ? "校验 PostgreSQL 并继续 OSS 引导" : "保存 OSS 并进入工作区"

  return (
    <div className="fixed inset-0 overflow-auto bg-app-bg p-3 text-app-primary sm:p-6">
      <section className="mx-auto w-full max-w-3xl rounded-3xl border border-app-border/80 bg-app-surface/90 p-4 shadow-card backdrop-blur sm:p-6">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-app-subtle">Runtime Onboarding</div>
        <h1 className="mt-2 text-2xl font-semibold text-app-primary">{isPostgresStep ? "初始化 PostgreSQL 共享配置库" : "配置 OSS 对象存储（可跳过）"}</h1>
        <p className="mt-2 text-sm leading-6 text-app-secondary">
          初始化按顺序完成：本地账号 → PostgreSQL → OSS。PostgreSQL 是进入工作区前的必填共享配置库；OSS 用于多模态文件对话，可先跳过，进入工作区后再补充。
        </p>
        <div className="mt-4 grid gap-2 text-xs text-slate-600 md:grid-cols-3">
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">1. 本地账号已完成</div>
          <div className={isPostgresStep ? "rounded-2xl border border-[#263a63]/25 bg-[#263a63]/5 px-3 py-2 font-medium text-[#263a63]" : "rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700"}>2. PostgreSQL</div>
          <div className={!isPostgresStep ? "rounded-2xl border border-[#263a63]/25 bg-[#263a63]/5 px-3 py-2 font-medium text-[#263a63]" : "rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-slate-500"}>3. OSS 可选</div>
        </div>

        <RuntimeBaseSelector
          runtimeBaseInput={runtimeBaseInput}
          setRuntimeBaseInput={setRuntimeBaseInput}
          applyRuntimeBase={applyRuntimeBase}
          disabled={submitPending}
          runtimeBaseLocked={runtimeBaseLocked}
        />

        {bootstrapStatus?.repair_required ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">
本机共享配置快照缺失、不匹配或损坏。请重新校验 PostgreSQL，Runtime 会先拉取权威快照；修复完成前将保持限制模式。
          </div>
        ) : null}

        {bootstrapStatus?.warnings.length ? (
          <ul className="mt-5 space-y-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-600">
            {bootstrapStatus.warnings.map((warning) => <li key={warning}>· {warning}</li>)}
          </ul>
        ) : null}

        {isPostgresStep ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <TextField
              label="PostgreSQL Host"
              value={cloudDatabaseForm.host}
              placeholder="请输入 PostgreSQL Host"
              onChange={(value) => setCloudDatabaseForm((current) => ({ ...current, host: value }))}
            />
            <TextField
              label="Port"
              value={cloudDatabaseForm.port}
              placeholder="例如 5432"
              onChange={(value) => setCloudDatabaseForm((current) => ({ ...current, port: value }))}
            />
            <TextField
              label="Database"
              value={cloudDatabaseForm.database}
              placeholder="请输入 Database"
              onChange={(value) => setCloudDatabaseForm((current) => ({ ...current, database: value }))}
            />
            <TextField
              label="Username"
              value={cloudDatabaseForm.username}
              placeholder="请输入 Username"
              onChange={(value) => setCloudDatabaseForm((current) => ({ ...current, username: value }))}
            />
            <TextField
              label="Password"
              value={cloudDatabaseForm.password}
              type="password"
              placeholder="请输入 Password"
              onChange={(value) => setCloudDatabaseForm((current) => ({ ...current, password: value }))}
            />
            <TextField
              label="SSL Mode"
              value={cloudDatabaseForm.sslmode}
              placeholder="默认 require"
              onChange={(value) => setCloudDatabaseForm((current) => ({ ...current, sslmode: value }))}
            />
            <TextField
              label="Connect Timeout Seconds"
              value={cloudDatabaseForm.connectTimeoutSeconds}
              onChange={(value) => setCloudDatabaseForm((current) => ({ ...current, connectTimeoutSeconds: value }))}
            />
          </div>
        ) : null}

        {!isPostgresStep ? (
          <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <h2 className="text-sm font-semibold text-slate-800">可选：OSS 对象存储密钥</h2>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              OSS 不是进入工作区的强制项，但这里仍按顺序引导你配置。暂时不需要多模态文件对话时，可以跳过。
            </p>
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <TextField
                label="AccessKey ID"
                value={objectStorageForm.accessKeyId}
                placeholder="可留空后点击跳过"
                onChange={(value) => setObjectStorageForm((current) => ({ ...current, accessKeyId: value }))}
              />
              <TextField
                label="AccessKey Secret"
                value={objectStorageForm.accessKeySecret}
                type="password"
                placeholder="可留空后点击跳过"
                onChange={(value) => setObjectStorageForm((current) => ({ ...current, accessKeySecret: value }))}
              />
            </div>
          </div>
        ) : null}

        {bootstrapStatus ? (
          <div className="mt-5 grid gap-3 text-xs text-slate-600 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="font-medium text-slate-700">PostgreSQL 初始化</div>
              <div className="mt-1">{bootstrapStatus.cloud_user_config_database.configured ? "凭据已保存" : "待配置"}</div>
              <div className="mt-1">{bootstrapStatus.cloud_user_config_database.shared_config_snapshot_ready ? "本机快照已就绪" : "本机快照待拉取"}</div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <div className="font-medium text-slate-700">OSS 对象存储</div>
              <div className="mt-1">{bootstrapStatus.object_storage.configured ? "已配置" : bootstrapStatus.object_storage.skipped ? "已明确跳过" : "可跳过，后续再配置"}</div>
            </div>
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{errorMessage}</div>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <div className="text-xs leading-5 text-app-muted">当前目标：{runtimeLabel}</div>
          <div className="flex flex-col gap-2 sm:flex-row">
            {isPostgresStep ? (
              <button
                type="button"
                onClick={() => void refreshRuntimeAuth()}
                disabled={submitPending}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[#4f6f96]/45 hover:text-slate-950 disabled:cursor-wait disabled:opacity-60"
              >
                重新检查
              </button>
            ) : (
              <button
                type="button"
                onClick={skipObjectStorageBootstrap}
                disabled={submitPending}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-[#4f6f96]/45 hover:text-slate-950 disabled:cursor-wait disabled:opacity-60"
              >
                跳过 OSS，完成初始化并进入工作区
              </button>
            )}
            <button
              type="button"
              onClick={() => void submitRuntimeBootstrap()}
              disabled={submitPending}
              className="rounded-xl bg-[#263a63] px-4 py-2 text-sm font-medium text-white shadow-[0_12px_28px_rgba(38,58,99,0.18)] transition hover:bg-[#304875] disabled:cursor-wait disabled:bg-slate-300 disabled:shadow-none"
            >
              {submitPending ? "正在校验并保存..." : primaryActionLabel}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function RuntimeBaseSelector(props: {
  runtimeBaseInput: string
  setRuntimeBaseInput: (value: string) => void
  applyRuntimeBase: () => void
  disabled: boolean
  runtimeBaseLocked: boolean
}) {
  const { runtimeBaseInput, setRuntimeBaseInput, applyRuntimeBase, disabled, runtimeBaseLocked } = props
  if (runtimeBaseLocked) {
    return (
      <label className="mt-5 block text-xs font-medium text-slate-600">
        Runtime API 地址
        <input
          value={runtimeBaseInput}
          readOnly
          disabled
          className="mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500 outline-none"
        />
      </label>
    )
  }
  return (
    <label className="mt-5 block text-xs font-medium text-app-secondary">
      Runtime API 地址
      <div className="mt-1 flex flex-col gap-2 sm:flex-row">
        <input
          value={runtimeBaseInput}
          onChange={(event) => setRuntimeBaseInput(event.target.value)}
          placeholder="留空使用同源"
          className="min-w-0 flex-1 rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-primary outline-none transition focus:border-app-accent-muted focus:ring-2 focus:ring-app-accent-muted/10"
        />
        <button
          type="button"
          onClick={applyRuntimeBase}
          disabled={disabled}
          className="rounded-xl border border-app-border bg-app-surface px-3 py-2 text-xs font-medium text-app-secondary transition hover:border-app-accent-muted hover:text-app-primary disabled:cursor-wait disabled:opacity-60"
        >
          应用
        </button>
      </div>
    </label>
  )
}

function TextField(props: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "password"
  placeholder?: string
}) {
  const { label, value, onChange, type = "text", placeholder } = props
  return (
    <label className="block text-xs font-medium text-app-secondary">
      {label}
      <input
        value={value}
        type={type}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full rounded-xl border border-app-border bg-app-surface px-3 py-2 text-sm text-app-primary outline-none transition placeholder:text-app-subtle focus:border-app-accent-muted focus:ring-2 focus:ring-app-accent-muted/10"
      />
    </label>
  )
}
