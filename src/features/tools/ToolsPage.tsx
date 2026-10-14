import { useEffect, useMemo, useState, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { getToolDetail, listTools, type ToolDetail, type ToolSummary } from "@/features/studio/studioApi"
import { ImageGenerationLlmRegistryPanel, type ImageGenerationRegistryResource } from "@/features/tools/ImageGenerationLlmRegistryPanel"
import {
  getImageGenerationSettings,
  getWebToolsSettings,
  listImageGenerationLlmExecutionPolicies,
  listImageGenerationLlmProviders,
  listLlmProviders,
  updateImageGenerationSettings,
  updateWebToolsSettings,
  type ImageGenerationSettings,
  type LlmExecutionPolicy,
  type LlmProviderDefinition,
  type WebToolPolicyCandidate,
  type WebToolsSettings,
} from "@/features/settings/settingsApi"
import { Badge } from "@/shared/components/Badge"
import {
  AdaptiveResourceLayout,
  DetailLayout,
  GroupedCompactResourceList,
  ResourceCard,
  ResourceGrid,
  ResourceManagementLayout,
  StatusText,
  countBy,
  filterOptionsFromCounts,
  matchesQuery,
} from "@/shared/components/ResourceManagement"

const CATEGORY_META: Record<string, { label: string; tone: "blue" | "amber" | "purple" }> = {
  business: { label: "业务工具", tone: "blue" },
  lifecycle: { label: "生命周期工具", tone: "amber" },
  system: { label: "系统工具", tone: "purple" },
}

type ToolsTab = "list" | "image_generation" | "web_tools"
type ImageGenerationSettingsSubTab = "runtime" | ImageGenerationRegistryResource

const IMAGE_GENERATION_SETTINGS_QUERY_KEY = ["tools", "image-generation-settings"] as const
const IMAGE_GENERATION_LLM_QUERY_KEY_PREFIX = ["image-generation", "llm-registry"] as const
const IMAGE_GENERATION_LLM_PROVIDERS_QUERY_KEY = [...IMAGE_GENERATION_LLM_QUERY_KEY_PREFIX, "providers"] as const
const IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY = [...IMAGE_GENERATION_LLM_QUERY_KEY_PREFIX, "execution-policies"] as const
const IMAGE_API_FORMAT = "openai_images_generations"
const GPT_IMAGE_AGENT_API_FORMAT = "openai_responses"
const WEB_TOOLS_SETTINGS_QUERY_KEY = ["tools", "web-tools-settings"] as const
const WEB_TOOLS_LLM_PROVIDERS_QUERY_KEY = ["llm", "providers"] as const
const DEFAULT_WEB_API_FORMATS = ["openai_responses", "anthropic_messages", "gemini_generate_content", "zhipu_chat_completions"]

type ImageBindingInfo = {
  provider: LlmProviderDefinition
  binding: LlmProviderDefinition["models"][number]
}

type WebBindingInfo = {
  provider: LlmProviderDefinition
  binding: LlmProviderDefinition["models"][number]
}

type WebCandidateRow = WebToolPolicyCandidate & {
  uiId: string
}

export function ToolsPage() {
  const [activeTab, setActiveTab] = useState<ToolsTab>("list")
  return (
    <div className="h-full bg-app-bg">
      <div className="border-b border-app-border/80 px-6 pt-4">
        <div className="flex gap-2">
          <ToolsTabButton active={activeTab === "list"} onClick={() => setActiveTab("list")}>工具列表</ToolsTabButton>
          <ToolsTabButton active={activeTab === "image_generation"} onClick={() => setActiveTab("image_generation")}>图片生成设置</ToolsTabButton>
          <ToolsTabButton active={activeTab === "web_tools"} onClick={() => setActiveTab("web_tools")}>网络工具设置</ToolsTabButton>
        </div>
      </div>
      <div className="h-[calc(100%-3.25rem)] min-h-0">
        {activeTab === "list" ? <ToolListPanel /> : activeTab === "image_generation" ? <ImageGenerationSettingsPanel /> : <WebToolsSettingsPanel />}
      </div>
    </div>
  )
}

function ToolsTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-t-lg border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-400",
        active ? "border-app-border/80 border-b-app-bg bg-app-bg text-app-primary" : "border-transparent text-app-muted hover:bg-app-surface/85 hover:text-app-secondary",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

function ToolListPanel() {
  const { data, isLoading, error } = useQuery({ queryKey: ["tools"], queryFn: listTools })
  const tools = data ?? []
  const [selected, setSelected] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [activeGroup, setActiveGroup] = useState<string | null>(null)

  const categoryOptions = useMemo(() => {
    const counts = countBy(tools, (tool) => tool.category)
    const options = filterOptionsFromCounts(counts, tools.length)
    return options.map((option) => ({ ...option, label: CATEGORY_META[option.value]?.label ?? option.label }))
  }, [tools])

  const categoryFiltered = useMemo(
    () => tools.filter((tool) => !activeCategory || tool.category === activeCategory),
    [activeCategory, tools],
  )

  const groupOptions = useMemo(
    () => filterOptionsFromCounts(countBy(categoryFiltered, (tool) => tool.group || "default"), categoryFiltered.length),
    [categoryFiltered],
  )

  const filtered = useMemo(
    () =>
      categoryFiltered.filter((tool) => {
        if (activeGroup && (tool.group || "default") !== activeGroup) return false
        const meta = CATEGORY_META[tool.category]
        return matchesQuery(
          [tool.tool_name, tool.description, tool.group, tool.category, meta?.label, tool.always_enabled ? "always enabled" : "", tool.allowed_loop_decisions.join(" ")],
          search,
        )
      }),
    [activeGroup, categoryFiltered, search],
  )

  const selectedTool = selected ? tools.find((tool) => tool.tool_name === selected) : null

  if (selectedTool) {
    const compactItems = filtered.some((tool) => tool.tool_name === selectedTool.tool_name) ? filtered : tools
    return (
      <AdaptiveResourceLayout
        list={
          <GroupedCompactResourceList
            items={compactItems}
            selectedKey={selectedTool.tool_name}
            onSelect={(tool) => setSelected(tool.tool_name)}
            getKey={(tool) => tool.tool_name}
            getTitle={(tool) => tool.tool_name}
            getGroup={(tool) => tool.group || "default"}
            onBack={() => setSelected(null)}
          />
        }
        detail={<ToolDetailStage name={selectedTool.tool_name} />}
      />
    )
  }

  return (
    <ResourceManagementLayout
      count={tools.length}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="搜索工具名 / 描述 / 分类 / 分组..."
      primaryFilters={categoryOptions}
      activePrimary={activeCategory}
      onPrimaryChange={(value) => {
        setActiveCategory(value)
        setActiveGroup(null)
      }}
      secondaryFilters={groupOptions}
      activeSecondary={activeGroup}
      onSecondaryChange={setActiveGroup}
    >
      <StatusText isLoading={isLoading} error={error} empty={!isLoading && !error && filtered.length === 0} />
      <ResourceGrid>
        {filtered.map((tool) => (
          <ToolCard key={tool.tool_name} tool={tool} onSelect={() => setSelected(tool.tool_name)} />
        ))}
      </ResourceGrid>
    </ResourceManagementLayout>
  )
}

function ImageGenerationSettingsPanel() {
  const [activeSubTab, setActiveSubTab] = useState<ImageGenerationSettingsSubTab>("runtime")
  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg text-app-primary">
      <div className="border-b border-app-border/80 px-6 pt-4">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">图片生成工具配置</h2>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-app-secondary">
              图片生成工具使用独立的图片生成 LLM 配置数据域；服务商、模型和策略的交互结构与业务 Agent LLM 配置一致，但不会混入业务 Agent 的 LLM Registry。
            </p>
          </div>
          <div className="rounded-xl border border-app-border/80 bg-app-surface-muted/90 px-3 py-2 font-mono text-xs text-app-secondary">
            {IMAGE_API_FORMAT} / {GPT_IMAGE_AGENT_API_FORMAT}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ImageGenerationSubTabButton active={activeSubTab === "runtime"} onClick={() => setActiveSubTab("runtime")}>工具运行设置</ImageGenerationSubTabButton>
          <ImageGenerationSubTabButton active={activeSubTab === "providers"} onClick={() => setActiveSubTab("providers")}>服务商</ImageGenerationSubTabButton>
          <ImageGenerationSubTabButton active={activeSubTab === "models"} onClick={() => setActiveSubTab("models")}>模型</ImageGenerationSubTabButton>
          <ImageGenerationSubTabButton active={activeSubTab === "policies"} onClick={() => setActiveSubTab("policies")}>服务商策略</ImageGenerationSubTabButton>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeSubTab === "runtime" ? (
          <ImageGenerationRuntimeSettingsPanel />
        ) : (
          <ImageGenerationLlmRegistryPanel key={activeSubTab} resource={activeSubTab} />
        )}
      </div>
    </div>
  )
}

function ImageGenerationSubTabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-t-lg border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-400",
        active ? "border-app-border/80 border-b-app-bg bg-app-bg text-app-primary" : "border-transparent text-app-muted hover:bg-app-surface/85 hover:text-app-secondary",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

function ImageGenerationRuntimeSettingsPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: IMAGE_GENERATION_SETTINGS_QUERY_KEY, queryFn: getImageGenerationSettings })
  const providersQuery = useQuery({ queryKey: IMAGE_GENERATION_LLM_PROVIDERS_QUERY_KEY, queryFn: listImageGenerationLlmProviders })
  const policiesQuery = useQuery({ queryKey: IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY, queryFn: listImageGenerationLlmExecutionPolicies })
  const [policyId, setPolicyId] = useState("")
  const [localError, setLocalError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const mutation = useMutation({
    mutationFn: async () => {
      const normalizedPolicyId = policyId.trim()
      if (!normalizedPolicyId) throw new Error("执行策略 ID 不能为空")
      return updateImageGenerationSettings({
        llm_policy_group_id: normalizedPolicyId,
      })
    },
    onSuccess: (next) => {
      queryClient.setQueryData(IMAGE_GENERATION_SETTINGS_QUERY_KEY, next)
      setSavedAt(new Date().toLocaleTimeString())
    },
  })

  useEffect(() => {
    if (!settingsQuery.data) return
    setPolicyId(settingsQuery.data.llm_policy_group_id ?? "")
    setLocalError(null)
  }, [settingsQuery.data])

  const imageBindings = useMemo(() => collectImageBindings(providersQuery.data ?? []), [providersQuery.data])
  const hasQueryError = Boolean(settingsQuery.error || providersQuery.error || policiesQuery.error)
  const isLoading = settingsQuery.isLoading || providersQuery.isLoading || policiesQuery.isLoading
  const canSave = !isLoading && !hasQueryError && !mutation.isPending

  const handleSave = () => {
    setLocalError(null)
    mutation.mutate(undefined, {
      onError: (error) => setLocalError(errorToText(error)),
    })
  }

  return (
    <div className="h-full overflow-auto bg-app-bg px-6 py-6 text-app-primary">
      <div className="mx-auto max-w-6xl space-y-5">
        <ImageGenerationErrorPanel
          settingsError={settingsQuery.error}
          providersError={providersQuery.error}
          policiesError={policiesQuery.error}
          onRetry={() => {
            void settingsQuery.refetch()
            void providersQuery.refetch()
            void policiesQuery.refetch()
          }}
        />

        <ImageGenerationStatusCard data={settingsQuery.data ?? null} loading={isLoading} />

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-blue-300">图片生成 LLM 服务商</div>
                <h3 className="mt-1 text-lg font-semibold">服务商接入</h3>
              </div>
              <span className="rounded-full border border-app-border/80 bg-app-surface-muted px-2 py-1 text-xs text-app-secondary">{imageBindings.length} 个图片接入</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-app-muted">
              这里显示当前可用于生图的服务商模型接入。服务商、API Key、重试和模型接入项在上方“服务商 / 模型”子页维护。
            </p>
            <ImageBindingList bindings={imageBindings} />
          </section>

          <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-medium text-blue-300">图片生成服务商策略</div>
                <h3 className="mt-1 text-lg font-semibold">执行策略绑定</h3>
              </div>
              <span className="rounded-full border border-app-border/80 bg-app-surface-muted px-2 py-1 text-xs text-app-secondary">{(policiesQuery.data ?? []).length} 个策略</span>
            </div>
            <p className="mt-2 text-sm leading-6 text-app-muted">
              本页只保存 generate_image 工具运行时使用的图片生成策略。策略候选顺序在“服务商策略”子页维护。
            </p>
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-app-muted">工具使用的执行策略</span>
                <select
                  value={policyId}
                  onChange={(event) => {
                    setPolicyId(event.target.value)
                    setSavedAt(null)
                  }}
                  disabled={isLoading}
                  className="h-9 w-full rounded-lg border border-app-border/80 bg-app-surface-muted px-3 font-mono text-sm text-app-primary outline-none transition focus:border-blue-400/60 disabled:cursor-not-allowed disabled:text-app-muted disabled:opacity-70"
                >
                  <option value="">未选择</option>
                  {(policiesQuery.data ?? []).map((policy) => (
                    <option key={policy.policy_group_id} value={policy.policy_group_id}>{policy.policy_group_id}</option>
                  ))}
                </select>
              </label>
            </div>
          </section>
        </div>

        <section className="sticky bottom-0 rounded-2xl border border-app-border/80 bg-app-rail/95 p-4 shadow-2xl shadow-slate-900/12 backdrop-blur">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-app-secondary">
              {savedAt ? <span className="text-emerald-300">已保存运行策略，时间 {savedAt}</span> : "保存后，后续 generate_image 调用会使用该策略。"}
              {localError || mutation.error ? <span className="ml-0 block text-red-300 sm:ml-3 sm:inline">{localError || errorToText(mutation.error)}</span> : null}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!canSave}
              className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {mutation.isPending ? "保存中..." : "保存运行策略"}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}

