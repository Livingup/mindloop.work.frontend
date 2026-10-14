import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FileText, Image, Plus, Trash2, Type } from "lucide-react"

import {
  deleteLlmModel,
  deleteLlmExecutionPolicy,
  deleteLlmProvider,
  getLlmRegistryMetadata,
  listLlmExecutionPolicies,
  listLlmModels,
  listLlmProviders,
  saveLlmExecutionPolicy,
  saveLlmModel,
  saveLlmProvider,
  type LlmExecutionPolicy,
  type LlmExecutionPolicyBody,
  type LlmExecutionPolicyCandidate,
  type LlmApiKey,
  type LlmRegistryMetadata,
  type LlmModelMetadata,
  type LlmModelMetadataBody,
  type LlmProviderDefinition,
  type LlmProviderDefinitionBody,
  type LlmProviderModelBinding,
  type LlmRetryPolicy,
} from "@/features/settings/settingsApi"
import { CodexAccountPanel } from "@/features/llm/CodexAccountPanel"
import { DarkSelect } from "@/shared/components/DarkSelect"
import {
  AdaptiveResourceLayout,
  DetailLayout,
  FilterChips,
  GroupedCompactResourceList,
  ResourceCard,
  ResourceGrid,
  ResourceManagementLayout,
  StatusText,
  countBy,
  filterOptionsFromCounts,
  matchesQuery,
} from "@/shared/components/ResourceManagement"
import { useAppConfirm, useAppNotification } from "@/shared/interaction/AppInteractionProvider"

export type ActiveResource = "providers" | "models" | "policies"
type Editing =
  | { resource: "provider"; mode: "create" | "edit"; original?: LlmProviderDefinition }
  | { resource: "model"; mode: "create" | "edit"; original?: LlmModelMetadata }
  | { resource: "policy"; mode: "create" | "edit"; original?: LlmExecutionPolicy }

export type LlmRegistryApi = {
  queryKeyPrefix: readonly unknown[]
  getMetadata: () => Promise<LlmRegistryMetadata>
  listModels: () => Promise<LlmModelMetadata[]>
  listProviders: () => Promise<LlmProviderDefinition[]>
  listExecutionPolicies: () => Promise<LlmExecutionPolicy[]>
  saveModel: (modelId: string, body: LlmModelMetadataBody) => Promise<LlmModelMetadata>
  deleteModel: (modelId: string) => Promise<null>
  saveProvider: (providerId: string, body: LlmProviderDefinitionBody) => Promise<LlmProviderDefinition>
  deleteProvider: (providerId: string) => Promise<null>
  saveExecutionPolicy: (policyGroupId: string, body: LlmExecutionPolicyBody) => Promise<LlmExecutionPolicy>
  deleteExecutionPolicy: (policyGroupId: string) => Promise<null>
}

type LlmRegistryQueryKeys = {
  metadata: readonly unknown[]
  models: readonly unknown[]
  providers: readonly unknown[]
  policies: readonly unknown[]
}

const DEFAULT_RETRY: LlmRetryPolicy = {
  max_retries_per_key: 3,
  initial_delay_seconds: 1,
  max_delay_seconds: 30,
  retryable_status_codes: [429, 500, 502, 503, 504],
}

const INPUT_MODALITY_LABELS: Record<string, string> = { text: "文本", image: "图片", pdf: "pdf" }
const INPUT_MODALITY_ORDER = ["text", "image", "pdf"]
const DEFAULT_UNSUPPORTED_INPUT_MODALITY_STRATEGY = "degrade"
const UNSUPPORTED_INPUT_MODALITY_STRATEGY_SKIP_CANDIDATE = "skip_candidate"
const CODEX_PROVIDER_ID = "openai_codex"
const CODEX_DISPLAY_API_BASE_URL = "https://chatgpt.com/backend-api/codex"
const CODEX_API_FORMAT = "codex_responses"
const UNSUPPORTED_INPUT_MODALITY_STRATEGY_LABELS: Record<string, string> = {
  degrade: "降级调用（继续调用当前候选）",
  [UNSUPPORTED_INPUT_MODALITY_STRATEGY_SKIP_CANDIDATE]: "跳过候选（切换到下一个支持模态的候选）",
}
type BindingJsonTemplateField = "tool_choice" | "thinking"
type BindingJsonTemplate = { id: string; field: BindingJsonTemplateField; apiFormats: string[]; label: string; value: string; note?: string }

const BINDING_JSON_TEMPLATES: BindingJsonTemplate[] = [
  { id: "openai_style_tool_required", field: "tool_choice", apiFormats: ["openai_chat_completions", "openai_responses", "codex_responses"], label: "OpenAI 风格 · 必须调用工具", value: jsonTemplate({ tool_choice: "required" }), note: "适用于 OpenAI Chat Completions / Responses、DeepSeek V4 等支持 required 的接口；Kimi K2.5/K2.6 开启思考时不要用。" },
  { id: "openai_style_tool_auto", field: "tool_choice", apiFormats: ["openai_chat_completions", "openai_responses", "codex_responses"], label: "OpenAI 风格 · 自动工具选择", value: jsonTemplate({ tool_choice: "auto" }), note: "适用于 OpenAI 兼容接口、Kimi K2.5/K2.6 思考模式、GLM 5.1；有工具时让模型自行决定是否调用。" },
  { id: "anthropic_messages_tool_auto", field: "tool_choice", apiFormats: ["anthropic_messages"], label: "Anthropic Messages · 自动工具选择", value: jsonTemplate({ tool_choice: { type: "auto" } }), note: "Claude extended thinking 只兼容 auto 或 none，不兼容 any / 指定 tool 的强制工具调用。" },
  { id: "gemini_generate_content_tool_any", field: "tool_choice", apiFormats: ["gemini_generate_content"], label: "Gemini generateContent · 必须调用工具", value: jsonTemplate({ toolConfig: { functionCallingConfig: { mode: "ANY" } } }), note: "Gemini 的工具选择放在 toolConfig.functionCallingConfig.mode，ANY 表示必须调用函数。" },
  { id: "openai_chat_completions_thinking_max", field: "thinking", apiFormats: ["openai_chat_completions"], label: "OpenAI Chat Completions · 开启最大推理", value: jsonTemplate({ reasoning_effort: "xhigh" }), note: "reasoning_effort 可取值依模型而定，官方列举包括 none / minimal / low / medium / high / xhigh；xhigh 是最高档。" },
  { id: "deepseek_v4_thinking_max", field: "thinking", apiFormats: ["openai_chat_completions"], label: "DeepSeek V4 · 开启最大推理", value: jsonTemplate({ thinking: { type: "enabled" }, reasoning_effort: "max" }), note: "thinking.type 取值 enabled / disabled；reasoning_effort 取值 high / max，兼容 low/medium→high、xhigh→max；max 是最高档。" },
  { id: "kimi_k25_k26_thinking_max", field: "thinking", apiFormats: ["openai_chat_completions"], label: "Kimi K2.5/K2.6 · 开启最大推理", value: jsonTemplate({ thinking: { type: "enabled" } }), note: "thinking.type 取值 enabled / disabled；官方未提供独立 max/effort/budget 档位，最大推理由模型默认思考策略和 max_tokens 共同决定；开启思考时 tool_choice 只能 auto 或 none。" },
  { id: "glm_51_thinking_max", field: "thinking", apiFormats: ["openai_chat_completions"], label: "GLM 5.1 · 开启最大推理", value: jsonTemplate({ thinking: { type: "enabled", clear_thinking: false } }), note: "thinking.type 取值 enabled / disabled；clear_thinking 取值 true / false；官方未提供独立 max/effort 档位，clear_thinking:false 用于保留 reasoning_content 支持多轮工具推理。" },
  { id: "openai_responses_thinking_max", field: "thinking", apiFormats: ["openai_responses", "codex_responses"], label: "OpenAI Responses · 开启最大推理", value: jsonTemplate({ reasoning: { effort: "xhigh" } }), note: "reasoning.effort 可取值依模型而定，官方列举包括 none / minimal / low / medium / high / xhigh；xhigh 是最高档。默认不请求推理摘要；如需调试可手动添加 summary，常见取值为 auto / concise / detailed。" },
  { id: "anthropic_messages_thinking_max", field: "thinking", apiFormats: ["anthropic_messages"], label: "Anthropic Messages · 开启最大推理", value: jsonTemplate({ thinking: { type: "adaptive" }, output_config: { effort: "max" } }), note: "新 Claude 使用 adaptive thinking + output_config.effort，effort 取值 low / medium / high / xhigh / max，max 是最高档；旧 Claude 使用 thinking.type: enabled + 数字 budget_tokens，现已是旧/兼容写法。" },
  { id: "gemini_25_thinking_max", field: "thinking", apiFormats: ["gemini_generate_content"], label: "Gemini 2.5 generateContent · 开启最大推理", value: jsonTemplate({ generationConfig: { thinkingConfig: { thinkingBudget: 32768 } } }), note: "Gemini 2.5 不支持 thinkingLevel。thinkingBudget 是同一模板结构：2.5 Pro 范围 128-32768，Flash 范围 0-24576，Flash Lite 范围 512-24576；Flash / Lite 最大推理请把 32768 改为 24576；-1 是动态思考，不是最大预算。" },
  { id: "gemini_3_thinking_high", field: "thinking", apiFormats: ["gemini_generate_content"], label: "Gemini 3 generateContent · 开启最大推理", value: jsonTemplate({ generationConfig: { thinkingConfig: { thinkingLevel: "high" } } }), note: "Gemini 3 推荐 thinkingLevel，取值 minimal / low / medium / high；high 是最高思考层级。不要与 thinkingBudget 同时设置。" },
]

const DEFAULT_LLM_REGISTRY_API: LlmRegistryApi = {
  queryKeyPrefix: ["llm"],
  getMetadata: getLlmRegistryMetadata,
  listModels: listLlmModels,
  listProviders: listLlmProviders,
  listExecutionPolicies: listLlmExecutionPolicies,
  saveModel: saveLlmModel,
  deleteModel: deleteLlmModel,
  saveProvider: saveLlmProvider,
  deleteProvider: deleteLlmProvider,
  saveExecutionPolicy: saveLlmExecutionPolicy,
  deleteExecutionPolicy: deleteLlmExecutionPolicy,
}

