import { useEffect, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertCircle,
  Bot,
  Brain,
  CheckCircle2,
  Clipboard,
  Database,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  MessageSquareText,
  Plug,
  Save,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react"

import {
  getCloudUserConfigDatabaseSettings,
  getObjectStorageSettings,
  getSystemSettings,
  updateCloudUserConfigDatabaseSettings,
  updateObjectStorageSettings,
  type CloudUserConfigDatabaseSettings,
  type CloudUserConfigDatabaseSettingsBody,
  type ObjectStorageSettings,
  type ObjectStorageSettingsBody,
  type PersistenceInventoryItem,
  type SystemSettingsSnapshot,
} from "@/features/settings/settingsApi"
import {
  canRestartRuntimeFromDesktop,
  getFrontendWebEntryReference,
  restartRuntimeFromDesktop,
} from "@/shared/api/runtimeAccess"

type ConfigRecord = Record<string, unknown>
type FieldKind = "text" | "number" | "path" | "url" | "provider" | "secret"

type FieldDefinition = {
  path: string[]
  label: string
  hint: string
  kind?: FieldKind
}

type ModuleDefinition = {
  section: string
  title: string
  purpose: string
  icon: LucideIcon
  fields: FieldDefinition[]
  nestedGroups?: Array<{
    path: string[]
    title: string
    purpose: string
    fields: FieldDefinition[]
  }>
}

type ServiceDomainDefinition = {
  title: string
  description: string
  modules: ModuleDefinition[]
}

const SERVICE_DOMAINS: ServiceDomainDefinition[] = [
  {
    title: "基础运行服务",
    description: "配置后端 REST API 服务从哪里接收请求。",
    modules: [
      {
        section: "agent_runtime_service",
        title: "REST API 服务入口",
        purpose: "这组配置决定后端 REST API 服务默认监听在哪个地址和端口。",
        icon: Server,
        fields: [
          { path: ["service_host"], label: "API 监听地址", hint: "监听地址：只给本机前端使用填 127.0.0.1；需要局域网电脑、手机、Docker 容器等访问这台电脑上的后端时填 0.0.0.0。" },
          { path: ["service_port"], label: "API 端口", hint: "后端服务端口", kind: "number" },
        ],
      },
    ],
  },
  {
    title: "多模态文件资源服务",
    description: "统一管理 Agent 运行中产生或上传的图片、PDF、附件等多模态文件资源，负责本地缓存、对象存储和公共访问地址。",
    modules: [
      {
        section: "file_resource_service",
        title: "统一文件资源服务",
        purpose: "这组配置控制文件资源如何批量处理、存放到哪里、以及生成什么公共 URL 给前端或模型访问。",
        icon: HardDrive,
        fields: [
          { path: ["file_resource_batch_limit"], label: "单次批量处理上限", hint: "限制一次接口调用最多接收多少个文件。调大可以一次上传更多文件，调小可以减少单次请求占用的内存和 I/O。", kind: "number" },
          { path: ["local_resource_storage_root_path"], label: "本地文件缓存目录", hint: "后端把上传的图片、PDF 等文件先保存到这个本机目录。需要迁移数据盘或清理缓存位置时改这里。", kind: "path" },
        ],
      },
    ],
  },
  {
    title: "Agent 运行与会话",
    description: "保存 Agent 对话消息、任务实例运行态、父子关系和执行 Trace。",
    modules: [
      {
        section: "conversation_repository",
        title: "会话消息存储",
        purpose: "这组配置决定历史对话消息保存在哪里。SQLite 保存会话索引和元数据，JSONL 保存消息正文。",
        icon: MessageSquareText,
        fields: [{ path: ["data_dir"], label: "会话数据目录", hint: "保存聊天线程、消息索引和消息正文的目录。换目录后，旧目录里的历史会话不会自动出现在新目录中。", kind: "path" }],
      },
      {
        section: "agent_runtime",
        title: "Agent 运行态仓储",
        purpose: "这组配置保存 Agent task、instance、父子关系和执行轨迹，用于支撑多 Agent 并发运行和追踪。",
        icon: Bot,
        fields: [
          { path: ["repository_type"], label: "运行态仓储类型", hint: "决定 Agent 任务状态保存在哪里。当前服务配置使用 sqlite，会落盘并支持本机多进程共享运行态。", kind: "provider" },
          { path: ["data_dir"], label: "运行态数据库目录", hint: "保存 Agent task、instance、父子关系数据库的目录。迁移这个目录会影响运行中的任务状态能否被继续读取。", kind: "path" },
          { path: ["trace_dir"], label: "执行 Trace 目录", hint: "每个 Agent 实例会将自己的对话执行过程保存为 Markdown trace 文件", kind: "path" },
        ],
      },

    ],
  },
  {
    title: "Agent 能力与定义仓储",
    description: "配置 Prompt 片段、Skill 仓库、MCP 服务配置和 Agent 静态定义文件的位置，是 Agent 能力装配的数据来源。",
    modules: [
      {
        section: "prompt_template",
        title: "提示词模板仓储",
        purpose: "这组配置告诉系统从哪里读取可复用 Prompt snippets。",
        icon: FileText,
        fields: [{ path: ["snippets_dir"], label: "Prompt 片段目录", hint: "系统从这里读取可复用提示词片段。Agent 定义引用 template_id 时，会到这个目录查找对应片段。", kind: "path" }],
      },
      {
        section: "skill_service",
        title: "Skill 仓库",
        purpose: "这组配置提供 Skill 仓库根目录默认值；实际用户目录可在上方用户设置中修改。",
        icon: Brain,
        fields: [
          { path: ["skills_dir"], label: "Skill 根目录默认值", hint: "没有用户设置时使用的 Skill 仓库根目录。", kind: "path" },
          { path: ["settings_dir"], label: "Skill 设置数据库目录", hint: "保存用户配置的 Skill 根目录。", kind: "path" },
        ],
      },
      {
        section: "mcp_client",
        title: "MCP 服务配置仓储",
        purpose: "这组配置告诉 MCP 客户端从哪里读取 MCP 服务配置 YAML。",
        icon: Plug,
        fields: [{ path: ["config_dir"], label: "MCP 服务配置目录", hint: "系统从这里读取 MCP 服务配置。目录中的每个 YAML 文件对应一个可连接的 MCP 服务。", kind: "path" }],
      },
      {
        section: "agent_definition",
        title: "Agent 定义仓储",
        purpose: "这组配置告诉系统从哪里读取 Agent 静态定义文件。",
        icon: ShieldCheck,
        fields: [{ path: ["definitions_dir"], label: "Agent 定义目录", hint: "系统从这里读取 Agent 静态定义。每个 YAML 文件定义一个 Agent，文件名就是 agent_id。", kind: "path" }],
      },
    ],
  },
  {
    title: "LLM 模型注册表",
    description: "配置模型元数据、服务商定义和执行策略 SQLite 数据库的存储根目录。",
    modules: [
      {
        section: "llm_model_registry",
        title: "LLM Registry SQLite 仓储",
        purpose: "这组配置告诉系统从哪里读取和保存模型元数据、服务商定义和执行策略。运行期权威数据是 SQLite，legacy YAML 只作为一次性迁移输入。",
        icon: Database,
        fields: [{ path: ["registry_dir"], label: "注册表根目录", hint: "系统在这里维护 llm_model_registry.sqlite3 和图像生成专用注册表数据库；模型、服务商和策略以 SQLite 为运行期权威数据。", kind: "path" }],
      },
    ],
  },
]

export function SettingsPage() {
  const queryClient = useQueryClient()
  const systemSettingsQuery = useQuery({ queryKey: ["settings", "system-settings"], queryFn: getSystemSettings })
  const databaseSettingsQuery = useQuery({
    queryKey: ["settings", "cloud-user-config-database"],
    queryFn: getCloudUserConfigDatabaseSettings,
  })
  const objectStorageQuery = useQuery({ queryKey: ["settings", "object-storage"], queryFn: getObjectStorageSettings })
  const databaseSettingsMutation = useMutation({
    mutationFn: updateCloudUserConfigDatabaseSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(["settings", "cloud-user-config-database"], next)
      void queryClient.invalidateQueries({ queryKey: ["settings", "object-storage"] })
    },
  })
  const objectStorageMutation = useMutation({
    mutationFn: updateObjectStorageSettings,
    onSuccess: (next) => {
      queryClient.setQueryData(["settings", "object-storage"], next)
    },
  })

  return (
    <div className="h-full overflow-auto px-8 py-7">
      <header className="mb-7">
        <h1 className="text-3xl font-semibold tracking-tight">系统服务配置</h1>
      </header>

      <UserSettingsPanel
        databaseSettings={databaseSettingsQuery.data}
        databaseSettingsLoading={databaseSettingsQuery.isLoading}
        databaseSettingsError={databaseSettingsQuery.error}
        databaseSettingsSaving={databaseSettingsMutation.isPending}
        databaseSettingsSaveError={databaseSettingsMutation.error}
        onSaveDatabaseSettings={(body) => databaseSettingsMutation.mutateAsync(body)}
        objectStorageSettings={objectStorageQuery.data}
        objectStorageLoading={objectStorageQuery.isLoading}
        objectStorageError={objectStorageQuery.error}
        objectStorageSaving={objectStorageMutation.isPending}
        objectStorageSaveError={objectStorageMutation.error}
        onSaveObjectStorage={(body) => objectStorageMutation.mutate(body)}
      />

      <FrontendWebEntryReferenceCard />

      <SystemSettingsPanel
        data={systemSettingsQuery.data}
        isLoading={systemSettingsQuery.isLoading}
        error={systemSettingsQuery.error}
      />
    </div>
  )
}