function WebToolsSettingsPanel() {
  const queryClient = useQueryClient()
  const settingsQuery = useQuery({ queryKey: WEB_TOOLS_SETTINGS_QUERY_KEY, queryFn: getWebToolsSettings })
  const providersQuery = useQuery({ queryKey: WEB_TOOLS_LLM_PROVIDERS_QUERY_KEY, queryFn: listLlmProviders })
  const [candidates, setCandidates] = useState<WebCandidateRow[]>([])
  const [localError, setLocalError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const supportedApiFormats = settingsQuery.data?.supported_api_formats?.length ? settingsQuery.data.supported_api_formats : DEFAULT_WEB_API_FORMATS
  const webBindings = useMemo(() => collectWebBindings(providersQuery.data ?? [], supportedApiFormats), [providersQuery.data, supportedApiFormats])
  const mutation = useMutation({
    mutationFn: async () => updateWebToolsSettings({ candidates: normalizeWebCandidates(candidates, webBindings) }),
    onSuccess: (next) => {
      queryClient.setQueryData(WEB_TOOLS_SETTINGS_QUERY_KEY, next)
      setSavedAt(new Date().toLocaleTimeString())
    },
  })

  useEffect(() => {
    if (!settingsQuery.data) return
    setCandidates(settingsQuery.data.candidates.map(webCandidateToRow))
    setLocalError(null)
  }, [settingsQuery.data])

  const hasQueryError = Boolean(settingsQuery.error || providersQuery.error)
  const isLoading = settingsQuery.isLoading || providersQuery.isLoading
  const canSave = !isLoading && !hasQueryError && !mutation.isPending

  const handleAddCandidate = () => {
    const firstBinding = webBindings[0]
    const providerId = firstBinding?.provider.provider_id ?? ""
    const bindingId = firstBinding?.binding.id ?? ""
    setCandidates((current) => [
      ...current,
      {
        uiId: crypto.randomUUID(),
        id: createUniqueWebCandidateId(providerId || "provider", bindingId || "model", current),
        provider_id: providerId,
        model_binding_id: bindingId,
        enabled: true,
      },
    ])
    setSavedAt(null)
  }

  const handleSave = () => {
    setLocalError(null)
    mutation.mutate(undefined, {
      onError: (error) => setLocalError(errorToText(error)),
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg text-app-primary">
      <div className="border-b border-app-border/80 px-6 py-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">网络工具配置</h2>
            <p className="mt-1 max-w-4xl text-sm leading-6 text-app-secondary">
              网络搜索和 URL 上下文读取工具复用主 LLM 服务商配置；每次工具调用都是独立底层对话，完整调用失败后按候选顺序切换下一个服务商模型。
            </p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {supportedApiFormats.map((format) => (
              <span key={format} className="rounded-lg border border-app-border/80 bg-app-surface-muted/90 px-2 py-1 font-mono text-[11px] text-app-secondary">{format}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-6 py-6">
        <div className="mx-auto max-w-6xl space-y-5">
          <WebToolsErrorPanel
            settingsError={settingsQuery.error}
            providersError={providersQuery.error}
            onRetry={() => {
              void settingsQuery.refetch()
              void providersQuery.refetch()
            }}
          />
          <WebToolsStatusCard data={settingsQuery.data ?? null} loading={isLoading} webBindingCount={webBindings.length} />
          <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-blue-300">支持联网的 LLM 接入</div>
                  <h3 className="mt-1 text-lg font-semibold">可选服务商模型</h3>
                </div>
                <span className="rounded-full border border-app-border/80 bg-app-surface-muted px-2 py-1 text-xs text-app-secondary">{webBindings.length} 个接入</span>
              </div>
              <p className="mt-2 text-sm leading-6 text-app-muted">
                这里只展示主 LLM Registry 中 api_format 属于网络工具支持范围的模型接入项。服务商、API Key、重试策略仍在 LLM 菜单维护。
              </p>
              <WebBindingList bindings={webBindings} />
            </section>
            <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-medium text-blue-300">网络工具服务商策略</div>
                  <h3 className="mt-1 text-lg font-semibold">有序候选列表</h3>
                </div>
                <button type="button" onClick={handleAddCandidate} disabled={!webBindings.length} className="rounded-lg px-3 py-1.5 text-xs font-medium text-blue-300 hover:bg-blue-500/10 disabled:cursor-not-allowed disabled:text-slate-600">
                  新增候选
                </button>
              </div>
              <p className="mt-2 text-sm leading-6 text-app-muted">
                调用 web_search 或 read_url_context 时，从第一个启用候选开始执行；一次完整工具调用失败后才切换到下一个候选。
              </p>
              <div className="mt-4 space-y-3">
                {candidates.map((candidate, index) => (
                  <WebCandidateEditorCard
                    key={candidate.uiId}
                    candidate={candidate}
                    index={index}
                    rows={candidates}
                    webBindings={webBindings}
                    onChange={(rows) => {
                      setCandidates(rows)
                      setSavedAt(null)
                    }}
                  />
                ))}
                {!candidates.length ? <div className="rounded-xl border border-dashed border-app-border/80 bg-app-surface-muted/90 p-4 text-sm text-app-muted">还没有网络工具服务商候选。</div> : null}
              </div>
            </section>
          </div>
          <section className="sticky bottom-0 rounded-2xl border border-app-border/80 bg-app-rail/95 p-4 shadow-2xl shadow-slate-900/12 backdrop-blur">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-app-secondary">
                {savedAt ? <span className="text-emerald-300">已保存网络工具策略，时间 {savedAt}</span> : "保存后，后续 web_search / read_url_context 调用会使用该候选顺序。"}
                {localError || mutation.error ? <span className="ml-0 block text-red-300 sm:ml-3 sm:inline">{localError || errorToText(mutation.error)}</span> : null}
              </div>
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mutation.isPending ? "保存中..." : "保存网络工具策略"}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}

function ImageGenerationErrorPanel({
  settingsError,
  providersError,
  policiesError,
  onRetry,
}: {
  settingsError: unknown
  providersError: unknown
  policiesError: unknown
  onRetry: () => void
}) {
  const errors = [
    settingsError ? { label: "图片生成设置接口", endpoint: "/api/image-generation/settings", error: settingsError } : null,
    providersError ? { label: "图片生成 LLM 服务商接口", endpoint: "/api/image-generation/llm-registry/providers", error: providersError } : null,
    policiesError ? { label: "图片生成 LLM 执行策略接口", endpoint: "/api/image-generation/llm-registry/execution-policies", error: policiesError } : null,
  ].filter(Boolean) as Array<{ label: string; endpoint: string; error: unknown }>
  if (!errors.length) return null
  return (
    <section className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold">加载配置失败</div>
          <div className="mt-1 text-sm text-red-100/80">下面是具体失败接口，不再吞成一句“加载失败”。</div>
        </div>
        <button type="button" onClick={onRetry} className="rounded-lg border border-red-300/30 px-3 py-1.5 text-xs font-medium text-red-50 hover:bg-red-400/10">
          重试
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {errors.map((item) => (
          <div key={item.endpoint} className="rounded-lg bg-app-surface-muted/90 px-3 py-2">
            <div className="text-xs font-medium text-red-100">{item.label}</div>
            <div className="mt-1 font-mono text-xs text-red-100/80">{item.endpoint}</div>
            <div className="mt-1 text-sm text-red-50">{errorToText(item.error)}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ImageGenerationStatusCard({ data, loading }: { data: ImageGenerationSettings | null; loading: boolean }) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-4">
        <div className="text-xs font-medium text-app-muted">当前状态</div>
        <div className="mt-3 text-sm text-app-secondary">正在读取图片生成配置...</div>
      </section>
    )
  }
  if (!data) {
    return (
      <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-4">
        <div className="text-xs font-medium text-app-muted">当前状态</div>
        <div className="mt-3 text-sm text-app-secondary">暂无配置数据。</div>
      </section>
    )
  }
  const ok = data.llm_policy_group_status === "ok"
  const unset = data.llm_policy_group_status === "unset"
  const toneClass = ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : unset
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-red-200 bg-red-50 text-red-700"
  const statusLabel = ok ? "可用" : unset ? "未配置" : data.llm_policy_group_status
  return (
    <section className={["rounded-2xl border p-4", toneClass].join(" ")}>
      <div className="text-xs font-medium text-app-muted">当前状态</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{statusLabel}</span>
        {data.llm_policy_group_id ? <span className="rounded-full bg-white/70 px-2 py-0.5 font-mono text-xs text-app-primary">{data.llm_policy_group_id}</span> : null}
      </div>
      {data.llm_policy_group_status_message ? <div className="mt-2 text-sm leading-6 text-app-secondary">{data.llm_policy_group_status_message}</div> : null}
      <div className="mt-3 grid gap-2 text-xs text-app-muted sm:grid-cols-2">
        <div>请求参数：工具调用生成 + 运行时固定值</div>
        <div>更新时间：{data.updated_at ? new Date(data.updated_at).toLocaleString() : "从未保存"}</div>
      </div>
    </section>
  )
}

function WebToolsErrorPanel({
  settingsError,
  providersError,
  onRetry,
}: {
  settingsError: unknown
  providersError: unknown
  onRetry: () => void
}) {
  const errors = [
    settingsError ? { label: "网络工具设置接口", endpoint: "/api/web-tools/settings", error: settingsError } : null,
    providersError ? { label: "主 LLM 服务商接口", endpoint: "/api/llm-registry/providers", error: providersError } : null,
  ].filter(Boolean) as Array<{ label: string; endpoint: string; error: unknown }>
  if (!errors.length) return null
  return (
    <section className="rounded-2xl border border-red-400/30 bg-red-500/10 p-4 text-red-100">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="font-semibold">加载网络工具配置失败</div>
          <div className="mt-1 text-sm text-red-100/80">请检查后端接口和主 LLM Registry 配置。</div>
        </div>
        <button type="button" onClick={onRetry} className="rounded-lg border border-red-300/30 px-3 py-1.5 text-xs font-medium text-red-50 hover:bg-red-400/10">
          重试
        </button>
      </div>
      <div className="mt-3 space-y-2">
        {errors.map((item) => (
          <div key={item.endpoint} className="rounded-lg bg-app-surface-muted/90 px-3 py-2">
            <div className="text-xs font-medium text-red-100">{item.label}</div>
            <div className="mt-1 font-mono text-xs text-red-100/80">{item.endpoint}</div>
            <div className="mt-1 text-sm text-red-50">{errorToText(item.error)}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function WebToolsStatusCard({ data, loading, webBindingCount }: { data: WebToolsSettings | null; loading: boolean; webBindingCount: number }) {
  if (loading) {
    return (
      <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-4">
        <div className="text-xs font-medium text-app-muted">当前状态</div>
        <div className="mt-3 text-sm text-app-secondary">正在读取网络工具配置...</div>
      </section>
    )
  }
  if (!data) {
    return (
      <section className="rounded-2xl border border-app-border/80 bg-app-surface/80 p-4">
        <div className="text-xs font-medium text-app-muted">当前状态</div>
        <div className="mt-3 text-sm text-app-secondary">暂无配置数据。</div>
      </section>
    )
  }
  const ok = data.status === "ok"
  const unset = data.status === "unset"
  const toneClass = ok
    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
    : unset
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : "border-red-200 bg-red-50 text-red-700"
  const statusLabel = ok ? "可用" : unset ? "未配置" : data.status
  return (
    <section className={["rounded-2xl border p-4", toneClass].join(" ")}>
      <div className="text-xs font-medium text-app-muted">当前状态</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="text-lg font-semibold">{statusLabel}</span>
        <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-app-primary">{data.candidates.filter((item) => item.enabled).length} 个启用候选</span>
      </div>
      {data.status_message ? <div className="mt-2 text-sm leading-6 text-app-secondary">{data.status_message}</div> : null}
      <div className="mt-3 grid gap-2 text-xs text-app-muted sm:grid-cols-3">
        <div>可选联网接入：{webBindingCount}</div>
        <div>失败切换：完整工具调用失败后切换</div>
        <div>更新时间：{data.updated_at ? new Date(data.updated_at).toLocaleString() : "从未保存"}</div>
      </div>
    </section>
  )
}

function collectImageBindings(providers: LlmProviderDefinition[]): ImageBindingInfo[] {
  return providers.flatMap((provider) =>
    provider.models
      .filter(isImageGenerationBinding)
      .map((binding) => ({ provider, binding })),
  )
}

function isImageGenerationBinding(binding: LlmProviderDefinition["models"][number]): boolean {
  return binding.api_format === IMAGE_API_FORMAT || binding.api_format === GPT_IMAGE_AGENT_API_FORMAT || binding.api_format === "codex_responses"
}

function collectWebBindings(providers: LlmProviderDefinition[], supportedApiFormats: string[]): WebBindingInfo[] {
  const supported = new Set(supportedApiFormats)
  return providers.flatMap((provider) =>
    provider.models
      .filter((binding) => supported.has(binding.api_format))
      .map((binding) => ({ provider, binding })),
  )
}

function ImageBindingList({ bindings }: { bindings: ImageBindingInfo[] }) {
  if (!bindings.length) {
    return <div className="mt-4 rounded-xl border border-dashed border-app-border/80 bg-app-surface-muted/90 p-4 text-sm text-app-muted">暂无图片生成模型接入项。请在“服务商”子 tab 中新增接入项（支持 Images 或 Responses 协议），或在主 LLM Registry 中配置相应的 Responses 接入。</div>
  }
  return (
    <div className="mt-4 space-y-2">
      {bindings.slice(0, 8).map(({ provider, binding }) => (
        <div key={`${provider.provider_id}:${binding.id}`} className="rounded-lg border border-app-border/80 bg-app-surface-muted/90 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-app-primary">
            <span>{provider.provider_id}</span>
            <span className="text-slate-600">/</span>
            <span>{binding.id}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-app-muted">
            <span>{binding.api_format}</span>
            <span>model_id {binding.model_id}</span>
            <span>alias {binding.model_alias}</span>
            <span>{provider.api_base_url}</span>
          </div>
        </div>
      ))}
      {bindings.length > 8 ? <div className="text-xs text-app-muted">还有 {bindings.length - 8} 个图片接入项未显示。</div> : null}
    </div>
  )
}

function WebBindingList({ bindings }: { bindings: WebBindingInfo[] }) {
  if (!bindings.length) {
    return <div className="mt-4 rounded-xl border border-dashed border-app-border/80 bg-app-surface-muted/90 p-4 text-sm text-app-muted">暂无支持网络工具的模型接入项。请在 LLM 菜单中添加 OpenAI Responses、Claude Messages、Gemini Generate Content 或 Zhipu Chat Completions 接入项。</div>
  }
  return (
    <div className="mt-4 space-y-2">
      {bindings.slice(0, 10).map(({ provider, binding }) => (
        <div key={`${provider.provider_id}:${binding.id}`} className="rounded-lg border border-app-border/80 bg-app-surface-muted/90 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-app-primary">
            <span>{provider.provider_id}</span>
            <span className="text-slate-600">/</span>
            <span>{binding.id}</span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-app-muted">
            <span>{binding.api_format}</span>
            <span>model_id {binding.model_id}</span>
            <span>alias {binding.model_alias}</span>
          </div>
        </div>
      ))}
      {bindings.length > 10 ? <div className="text-xs text-app-muted">还有 {bindings.length - 10} 个网络工具接入项未显示。</div> : null}
    </div>
  )
}

function WebCandidateEditorCard({
  candidate,
  index,
  rows,
  webBindings,
  onChange,
}: {
  candidate: WebCandidateRow
  index: number
  rows: WebCandidateRow[]
  webBindings: WebBindingInfo[]
  onChange: (rows: WebCandidateRow[]) => void
}) {
  const selectedValue = `${candidate.provider_id}:${candidate.model_binding_id}`
  const selectedBinding = webBindings.find((item) => `${item.provider.provider_id}:${item.binding.id}` === selectedValue)
  const updateRow = (patch: Partial<WebCandidateRow>) => onChange(rows.map((row) => (row.uiId === candidate.uiId ? { ...row, ...patch } : row)))
  const move = (direction: -1 | 1) => {
    const next = [...rows]
    const targetIndex = index + direction
    if (targetIndex < 0 || targetIndex >= next.length) return
    const current = next[index]
    next[index] = next[targetIndex]
    next[targetIndex] = current
    onChange(next)
  }
  return (
    <div className="rounded-xl border border-app-border/80 bg-app-surface-muted/90 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-app-selected px-2 py-0.5 font-mono text-xs text-app-secondary">#{index + 1}</span>
        <input
          value={candidate.id}
          onChange={(event) => updateRow({ id: event.target.value })}
          className="h-8 min-w-[12rem] flex-1 rounded-lg border border-app-border/80 bg-app-surface-muted px-3 font-mono text-xs text-app-primary outline-none focus:border-blue-400/60"
        />
        <label className="inline-flex items-center gap-2 text-xs text-app-secondary">
          <input type="checkbox" checked={candidate.enabled} onChange={(event) => updateRow({ enabled: event.target.checked })} />
          启用
        </label>
      </div>
      <select
        value={selectedValue}
        onChange={(event) => {
          const [providerId, bindingId] = event.target.value.split(":")
          updateRow({
            provider_id: providerId,
            model_binding_id: bindingId,
            id: createUniqueWebCandidateId(providerId, bindingId, rows.filter((row) => row.uiId !== candidate.uiId)),
          })
        }}
        className="h-9 w-full rounded-lg border border-app-border/80 bg-app-surface-muted px-3 font-mono text-sm text-app-primary outline-none transition focus:border-blue-400/60"
      >
        {webBindings.map(({ provider, binding }) => (
          <option key={`${provider.provider_id}:${binding.id}`} value={`${provider.provider_id}:${binding.id}`}>
            {provider.provider_id} / {binding.id} · {binding.api_format}
          </option>
        ))}
      </select>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-app-muted">
        <div className="font-mono">
          {selectedBinding ? `${selectedBinding.binding.model_alias} · ${selectedBinding.binding.api_format}` : "当前候选未匹配到可用模型接入项"}
        </div>
        <div className="flex gap-1">
          <button type="button" onClick={() => move(-1)} disabled={index === 0} className="rounded-md px-2 py-1 text-app-secondary hover:bg-app-selected disabled:cursor-not-allowed disabled:text-slate-700">上移</button>
          <button type="button" onClick={() => move(1)} disabled={index >= rows.length - 1} className="rounded-md px-2 py-1 text-app-secondary hover:bg-app-selected disabled:cursor-not-allowed disabled:text-slate-700">下移</button>
          <button type="button" onClick={() => onChange(rows.filter((row) => row.uiId !== candidate.uiId))} className="rounded-md px-2 py-1 text-red-300 hover:bg-red-500/10">删除</button>
        </div>
      </div>
    </div>
  )
}

function webCandidateToRow(candidate: WebToolPolicyCandidate): WebCandidateRow {
  return { ...candidate, uiId: crypto.randomUUID() }
}

function normalizeWebCandidates(rows: WebCandidateRow[], webBindings: WebBindingInfo[]): WebToolPolicyCandidate[] {
  const available = new Set(webBindings.map(({ provider, binding }) => `${provider.provider_id}:${binding.id}`))
  return rows.map((row) => {
    const id = row.id.trim()
    const providerId = row.provider_id.trim()
    const bindingId = row.model_binding_id.trim()
    if (!id) throw new Error("候选 ID 不能为空")
    if (!providerId || !bindingId) throw new Error("候选服务商和模型接入项不能为空")
    if (!available.has(`${providerId}:${bindingId}`)) throw new Error(`候选 ${id} 指向的服务商模型不存在或不支持网络工具`)
    return {
      id,
      provider_id: providerId,
      model_binding_id: bindingId,
      enabled: row.enabled,
    }
  })
}

function createUniqueWebCandidateId(providerId: string, bindingId: string, rows: WebCandidateRow[]): string {
  const base = normalizeId(`web_${providerId}_${bindingId}`)
  const existing = new Set(rows.map((row) => row.id))
  if (!existing.has(base)) return base
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base}_${index}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}_${Date.now()}`
}

function normalizeId(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
  return normalized || "candidate"
}

function errorToText(error: unknown): string {
  if (!error) return ""
  if (error instanceof Error && error.message) return error.message
  return String(error)
}

function ToolCard({ tool, onSelect }: { tool: ToolSummary; onSelect: () => void }) {
  const meta = CATEGORY_META[tool.category] ?? { label: tool.category, tone: "blue" as const }
  return (
    <ResourceCard
      title={tool.tool_name}
      identifier={tool.group}
      description={tool.description}
      onClick={onSelect}
      actions={<Badge tone={meta.tone}>{meta.label}</Badge>}
      badges={
        <>
          {tool.always_enabled && <Badge tone="green">always enabled</Badge>}
          <span>{tool.allowed_loop_decisions.join(" / ")}</span>
        </>
      }
    />
  )
}

function ToolDetailStage({ name }: { name: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["tool-detail", name], queryFn: () => getToolDetail(name) })
  return (
    <DetailLayout title={name} titleMeta={data ? <ToolDetailBadges data={data} /> : undefined}>
      <StatusText isLoading={isLoading} error={error} empty={false} />
      {data && <ToolDetailContent data={data} />}
    </DetailLayout>
  )
}

function ToolDetailBadges({ data }: { data: ToolDetail }) {
  const meta = CATEGORY_META[data.category] ?? { label: data.category, tone: "blue" as const }
  return (
    <>
      <Badge tone={meta.tone}>{meta.label}</Badge>
      <span className="text-xs text-app-muted">{data.group}</span>
      {data.public && <Badge tone="green">public</Badge>}
      {data.always_enabled && <Badge tone="green">always enabled</Badge>}
    </>
  )
}

function ToolDetailContent({ data }: { data: ToolDetail }) {
  return (
    <div className="space-y-5 pb-8">
      <InfoSection title="描述">
        <div className="text-sm leading-relaxed text-app-secondary">{data.description}</div>
      </InfoSection>
      {data.wiki && (
        <InfoSection title="Wiki">
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-app-secondary">{data.wiki}</div>
        </InfoSection>
      )}
      <InfoSection title="Allowed Loop Decisions">
        <div className="flex flex-wrap gap-1.5">
          {data.allowed_loop_decisions.map((decision) => (
            <span key={decision} className="rounded bg-app-selected px-2 py-0.5 font-mono text-xs text-app-secondary">{decision}</span>
          ))}
        </div>
      </InfoSection>
      {data.schemas && Object.keys(data.schemas).length > 0 && (
        <InfoSection title="参数 Schema">
          <ToolSchemaTabs schemas={data.schemas} />
        </InfoSection>
      )}
    </div>
  )
}

function ToolSchemaTabs({ schemas }: { schemas: NonNullable<ToolDetail["schemas"]> }) {
  const platforms = useMemo(() => {
    const preferred = ["openai", "anthropic", "gemini"]
    return Object.keys(schemas).sort((a, b) => {
      const ai = preferred.indexOf(a)
      const bi = preferred.indexOf(b)
      if (ai !== -1 || bi !== -1) return (ai === -1 ? preferred.length : ai) - (bi === -1 ? preferred.length : bi)
      return a.localeCompare(b)
    })
  }, [schemas])
  const [activePlatform, setActivePlatform] = useState(platforms[0] ?? "")
  const selectedPlatform = platforms.includes(activePlatform) ? activePlatform : platforms[0]

  if (!selectedPlatform) return null

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        {platforms.map((platform) => {
          const active = platform === selectedPlatform
          return (
            <button
              key={platform}
              type="button"
              onClick={() => setActivePlatform(platform)}
              className={[
                "rounded-md border px-2.5 py-1 font-mono text-xs transition",
                active ? "border-blue-200 bg-blue-50 text-blue-700" : "border-app-border/80 bg-app-surface/80 text-app-muted hover:bg-app-surface-hover hover:text-app-secondary",
              ].join(" ")}
            >
              {platform}
            </button>
          )
        })}
      </div>
      <pre className="overflow-auto rounded border border-app-border/80 bg-app-surface-muted p-3 font-mono text-xs leading-relaxed text-app-secondary">{JSON.stringify(schemas[selectedPlatform], null, 2)}</pre>
    </div>
  )
}

function InfoSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-1 text-xs font-medium text-app-muted">{title}</div>
      {children}
    </section>
  )
}