export function LlmPage({ resource }: { resource: ActiveResource }) {
  return <LlmRegistryManager key={resource} resource={resource} registryApi={DEFAULT_LLM_REGISTRY_API} />
}

export function LlmRegistryManager({ resource, registryApi }: { resource: ActiveResource; registryApi: LlmRegistryApi }) {
  const qc = useQueryClient()
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const providerDeleteClaimRef = useRef<string | null>(null)
  const modelDeleteClaimRef = useRef<string | null>(null)
  const policyDeleteClaimRef = useRef<string | null>(null)
  const interactionOwnerMountedRef = useRef(true)
  useEffect(() => {
    interactionOwnerMountedRef.current = true
    return () => {
      interactionOwnerMountedRef.current = false
    }
  }, [])
  const queryKeys = useMemo<LlmRegistryQueryKeys>(() => ({
    metadata: [...registryApi.queryKeyPrefix, "metadata"],
    models: [...registryApi.queryKeyPrefix, "models"],
    providers: [...registryApi.queryKeyPrefix, "providers"],
    policies: [...registryApi.queryKeyPrefix, "execution-policies"],
  }), [registryApi.queryKeyPrefix])
  const metadataQuery = useQuery({ queryKey: queryKeys.metadata, queryFn: registryApi.getMetadata })
  const modelsQuery = useQuery({ queryKey: queryKeys.models, queryFn: registryApi.listModels })
  const providersQuery = useQuery({ queryKey: queryKeys.providers, queryFn: registryApi.listProviders })
  const policiesQuery = useQuery({ queryKey: queryKeys.policies, queryFn: registryApi.listExecutionPolicies })
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<Editing | null>(null)
  const models = modelsQuery.data ?? []
  const providers = providersQuery.data ?? []
  const policies = policiesQuery.data ?? []
  const apiFormats = metadataQuery.data?.api_formats ?? []
  const inputModalities = metadataQuery.data?.input_modalities ?? []
  const unsupportedInputModalityStrategies = metadataQuery.data?.unsupported_input_modality_strategies ?? []
  const modelById = useMemo(() => new Map(models.map((model) => [model.model_id, model])), [models])

  const providerFilters = useMemo(() => filterOptionsFromCounts(countBy(providers, (provider) => provider.group || "default"), providers.length), [providers])
  const modelFilters = useMemo(() => filterOptionsFromCounts(countBy(models, (model) => model.group || "default"), models.length), [models])
  const policyFilters = useMemo(() => filterOptionsFromCounts(countBy(policies, (policy) => policy.group || "default"), policies.length), [policies])
  const [activeProviderGroup, setActiveProviderGroup] = useState<string | null>(null)
  const [activeModelGroup, setActiveModelGroup] = useState<string | null>(null)
  const [activePolicyGroup, setActivePolicyGroup] = useState<string | null>(null)

  useEffect(() => {
    setEditing(null)
  }, [resource])

  const filteredProviders = useMemo(
    () =>
      providers.filter((provider) => {
        const group = provider.group || "default"
        if (activeProviderGroup && group !== activeProviderGroup) return false
        return matchesQuery([
          provider.provider_id,
          provider.group,
          provider.api_base_url,
          Object.keys(provider.custom_headers).join(" "),
          provider.api_keys.map((key) => key.name).join(" "),
          provider.models.map((model) => `${model.id} ${model.model_id} ${model.model_alias} ${model.api_format}`).join(" "),
        ], search)
      }),
    [activeProviderGroup, providers, search],
  )
  const filteredModels = useMemo(
    () =>
      models.filter((model) => {
        const group = model.group || "default"
        if (activeModelGroup && group !== activeModelGroup) return false
        return matchesQuery([model.model_id, model.group, model.supports_structured_output ? "structured" : "", model.supported_input_modalities.join(" ")], search)
      }),
    [activeModelGroup, models, search],
  )
  const filteredPolicies = useMemo(
    () =>
      policies.filter((policy) => {
        const group = policy.group || "default"
        if (activePolicyGroup && group !== activePolicyGroup) return false
        return matchesQuery([
          policy.policy_group_id,
          policy.name,
          policy.description,
          policy.group,
          policy.unsupported_input_modality_strategy,
          policy.candidates.map((candidate) => `${candidate.id} ${candidate.provider_id} ${candidate.model_binding_id}`).join(" "),
        ], search)
      }),
    [activePolicyGroup, policies, search],
  )

  const deleteModelMut = useMutation({
    mutationFn: registryApi.deleteModel,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.models })
      qc.invalidateQueries({ queryKey: queryKeys.providers })
    },
    onSettled: (_data, _error, modelId) => {
      if (modelDeleteClaimRef.current === modelId) modelDeleteClaimRef.current = null
    },
  })
  const deleteProviderMut = useMutation({
    mutationFn: registryApi.deleteProvider,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.providers }),
    onSettled: (_data, _error, providerId) => {
      if (providerDeleteClaimRef.current === providerId) providerDeleteClaimRef.current = null
    },
  })
  const deletePolicyMut = useMutation({
    mutationFn: registryApi.deleteExecutionPolicy,
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.policies }),
    onSettled: (_data, _error, policyGroupId) => {
      if (policyDeleteClaimRef.current === policyGroupId) policyDeleteClaimRef.current = null
    },
  })
  const registryInteractionStateRef = useRef({
    resource,
    editing,
    models,
    providers,
    policies,
    deleteModelPending: deleteModelMut.isPending,
    deleteProviderPending: deleteProviderMut.isPending,
    deletePolicyPending: deletePolicyMut.isPending,
  })
  registryInteractionStateRef.current = {
    resource,
    editing,
    models,
    providers,
    policies,
    deleteModelPending: deleteModelMut.isPending,
    deleteProviderPending: deleteProviderMut.isPending,
    deletePolicyPending: deletePolicyMut.isPending,
  }

  const requestDeleteProvider = async (provider: LlmProviderDefinition) => {
    const target = {
      resource: "llm-provider" as const,
      id: provider.provider_id,
      displayName: provider.provider_id,
      deletable: !isBuiltinProvider(provider),
    }
    if (!target.deletable || deleteProviderMut.isPending || providerDeleteClaimRef.current !== null) return
    providerDeleteClaimRef.current = target.id
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除 LLM 服务商",
        description: `确认删除服务商「${target.displayName}」？`,
        confirmLabel: "删除服务商",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = registryInteractionStateRef.current
      const latestProvider = latest.providers.find((item) => item.provider_id === target.id)
      if (
        !interactionOwnerMountedRef.current
        || latest.resource !== "providers"
        || latest.editing !== null
        || latest.deleteProviderPending
        || !latestProvider
        || isBuiltinProvider(latestProvider)
      ) {
        notify({
          title: "未删除 LLM 服务商",
          message: "确认期间资源列表、当前详情或删除任务状态已变化，请重新操作。",
          tone: "warning",
        })
        return
      }
      deleteProviderMut.mutate(target.id)
      mutationStarted = true
    } finally {
      if (!mutationStarted && providerDeleteClaimRef.current === target.id) providerDeleteClaimRef.current = null
    }
  }

  const requestDeleteModel = async (model: LlmModelMetadata) => {
    const target = {
      resource: "llm-model" as const,
      id: model.model_id,
      displayName: model.model_id,
      deletable: !isBuiltinModel(model),
    }
    if (!target.deletable || deleteModelMut.isPending || modelDeleteClaimRef.current !== null) return
    modelDeleteClaimRef.current = target.id
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除 LLM 模型",
        description: `确认删除模型「${target.displayName}」？`,
        confirmLabel: "删除模型",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = registryInteractionStateRef.current
      const latestModel = latest.models.find((item) => item.model_id === target.id)
      if (
        !interactionOwnerMountedRef.current
        || latest.resource !== "models"
        || latest.editing !== null
        || latest.deleteModelPending
        || !latestModel
        || isBuiltinModel(latestModel)
      ) {
        notify({
          title: "未删除 LLM 模型",
          message: "确认期间资源列表、当前详情或删除任务状态已变化，请重新操作。",
          tone: "warning",
        })
        return
      }
      deleteModelMut.mutate(target.id)
      mutationStarted = true
    } finally {
      if (!mutationStarted && modelDeleteClaimRef.current === target.id) modelDeleteClaimRef.current = null
    }
  }

  const requestDeletePolicy = async (policy: LlmExecutionPolicy) => {
    const target = {
      resource: "llm-policy" as const,
      id: policy.policy_group_id,
      displayName: policy.name?.trim() || policy.policy_group_id,
      deletable: true,
    }
    if (deletePolicyMut.isPending || policyDeleteClaimRef.current !== null) return
    policyDeleteClaimRef.current = target.id
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除 LLM 策略组",
        description: `确认删除策略组「${target.displayName}」？`,
        confirmLabel: "删除策略组",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = registryInteractionStateRef.current
      const latestPolicy = latest.policies.find((item) => item.policy_group_id === target.id)
      if (
        !interactionOwnerMountedRef.current
        || latest.resource !== "policies"
        || latest.editing !== null
        || latest.deletePolicyPending
        || !latestPolicy
      ) {
        notify({
          title: "未删除 LLM 策略组",
          message: "确认期间资源列表、当前详情或删除任务状态已变化，请重新操作。",
          tone: "warning",
        })
        return
      }
      deletePolicyMut.mutate(target.id)
      mutationStarted = true
    } finally {
      if (!mutationStarted && policyDeleteClaimRef.current === target.id) policyDeleteClaimRef.current = null
    }
  }

  if (editing) {
    const selectedKey = getEditingKey(editing)
    return (
      <AdaptiveResourceLayout
        list={
          editing.resource === "policy" ? (
            <GroupedCompactResourceList
              items={filteredPolicies}
              selectedKey={selectedKey}
              onSelect={(policy) => setEditing({ resource: "policy", mode: "edit", original: policy })}
              getKey={(policy) => policy.policy_group_id}
              getTitle={(policy) => policy.name ?? policy.policy_group_id}
              getGroup={(policy) => policy.group || "default"}
              onBack={() => setEditing(null)}
            />
          ) : editing.resource === "provider" ? (
            <GroupedCompactResourceList
              items={filteredProviders}
              selectedKey={selectedKey}
              onSelect={(provider) => setEditing({ resource: "provider", mode: "edit", original: provider })}
              getKey={(provider) => provider.provider_id}
              getTitle={(provider) => provider.provider_id}
              getGroup={(provider) => provider.group || "default"}
              onBack={() => setEditing(null)}
            />
          ) : (
            <GroupedCompactResourceList
              items={filteredModels}
              selectedKey={selectedKey}
              onSelect={(model) => { if (!isBuiltinModel(model)) setEditing({ resource: "model", mode: "edit", original: model }) }}
              getKey={(model) => model.model_id}
              getTitle={(model) => model.model_id}
              getGroup={(model) => model.group || "default"}
              onBack={() => setEditing(null)}
            />
          )
        }
        detail={
          editing.resource === "policy" ? (
            <PolicyEditor key={selectedKey} editing={editing} providers={providers} unsupportedInputModalityStrategies={unsupportedInputModalityStrategies} registryApi={registryApi} queryKeys={queryKeys} onClose={() => setEditing(null)} />
          ) : editing.resource === "provider" ? (
            <ProviderEditor key={selectedKey} editing={editing} models={models} modelById={modelById} apiFormats={apiFormats} registryApi={registryApi} queryKeys={queryKeys} onClose={() => setEditing(null)} />
          ) : (
            <ModelEditor key={selectedKey} editing={editing} inputModalities={inputModalities} registryApi={registryApi} queryKeys={queryKeys} onClose={() => setEditing(null)} />
          )
        }
      />
    )
  }

  return (
    <ResourceManagementLayout
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={resource === "providers" ? "搜索服务商 / URL / 模型..." : resource === "models" ? "搜索模型 ID / 能力..." : "搜索策略组 / 候选模型..."}
      primaryFilters={resource === "models" ? modelFilters : resource === "policies" ? policyFilters : providerFilters}
      activePrimary={resource === "models" ? activeModelGroup : resource === "policies" ? activePolicyGroup : activeProviderGroup}
      onPrimaryChange={resource === "models" ? setActiveModelGroup : resource === "policies" ? setActivePolicyGroup : setActiveProviderGroup}
      action={
        <button
          type="button"
          onClick={() => setEditing(resource === "providers" ? { resource: "provider", mode: "create" } : resource === "models" ? { resource: "model", mode: "create" } : { resource: "policy", mode: "create" })}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500"
        >
          <Plus size={13} />
          新建
        </button>
      }
    >
      {resource === "providers" ? (
        <>
          <StatusText isLoading={providersQuery.isLoading} error={providersQuery.error || deleteProviderMut.error} empty={!providersQuery.isLoading && !providersQuery.error && filteredProviders.length === 0} />
          <ResourceGrid>
            {filteredProviders.map((provider) => (
              <ResourceCard
                key={provider.provider_id}
                title={<ProviderCardTitle provider={provider} />}
                description={<ProviderCardSummary provider={provider} />}
                onClick={() => setEditing({ resource: "provider", mode: "edit", original: provider })}
                actions={isBuiltinProvider(provider) ? null : (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void requestDeleteProvider(provider)
                    }}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                    删除
                  </button>
                )}
                badges={<ProviderCardMeta provider={provider} />}
              />
            ))}
          </ResourceGrid>
        </>
      ) : resource === "models" ? (
        <>
          <StatusText isLoading={modelsQuery.isLoading || metadataQuery.isLoading} error={modelsQuery.error || metadataQuery.error || deleteModelMut.error} empty={!modelsQuery.isLoading && !modelsQuery.error && filteredModels.length === 0} />
          {filteredModels.length > 0 && (
            <ModelTable
              models={filteredModels}
              onEdit={(model) => { if (!isBuiltinModel(model)) setEditing({ resource: "model", mode: "edit", original: model }) }}
              onDelete={(model) => {
                void requestDeleteModel(model)
              }}
            />
          )}
        </>
      ) : (
        <>
          <StatusText isLoading={policiesQuery.isLoading} error={policiesQuery.error || deletePolicyMut.error} empty={!policiesQuery.isLoading && !policiesQuery.error && filteredPolicies.length === 0} />
          <ResourceGrid>
            {filteredPolicies.map((policy) => (
              <ResourceCard
                key={policy.policy_group_id}
                title={policy.name ?? policy.policy_group_id}
                description={<PolicyCardSummary policy={policy} unsupportedInputModalityStrategies={unsupportedInputModalityStrategies} />}
                onClick={() => setEditing({ resource: "policy", mode: "edit", original: policy })}
                actions={
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void requestDeletePolicy(policy)
                    }}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 size={12} />
                    删除
                  </button>
                }
                badges={<PolicyCardMeta policy={policy} />}
              />
            ))}
          </ResourceGrid>
        </>
      )}
    </ResourceManagementLayout>
  )
}