function SystemSettingsPanel({
  data,
  isLoading,
  error,
}: {
  data: SystemSettingsSnapshot | undefined
  isLoading: boolean
  error: unknown
}) {
  if (isLoading) {
    return (
      <div className="flex h-40 items-center justify-center gap-2 rounded-2xl border border-app-border/80 bg-app-surface/80 text-sm text-app-secondary">
        <Loader2 size={18} className="animate-spin" />
        加载中
      </div>
    )
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
        <div className="mb-2 flex items-center gap-2 font-medium">
          <AlertCircle size={16} />
          加载失败
        </div>
        <div className="break-words text-red-700/80">{error instanceof Error ? error.message : "请求失败"}</div>
      </div>
    )
  }

  return data ? <SystemSettingsContent data={data} /> : null
}

function FrontendWebEntryReferenceCard() {
  const reference = getFrontendWebEntryReference()
  const [copiedOrigin, setCopiedOrigin] = useState(false)
  const originText = reference.localIP && reference.localPort !== null
    ? `localIP=\"${reference.localIP}\"\nlocalPort=${reference.localPort}`
    : ""
  const canCopyOrigin = Boolean(originText)

  const copyOriginText = () => {
    if (!originText) return
    void writeClipboardText(originText)
      .then(() => {
        setCopiedOrigin(true)
        window.setTimeout(() => setCopiedOrigin(false), 1200)
      })
      .catch(() => {
        setCopiedOrigin(false)
      })
  }

  return (
    <section className="mb-7 rounded-2xl border border-app-border/80 bg-app-surface/80 p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-app-primary">frpc.toml 本机回源字段</h2>
        <button
          type="button"
          disabled={!canCopyOrigin}
          onClick={copyOriginText}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-app-border/80 bg-app-surface/85 px-2.5 text-xs text-app-secondary transition hover:bg-app-selected hover:text-app-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Clipboard size={13} />
          {copiedOrigin ? "已复制" : "复制 localIP/localPort"}
        </button>
      </div>
      <div className="min-h-10 whitespace-pre-wrap break-all rounded-lg border border-app-border/80 bg-app-surface/85 px-3 py-2 font-mono text-sm leading-6 text-app-primary">{originText}</div>
    </section>
  )
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textArea = document.createElement("textarea")
  textArea.value = text
  textArea.setAttribute("readonly", "true")
  textArea.style.position = "fixed"
  textArea.style.left = "-9999px"
  document.body.appendChild(textArea)
  textArea.select()
  const copied = document.execCommand("copy")
  document.body.removeChild(textArea)
  if (!copied) throw new Error("复制到剪切板失败")
}