function ModelTable({ models, onEdit, onDelete }: { models: LlmModelMetadata[]; onEdit: (model: LlmModelMetadata) => void; onDelete: (model: LlmModelMetadata) => void }) {
  return (
    <div className="overflow-hidden rounded-lg border border-app-border/80 bg-app-surface/70">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-app-border/80 bg-app-surface/80 text-app-muted">
            <tr>
              <th rowSpan={2} className="px-4 py-3 font-medium">id</th>
              <th rowSpan={2} className="px-4 py-3 font-medium">分组</th>
              <th rowSpan={2} className="px-4 py-3 font-medium">来源</th>
              <th colSpan={3} className="border-l border-app-border/80 px-4 py-2 text-center font-medium">上下文</th>
              <th colSpan={3} className="border-l border-app-border/80 px-4 py-2 text-center font-medium">多模态</th>
              <th rowSpan={2} className="border-l border-app-border/80 px-4 py-3 font-medium">工具调用</th>
              <th rowSpan={2} className="px-4 py-3 font-medium">结构化输出</th>
              <th rowSpan={2} className="px-4 py-3 text-right font-medium">操作</th>
            </tr>
            <tr className="border-t border-app-border/80">
              <th className="border-l border-app-border/80 px-4 py-2 font-medium">最大上下文</th>
              <th className="px-4 py-2 font-medium">最大输出</th>
              <th className="px-4 py-2 font-medium">压缩阈值</th>
              <th className="border-l border-app-border/80 px-4 py-2 font-medium">text</th>
              <th className="px-4 py-2 font-medium">image</th>
              <th className="px-4 py-2 font-medium">pdf</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {models.map((model) => {
              const builtin = isBuiltinModel(model)
              return (
                <tr key={model.model_id} onClick={() => { if (!builtin) onEdit(model) }} className={["text-app-secondary transition", builtin ? "" : "cursor-pointer hover:bg-app-surface/85"].join(" ")}>
                  <td className="max-w-[260px] truncate px-4 py-3 font-mono text-sm text-app-primary">{model.model_id}</td>
                  <td className="px-4 py-3">
                    <span className="rounded border border-app-border/80 bg-app-surface/85 px-1.5 py-0.5 font-mono text-[11px] text-app-secondary">{model.group || "default"}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={["rounded border px-1.5 py-0.5 font-mono text-[11px]", builtin ? "border-app-accent-muted/35 bg-app-selected/60 text-app-accent" : "border-app-border/80 bg-app-surface/85 text-app-secondary"].join(" ")}>{builtin ? "builtin" : "custom"}</span>
                  </td>
                  <td className="border-l border-app-border/80 px-4 py-3 font-mono text-[11px]">{fmt(model.context_window)}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{fmt(model.max_output_tokens)}</td>
                  <td className="px-4 py-3 font-mono text-[11px]">{fmtOptional(model.compression_threshold)}</td>
                  <td className="border-l border-app-border/80 px-4 py-3">
                    <BooleanStatus active={model.supported_input_modalities.includes("text")} />
                  </td>
                  <td className="px-4 py-3">
                    <BooleanStatus active={model.supported_input_modalities.includes("image")} />
                  </td>
                  <td className="px-4 py-3">
                    <BooleanStatus active={model.supported_input_modalities.includes("pdf")} />
                  </td>
                  <td className="border-l border-app-border/80 px-4 py-3">
                    <BooleanStatus active={model.supports_tool_calling} />
                  </td>
                  <td className="px-4 py-3">
                    <BooleanStatus active={model.supports_structured_output} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {builtin ? (
                      <span className="text-xs text-app-muted">只读</span>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onDelete(model)
                        }}
                        className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                      >
                        <Trash2 size={12} />
                        删除
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ModelEditor({
  editing,
  inputModalities,
  registryApi,
  queryKeys,
  onClose,
}: {
  editing: Extract<Editing, { resource: "model" }>
  inputModalities: string[]
  registryApi: LlmRegistryApi
  queryKeys: LlmRegistryQueryKeys
  onClose: () => void
}) {
  const qc = useQueryClient()
  const original = editing.original
  const isCreate = editing.mode === "create"
  const [modelId, setModelId] = useState(original?.model_id ?? "")
  const [group, setGroup] = useState(original?.group ?? "default")
  const [contextWindow, setContextWindow] = useState(original?.context_window ?? 128000)
  const [maxOutputTokens, setMaxOutputTokens] = useState(original?.max_output_tokens ?? 8192)
  const [compressionThreshold, setCompressionThreshold] = useState<number | "">(original?.compression_threshold ?? "")
  const [supportsToolCalling, setSupportsToolCalling] = useState(original?.supports_tool_calling ?? true)
  const [supportsStructuredOutput, setSupportsStructuredOutput] = useState(original?.supports_structured_output ?? false)
  const [modalities, setModalities] = useState<string[]>(original?.supported_input_modalities?.length ? original.supported_input_modalities : inputModalities[0] ? [inputModalities[0]] : [])
  const [localError, setLocalError] = useState("")
  const modelTitle = isCreate ? "新增模型定义" : modelId || original?.model_id
  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LlmModelMetadataBody }) => registryApi.saveModel(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.models })
      qc.invalidateQueries({ queryKey: queryKeys.providers })
      onClose()
    },
  })

  function handleSave() {
    setLocalError("")
    if (!modelId.trim()) { setLocalError("模型 ID 不能为空"); return }
    if (!group.trim()) { setLocalError("模型分组不能为空"); return }
    if (contextWindow <= 0 || maxOutputTokens <= 0) { setLocalError("Token 容量必须大于 0"); return }
    if (!modalities.length) { setLocalError("至少选择一个输入模态"); return }
    saveMut.mutate({
      id: modelId.trim(),
      body: {
        group: group.trim(),
        context_window: contextWindow,
        max_output_tokens: maxOutputTokens,
        compression_threshold: compressionThreshold === "" ? null : compressionThreshold,
        supports_tool_calling: supportsToolCalling,
        supports_structured_output: supportsStructuredOutput,
        supported_input_modalities: modalities,
      },
    })
  }

  return (
    <DetailLayout
      title={modelTitle}
      actions={<EditorActions saving={saveMut.isPending} error={localError || mutationError(saveMut.error)} onCancel={onClose} onSave={handleSave} />}
    >
      <div className="space-y-5">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <TextField label="模型 ID" value={modelId} onChange={setModelId} disabled={!isCreate} mono />
          <TextField label="分组" value={group} onChange={setGroup} />
          <NumberField label="上下文窗口" value={contextWindow} onChange={(value) => setContextWindow(value || 0)} />
          <NumberField label="最大输出" value={maxOutputTokens} onChange={(value) => setMaxOutputTokens(value || 0)} />
          <NumberField label="上下文压缩阈值（需要留35k用于压缩输出，建议阈值不要超过300k）" value={compressionThreshold} onChange={setCompressionThreshold} optional />
        </div>
        <FieldBlock label="能力">
          <div className="flex flex-wrap gap-3 text-xs text-app-secondary">
            <CheckField label="支持工具调用" checked={supportsToolCalling} onChange={setSupportsToolCalling} />
            <CheckField label="支持结构化输出" checked={supportsStructuredOutput} onChange={setSupportsStructuredOutput} />
          </div>
        </FieldBlock>
        <FieldBlock label="输入模态">
          <div className="flex flex-wrap gap-2">
            {inputModalities.map((item) => (
              <ToggleChip key={item} active={modalities.includes(item)} onClick={() => setModalities((current) => toggleValue(current, item))}>
                {item}
              </ToggleChip>
            ))}
          </div>
        </FieldBlock>
      </div>
    </DetailLayout>
  )
}