function UserSettingsPanel({
  databaseSettings,
  databaseSettingsLoading,
  databaseSettingsError,
  databaseSettingsSaving,
  databaseSettingsSaveError,
  onSaveDatabaseSettings,
  objectStorageSettings,
  objectStorageLoading,
  objectStorageError,
  objectStorageSaving,
  objectStorageSaveError,
  onSaveObjectStorage,
}: {
  databaseSettings: CloudUserConfigDatabaseSettings | undefined
  databaseSettingsLoading: boolean
  databaseSettingsError: unknown
  databaseSettingsSaving: boolean
  databaseSettingsSaveError: unknown
  onSaveDatabaseSettings: (body: CloudUserConfigDatabaseSettingsBody) => Promise<CloudUserConfigDatabaseSettings>,
  objectStorageSettings: ObjectStorageSettings | undefined
  objectStorageLoading: boolean
  objectStorageError: unknown
  objectStorageSaving: boolean
  objectStorageSaveError: unknown
  onSaveObjectStorage: (body: ObjectStorageSettingsBody) => void
}) {
  return (
    <section className="mb-7 space-y-5">
      <CloudUserConfigDatabaseSettingsCard
        settings={databaseSettings}
        isLoading={databaseSettingsLoading}
        error={databaseSettingsError}
        saving={databaseSettingsSaving}
        saveError={databaseSettingsSaveError}
        onSave={onSaveDatabaseSettings}
      />
      <ObjectStorageSettingsCard
        settings={objectStorageSettings}
        isLoading={objectStorageLoading}
        error={objectStorageError}
        saving={objectStorageSaving}
        saveError={objectStorageSaveError}
        onSave={onSaveObjectStorage}
      />
    </section>
  )
}