function PolicyEditor({
  editing,
  providers,
  unsupportedInputModalityStrategies,
  registryApi,
  queryKeys,
  onClose,
}: {
  editing: Extract<Editing, { resource: "policy" }>
  providers: LlmProviderDefinition[]
  unsupportedInputModalityStrategies: string[]
  registryApi: LlmRegistryApi
  queryKeys: LlmRegistryQueryKeys
  onClose: () => void
}) {
  const qc = useQueryClient()
  const original = editing.original
  const isCreate = editing.mode === "create"
  const [policyGroupId, setPolicyGroupId] = useState(original?.policy_group_id ?? "")
  const [name, setName] = useState(original?.name ?? "")
  const [description, setDescription] = useState(original?.description ?? "")
  const [group, setGroup] = useState(original?.group ?? "default")
  const [enabled, setEnabled] = useState(original?.enabled ?? true)
  const defaultUnsupportedInputModalityStrategy = DEFAULT_UNSUPPORTED_INPUT_MODALITY_STRATEGY
  const [unsupportedInputModalityStrategy, setUnsupportedInputModalityStrategy] = useState(() =>
    normalizeUnsupportedInputModalityStrategy(original?.unsupported_input_modality_strategy, unsupportedInputModalityStrategies, defaultUnsupportedInputModalityStrategy),
  )
  const [candidates, setCandidates] = useState<PolicyCandidateRow[]>(() => policyCandidatesToRows(original?.candidates ?? []))
  const [draggingCandidateUiId, setDraggingCandidateUiId] = useState<string | null>(null)
  const [localError, setLocalError] = useState("")
  const providerOptions = providers.map((provider) => ({ value: provider.provider_id, label: provider.provider_id }))
  const unsupportedInputModalityStrategyOptions = getUnsupportedInputModalityStrategyOptions(
    unsupportedInputModalityStrategies,
    defaultUnsupportedInputModalityStrategy,
  )
  useEffect(() => {
    setUnsupportedInputModalityStrategy((current) =>
      normalizeUnsupportedInputModalityStrategy(current, unsupportedInputModalityStrategies, defaultUnsupportedInputModalityStrategy),
    )
  }, [defaultUnsupportedInputModalityStrategy, unsupportedInputModalityStrategies])
  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LlmExecutionPolicyBody }) => registryApi.saveExecutionPolicy(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.policies })
      onClose()
    },
  })

  function addCandidate() {
    const provider = providers.find((item) => item.models.length > 0) ?? providers[0]
    const binding = provider?.models[0]
    const nextRow: PolicyCandidateRow = {
      uiId: crypto.randomUUID(),
      id: createUniqueCandidateId(provider?.provider_id ?? "provider", binding?.id ?? "model", candidates),
      provider_id: provider?.provider_id ?? "",
      model_binding_id: binding?.id ?? "",
      enabled: true,
    }
    setCandidates([...candidates, nextRow])
  }

  function patchCandidate(uiId: string, patch: Partial<PolicyCandidateRow>) {
    setCandidates(candidates.map((candidate) => (candidate.uiId === uiId ? { ...candidate, ...patch } : candidate)))
  }

  function moveCandidate(sourceUiId: string, targetUiId: string) {
    if (sourceUiId === targetUiId) return
    const sourceIndex = candidates.findIndex((candidate) => candidate.uiId === sourceUiId)
    const targetIndex = candidates.findIndex((candidate) => candidate.uiId === targetUiId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...candidates]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    setCandidates(next)
  }

  function handleSave() {
    setLocalError("")
    try {
      if (!policyGroupId.trim()) throw new Error("策略组 ID 不能为空")
      if (!group.trim()) throw new Error("分组不能为空")
      const body: LlmExecutionPolicyBody = {
        name: name.trim() || null,
        description: description.trim() || null,
        group: group.trim(),
        enabled,
        unsupported_input_modality_strategy: normalizeUnsupportedInputModalityStrategy(
          unsupportedInputModalityStrategy,
          unsupportedInputModalityStrategies,
          defaultUnsupportedInputModalityStrategy,
        ),
        candidates: normalizePolicyCandidates(candidates, providers),
      }
      saveMut.mutate({ id: policyGroupId.trim(), body })
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <DetailLayout
      title={isCreate ? "新增执行策略组" : original?.policy_group_id}
      actions={<EditorActions saving={saveMut.isPending} error={localError || mutationError(saveMut.error)} onCancel={onClose} onSave={handleSave} />}
    >
      <div className="space-y-5">
        <ProviderEditorBlock title="策略组基础配置">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TextField label="策略组 ID" value={policyGroupId} onChange={setPolicyGroupId} disabled={!isCreate} mono required />
            <TextField label="分组" value={group} onChange={setGroup} mono required />
            <TextField label="名称" value={name} onChange={setName} />
            <SelectField label="输入模态不兼容处理" value={unsupportedInputModalityStrategy} onChange={setUnsupportedInputModalityStrategy} options={unsupportedInputModalityStrategyOptions} required />
          </div>
          <CheckField label="启用" checked={enabled} onChange={setEnabled} />
          <MultilineField label="描述" value={description} onChange={setDescription} />
        </ProviderEditorBlock>
        <ProviderEditorBlock title="候选服务商-模型">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs text-app-muted">按列表顺序进行外层候选切换；服务商模型内部 Key 重试/轮换由 Provider retry 独立处理。</div>
            <button type="button" onClick={addCandidate} className="rounded px-2 py-1 text-xs text-app-accent transition hover:bg-app-selected/70 hover:text-app-accent-hover">
              新增候选
            </button>
          </div>
          <div className="space-y-3">
            {candidates.map((candidate, index) => {
              const provider = providers.find((item) => item.provider_id === candidate.provider_id)
              const bindingOptions = (provider?.models ?? []).map((binding) => ({ value: binding.id, label: binding.id }))
              return (
                <div
                  key={candidate.uiId}
                  draggable
                  onDragStart={(event: DragEvent<HTMLDivElement>) => {
                    event.dataTransfer.effectAllowed = "move"
                    event.dataTransfer.setData("text/plain", candidate.uiId)
                    setDraggingCandidateUiId(candidate.uiId)
                  }}
                  onDragOver={(event: DragEvent<HTMLDivElement>) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = "move"
                  }}
                  onDrop={(event: DragEvent<HTMLDivElement>) => {
                    event.preventDefault()
                    const sourceUiId = event.dataTransfer.getData("text/plain") || draggingCandidateUiId
                    if (sourceUiId) moveCandidate(sourceUiId, candidate.uiId)
                    setDraggingCandidateUiId(null)
                  }}
                  onDragEnd={() => setDraggingCandidateUiId(null)}
                  className={`rounded-lg border border-app-border/80 bg-app-surface-muted/80 p-3 ${draggingCandidateUiId === candidate.uiId ? "opacity-50" : ""}`}
                >
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-[2.5rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
                    <div className="flex items-end">
                      <div className="flex h-10 w-10 cursor-grab select-none items-center justify-center rounded border border-app-border/80 bg-app-surface/80 font-mono text-xs text-app-secondary" title="拖动调整顺序">
                        {index + 1}
                      </div>
                    </div>
                    <TextField label="候选 ID" value={candidate.id} onChange={(value) => patchCandidate(candidate.uiId, { id: value })} mono required />
                    <SelectField
                      label="服务商"
                      value={candidate.provider_id}
                      onChange={(providerId) => {
                        const nextProvider = providers.find((item) => item.provider_id === providerId)
                        const nextBindingId = nextProvider?.models[0]?.id ?? ""
                        patchCandidate(candidate.uiId, { provider_id: providerId, model_binding_id: nextBindingId })
                      }}
                      options={providerOptions}
                      required
                    />
                    <SelectField label="模型接入" value={candidate.model_binding_id} onChange={(modelBindingId) => patchCandidate(candidate.uiId, { model_binding_id: modelBindingId })} options={bindingOptions} required />
                    <div className="flex items-end gap-3">
                      <CheckField label="启用" checked={candidate.enabled} onChange={(value) => patchCandidate(candidate.uiId, { enabled: value })} />
                      <button type="button" onClick={() => setCandidates(candidates.filter((item) => item.uiId !== candidate.uiId))} className="rounded px-2 py-2 text-xs text-red-400 hover:bg-red-500/10">
                        删除
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
            {candidates.length === 0 && <div className="rounded-lg border border-dashed border-app-border/80 p-4 text-xs text-app-muted">暂无候选项</div>}
          </div>
        </ProviderEditorBlock>
      </div>
    </DetailLayout>
  )
}

function ProviderEditor({
  editing,
  models,
  modelById,
  apiFormats,
  registryApi,
  queryKeys,
  onClose,
}: {
  editing: Extract<Editing, { resource: "provider" }>
  models: LlmModelMetadata[]
  modelById: Map<string, LlmModelMetadata>
  apiFormats: string[]
  registryApi: LlmRegistryApi
  queryKeys: LlmRegistryQueryKeys
  onClose: () => void
}) {
  const qc = useQueryClient()
  const original = editing.original
  const isCreate = editing.mode === "create"
  const [providerId, setProviderId] = useState(original?.provider_id ?? "")
  const [group, setGroup] = useState(original?.group ?? "default")
  const [apiBaseUrl, setApiBaseUrl] = useState(original?.api_base_url ?? "")
  const [headers, setHeaders] = useState<KeyValueRow[]>(() => objectToRows(original?.custom_headers ?? {}))
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>(() => (original?.api_keys?.length ? original.api_keys.map((item) => ({ ...item, uiId: crypto.randomUUID() })) : []))
  const [retry, setRetry] = useState<LlmRetryPolicy>(original?.retry ?? DEFAULT_RETRY)
  const [retryStatusCodesText, setRetryStatusCodesText] = useState(() => (original?.retry ?? DEFAULT_RETRY).retryable_status_codes.join(","))
  const [bindings, setBindings] = useState<BindingRow[]>(() => (original?.models?.length ? original.models.map(bindingToRow) : []))
  const [localError, setLocalError] = useState("")
  const providerTitle = isCreate ? "新增服务商" : original?.provider_id
  const isCodexProvider = providerId.trim() === CODEX_PROVIDER_ID || original?.provider_id === CODEX_PROVIDER_ID
  const providerIdError = providerId.trim() ? "" : "服务商 ID 必填"
  const groupError = group.trim() ? "" : "分组必填"
  const apiBaseUrlError = isCodexProvider || apiBaseUrl.trim() ? "" : "默认 API Base URL 必填"
  const defaultApiKeysError = isCodexProvider || normalizeApiKeys(apiKeys).length > 0 ? "" : "默认 API Keys 必填"
  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LlmProviderDefinitionBody }) => registryApi.saveProvider(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers })
      onClose()
    },
  })

  function handleSave() {
    setLocalError("")
    try {
      if (!providerId.trim()) throw new Error("服务商 ID 不能为空")
      if (!group.trim()) throw new Error("分组不能为空")
      if (!isCodexProvider && !apiBaseUrl.trim()) throw new Error("API Base URL 不能为空")
      const normalizedApiKeys = normalizeApiKeys(apiKeys)
      if (!isCodexProvider && normalizedApiKeys.length === 0) throw new Error("默认 API Keys 不能为空")
      const normalizedRetry: LlmRetryPolicy = isCodexProvider
        ? { max_retries_per_key: 0, initial_delay_seconds: 0, max_delay_seconds: 0, retryable_status_codes: [] }
        : { ...retry, retryable_status_codes: parseRetryableStatusCodes(retryStatusCodesText) }
      const body: LlmProviderDefinitionBody = {
        group: group.trim(),
        api_base_url: isCodexProvider ? CODEX_DISPLAY_API_BASE_URL : apiBaseUrl.trim(),
        custom_headers: rowsToObject(headers),
        api_keys: isCodexProvider ? [] : normalizedApiKeys,
        retry: normalizedRetry,
        models: normalizeBindings(bindings, isCodexProvider),
      }
      saveMut.mutate({ id: providerId.trim(), body })
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <DetailLayout
      title={providerTitle}
      actions={<EditorActions saving={saveMut.isPending} error={localError || mutationError(saveMut.error)} onCancel={onClose} onSave={handleSave} />}
    >
      <div className="space-y-5">
        <ProviderEditorBlock title="服务商级别配置">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TextField label="服务商 ID" value={providerId} onChange={setProviderId} disabled={!isCreate} mono required error={providerIdError} />
            <TextField label="分组" value={group} onChange={setGroup} mono required error={groupError} />
            <div className="lg:col-span-2">
              {isCodexProvider ? (
                <div className="rounded border border-app-accent-muted/25 bg-app-selected/40 px-3 py-2 text-xs leading-5 text-app-secondary">
                  <div className="font-medium text-app-accent">Codex 托管连接</div>
                  <div>固定地址仅用于兼容展示，不是可编辑的请求目标；账号服务统一管理请求连接、账号凭证、账号代理与账号选择。</div>
                </div>
              ) : (
                <TextField label="默认 API Base URL" value={apiBaseUrl} onChange={setApiBaseUrl} mono required error={apiBaseUrlError} />
              )}
            </div>
          </div>
          {isCodexProvider && <CodexAccountPanel />}
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <KeyValueEditor title="自定义请求头" rows={headers} onChange={setHeaders} compact />
            {!isCodexProvider && <ApiKeyEditor title="默认 API Keys" rows={apiKeys} onChange={setApiKeys} compact required error={defaultApiKeysError} />}
          </div>
          {isCodexProvider ? (
            <div className="rounded border border-app-border/80 bg-app-surface/60 px-3 py-2 text-xs text-app-muted">账号服务统一管理 Codex 的请求连接、账号凭证、账号代理与账号选择；服务商级自定义请求头会随请求发送。</div>
          ) : (
            <RetryEditor value={retry} statusCodesText={retryStatusCodesText} onStatusCodesTextChange={setRetryStatusCodesText} onChange={setRetry} compact required />
          )}
        </ProviderEditorBlock>
        <BindingEditor managedCodex={isCodexProvider} rows={bindings} models={models} modelById={modelById} apiFormats={apiFormats} onChange={setBindings} />
      </div>
    </DetailLayout>
  )
}