function CloudUserConfigDatabaseSettingsCard({
  settings,
  isLoading,
  error,
  saving,
  saveError,
  onSave,
}: {
  settings: CloudUserConfigDatabaseSettings | undefined
  isLoading: boolean
  error: unknown
  saving: boolean
  saveError: unknown
  onSave: (body: CloudUserConfigDatabaseSettingsBody) => Promise<CloudUserConfigDatabaseSettings>,
}) {
  const [host, setHost] = useState("")
  const [port, setPort] = useState("5432")
  const [database, setDatabase] = useState("")
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [sslmode, setSslmode] = useState("require")
  const [connectTimeoutSeconds, setConnectTimeoutSeconds] = useState("10")
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [restartError, setRestartError] = useState<string | null>(null)
  const canRestartDesktop = canRestartRuntimeFromDesktop()

  useEffect(() => {
    if (!settings) return
    setHost(settings.host ?? "")
    setPort(String(settings.port || 5432))
    setDatabase(settings.database ?? "")
    setUsername(settings.username ?? "")
    setSslmode(settings.sslmode || "require")
    setConnectTimeoutSeconds(String(settings.connect_timeout_seconds || 10))
    setPassword("")
    setSuccessMessage(null)
    setRestartError(null)
  }, [settings])

  if (isLoading) return <LoadingCard label="正在加载用户通用数据 PostgreSQL 设置" />
  if (error || !settings) return <ErrorCard title="PostgreSQL 设置加载失败" error={error} />

  const parseStrictPositiveInt = (value: string): number | null => {
    const trimmed = value.trim()
    if (!/^\d+$/.test(trimmed)) return null
    const parsed = Number(trimmed)
    if (!Number.isSafeInteger(parsed) || parsed <= 0) return null
    return parsed
  }

  const portNumber = parseStrictPositiveInt(port)
  const timeoutNumber = parseStrictPositiveInt(connectTimeoutSeconds)
  const validationError = (() => {
    if (!host.trim() || !database.trim() || !username.trim()) {
      return "请填写 Host、Database 和 Username。"
    }
    if (portNumber == null) {
      return "Port 必须是大于 0 的整数，不能包含非数字字符。"
    }
    if (timeoutNumber == null) {
      return "连接超时秒数必须是大于 0 的整数，不能包含非数字字符。"
    }
    if (!settings.password_configured && !password.trim()) {
      return "首次配置时必须填写 Password。"
    }
    return null
  })()

  const dirty =
    host.trim() !== (settings.host ?? "") ||
    (portNumber ?? -1) !== (settings.port || 5432) ||
    database.trim() !== (settings.database ?? "") ||
    username.trim() !== (settings.username ?? "") ||
    sslmode.trim() !== (settings.sslmode || "require") ||
    (timeoutNumber ?? -1) !== (settings.connect_timeout_seconds || 10) ||
    password.trim().length > 0

  const statusOk = settings.configured && settings.shared_config_snapshot_ready
  const statusLabel = !settings.configured
    ? "未配置"
    : settings.restart_required
      ? "已保存待重启"
      : settings.effective_target_matches_saved
        ? "当前进程已生效"
        : "已配置"

  const updateField = (updater: () => void) => {
    updater()
    setSuccessMessage(null)
    setRestartError(null)
  }

  const handleSave = async () => {
    if (validationError || portNumber == null || timeoutNumber == null) return
    setSuccessMessage(null)
    setRestartError(null)
    try {
      const next = await onSave({
        enabled: true,
        backend: "postgresql",
        host: host.trim(),
        port: portNumber,
        database: database.trim(),
        username: username.trim(),
        password: password.trim() ? password : null,
        sslmode: sslmode.trim() || "require",
        connect_timeout_seconds: timeoutNumber,
      })
      setPassword("")
      if (next.restart_required) {
        setSuccessMessage("连接配置已保存到本机。请重启 Runtime 后生效；当前进程仍可能使用旧数据库。")
      } else {
        setSuccessMessage("连接配置已保存。")
      }
    } catch {
      setSuccessMessage(null)
    }
  }

  const handleRestart = async () => {
    setRestarting(true)
    setRestartError(null)
    try {
      await restartRuntimeFromDesktop()
      setSuccessMessage("已请求重启 Runtime，请等待服务恢复后重新打开设置页确认生效状态。")
    } catch (restartFailure) {
      setRestartError(restartFailure instanceof Error ? restartFailure.message : "Runtime 自动重启失败，请手动重启。")
    } finally {
      setRestarting(false)
    }
  }

  return (
    <section className="rounded-2xl border border-app-border/80 bg-app-surface/80">
      <div className="flex flex-col gap-3 border-b border-app-border/80 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-app-primary">用户通用数据 PostgreSQL</h2>
          <p className="mt-1 text-sm leading-6 text-app-secondary">
            本机连接用户共享配置权威库的地址与账号。密码只保存在本机 bootstrap，不会写入共享库，也不会回显明文。
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StatusPill ok={statusOk} okLabel={statusLabel} failLabel={statusLabel} />
          <StatusPill
            ok={settings.shared_config_snapshot_ready}
            okLabel="快照就绪"
            failLabel="快照待修复"
          />
        </div>
      </div>

      <div className="grid gap-4 p-5 md:grid-cols-2">
        <SettingsField label="PostgreSQL Host" hint="例如 127.0.0.1 或 db.mindloop.chat">
          <input value={host} onChange={(event) => updateField(() => setHost(event.target.value))} className={inputClassName} placeholder="请输入 Host" />
        </SettingsField>
        <SettingsField label="Port" hint="本地 Docker 常见 5432；云端映射常见 25432">
          <input value={port} onChange={(event) => updateField(() => setPort(event.target.value))} className={inputClassName} placeholder="5432" />
        </SettingsField>
        <SettingsField label="Database" hint="项目默认 agent_runtime">
          <input value={database} onChange={(event) => updateField(() => setDatabase(event.target.value))} className={inputClassName} placeholder="agent_runtime" />
        </SettingsField>
        <SettingsField label="Username" hint="项目默认 agent_runtime_client">
          <input value={username} onChange={(event) => updateField(() => setUsername(event.target.value))} className={inputClassName} placeholder="agent_runtime_client" />
        </SettingsField>
        <SettingsField
          label="Password"
          hint={settings.password_configured ? "已配置；留空表示不覆盖。" : "尚未配置，保存时必须填写。"}
        >
          <input
            value={password}
            type="password"
            onChange={(event) => updateField(() => setPassword(event.target.value))}
            className={inputClassName}
            placeholder={settings.password_configured ? "已配置，输入新值可覆盖" : "请输入 Password"}
            autoComplete="new-password"
          />
        </SettingsField>
        <SettingsField label="SSL Mode" hint="本机无 TLS 时用 disable；云端通常 require">
          <input value={sslmode} onChange={(event) => updateField(() => setSslmode(event.target.value))} className={inputClassName} placeholder="require" />
        </SettingsField>
        <SettingsField label="Connect Timeout Seconds" hint="连接超时秒数">
          <input value={connectTimeoutSeconds} onChange={(event) => updateField(() => setConnectTimeoutSeconds(event.target.value))} className={inputClassName} placeholder="10" />
        </SettingsField>
        <ReadonlySettingsValue
          label="快照 revision"
          value={settings.snapshot_revision == null ? "未知" : String(settings.snapshot_revision)}
        />
      </div>

      {settings.warnings.length > 0 ? (
        <div className="space-y-2 px-5 pb-2">
          {settings.warnings.map((warning) => (
            <InlineMessage key={warning} tone="warn" text={warning} />
          ))}
        </div>
      ) : null}
      {successMessage ? (
        <div className="px-5 pb-2">
          <div className="mb-2 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
            <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            {successMessage}
          </div>
        </div>
      ) : null}
      {restartError ? (
        <div className="px-5 pb-2">
          <InlineMessage tone="error" text={restartError} />
        </div>
      ) : null}

      <div className="border-t border-app-border/80 px-5 py-4">
        {validationError && dirty ? <InlineMessage tone="warn" text={validationError} /> : null}
        {saveError ? <InlineMessage tone="error" text={saveError instanceof Error ? saveError.message : "保存失败。"} /> : null}
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <button
            type="button"
            disabled={!dirty || saving || Boolean(validationError)}
            onClick={() => void handleSave()}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            保存设置
          </button>
          {canRestartDesktop && settings.restart_required ? (
            <button
              type="button"
              disabled={restarting || saving}
              onClick={() => void handleRestart()}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-app-border/80 bg-app-surface/85 px-3 text-xs font-medium text-app-primary transition hover:bg-app-selected disabled:cursor-not-allowed disabled:opacity-40"
            >
              {restarting ? <Loader2 size={13} className="animate-spin" /> : <Server size={13} />}
              重启 Runtime
            </button>
          ) : null}
          {!canRestartDesktop && settings.restart_required ? (
            <span className="text-xs leading-5 text-app-muted">
              浏览器/移动端请手动重启 Runtime 后生效。
            </span>
          ) : null}
          <span className="min-w-0 truncate text-xs text-app-muted">
            本机设置库：<span className="font-mono">{settings.bootstrap_db_path || "未设置"}</span>
          </span>
        </div>
      </div>
    </section>
  )
}