type KeyValueRow = { uiId: string; key: string; value: string }
type ApiKeyRow = LlmApiKey & { uiId: string }
type BindingRow = Omit<LlmProviderModelBinding, "custom_headers" | "api_keys" | "api_base_url" | "tool_choice" | "thinking" | "custom_request_params"> & {
  uiId: string
  api_base_url: string | null
  tool_choice: string | null
  thinking: string | null
  custom_request_params: string | null
  custom_headers: KeyValueRow[]
  api_keys: ApiKeyRow[]
}
type PolicyCandidateRow = LlmExecutionPolicyCandidate & { uiId: string }

function ProviderEditorBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-app-border/80 bg-app-surface/70 p-4">
      <div className="mb-4 text-sm font-medium text-app-primary">{title}</div>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function BindingEditor({ managedCodex, rows, models, modelById, apiFormats, onChange }: { managedCodex: boolean; rows: BindingRow[]; models: LlmModelMetadata[]; modelById: Map<string, LlmModelMetadata>; apiFormats: string[]; onChange: (rows: BindingRow[]) => void }) {
  const [selectedUiId, setSelectedUiId] = useState(rows[0]?.uiId ?? "")
  const selectedRow = rows.find((row) => row.uiId === selectedUiId) ?? rows[0]
  const selectableApiFormats = managedCodex ? [CODEX_API_FORMAT] : apiFormats.filter((item) => item !== CODEX_API_FORMAT)

  function addBinding() {
    const model = models[0]
    const modelId = model?.model_id ?? ""
    const nextRow: BindingRow = {
      uiId: crypto.randomUUID(),
      id: createUniqueBindingId(modelId || "model", rows),
      model_id: modelId,
      model_alias: modelId,
      api_format: selectableApiFormats[0] ?? "",
      tool_choice: null,
      thinking: null,
      custom_request_params: null,
      api_base_url: null,
      custom_headers: [],
      api_keys: [],
    }
    setSelectedUiId(nextRow.uiId)
    onChange([...rows, nextRow])
  }

  function deleteBinding(uiId: string, index: number) {
    const nextRows = rows.filter((item) => item.uiId !== uiId)
    onChange(nextRows)
    if (selectedRow?.uiId === uiId) setSelectedUiId(nextRows[Math.min(index, nextRows.length - 1)]?.uiId ?? "")
  }

  function patchSelected(patch: Partial<BindingRow>) {
    if (!selectedRow) return
    patchBinding(rows, selectedRow.uiId, patch, onChange)
  }
  const selectedIdError = selectedRow && !selectedRow.id.trim() ? "自定义 ID 必填" : ""
  const selectedModelError = selectedRow && !selectedRow.model_id.trim() ? "模型型号必填" : ""
  const selectedAliasError = selectedRow && !selectedRow.model_alias.trim() ? "API 请求时模型名必填" : ""
  const selectedApiFormatError = selectedRow && !managedCodex && selectedRow.api_format === CODEX_API_FORMAT
    ? `${CODEX_API_FORMAT} 仅可用于 ${CODEX_PROVIDER_ID}`
    : selectedRow && !(managedCodex || selectedRow.api_format.trim()) ? "API 协议必填" : ""
  const selectedToolChoiceError = selectedRow && !selectedRow.tool_choice?.trim() ? "Tool Choice JSON 必填" : ""
  const selectedThinkingError = selectedRow && !selectedRow.thinking?.trim() ? "Thinking JSON 必填" : ""
  const bindingOptions = rows.map((row) => ({ value: row.uiId, label: row.id || "未命名接入" }))

  return (
    <section className="rounded-lg border border-app-border/80 bg-app-surface/70 p-4">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="shrink-0 text-sm font-medium text-app-primary">模型接入列表</div>
        {bindingOptions.length > 0 && (
          <div className="min-w-[12rem] flex-1">
            <FilterChips options={bindingOptions} activeValue={selectedRow?.uiId ?? null} onChange={(value) => value && setSelectedUiId(value)} compact />
          </div>
        )}
        <button type="button" onClick={addBinding} className="shrink-0 rounded-full px-3 py-1 text-xs text-app-accent transition hover:bg-app-selected/70 hover:text-app-accent-hover">
          新增接入
        </button>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-app-border/80 p-4 text-xs text-app-muted">暂无模型接入项</div>
      ) : (
        <div>
          {selectedRow && (
            <div className="rounded-lg border border-app-border/80 bg-app-surface-muted/80 p-4">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm text-app-primary">{selectedRow.id || "未命名接入"}</div>
                  <BindingMeta binding={selectedRow} model={modelById.get(selectedRow.model_id)} />
                </div>
                <button type="button" onClick={() => deleteBinding(selectedRow.uiId, rows.findIndex((item) => item.uiId === selectedRow.uiId))} className="shrink-0 text-xs text-red-400 hover:text-red-300">
                  删除
                </button>
              </div>
              <div className="space-y-5">
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  <TextField label="自定义 ID" value={selectedRow.id} onChange={(value) => patchSelected({ id: value })} mono required error={selectedIdError} />
                  <SelectField label="模型型号" value={selectedRow.model_id} onChange={(value) => patchBindingModel(rows, selectedRow.uiId, value, onChange)} options={models.map((model) => ({ value: model.model_id, label: model.model_id }))} required error={selectedModelError} />
                  <TextField label="API 请求时模型名" value={selectedRow.model_alias} onChange={(value) => patchSelected({ model_alias: value })} mono required error={selectedAliasError} />
                  {managedCodex ? (
                    <TextField label="API 协议" value={CODEX_API_FORMAT} onChange={() => undefined} disabled mono required />
                  ) : (
                    <SelectField label="API 协议" value={selectedRow.api_format} onChange={(value) => patchSelected({ api_format: value })} options={selectableApiFormats.map((item) => ({ value: item, label: item }))} required error={selectedApiFormatError} />
                  )}
                </div>
                {!managedCodex && <TextField label="专属 Base URL（不填则使用服务商的 base url）" value={selectedRow.api_base_url ?? ""} onChange={(value) => patchSelected({ api_base_url: value || null })} mono />}
                <div className="grid grid-cols-1 gap-3">
                  <JsonTemplateField field="tool_choice" apiFormat={managedCodex ? CODEX_API_FORMAT : selectedRow.api_format} label="Tool Choice JSON" value={selectedRow.tool_choice ?? ""} onChange={(value) => patchSelected({ tool_choice: value || null })} required error={selectedToolChoiceError} />
                  <JsonTemplateField field="thinking" apiFormat={managedCodex ? CODEX_API_FORMAT : selectedRow.api_format} label="Thinking JSON" value={selectedRow.thinking ?? ""} onChange={(value) => patchSelected({ thinking: value || null })} required error={selectedThinkingError} />
                  <MultilineField label="自定义请求参数（用于自定义Tool Choice/Thinking设置外的参数值）" value={selectedRow.custom_request_params ?? ""} onChange={(value) => patchSelected({ custom_request_params: value || null })} />
                </div>
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                  <KeyValueEditor title="自定义请求头（同名会覆盖服务商请求头）" rows={selectedRow.custom_headers} onChange={(value) => patchSelected({ custom_headers: value })} compact />
                  {!managedCodex && <ApiKeyEditor title="模型专用 API Keys（不设置则使用服务商 API Keys）" rows={selectedRow.api_keys} onChange={(value) => patchSelected({ api_keys: value })} compact />}
                </div>
                {managedCodex && <div className="rounded border border-app-border/80 bg-app-surface/60 px-3 py-2 text-xs text-app-muted">Codex 接入项固定使用 Responses 协议；账号服务统一管理请求连接、账号凭证、账号代理与账号选择，模型接入项的自定义请求头会随请求发送。</div>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function KeyValueEditor({ title, rows, onChange, compact }: { title: string; rows: KeyValueRow[]; onChange: (rows: KeyValueRow[]) => void; compact?: boolean }) {
  return (
    <section className={compact ? "" : "rounded-lg border border-app-border/80 bg-app-surface/70 p-4"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="text-sm font-medium text-app-primary">{title}</div>
        <button type="button" onClick={() => onChange([...rows, { uiId: crypto.randomUUID(), key: "", value: "" }])} className="rounded px-2 py-1 text-xs text-app-accent transition hover:bg-app-selected/70 hover:text-app-accent-hover">
          新增
        </button>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.uiId} className="grid grid-cols-1 gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]">
            <input value={row.key} onChange={(event) => onChange(rows.map((item) => (item.uiId === row.uiId ? { ...item, key: event.target.value } : item)))} placeholder="Key" className={inputClass(true)} />
            <input value={row.value} onChange={(event) => onChange(rows.map((item) => (item.uiId === row.uiId ? { ...item, value: event.target.value } : item)))} placeholder="Value" className={inputClass(true)} />
            <button type="button" onClick={() => onChange(rows.filter((item) => item.uiId !== row.uiId))} className="rounded px-2 text-xs text-red-400 hover:bg-red-500/10">
              删除
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function ApiKeyEditor({ title = "API Keys", rows, onChange, compact, required, error }: { title?: string; rows: ApiKeyRow[]; onChange: (rows: ApiKeyRow[]) => void; compact?: boolean; required?: boolean; error?: string }) {
  const hasError = Boolean(error)
  const [draggingApiKeyUiId, setDraggingApiKeyUiId] = useState<string | null>(null)

  function moveApiKey(sourceUiId: string, targetUiId: string) {
    if (sourceUiId === targetUiId) return
    const sourceIndex = rows.findIndex((row) => row.uiId === sourceUiId)
    const targetIndex = rows.findIndex((row) => row.uiId === targetUiId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const next = [...rows]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onChange(next)
  }

  return (
    <section className={compact ? "" : "rounded-lg border border-app-border/80 bg-app-surface/70 p-4"}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-app-primary">
            {title}
            {required && <span className="ml-1 text-red-300">*</span>}
          </div>
          <div className="mt-1 text-xs text-app-muted">按列表顺序轮换；拖动序号可调整优先级。</div>
        </div>
        <button type="button" onClick={() => onChange([...rows, { uiId: crypto.randomUUID(), key: "", name: null }])} className="rounded px-2 py-1 text-xs text-app-accent transition hover:bg-app-selected/70 hover:text-app-accent-hover">
          新增
        </button>
      </div>
      {hasError && <div className="mb-2 text-xs text-red-300">{error}</div>}
      <div className="space-y-2">
        {rows.map((row, index) => (
          <div
            key={row.uiId}
            draggable
            onDragStart={(event: DragEvent<HTMLDivElement>) => {
              event.dataTransfer.effectAllowed = "move"
              event.dataTransfer.setData("text/plain", row.uiId)
              setDraggingApiKeyUiId(row.uiId)
            }}
            onDragOver={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
            }}
            onDrop={(event: DragEvent<HTMLDivElement>) => {
              event.preventDefault()
              const sourceUiId = event.dataTransfer.getData("text/plain") || draggingApiKeyUiId
              if (sourceUiId) moveApiKey(sourceUiId, row.uiId)
              setDraggingApiKeyUiId(null)
            }}
            onDragEnd={() => setDraggingApiKeyUiId(null)}
            className={`grid grid-cols-1 gap-2 rounded border border-transparent p-1 md:grid-cols-[2.5rem_minmax(0,0.8fr)_minmax(0,1.6fr)_auto] ${draggingApiKeyUiId === row.uiId ? "opacity-50" : ""}`}
          >
            <div className="flex items-center">
              <div className="flex h-9 w-10 cursor-grab select-none items-center justify-center rounded border border-app-border/80 bg-app-surface/80 font-mono text-xs text-app-secondary" title="拖动调整 Key 轮换顺序">
                {index + 1}
              </div>
            </div>
            <input value={row.name ?? ""} onChange={(event) => onChange(rows.map((item) => (item.uiId === row.uiId ? { ...item, name: event.target.value || null } : item)))} placeholder="Name" className={inputClass(false)} />
            <input value={row.key} onChange={(event) => onChange(rows.map((item) => (item.uiId === row.uiId ? { ...item, key: event.target.value } : item)))} placeholder="${ENV_NAME} 或 sk-..." className={inputClass(true)} />
            <button type="button" onClick={() => onChange(rows.filter((item) => item.uiId !== row.uiId))} className="rounded px-2 text-xs text-red-400 hover:bg-red-500/10">
              删除
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}

function RetryEditor({ value, statusCodesText, onStatusCodesTextChange, onChange, compact, required }: { value: LlmRetryPolicy; statusCodesText: string; onStatusCodesTextChange: (value: string) => void; onChange: (value: LlmRetryPolicy) => void; compact?: boolean; required?: boolean }) {
  return (
    <section className={compact ? "" : "rounded-lg border border-app-border/80 bg-app-surface/70 p-4"}>
      <div className="mb-3 text-sm font-medium text-app-primary">
        服务商模型内 Key 重试/轮换策略
        {required && <span className="ml-1 text-red-300">*</span>}
      </div>
      <div className="mb-3 text-xs leading-5 text-app-muted">
        当前服务商-模型调用时，先按单 Key 重试策略重试当前 Key；当前 Key 失败后切换下一个 Key。所有 Key 都失败后，才交给执行策略组切换下一个服务商-模型。
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
        <NumberField label="单 Key 重试次数（0 表示不重试）" value={value.max_retries_per_key} onChange={(next) => onChange({ ...value, max_retries_per_key: next || 0 })} />
        <NumberField label="初始延迟秒" value={value.initial_delay_seconds} onChange={(next) => onChange({ ...value, initial_delay_seconds: next || 0 })} />
        <NumberField label="最大延迟秒" value={value.max_delay_seconds} onChange={(next) => onChange({ ...value, max_delay_seconds: next || 0 })} />
        <TextField label="可重试状态码" value={statusCodesText} onChange={onStatusCodesTextChange} mono />
      </div>
    </section>
  )
}

function EditorActions({ saving, error, onCancel, onSave }: { saving: boolean; error: string; onCancel: () => void; onSave: () => void }) {
  return (
    <>
      {error && <span className="max-w-xs truncate text-xs text-red-400">{error}</span>}
      <button type="button" onClick={onCancel} className="rounded px-3 py-1.5 text-xs text-app-secondary hover:text-app-primary">
        取消
      </button>
      <button type="button" onClick={onSave} disabled={saving} className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
        {saving ? "保存中" : "保存"}
      </button>
    </>
  )
}

function TextField({ label, value, onChange, disabled, mono, required, error }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; mono?: boolean; required?: boolean; error?: string }) {
  const hasError = Boolean(error)
  return (
    <label className="block">
      <FieldLabel label={label} required={required} />
      <input value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled} aria-invalid={hasError || undefined} className={inputClass(mono, hasError)} />
      {hasError && <div className="mt-1 text-xs text-red-300">{error}</div>}
    </label>
  )
}

function MultilineField({ label, value, onChange, minRows = 2, required, error }: { label: string; value: string; onChange: (value: string) => void; minRows?: number; required?: boolean; error?: string }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const hasError = Boolean(error)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [value])

  return (
    <label className="block">
      <FieldLabel label={label} required={required} />
      <textarea ref={textareaRef} value={value} onChange={(event) => onChange(event.target.value)} rows={minRows} aria-invalid={hasError || undefined} className={`${inputClass(true, hasError)} resize-y overflow-hidden leading-5`} />
      {hasError && <div className="mt-1 text-xs text-red-300">{error}</div>}
    </label>
  )
}

function JsonTemplateField({ field, apiFormat, label, value, onChange, required, error }: { field: BindingJsonTemplateField; apiFormat: string; label: string; value: string; onChange: (value: string) => void; required?: boolean; error?: string }) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [open, setOpen] = useState(false)
  const hasError = Boolean(error)
  const templates = getJsonTemplates(field, apiFormat)

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.style.height = "auto"
    textarea.style.height = `${textarea.scrollHeight}px`
  }, [value])

  return (
    <div className="block">
      <div
        className="mb-1.5 flex flex-wrap items-center gap-2"
        onBlur={(event) => {
          const nextTarget = event.relatedTarget as Node | null
          if (!nextTarget || !event.currentTarget.contains(nextTarget)) setOpen(false)
        }}
      >
        <span className="text-xs text-app-muted">
          {label}
          {required && <span className="ml-1 text-red-300">*</span>}
        </span>
        <div className="relative">
          <button type="button" onClick={() => setOpen((next) => !next)} className="rounded border border-app-border/80 bg-app-surface/70 px-2 py-1 font-mono text-[11px] text-app-secondary outline-none hover:border-app-border-strong hover:text-app-primary focus:border-app-border-strong" aria-expanded={open}>
            套用模板...
          </button>
          {open && (
            <div className="absolute left-0 z-50 mt-1 max-h-72 min-w-[420px] overflow-auto rounded-lg border border-blue-500/20 bg-app-surface p-1 shadow-xl shadow-slate-900/12">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => {
                    onChange(template.value)
                    setOpen(false)
                  }}
                  className="block w-full rounded px-3 py-2.5 text-left text-xs text-app-primary transition hover:bg-app-selected hover:text-app-primary"
                >
                  <span className="block font-mono text-app-primary">{template.label}</span>
                  {template.note && <span className="mt-1 block whitespace-normal text-[11px] leading-4 text-app-secondary">{template.note}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <textarea ref={textareaRef} value={value} onChange={(event) => onChange(event.target.value)} rows={2} aria-invalid={hasError || undefined} className={`${inputClass(true, hasError)} resize-y overflow-hidden leading-5`} />
      {hasError && <div className="mt-1 text-xs text-red-300">{error}</div>}
    </div>
  )
}

function NumberField({ label, value, onChange, optional }: { label: string; value: number | ""; onChange: (value: number | "") => void; optional?: boolean }) {
  return (
    <label className="block">
      <FieldLabel label={label} />
      <input
        type="number"
        value={value}
        onChange={(event) => onChange(event.target.value === "" && optional ? "" : Number(event.target.value))}
        className={inputClass(true)}
      />
    </label>
  )
}

function SelectField({ label, value, onChange, options, required, error }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; required?: boolean; error?: string }) {
  const hasError = Boolean(error)
  return (
    <div className="block">
      <FieldLabel label={label} required={required} />
      <DarkSelect value={value} options={options} onChange={onChange} placeholder="未选择" mono invalid={hasError} className="py-2" />
      {hasError && <div className="mt-1 text-xs text-red-300">{error}</div>}
    </div>
  )
}

function FieldLabel({ label, required }: { label: string; required?: boolean }) {
  return (
    <span className="mb-1.5 block text-xs text-app-muted">
      {label}
      {required && <span className="ml-1 text-red-300">*</span>}
    </span>
  )
}

function FieldBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <FieldLabel label={label} />
      {children}
    </div>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={["rounded-full px-3 py-1 text-xs transition", active ? "bg-app-selected text-app-primary" : "bg-app-surface/85 text-app-muted hover:text-app-secondary"].join(" ")}>
      {children}
    </button>
  )
}

function inputClass(mono?: boolean, error?: boolean) {
  return ["w-full rounded border bg-app-surface/70 px-3 py-2 text-sm text-app-primary outline-none placeholder:text-app-subtle disabled:cursor-not-allowed disabled:opacity-60", error ? "border-red-400/60 focus:border-red-300" : "border-app-border/80 focus:border-app-border-strong", mono ? "font-mono" : ""].join(" ")
}

function getEditingKey(editing: Editing) {
  if (editing.mode === "create") return "__create"
  if (editing.resource === "provider") return editing.original?.provider_id ?? "__missing"
  if (editing.resource === "policy") return editing.original?.policy_group_id ?? "__missing"
  return editing.original?.model_id ?? "__missing"
}

function objectToRows(value: Record<string, string> | null | undefined) {
  return Object.entries(value ?? {}).map(([key, rowValue]) => ({ uiId: crypto.randomUUID(), key, value: rowValue }))
}

function rowsToObject(rows: KeyValueRow[]) {
  return Object.fromEntries(rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]))
}

function normalizeApiKeys(rows: ApiKeyRow[]) {
  return rows.filter((row) => row.key.trim()).map(({ key, name }) => ({ key: key.trim(), name: name?.trim() || null }))
}

function jsonTemplate(value: unknown) {
  return JSON.stringify(value, null, 2)
}

function getJsonTemplates(field: BindingJsonTemplateField, apiFormat: string) {
  const templates = BINDING_JSON_TEMPLATES.filter((template) => template.field === field)
  const prioritized = [...templates.filter((template) => template.apiFormats.includes(apiFormat)), ...templates.filter((template) => !template.apiFormats.includes(apiFormat))]
  const seenValues = new Set<string>()
  return prioritized.filter((template) => {
    if (seenValues.has(template.value)) return false
    seenValues.add(template.value)
    return true
  })
}

function parseRetryableStatusCodes(value: string) {
  const codes: number[] = []
  const seen = new Set<number>()
  for (const item of value.split(",")) {
    const trimmed = item.trim()
    if (!trimmed) continue
    if (!/^\d+$/.test(trimmed)) throw new Error(`可重试状态码必须是整数: ${trimmed}`)
    const code = Number(trimmed)
    if (code < 100 || code > 599) throw new Error(`可重试状态码必须在 100-599 之间: ${code}`)
    if (seen.has(code)) throw new Error(`可重试状态码重复: ${code}`)
    seen.add(code)
    codes.push(code)
  }
  return codes
}

function bindingToRow(binding: LlmProviderModelBinding): BindingRow {
  return {
    uiId: crypto.randomUUID(),
    id: binding.id,
    model_id: binding.model_id,
    model_alias: binding.model_alias,
    api_format: binding.api_format,
    tool_choice: binding.tool_choice ?? null,
    thinking: binding.thinking ?? null,
    custom_request_params: binding.custom_request_params ?? null,
    api_base_url: binding.api_base_url ?? null,
    custom_headers: objectToRows(binding.custom_headers),
    api_keys: (binding.api_keys ?? []).map((item) => ({ ...item, uiId: crypto.randomUUID() })),
  }
}

function normalizeBindings(rows: BindingRow[], managedCodex = false) {
  const seenIds = new Set<string>()
  return rows.map((row) => {
    const id = row.id.trim()
    if (!id) throw new Error("模型接入自定义 ID 不能为空")
    if (seenIds.has(id)) throw new Error(`模型接入 ID 重复: ${id}`)
    seenIds.add(id)
    if (!row.model_id.trim()) throw new Error(`模型接入「${id}」必须选择模型型号`)
    if (!row.model_alias.trim()) throw new Error(`模型接入「${id}」必须填写 API 请求时模型名`)
    if (!managedCodex && !row.api_format.trim()) throw new Error(`模型接入「${id}」必须选择 API 协议`)
    if (!managedCodex && row.api_format.trim() === CODEX_API_FORMAT) throw new Error(`${CODEX_API_FORMAT} 仅可用于 ${CODEX_PROVIDER_ID}`)
    if (!row.tool_choice?.trim()) throw new Error(`模型接入「${id}」Tool Choice JSON 不能为空`)
    if (!row.thinking?.trim()) throw new Error(`模型接入「${id}」Thinking JSON 不能为空`)
    return {
      id,
      model_id: row.model_id.trim(),
      model_alias: row.model_alias.trim(),
      api_format: managedCodex ? CODEX_API_FORMAT : row.api_format.trim(),
      tool_choice: normalizeJsonText(row.tool_choice, `模型接入「${id}」Tool Choice`),
      thinking: normalizeJsonText(row.thinking, `模型接入「${id}」Thinking`),
      custom_request_params: normalizeJsonText(row.custom_request_params, `模型接入「${id}」请求参数`),
      api_base_url: managedCodex ? null : row.api_base_url?.trim() || null,
      custom_headers: rowsToObject(row.custom_headers),
      api_keys: managedCodex ? [] : normalizeApiKeys(row.api_keys),
    }
  })
}

function normalizeJsonText(value: string | null, label: string) {
  const trimmed = value?.trim()
  if (!trimmed) return null
  try {
    JSON.parse(trimmed)
  } catch {
    throw new Error(`${label} 必须是合法 JSON`)
  }
  return trimmed
}

function patchBinding(rows: BindingRow[], uiId: string, patch: Partial<BindingRow>, onChange: (rows: BindingRow[]) => void) {
  onChange(rows.map((row) => (row.uiId === uiId ? { ...row, ...patch } : row)))
}

function patchBindingModel(rows: BindingRow[], uiId: string, modelId: string, onChange: (rows: BindingRow[]) => void) {
  onChange(
    rows.map((row) => {
      if (row.uiId !== uiId) return row
      const previousModelId = row.model_id
      return {
        ...row,
        id: row.id.trim() ? row.id : createUniqueBindingId(modelId || "model", rows.filter((item) => item.uiId !== uiId)),
        model_id: modelId,
        model_alias: !row.model_alias.trim() || row.model_alias === previousModelId ? modelId : row.model_alias,
      }
    }),
  )
}

function createUniqueBindingId(modelId: string, rows: BindingRow[]) {
  const base = toRegistryId(modelId)
  const used = new Set(rows.map((row) => row.id.trim()).filter(Boolean))
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function toRegistryId(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 128)
  return normalized || "model"
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function policyCandidatesToRows(candidates: LlmExecutionPolicyCandidate[]) {
  return candidates.map((candidate) => ({ ...candidate, uiId: crypto.randomUUID() }))
}

function createUniqueCandidateId(providerId: string, modelBindingId: string, rows: PolicyCandidateRow[]) {
  const base = toRegistryId(`${providerId}-${modelBindingId}`)
  const used = new Set(rows.map((row) => row.id.trim()).filter(Boolean))
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function normalizePolicyCandidates(rows: PolicyCandidateRow[], providers: LlmProviderDefinition[]) {
  if (rows.length === 0) throw new Error("策略组候选项不能为空")
  const seenIds = new Set<string>()
  return rows.map((row) => {
    const id = row.id.trim()
    if (!id) throw new Error("候选 ID 不能为空")
    if (seenIds.has(id)) throw new Error(`候选 ID 重复: ${id}`)
    seenIds.add(id)
    const providerId = row.provider_id.trim()
    const bindingId = row.model_binding_id.trim()
    if (!providerId) throw new Error(`候选「${id}」必须选择服务商`)
    if (!bindingId) throw new Error(`候选「${id}」必须选择模型接入`)
    const provider = providers.find((item) => item.provider_id === providerId)
    if (!provider) throw new Error(`候选「${id}」引用的服务商不存在: ${providerId}`)
    if (!provider.models.some((binding) => binding.id === bindingId)) throw new Error(`候选「${id}」引用的模型接入不存在: ${providerId}/${bindingId}`)
    return {
      id,
      provider_id: providerId,
      model_binding_id: bindingId,
      enabled: row.enabled,
    }
  })
}

function mutationError(error: unknown) {
  if (!error) return ""
  if (typeof error === "object" && "body" in error) {
    const body = (error as { body?: unknown }).body
    if (body && typeof body === "object" && "detail" in body) return String((body as { detail?: unknown }).detail)
  }
  if (error instanceof Error) return error.message
  return String(error)
}

function fmt(n: number) {
  return new Intl.NumberFormat("zh-CN").format(n)
}

function fmtOptional(n: number | null) {
  return n == null ? "未设" : fmt(n)
}

function formatInputModality(value: string) {
  return INPUT_MODALITY_LABELS[value] ?? value
}

function formatUnsupportedInputModalityStrategy(value: string, labels?: Record<string, string>) {
  return labels?.[value] ?? UNSUPPORTED_INPUT_MODALITY_STRATEGY_LABELS[value] ?? value
}

function supportedUnsupportedInputModalityStrategies(values: string[], defaultValue: string) {
  if (values.length) return values
  return defaultValue === UNSUPPORTED_INPUT_MODALITY_STRATEGY_SKIP_CANDIDATE
    ? [UNSUPPORTED_INPUT_MODALITY_STRATEGY_SKIP_CANDIDATE]
    : [defaultValue, UNSUPPORTED_INPUT_MODALITY_STRATEGY_SKIP_CANDIDATE]
}

function normalizeUnsupportedInputModalityStrategy(value: string | null | undefined, values: string[], defaultValue: string) {
  const options = supportedUnsupportedInputModalityStrategies(values, defaultValue)
  const nextValue = value?.trim() || defaultValue
  if (options.includes(nextValue)) return nextValue
  if (options.includes(defaultValue)) return defaultValue
  return options[0] ?? defaultValue
}

function getUnsupportedInputModalityStrategyOptions(values: string[], defaultValue: string, labels?: Record<string, string>) {
  const options = supportedUnsupportedInputModalityStrategies(values, defaultValue)
  return Array.from(new Set(options)).map((value) => ({
    value,
    label: formatUnsupportedInputModalityStrategy(value, labels),
  }))
}

function isBuiltinModel(model: LlmModelMetadata) {
  return model.source === "builtin"
}


function isBuiltinProvider(provider: LlmProviderDefinition) {
  return provider.builtin === true || provider.provider_type === "builtin"
}

function ProviderCardTitle({ provider }: { provider: LlmProviderDefinition }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <span className="truncate font-mono">{provider.provider_id}</span>
      {provider.builtin && (
        <span className="rounded border border-app-accent-muted/35 bg-app-selected/60 px-1.5 py-0.5 text-[10px] font-medium text-app-accent">
          内置
        </span>
      )}
      {provider.auth_type === "oauth" && (
        <span className="rounded border border-violet-200 bg-violet-50 px-1.5 py-0.5 text-[10px] font-medium text-violet-700">
          OAuth
        </span>
      )}
    </div>
  )
}

function ProviderCardSummary({ provider }: { provider: LlmProviderDefinition }) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <span className="min-w-0 flex-1 truncate font-mono">{provider.api_base_url}</span>
      <span className="shrink-0 font-mono">
        <ModelInlineMetric label="分组" value={provider.group || "default"} />
      </span>
      <span className="shrink-0 font-mono">
        <ModelInlineMetric label="鉴权" value={provider.auth_type || "api_key"} />
      </span>
    </div>
  )
}

function ProviderCardMeta({ provider }: { provider: LlmProviderDefinition }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {provider.managed && (
        <span className="max-w-full truncate rounded border border-app-accent-muted/35 bg-app-selected/60 px-1.5 py-0.5 text-[11px] text-app-accent">
          托管服务商
        </span>
      )}
      {provider.models.slice(0, 4).map((binding) => (
        <span key={binding.id} className="max-w-full truncate rounded border border-app-border/80 bg-app-surface/80 px-1.5 py-0.5 font-mono text-[11px] text-app-secondary">
          {binding.id}
        </span>
      ))}
    </div>
  )
}