function ObjectStorageSettingsCard({
  settings,
  isLoading,
  error,
  saving,
  saveError,
  onSave,
}: {
  settings: ObjectStorageSettings | undefined
  isLoading: boolean
  error: unknown
  saving: boolean
  saveError: unknown
  onSave: (body: ObjectStorageSettingsBody) => void
}) {
  const [accessKeyId, setAccessKeyId] = useState("")
  const [accessKeySecret, setAccessKeySecret] = useState("")

  useEffect(() => {
    if (!settings) return
    setAccessKeyId(settings.object_storage_access_key_id ?? "")
    setAccessKeySecret(settings.object_storage_access_key_secret ?? "")
  }, [settings])

  const dirty = settings
    ? accessKeyId !== (settings.object_storage_access_key_id ?? "") ||
      accessKeySecret !== (settings.object_storage_access_key_secret ?? "")
    : false
  const configured = Boolean(
    settings?.object_storage_access_key_id_configured &&
    settings.object_storage_access_key_secret_configured,
  )

  if (isLoading) return <LoadingCard label="正在加载 OSS 用户设置" />
  if (error || !settings) return <ErrorCard title="OSS 设置加载失败" error={error} />

  return (
    <section className="rounded-2xl border border-app-border/80 bg-app-surface/80">
      <div className="flex items-start justify-between gap-4 border-b border-app-border/80 px-5 py-4">
        <div>
          <h2 className="text-lg font-semibold text-app-primary">对象存储用户设置</h2>
          <p className="mt-1 text-sm leading-6 text-app-secondary">OSS 服务商、Endpoint、Region、Bucket 和对象路径使用产品内置默认值；用户只需要配置访问密钥。</p>
        </div>
        <StatusPill ok={configured} okLabel="已配置" failLabel="未完整配置" />
      </div>
      <div className="grid gap-4 p-5 md:grid-cols-2">
        <ReadonlySettingsValue label="服务商" value={settings.gateway_provider} />
        <ReadonlySettingsValue label="Region" value={settings.object_storage_region} />
        <ReadonlySettingsValue label="Endpoint" value={settings.object_storage_endpoint} />
        <ReadonlySettingsValue label="Bucket" value={settings.object_storage_bucket_name} />
        <ReadonlySettingsValue label="对象 Key 前缀" value={settings.object_storage_object_key_prefix} />
        <ReadonlySettingsValue label="连接超时秒数" value={String(settings.connect_timeout_seconds)} />
        <div className="md:col-span-2">
          <ReadonlySettingsValue label="公共访问 URL 前缀" value={settings.object_storage_public_base_url} />
        </div>
        <SettingsField label="AccessKey ID" hint={settings.object_storage_access_key_id_configured ? "已配置；留空表示不覆盖。" : "尚未配置。"}>
          <input value={accessKeyId} onChange={(event) => setAccessKeyId(event.target.value)} placeholder={settings.object_storage_access_key_id_configured ? "已配置，输入新值可覆盖" : ""} className={inputClassName} />
        </SettingsField>
        <SettingsField label="AccessKey Secret" hint={settings.object_storage_access_key_secret_configured ? "已配置；留空表示不覆盖。" : "尚未配置。"}>
          <input value={accessKeySecret} onChange={(event) => setAccessKeySecret(event.target.value)} placeholder={settings.object_storage_access_key_secret_configured ? "已配置，输入新值可覆盖" : ""} className={inputClassName} />
        </SettingsField>
      </div>
      <SettingsFooter
        dbPath={settings.db_path}
        dirty={dirty}
        saving={saving}
        validationError={null}
        saveError={saveError}
        onSave={() => onSave({
          gateway_provider: settings.gateway_provider,
          object_storage_endpoint: settings.object_storage_endpoint,
          object_storage_region: settings.object_storage_region,
          object_storage_bucket_name: settings.object_storage_bucket_name,
          object_storage_public_base_url: settings.object_storage_public_base_url,
          object_storage_object_key_prefix: settings.object_storage_object_key_prefix,
          object_storage_access_key_id: accessKeyId.trim() ? accessKeyId : undefined,
          object_storage_access_key_secret: accessKeySecret.trim() ? accessKeySecret : undefined,
          connect_timeout_seconds: settings.connect_timeout_seconds,
        })}
      />
    </section>
  )
}