function PolicyCardSummary({
  policy,
  unsupportedInputModalityStrategies,
}: {
  policy: LlmExecutionPolicy
  unsupportedInputModalityStrategies: string[]
}) {
  const defaultStrategy = DEFAULT_UNSUPPORTED_INPUT_MODALITY_STRATEGY
  const strategy = normalizeUnsupportedInputModalityStrategy(
    policy.unsupported_input_modality_strategy,
    unsupportedInputModalityStrategies,
    defaultStrategy,
  )
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-mono">
        <ModelInlineMetric label="id" value={policy.policy_group_id} />
      </span>
      <span className="font-mono">
        <ModelInlineMetric label="分组" value={policy.group || "default"} />
      </span>
      <span>
        <ModelInlineMetric label="模态不兼容" value={formatUnsupportedInputModalityStrategy(strategy)} />
      </span>
      <span className={policy.enabled ? "font-medium text-emerald-700" : "text-app-muted"}>{policy.enabled ? "enabled" : "disabled"}</span>
    </div>
  )
}

function PolicyCardMeta({ policy }: { policy: LlmExecutionPolicy }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {policy.candidates.slice(0, 4).map((candidate) => (
        <span key={candidate.id} className="max-w-full truncate rounded border border-app-border/80 bg-app-surface/80 px-1.5 py-0.5 font-mono text-[11px] text-app-secondary">
          {candidate.provider_id}/{candidate.model_binding_id}
        </span>
      ))}
      {policy.candidates.length > 4 && <span className="rounded border border-app-border/80 bg-app-surface/80 px-1.5 py-0.5 font-mono text-[11px] text-app-muted">+{policy.candidates.length - 4}</span>}
    </div>
  )
}

function BindingMeta({ binding, model }: { binding: BindingRow; model?: LlmModelMetadata }) {
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-app-muted">
      {model ? (
        <>
          <span>上下文 {fmt(model.context_window)}</span>
          <span>最大输出 {fmt(model.max_output_tokens)}</span>
          <span>压缩阈值 {fmtOptional(model.compression_threshold)}</span>
          <ModelModalityIcons modalities={model.supported_input_modalities} />
        </>
      ) : binding.model_id ? (
        <span className="font-medium text-amber-700">模型定义不存在</span>
      ) : null}
    </div>
  )
}

function ModelModalityIcons({ modalities }: { modalities: string[] }) {
  const supported = new Set(modalities)
  return (
    <div className="flex shrink-0 items-center gap-1">
      {INPUT_MODALITY_ORDER.map((item) => {
        const active = supported.has(item)
        const Icon = item === "image" ? Image : item === "pdf" ? FileText : Type
        return (
          <span
            key={item}
            title={`${formatInputModality(item)}：${active ? "支持" : "不支持"}`}
            className={[
              "inline-flex h-5 w-5 items-center justify-center rounded border",
              active ? "border-app-accent-muted/40 bg-app-selected/60 text-app-accent" : "border-app-border/80 bg-app-surface/70 text-slate-700",
            ].join(" ")}
          >
            <Icon size={12} />
          </span>
        )
      })}
    </div>
  )
}

function ModelInlineMetric({ label, value }: { label: string; value: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="mr-1 font-sans text-app-muted">{label}</span>
      {value}
    </span>
  )
}

function BooleanStatus({ active }: { active: boolean }) {
  return (
    <span aria-label={active ? "支持" : "不支持"} title={active ? "支持" : "不支持"} className={active ? "text-base font-semibold text-emerald-700" : "text-base font-semibold text-slate-600"}>
      {active ? "✓" : "×"}
    </span>
  )
}