const inputClassName = "h-10 w-full rounded-lg border border-app-border/80 bg-app-surface/85 px-3 font-mono text-sm text-app-primary outline-none placeholder:text-app-subtle focus:border-sky-400/50"

function SettingsField({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
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

function ReadonlySettingsValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="block">
      <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-medium text-app-primary">{label}</span>
        <span className="text-xs text-app-muted">产品内置值</span>
      </div>
      <div className="min-h-10 rounded-lg border border-app-border/80 bg-app-surface/70 px-3 py-2 font-mono text-sm text-app-secondary">
        {value || "未设置"}
      </div>
    </div>
  )
}

function SettingsFooter({
  dbPath,
  dirty,
  saving,
  validationError,
  saveError,
  onSave,
}: {
  dbPath: string
  dirty: boolean
  saving: boolean
  validationError: string | null
  saveError: unknown
  onSave: () => void
}) {
  return (
    <div className="border-t border-app-border/80 px-5 py-4">
      {validationError ? <InlineMessage tone="warn" text={validationError} /> : null}
      {saveError ? <InlineMessage tone="error" text={saveError instanceof Error ? saveError.message : "保存失败。"} /> : null}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!dirty || saving || Boolean(validationError)}
          onClick={onSave}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-medium text-white transition hover:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          保存设置
        </button>
        <span className="min-w-0 truncate text-xs text-app-muted">设置数据库：<span className="font-mono">{dbPath}</span></span>
      </div>
    </div>
  )
}

function InlineMessage({ tone, text }: { tone: "warn" | "error"; text: string }) {
  const className = tone === "warn"
    ? "mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
    : "mb-2 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700"
  return (
    <div className={className}>
      <AlertCircle size={13} className="mt-0.5 shrink-0" />
      {text}
    </div>
  )
}

function StatusPill({ ok, okLabel, failLabel }: { ok: boolean; okLabel: string; failLabel: string }) {
  return (
    <div className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${ok ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
      {ok ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
      {ok ? okLabel : failLabel}
    </div>
  )
}

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="flex h-48 items-center justify-center gap-2 rounded-2xl border border-app-border/80 bg-app-surface/80 text-sm text-app-secondary">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  )
}

function ErrorCard({ title, error }: { title: string; error: unknown }) {
  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <AlertCircle size={16} />
        {title}
      </div>
      <div>{error instanceof Error ? error.message : "请求失败。"}</div>
    </div>
  )
}

function SystemSettingsContent({ data }: { data: SystemSettingsSnapshot }) {
  const config = data.raw_config
  const homeDir = inferHomeDir(data.config_path)

  return (
    <article className="space-y-6">
      <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-app-border/80 bg-app-surface/80 px-5 py-4 text-sm text-app-secondary">
        <FolderOpen size={15} className="shrink-0 text-app-muted" />
        <span className="shrink-0 text-app-muted">配置文件</span>
        <span className="truncate font-mono text-app-primary">{data.config_path}</span>
      </div>

      <PersistenceInventoryPanel items={data.persistence_inventory ?? []} />

      <div className="space-y-5">
        {SERVICE_DOMAINS.map((domain) => (
          <ServiceDomainSection key={domain.title} domain={domain} config={config} sectionNames={data.section_names} homeDir={homeDir} />
        ))}
      </div>
    </article>
  )
}

const PERSISTENCE_SCOPE_ORDER = [
  "user_global_reusable_config",
  "machine_local_config",
  "project_workspace_data",
  "runtime_history_diagnostic_state",
]

const PERSISTENCE_SCOPE_LABELS: Record<string, string> = {
  user_global_reusable_config: "用户级可复用配置",
  machine_local_config: "机器本地配置",
  project_workspace_data: "项目/工作区数据",
  runtime_history_diagnostic_state: "运行历史/诊断状态",
}

const SYNC_RECOMMENDATION_LABELS: Record<string, string> = {
  server_sync_candidate: "建议服务端同步",
  field_level_review: "需字段级评审",
  local_only: "仅本机保留",
  project_bound_local_state: "项目绑定本地状态",
  local_runtime_history: "本机运行历史",
  local_runtime_artifacts: "本机运行产物",
  security_local_or_dedicated_identity: "本地安全态/独立身份体系",
  diagnostic_local_only: "诊断本地保留",
  browser_local_only: "浏览器本地保留",
}

function PersistenceInventoryPanel({ items }: { items: PersistenceInventoryItem[] }) {
  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-5 text-sm text-app-secondary">
        当前后端没有返回持久化清单。
      </section>
    )
  }

  const candidateCount = items.filter((item) => item.server_sync_candidate).length
  const reviewCount = items.filter((item) => item.sync_recommendation === "field_level_review").length
  const localOnlyCount = items.length - candidateCount
  const groupedItems = PERSISTENCE_SCOPE_ORDER.map((scope) => ({
    scope,
    items: items.filter((item) => item.scope === scope),
  })).filter((group) => group.items.length > 0)

  return (
    <section className="overflow-hidden rounded-2xl border border-app-border/80 bg-app-surface/80">
      <div className="border-b border-app-border/80 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-app-primary">持久化与跨设备同步边界</h2>
            <p className="mt-1 text-sm leading-6 text-app-secondary">
              这份清单把当前本地 SQLite、YAML、JSON/JSONL、文件缓存和浏览器存储划分为用户级可复用配置、机器本地配置、项目/工作区数据，以及运行历史/诊断状态。
            </p>
          </div>
          <div className="grid min-w-52 grid-cols-3 gap-2 text-center text-xs">
            <InventoryMetric label="可同步候选" value={candidateCount} />
            <InventoryMetric label="需评审" value={reviewCount} />
            <InventoryMetric label="本地/项目态" value={localOnlyCount} />
          </div>
        </div>
      </div>
      <div className="divide-y divide-white/10">
        {groupedItems.map((group) => (
          <div key={group.scope} className="px-5 py-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-app-primary">{PERSISTENCE_SCOPE_LABELS[group.scope] ?? group.scope}</h3>
              <span className="rounded-full border border-app-border/80 bg-app-surface/85 px-2 py-0.5 text-[11px] text-app-muted">{group.items.length} 项</span>
            </div>
            <div className="grid gap-3 xl:grid-cols-2">
              {group.items.map((item) => (
                <PersistenceInventoryItemCard key={item.item_id} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function InventoryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-app-border/80 bg-app-surface/85 px-3 py-2">
      <div className="text-base font-semibold text-app-primary">{value}</div>
      <div className="text-app-muted">{label}</div>
    </div>
  )
}

function PersistenceInventoryItemCard({ item }: { item: PersistenceInventoryItem }) {
  return (
    <article className="min-w-0 rounded-xl border border-app-border/80 bg-app-surface/70 p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 className="truncate text-sm font-semibold text-app-primary">{item.title}</h4>
          <div className="mt-1 break-all font-mono text-[11px] text-app-muted">{item.storage_location}</div>
        </div>
        <span className="shrink-0 rounded-full border border-app-border/80 bg-app-surface/85 px-2 py-0.5 text-[11px] text-app-muted">
          {SYNC_RECOMMENDATION_LABELS[item.sync_recommendation] ?? item.sync_recommendation}
        </span>
      </div>
      <div className="mb-3 flex flex-wrap gap-2 text-[11px] text-app-muted">
        <span className="rounded-full border border-app-border/80 px-2 py-0.5">{item.storage_medium}</span>
        {item.server_sync_candidate ? <span className="rounded-full border border-app-border/80 px-2 py-0.5">服务端同步候选</span> : null}
        {item.config_sections.map((section) => (
          <span key={section} className="rounded-full border border-app-border/80 px-2 py-0.5 font-mono">{section}</span>
        ))}
      </div>
      <div className="space-y-3 text-xs leading-5 text-app-secondary">
        <div>
          <div className="mb-1 font-medium text-app-primary">实际持久化内容</div>
          <ul className="list-disc space-y-1 pl-4">
            {item.persisted_data.map((text) => <li key={text}>{text}</li>)}
          </ul>
        </div>
        <div>
          <div className="mb-1 font-medium text-app-primary">分类依据</div>
          <p>{item.rationale}</p>
        </div>
        {item.secret_handling ? (
          <div>
            <div className="mb-1 font-medium text-app-primary">敏感数据边界</div>
            <p>{item.secret_handling}</p>
          </div>
        ) : null}
        {item.migration_notes ? (
          <div>
            <div className="mb-1 font-medium text-app-primary">迁移提示</div>
            <p>{item.migration_notes}</p>
          </div>
        ) : null}
      </div>
    </article>
  )
}

function ServiceDomainSection({
  domain,
  config,
  sectionNames,
  homeDir,
}: {
  domain: ServiceDomainDefinition
  config: ConfigRecord
  sectionNames: string[]
  homeDir: string | undefined
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-app-border/80 bg-app-surface/70">
      <div className="border-b border-app-border/80 px-5 py-3">
        <h2 className="text-lg font-semibold text-app-primary">{domain.title}</h2>
        <p className="mt-1 text-sm leading-6 text-app-secondary">{domain.description}</p>
      </div>
      <div className="divide-y divide-white/10">
        {domain.modules.map((module) => (
          <ModuleCard key={module.section} module={module} config={config} present={sectionNames.includes(module.section)} homeDir={homeDir} />
        ))}
      </div>
    </section>
  )
}

function ModuleCard({
  module,
  config,
  present,
  homeDir,
}: {
  module: ModuleDefinition
  config: ConfigRecord
  present: boolean
  homeDir: string | undefined
}) {
  const Icon = module.icon
  const section = sectionRecord(config, module.section)

  return (
    <section className="min-w-0 px-5 py-4">
      <div className="mb-3 flex min-w-0 items-center gap-2">
        <Icon size={15} className="shrink-0 text-app-accent-muted" />
        <h3 className="text-sm font-semibold text-app-primary">{module.title}</h3>
        <span className="truncate font-mono text-xs text-app-muted">{module.section}</span>
      </div>

      <div>
        {present ? (
          <div className="overflow-hidden rounded-xl border border-app-border/80">
            <div className="hidden grid-cols-[15rem_minmax(14rem,1fr)_minmax(24rem,1.5fr)] gap-4 border-b border-app-border/80 bg-app-surface/80 px-4 py-2 text-xs text-app-muted xl:grid">
              <div>配置项</div>
              <div>当前值</div>
              <div>说明</div>
            </div>
            <div className="divide-y divide-white/10">
              {module.fields.map((field) => (
                <FieldRow key={field.path.join(".")} section={module.section} field={field} value={readPath(section, field.path)} homeDir={homeDir} />
              ))}

              {module.nestedGroups?.map((group) => {
                const groupValue = readPath(section, group.path)
                if (!isRecord(groupValue)) return null

                return (
                  <div key={group.path.join(".")}>
                    <div className="bg-white/[0.025] px-4 py-2">
                      <div className="text-xs font-medium text-app-secondary">{group.title}</div>
                    </div>
                    {group.fields.map((field) => (
                      <FieldRow
                        key={[...group.path, ...field.path].join(".")}
                        section={module.section}
                        parentPath={group.path}
                        field={field}
                        value={readPath(groupValue, field.path)}
                        homeDir={homeDir}
                      />
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">当前 YAML 文件中没有这个配置段。</div>
        )}
      </div>
    </section>
  )
}

function FieldRow({
  section,
  parentPath = [],
  field,
  value,
  homeDir,
}: {
  section: string
  parentPath?: string[]
  field: FieldDefinition
  value: unknown
  homeDir: string | undefined
}) {
  const text = displayValue(value, field.kind, homeDir)
  const key = [section, ...parentPath, ...field.path].join(".")

  return (
    <div className="grid gap-2 px-4 py-3 text-sm xl:grid-cols-[15rem_minmax(14rem,1fr)_minmax(24rem,1.5fr)] xl:gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-app-primary">{field.label}</span>
          {field.kind ? <KindBadge kind={field.kind} /> : null}
        </div>
        <div className="mt-1 break-all font-mono text-[11px] leading-5 text-slate-600">{key}</div>
      </div>
      <div className={`break-all font-mono text-xs leading-5 ${valueColor(field.kind)}`}>
        <span className="mr-2 text-slate-600 xl:hidden">值</span>
        {text}
      </div>
      <div className="text-xs leading-5 text-app-secondary">
        <span className="mr-2 text-slate-600 xl:hidden">说明</span>
        {field.hint}
      </div>
    </div>
  )
}

function KindBadge({ kind }: { kind: FieldKind }) {
  const labelByKind: Record<FieldKind, string> = {
    text: "text",
    number: "number",
    path: "path",
    url: "url",
    provider: "provider",
    secret: "secret",
  }

  return <span className="shrink-0 rounded-full border border-app-border/80 bg-app-surface/85 px-2 py-0.5 font-mono text-[10px] text-app-muted">{labelByKind[kind]}</span>
}

function valueColor(kind: FieldKind | undefined) {
  if (kind === "secret") return "text-amber-700"
  if (kind === "url") return "text-blue-700"
  if (kind === "path") return "text-emerald-700"
  if (kind === "provider") return "text-violet-700"
  return "text-app-primary"
}

function sectionRecord(config: ConfigRecord, sectionName: string): ConfigRecord {
  const value = config[sectionName]
  return isRecord(value) ? value : {}
}

function readPath(source: ConfigRecord, path: string[]) {
  return path.reduce<unknown>((current, key) => (isRecord(current) ? current[key] : undefined), source)
}

function isRecord(value: unknown): value is ConfigRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function displayValue(value: unknown, kind: FieldKind | undefined, homeDir: string | undefined) {
  if (value === null || value === undefined || value === "") return "未设置"
  if (kind === "secret") return normalizeSecretValue(value)
  if (typeof value === "boolean") return value ? "true" : "false"
  if (kind === "path") return expandTildePath(String(value), homeDir)
  return String(value)
}

function normalizeSecretValue(value: unknown) {
  const text = String(value)
  if (text.startsWith("${") && text.endsWith("}")) return `环境变量 ${text.slice(2, -1)}`
  return text
}

function inferHomeDir(configPath: string) {
  const normalizedPath = configPath.replaceAll("\\", "/")
  const marker = "/.spread-ai/"
  const markerIndex = normalizedPath.toLowerCase().indexOf(marker)
  if (markerIndex <= 0) return undefined

  const normalizedHomeDir = normalizedPath.slice(0, markerIndex)
  return configPath.includes("\\") ? normalizedHomeDir.replaceAll("/", "\\") : normalizedHomeDir
}

function expandTildePath(path: string, homeDir: string | undefined) {
  if (!homeDir) return path
  if (path === "~") return homeDir
  if (!path.startsWith("~/") && !path.startsWith("~\\")) return path

  const relativePath = path.slice(2)
  if (homeDir.includes("\\")) return `${homeDir}\\${relativePath.replace(/[\\/]+/g, "\\")}`
  return `${homeDir}/${relativePath.replace(/[\\/]+/g, "/")}`
}
