import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"

import {
  deleteImageGenerationLlmExecutionPolicy,
  deleteImageGenerationLlmModel,
  deleteImageGenerationLlmProvider,
  listImageGenerationLlmExecutionPolicies,
  listImageGenerationLlmModels,
  listImageGenerationLlmProviders,
  saveImageGenerationLlmExecutionPolicy,
  saveImageGenerationLlmModel,
  saveImageGenerationLlmProvider,
  type LlmApiKey,
  type LlmExecutionPolicy,
  type LlmExecutionPolicyBody,
  type LlmExecutionPolicyCandidate,
  type LlmModelMetadata,
  type LlmModelMetadataBody,
  type LlmProviderDefinition,
  type LlmProviderDefinitionBody,
  type LlmProviderModelBinding,
  type LlmRetryPolicy,
} from "@/features/settings/settingsApi"
import { DetailLayout, ResourceCard, ResourceGrid, ResourceManagementLayout, StatusText, countBy, filterOptionsFromCounts, matchesQuery } from "@/shared/components/ResourceManagement"
import { useAppConfirm, useAppNotification } from "@/shared/interaction/AppInteractionProvider"

export type ImageGenerationRegistryResource = "providers" | "models" | "policies"

type KeyValueRow = {
  uiId: string
  key: string
  value: string
}

type ApiKeyRow = LlmApiKey & {
  uiId: string
}

type BindingRow = {
  uiId: string
  id: string
  model_id: string
  model_alias: string
  api_format: string
  api_base_url: string | null
  custom_headers: KeyValueRow[]
  api_keys: ApiKeyRow[]
}

type CandidateRow = LlmExecutionPolicyCandidate & {
  uiId: string
}

type ProviderEditing = {
  resource: "provider"
  mode: "create" | "edit"
  original?: LlmProviderDefinition
}

type ModelEditing = {
  resource: "model"
  mode: "create" | "edit"
  original?: LlmModelMetadata
}

type PolicyEditing = {
  resource: "policy"
  mode: "create" | "edit"
  original?: LlmExecutionPolicy
}

type Editing = ProviderEditing | ModelEditing | PolicyEditing

type ImageBindingInfo = {
  provider: LlmProviderDefinition
  binding: LlmProviderModelBinding
}

const IMAGE_GENERATION_LLM_QUERY_KEY_PREFIX = ["image-generation", "llm-registry"] as const
const IMAGE_GENERATION_LLM_MODELS_QUERY_KEY = [...IMAGE_GENERATION_LLM_QUERY_KEY_PREFIX, "models"] as const
const IMAGE_GENERATION_LLM_PROVIDERS_QUERY_KEY = [...IMAGE_GENERATION_LLM_QUERY_KEY_PREFIX, "providers"] as const
const IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY = [...IMAGE_GENERATION_LLM_QUERY_KEY_PREFIX, "execution-policies"] as const
const IMAGE_API_FORMAT = "openai_images_generations"
const GPT_IMAGE_AGENT_API_FORMAT = "openai_responses"
const API_FORMAT_OPTIONS = [
  { value: "openai_images_generations", label: "openai_images_generations (OpenAI Images 传统生图)" },
  { value: "openai_responses", label: "openai_responses (OpenAI Responses 生图 Agent 模式)" },
]
const FIXED_UNSUPPORTED_INPUT_MODALITY_STRATEGY = "skip_candidate"
const DEFAULT_RETRY: LlmRetryPolicy = {
  max_retries_per_key: 2,
  initial_delay_seconds: 1,
  max_delay_seconds: 10,
  retryable_status_codes: [429, 500, 502, 503, 504],
}

export function ImageGenerationLlmRegistryPanel({ resource }: { resource: ImageGenerationRegistryResource }) {
  const queryClient = useQueryClient()
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
  const modelsQuery = useQuery({ queryKey: IMAGE_GENERATION_LLM_MODELS_QUERY_KEY, queryFn: listImageGenerationLlmModels })
  const providersQuery = useQuery({ queryKey: IMAGE_GENERATION_LLM_PROVIDERS_QUERY_KEY, queryFn: listImageGenerationLlmProviders })
  const policiesQuery = useQuery({ queryKey: IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY, queryFn: listImageGenerationLlmExecutionPolicies })
  const [search, setSearch] = useState("")
  const [editing, setEditing] = useState<Editing | null>(null)
  const [activeProviderGroup, setActiveProviderGroup] = useState<string | null>(null)
  const [activeModelGroup, setActiveModelGroup] = useState<string | null>(null)
  const [activePolicyGroup, setActivePolicyGroup] = useState<string | null>(null)

  useEffect(() => {
    setEditing(null)
  }, [resource])

  const models = modelsQuery.data ?? []
  const providers = providersQuery.data ?? []
  const policies = policiesQuery.data ?? []
  const editableModels = models
  const imageBindings = useMemo(() => collectImageBindings(providers), [providers])

  const providerFilters = useMemo(() => filterOptionsFromCounts(countBy(providers, (provider) => provider.group || "default"), providers.length), [providers])
  const modelFilters = useMemo(() => filterOptionsFromCounts(countBy(models, (model) => model.group || "default"), models.length), [models])
  const policyFilters = useMemo(() => filterOptionsFromCounts(countBy(policies, (policy) => policy.group || "default"), policies.length), [policies])

  const filteredProviders = useMemo(
    () => providers.filter((provider) => (!activeProviderGroup || (provider.group || "default") === activeProviderGroup) && matchesProvider(provider, search)),
    [activeProviderGroup, providers, search],
  )
  const filteredModels = useMemo(
    () => models.filter((model) => (!activeModelGroup || (model.group || "default") === activeModelGroup) && matchesImageModel(model, search)),
    [activeModelGroup, models, search],
  )
  const filteredPolicies = useMemo(
    () => policies.filter((policy) => (!activePolicyGroup || (policy.group || "default") === activePolicyGroup) && matchesPolicy(policy, imageBindings, search)),
    [activePolicyGroup, imageBindings, policies, search],
  )

  const deleteProviderMut = useMutation({
    mutationFn: deleteImageGenerationLlmProvider,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_PROVIDERS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY })
    },
    onSettled: (_data, _error, providerId) => {
      if (providerDeleteClaimRef.current === providerId) providerDeleteClaimRef.current = null
    },
  })
  const deleteModelMut = useMutation({
    mutationFn: deleteImageGenerationLlmModel,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_MODELS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_PROVIDERS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY })
    },
    onSettled: (_data, _error, modelId) => {
      if (modelDeleteClaimRef.current === modelId) modelDeleteClaimRef.current = null
    },
  })
  const deletePolicyMut = useMutation({
    mutationFn: deleteImageGenerationLlmExecutionPolicy,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY })
    },
    onSettled: (_data, _error, policyGroupId) => {
      if (policyDeleteClaimRef.current === policyGroupId) policyDeleteClaimRef.current = null
    },
  })

  const imageRegistryInteractionStateRef = useRef({
    resource,
    editing,
    providers,
    models,
    policies,
    deleteProviderPending: deleteProviderMut.isPending,
    deleteModelPending: deleteModelMut.isPending,
    deletePolicyPending: deletePolicyMut.isPending,
  })
  imageRegistryInteractionStateRef.current = {
    resource,
    editing,
    providers,
    models,
    policies,
    deleteProviderPending: deleteProviderMut.isPending,
    deleteModelPending: deleteModelMut.isPending,
    deletePolicyPending: deletePolicyMut.isPending,
  }

  const requestDeleteModel = async (model: LlmModelMetadata) => {
    if (model.source === "builtin" || deleteModelMut.isPending || modelDeleteClaimRef.current !== null) return
    modelDeleteClaimRef.current = model.model_id
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除图片生成模型",
        description: `确认删除图片生成模型「${model.model_id}」？`,
        confirmLabel: "删除模型",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = imageRegistryInteractionStateRef.current
      const latestModel = latest.models.find((item) => item.model_id === model.model_id)
      if (
        !interactionOwnerMountedRef.current
        || latest.resource !== "models"
        || latest.editing !== null
        || latest.deleteModelPending
        || !latestModel
        || latestModel.source === "builtin"
      ) {
        notify({
          title: "未删除图片生成模型",
          message: "确认期间资源列表、当前详情或删除任务状态已变化，请重新操作。",
          tone: "warning",
        })
        return
      }
      deleteModelMut.mutate(model.model_id)
      mutationStarted = true
    } finally {
      if (!mutationStarted && modelDeleteClaimRef.current === model.model_id) modelDeleteClaimRef.current = null
    }
  }

  const requestDeleteProvider = async (provider: LlmProviderDefinition) => {
    const target = {
      resource: "image-generation-provider" as const,
      id: provider.provider_id,
      displayName: provider.provider_id,
      deletable: hasEditableImageProviderBindings(provider),
    }
    if (!target.deletable || deleteProviderMut.isPending || providerDeleteClaimRef.current !== null) return
    providerDeleteClaimRef.current = target.id
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除图片生成服务商",
        description: `确认删除图片生成服务商「${target.displayName}」？`,
        confirmLabel: "删除服务商",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = imageRegistryInteractionStateRef.current
      const latestProvider = latest.providers.find((item) => item.provider_id === target.id)
      if (
        !interactionOwnerMountedRef.current
        || latest.resource !== "providers"
        || latest.editing !== null
        || latest.deleteProviderPending
        || !latestProvider
        || !hasEditableImageProviderBindings(latestProvider)
      ) {
        notify({
          title: "未删除图片生成服务商",
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

  const requestDeletePolicy = async (policy: LlmExecutionPolicy) => {
    const target = {
      resource: "image-generation-policy" as const,
      id: policy.policy_group_id,
      displayName: policy.name?.trim() || policy.policy_group_id,
      deletable: true,
    }
    if (deletePolicyMut.isPending || policyDeleteClaimRef.current !== null) return
    policyDeleteClaimRef.current = target.id
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除图片生成服务商策略",
        description: `确认删除图片生成服务商策略「${target.displayName}」？`,
        confirmLabel: "删除策略",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = imageRegistryInteractionStateRef.current
      const latestPolicy = latest.policies.find((item) => item.policy_group_id === target.id)
      if (
        !interactionOwnerMountedRef.current
        || latest.resource !== "policies"
        || latest.editing !== null
        || latest.deletePolicyPending
        || !latestPolicy
      ) {
        notify({
          title: "未删除图片生成服务商策略",
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

  if (editing?.resource === "model") {
    return (
      <ModelEditor
        editing={editing}
        onClose={() => setEditing(null)}
      />
    )
  }
  if (editing?.resource === "provider") {
    return (
      <ProviderEditor
        editing={editing}
        models={editableModels}
        onClose={() => setEditing(null)}
      />
    )
  }
  if (editing?.resource === "policy") {
    return (
      <PolicyEditor
        editing={editing}
        providers={providers}
        imageBindings={imageBindings}
        onClose={() => setEditing(null)}
      />
    )
  }

  return (
    <ResourceManagementLayout
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder={resource === "providers" ? "搜索图片生成服务商 / URL / 模型接入..." : resource === "models" ? "搜索图片生成模型 ID / 分组..." : "搜索图片生成策略 / 候选服务商..."}
      primaryFilters={resource === "models" ? modelFilters : resource === "policies" ? policyFilters : providerFilters}
      activePrimary={resource === "models" ? activeModelGroup : resource === "policies" ? activePolicyGroup : activeProviderGroup}
      onPrimaryChange={resource === "models" ? setActiveModelGroup : resource === "policies" ? setActivePolicyGroup : setActiveProviderGroup}
      action={
        <button
          type="button"
          onClick={() => setEditing(
            resource === "providers"
              ? { resource: "provider", mode: "create" }
              : resource === "models"
              ? { resource: "model", mode: "create" }
              : { resource: "policy", mode: "create" }
          )}
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
            {filteredProviders.map((provider) => {
              const editable = hasEditableImageProviderBindings(provider)
              return (
              <ResourceCard
                key={provider.provider_id}
                title={<ProviderCardTitle provider={provider} />}
                identifier={provider.api_base_url}
                description={<ProviderCardSummary provider={provider} />}
                onClick={editable ? () => setEditing({ resource: "provider", mode: "edit", original: provider }) : undefined}
                actions={editable ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      void requestDeleteProvider(provider)
                    }}
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    <Trash2 size={13} />
                    删除
                  </button>
                ) : null}
                badges={<ProviderCardMeta provider={provider} />}
              />
              )
            })}
          </ResourceGrid>
        </>
      ) : resource === "models" ? (
        <>
          <StatusText isLoading={modelsQuery.isLoading} error={modelsQuery.error || deleteModelMut.error} empty={!modelsQuery.isLoading && !modelsQuery.error && filteredModels.length === 0} />
          {filteredModels.length > 0 && (
            <ImageModelTable
              models={filteredModels}
              onEdit={(model) => setEditing({ resource: "model", mode: "edit", original: model })}
              onDelete={requestDeleteModel}
            />
          )}
        </>
      ) : (
        <>
          <StatusText isLoading={policiesQuery.isLoading || providersQuery.isLoading} error={policiesQuery.error || providersQuery.error || deletePolicyMut.error} empty={!policiesQuery.isLoading && !policiesQuery.error && filteredPolicies.length === 0} />
          <ResourceGrid>
            {filteredPolicies.map((policy) => (
              <ResourceCard
                key={policy.policy_group_id}
                title={policy.name ?? policy.policy_group_id}
                description={<PolicyCardSummary policy={policy} imageBindings={imageBindings} />}
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
                    <Trash2 size={13} />
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

function ProviderEditor({ editing, models, onClose }: { editing: ProviderEditing; models: LlmModelMetadata[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const original = editing.original
  const isCreate = editing.mode === "create"
  const [providerId, setProviderId] = useState(original?.provider_id ?? "")
  const [group, setGroup] = useState(original?.group ?? "default")
  const [apiBaseUrl, setApiBaseUrl] = useState(original?.api_base_url ?? "")
  const [customHeaders, setCustomHeaders] = useState<KeyValueRow[]>(() => objectToRows(original?.custom_headers))
  const [apiKeys, setApiKeys] = useState<ApiKeyRow[]>(() => apiKeysToRows(original?.api_keys ?? []))
  const [retryMax, setRetryMax] = useState(String(original?.retry.max_retries_per_key ?? DEFAULT_RETRY.max_retries_per_key))
  const [retryInitialDelay, setRetryInitialDelay] = useState(String(original?.retry.initial_delay_seconds ?? DEFAULT_RETRY.initial_delay_seconds))
  const [retryMaxDelay, setRetryMaxDelay] = useState(String(original?.retry.max_delay_seconds ?? DEFAULT_RETRY.max_delay_seconds))
  const [retryStatusCodes, setRetryStatusCodes] = useState((original?.retry.retryable_status_codes ?? DEFAULT_RETRY.retryable_status_codes).join(","))
  const [bindings, setBindings] = useState<BindingRow[]>(() =>
    (original?.models ?? [])
      .filter((binding) => binding.api_format === IMAGE_API_FORMAT || binding.api_format === GPT_IMAGE_AGENT_API_FORMAT)
      .map(bindingToRow)
  )
  const [localError, setLocalError] = useState("")
  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LlmProviderDefinitionBody }) => saveImageGenerationLlmProvider(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_PROVIDERS_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY })
      onClose()
    },
  })

  const handleSave = () => {
    try {
      const id = providerId.trim()
      if (!id) throw new Error("服务商 ID 不能为空")
      const baseUrl = apiBaseUrl.trim()
      if (!baseUrl) throw new Error("API Base URL 不能为空")
      const body: LlmProviderDefinitionBody = {
        group: group.trim() || "default",
        api_base_url: baseUrl,
        custom_headers: rowsToObject(customHeaders),
        api_keys: normalizeApiKeys(apiKeys),
        retry: {
          max_retries_per_key: parseNonNegativeInteger(retryMax, "每个 Key 最大重试次数"),
          initial_delay_seconds: parseNonNegativeNumber(retryInitialDelay, "初始重试延迟"),
          max_delay_seconds: parseNonNegativeNumber(retryMaxDelay, "最大重试延迟"),
          retryable_status_codes: parseRetryableStatusCodes(retryStatusCodes),
        },
        models: normalizeBindings(bindings),
      }
      setLocalError("")
      saveMut.mutate({ id, body }, { onError: (error) => setLocalError(errorToText(error)) })
    } catch (error) {
      setLocalError(errorToText(error))
    }
  }

  const addBinding = () => {
    const modelId = models[0]?.model_id ?? ""
    setBindings((current) => [
      ...current,
      {
        uiId: crypto.randomUUID(),
        id: createUniqueBindingId(modelId || "image-model", current),
        model_id: modelId,
        model_alias: modelId,
        api_format: IMAGE_API_FORMAT,
        api_base_url: null,
        custom_headers: [],
        api_keys: [],
      },
    ])
  }

  return (
    <DetailLayout title={isCreate ? "新增图片生成服务商" : original?.provider_id} actions={<EditorActions saving={saveMut.isPending} error={localError || errorToText(saveMut.error)} onCancel={onClose} onSave={handleSave} />}>
      <div className="space-y-5 pb-8">
        <EditorSection title="服务商基础配置">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TextField label="服务商 ID" value={providerId} onChange={setProviderId} disabled={!isCreate} mono required />
            <TextField label="分组" value={group} onChange={setGroup} mono required />
            <TextField label="API Base URL" value={apiBaseUrl} onChange={setApiBaseUrl} mono required />
          </div>
        </EditorSection>
        <EditorSection title="服务商 API Keys">
          <ApiKeyRows rows={apiKeys} onChange={setApiKeys} />
        </EditorSection>
        <EditorSection title="服务商请求头">
          <KeyValueRows rows={customHeaders} onChange={setCustomHeaders} keyPlaceholder="Header" valuePlaceholder="Value" />
        </EditorSection>
        <EditorSection title="重试策略">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <TextField label="每个 Key 最大重试次数" value={retryMax} onChange={setRetryMax} mono required />
            <TextField label="初始重试延迟秒数" value={retryInitialDelay} onChange={setRetryInitialDelay} mono required />
            <TextField label="最大重试延迟秒数" value={retryMaxDelay} onChange={setRetryMaxDelay} mono required />
            <TextField label="可重试 HTTP 状态码" value={retryStatusCodes} onChange={setRetryStatusCodes} mono />
          </div>
        </EditorSection>
        <EditorSection title="图片生成模型接入">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-app-muted">支持选择 OpenAI Images 传统生图或 OpenAI Responses 生图 Agent 模式，真实请求模型名由模型别名控制。</div>
            <button type="button" onClick={addBinding} className="rounded px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/10">
              新增模型接入
            </button>
          </div>
          <div className="space-y-3">
            {bindings.map((binding, index) => (
              <BindingEditorCard key={binding.uiId} binding={binding} index={index} models={models} rows={bindings} onChange={setBindings} />
            ))}
            {bindings.length === 0 ? <div className="rounded border border-dashed border-app-border/80 p-4 text-sm text-app-muted">还没有图片生成模型接入项。</div> : null}
          </div>
        </EditorSection>
      </div>
    </DetailLayout>
  )
}

function PolicyEditor({ editing, providers, imageBindings, onClose }: { editing: PolicyEditing; providers: LlmProviderDefinition[]; imageBindings: ImageBindingInfo[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const original = editing.original
  const isCreate = editing.mode === "create"
  const [policyGroupId, setPolicyGroupId] = useState(original?.policy_group_id ?? "")
  const [name, setName] = useState(original?.name ?? "")
  const [description, setDescription] = useState(original?.description ?? "")
  const [group, setGroup] = useState(original?.group ?? "default")
  const [enabled, setEnabled] = useState(original?.enabled ?? true)
  const [candidates, setCandidates] = useState<CandidateRow[]>(() => (original?.candidates ?? []).map(candidateToRow))
  const [localError, setLocalError] = useState("")
  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LlmExecutionPolicyBody }) => saveImageGenerationLlmExecutionPolicy(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_POLICIES_QUERY_KEY })
      onClose()
    },
  })

  const handleSave = () => {
    try {
      const id = policyGroupId.trim()
      if (!id) throw new Error("策略组 ID 不能为空")
      const body: LlmExecutionPolicyBody = {
        name: name.trim() || null,
        description: description.trim() || null,
        group: group.trim() || "default",
        enabled,
        unsupported_input_modality_strategy: FIXED_UNSUPPORTED_INPUT_MODALITY_STRATEGY,
        candidates: normalizePolicyCandidates(candidates, providers),
      }
      setLocalError("")
      saveMut.mutate({ id, body }, { onError: (error) => setLocalError(errorToText(error)) })
    } catch (error) {
      setLocalError(errorToText(error))
    }
  }

  const addCandidate = () => {
    const firstBinding = imageBindings[0]
    const providerId = firstBinding?.provider.provider_id ?? ""
    const bindingId = firstBinding?.binding.id ?? ""
    setCandidates((current) => [
      ...current,
      {
        uiId: crypto.randomUUID(),
        id: createUniqueCandidateId(providerId || "provider", bindingId || "model", current),
        provider_id: providerId,
        model_binding_id: bindingId,
        enabled: true,
      },
    ])
  }

  return (
    <DetailLayout title={isCreate ? "新增图片生成服务商策略" : original?.policy_group_id} actions={<EditorActions saving={saveMut.isPending} error={localError || errorToText(saveMut.error)} onCancel={onClose} onSave={handleSave} />}>
      <div className="space-y-5 pb-8">
        <EditorSection title="策略基础配置">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TextField label="策略组 ID" value={policyGroupId} onChange={setPolicyGroupId} disabled={!isCreate} mono required />
            <TextField label="分组" value={group} onChange={setGroup} mono required />
            <TextField label="名称" value={name} onChange={setName} />
          </div>
          <CheckField label="启用" checked={enabled} onChange={setEnabled} />
          <MultilineField label="描述" value={description} onChange={setDescription} />
        </EditorSection>
        <EditorSection title="候选图片生成服务商模型">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-app-muted">策略只选择图片生成服务商模型接入项；输入模态不兼容处理固定为不降级。</div>
            <button type="button" onClick={addCandidate} className="rounded px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/10">
              新增候选
            </button>
          </div>
          <div className="space-y-3">
            {candidates.map((candidate, index) => (
              <CandidateEditorCard key={candidate.uiId} candidate={candidate} index={index} rows={candidates} imageBindings={imageBindings} onChange={setCandidates} />
            ))}
            {candidates.length === 0 ? <div className="rounded border border-dashed border-app-border/80 p-4 text-sm text-app-muted">还没有候选图片生成服务商模型。</div> : null}
          </div>
        </EditorSection>
      </div>
    </DetailLayout>
  )
}

function ModelEditor({ editing, onClose }: { editing: ModelEditing; onClose: () => void }) {
  const queryClient = useQueryClient()
  const original = editing.original
  const isCreate = editing.mode === "create"
  const [modelId, setModelId] = useState(original?.model_id ?? "")
  const [group, setGroup] = useState(original?.group ?? "image_generation")
  const [contextWindow, setContextWindow] = useState(String(original?.context_window ?? 32000))
  const [maxOutputTokens, setMaxOutputTokens] = useState(String(original?.max_output_tokens ?? 32000))
  const [supportsToolCalling, setSupportsToolCalling] = useState(original?.supports_tool_calling ?? true)
  const [supportsStructuredOutput, setSupportsStructuredOutput] = useState(original?.supports_structured_output ?? false)
  const [supportedInputModalities, setSupportedInputModalities] = useState<string[]>(
    () => (original?.supported_input_modalities && original.supported_input_modalities.length > 0)
      ? [...original.supported_input_modalities]
      : ["text", "image"]
  )
  const [localError, setLocalError] = useState("")

  const saveMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: LlmModelMetadataBody }) => saveImageGenerationLlmModel(id, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: IMAGE_GENERATION_LLM_MODELS_QUERY_KEY })
      onClose()
    },
  })

  const handleSave = () => {
    try {
      const id = modelId.trim()
      if (!id) throw new Error("模型 ID 不能为空")
      const cw = parseNonNegativeInteger(contextWindow, "上下文窗口")
      const mt = parseNonNegativeInteger(maxOutputTokens, "最大输出 Token")
      if (cw <= 0) throw new Error("上下文窗口必须大于 0")
      if (mt <= 0) throw new Error("最大输出 Token 必须大于 0")
      const body: LlmModelMetadataBody = {
        group: group.trim() || "image_generation",
        context_window: cw,
        max_output_tokens: mt,
        compression_threshold: null,
        supports_tool_calling: supportsToolCalling,
        supports_structured_output: supportsStructuredOutput,
        supported_input_modalities: supportedInputModalities,
      }
      setLocalError("")
      saveMut.mutate({ id, body }, { onError: (error) => setLocalError(errorToText(error)) })
    } catch (error) {
      setLocalError(errorToText(error))
    }
  }

  const toggleModality = (modality: string) => {
    setSupportedInputModalities((prev) =>
      prev.includes(modality) ? prev.filter((m) => m !== modality) : [...prev, modality]
    )
  }

  return (
    <DetailLayout
      title={isCreate ? "新增图片生成模型" : original?.model_id}
      actions={
        <EditorActions
          saving={saveMut.isPending}
          error={localError || errorToText(saveMut.error)}
          onCancel={onClose}
          onSave={handleSave}
        />
      }
    >
      <div className="space-y-5 pb-8">
        <EditorSection title="模型基础配置">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <TextField
              label="模型 ID"
              value={modelId}
              onChange={setModelId}
              disabled={!isCreate}
              mono
              required
            />
            <TextField label="分组" value={group} onChange={setGroup} mono required />
            <TextField label="上下文窗口 (tokens)" value={contextWindow} onChange={setContextWindow} mono required />
            <TextField label="最大输出 Token 数" value={maxOutputTokens} onChange={setMaxOutputTokens} mono required />
          </div>
          <div className="flex flex-wrap gap-6 pt-2">
            <CheckField label="支持工具调用 (Tool Calling)" checked={supportsToolCalling} onChange={setSupportsToolCalling} />
            <CheckField label="支持结构化输出" checked={supportsStructuredOutput} onChange={setSupportsStructuredOutput} />
          </div>
        </EditorSection>
        <EditorSection title="支持输入模态">
          <div className="flex flex-wrap gap-6">
            <CheckField label="文本 (text)" checked={supportedInputModalities.includes("text")} onChange={() => toggleModality("text")} />
            <CheckField label="图片 (image)" checked={supportedInputModalities.includes("image")} onChange={() => toggleModality("image")} />
            <CheckField label="PDF (pdf)" checked={supportedInputModalities.includes("pdf")} onChange={() => toggleModality("pdf")} />
          </div>
        </EditorSection>
      </div>
    </DetailLayout>
  )
}

function ImageModelTable({
  models,
  onEdit,
  onDelete,
}: {
  models: LlmModelMetadata[]
  onEdit: (model: LlmModelMetadata) => void
  onDelete: (model: LlmModelMetadata) => void
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-app-border/80 bg-app-surface/70">
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-app-border/80 bg-app-surface/80 text-app-muted">
            <tr>
              <th className="px-4 py-3 font-medium">模型 ID</th>
              <th className="px-4 py-3 font-medium">分组</th>
              <th className="px-4 py-3 font-medium">来源</th>
              <th className="px-4 py-3 font-medium">输入模态</th>
              <th className="px-4 py-3 font-medium">操作 / 状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {models.map((model) => {
              const isBuiltin = model.source === "builtin"
              return (
                <tr key={model.model_id} className="text-app-secondary">
                  <td className="max-w-[320px] truncate px-4 py-3 font-mono text-sm text-app-primary">{model.model_id}</td>
                  <td className="px-4 py-3"><span className="rounded border border-app-border/80 bg-app-surface/85 px-1.5 py-0.5 font-mono text-[11px] text-app-secondary">{model.group || "default"}</span></td>
                  <td className="px-4 py-3"><span className={`rounded border px-1.5 py-0.5 font-mono text-[11px] ${isBuiltin ? "border-cyan-200 bg-cyan-50 text-cyan-700" : "border-purple-200 bg-purple-50 text-purple-700"}`}>{model.source}</span></td>
                  <td className="px-4 py-3 font-mono text-[11px]">{model.supported_input_modalities.join(" / ") || "image"}</td>
                  <td className="px-4 py-3 text-xs">
                    {isBuiltin ? (
                      <span className="text-app-muted">程序内置，只读</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onEdit(model)}
                          className="rounded px-2 py-0.5 text-xs text-blue-400 hover:bg-blue-500/10 hover:text-blue-300"
                        >
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(model)}
                          className="rounded px-2 py-0.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
                        >
                          删除
                        </button>
                      </div>
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

function BindingEditorCard({ binding, index, models, rows, onChange }: { binding: BindingRow; index: number; models: LlmModelMetadata[]; rows: BindingRow[]; onChange: (rows: BindingRow[]) => void }) {
  const update = (patch: Partial<BindingRow>) => onChange(rows.map((row) => (row.uiId === binding.uiId ? { ...row, ...patch } : row)))
  const modelOptions = models.map((model) => ({ value: model.model_id, label: model.model_id }))
  return (
    <div className="rounded-lg border border-app-border/80 bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-xs text-app-muted">#{index + 1} {binding.id || "未命名接入项"}</div>
        <button type="button" onClick={() => onChange(rows.filter((row) => row.uiId !== binding.uiId))} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10">
          删除接入
        </button>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TextField label="接入项 ID" value={binding.id} onChange={(value) => update({ id: value })} mono required />
        <SelectField label="模型型号" value={binding.model_id} onChange={(value) => updateBindingModel(rows, binding.uiId, value, onChange)} options={modelOptions} required />
        <TextField label="API 请求模型名" value={binding.model_alias} onChange={(value) => update({ model_alias: value })} mono required />
        <TextField label="模型专属 Base URL" value={binding.api_base_url ?? ""} onChange={(value) => update({ api_base_url: value })} mono />
        <SelectField
          label="API 协议"
          value={binding.api_format}
          onChange={(value) => update({ api_format: value })}
          options={API_FORMAT_OPTIONS}
          required
        />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-medium text-app-muted">模型专属请求头</div>
          <KeyValueRows rows={binding.custom_headers} onChange={(next) => update({ custom_headers: next })} keyPlaceholder="Header" valuePlaceholder="Value" />
        </div>
        <div>
          <div className="mb-2 text-xs font-medium text-app-muted">模型专属 API Keys</div>
          <ApiKeyRows rows={binding.api_keys} onChange={(next) => update({ api_keys: next })} />
        </div>
      </div>
    </div>
  )
}

function CandidateEditorCard({ candidate, index, rows, imageBindings, onChange }: { candidate: CandidateRow; index: number; rows: CandidateRow[]; imageBindings: ImageBindingInfo[]; onChange: (rows: CandidateRow[]) => void }) {
  const update = (patch: Partial<CandidateRow>) => onChange(rows.map((row) => (row.uiId === candidate.uiId ? { ...row, ...patch } : row)))
  const providerOptions = uniqueImageProviderOptions(imageBindings)
  const bindingOptions = imageBindings.filter((item) => item.provider.provider_id === candidate.provider_id).map((item) => ({ value: item.binding.id, label: item.binding.id }))
  return (
    <div className="rounded-lg border border-app-border/80 bg-white/[0.025] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="font-mono text-xs text-app-muted">#{index + 1} {candidate.id || "未命名候选"}</div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => moveCandidate(rows, candidate.uiId, -1, onChange)} disabled={index === 0} className="rounded px-2 py-1 text-xs text-app-secondary hover:bg-app-selected disabled:opacity-30"><ArrowUp size={13} /></button>
          <button type="button" onClick={() => moveCandidate(rows, candidate.uiId, 1, onChange)} disabled={index === rows.length - 1} className="rounded px-2 py-1 text-xs text-app-secondary hover:bg-app-selected disabled:opacity-30"><ArrowDown size={13} /></button>
          <button type="button" onClick={() => onChange(rows.filter((row) => row.uiId !== candidate.uiId))} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10">删除候选</button>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TextField label="候选 ID" value={candidate.id} onChange={(value) => update({ id: value })} mono required />
        <SelectField label="服务商" value={candidate.provider_id} onChange={(providerId) => updateCandidateProvider(rows, candidate.uiId, providerId, imageBindings, onChange)} options={providerOptions} required />
        <SelectField label="模型接入项" value={candidate.model_binding_id} onChange={(value) => update({ model_binding_id: value })} options={bindingOptions} required />
      </div>
      <div className="mt-3">
        <CheckField label="启用候选" checked={candidate.enabled} onChange={(enabled) => update({ enabled })} />
      </div>
    </div>
  )
}

function ProviderCardTitle({ provider }: { provider: LlmProviderDefinition }) {
  return <span className="font-mono">{provider.provider_id}</span>
}

function ProviderCardSummary({ provider }: { provider: LlmProviderDefinition }) {
  const bindings = provider.models.filter(isImageGenerationBinding)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <ModelInlineMetric label="分组" value={provider.group || "default"} />
      <ModelInlineMetric label="图片接入" value={bindings.length} />
      <ModelInlineMetric label="API Keys" value={provider.api_keys.length} />
      <ModelInlineMetric label="重试" value={provider.retry.max_retries_per_key} />
    </div>
  )
}

function ProviderCardMeta({ provider }: { provider: LlmProviderDefinition }) {
  const bindings = provider.models.filter(isImageGenerationBinding)
  return (
    <div className="flex flex-wrap gap-1.5">
      {bindings.slice(0, 4).map((binding) => (
        <span key={binding.id} className="max-w-full truncate rounded border border-app-border/80 bg-app-surface/80 px-1.5 py-0.5 font-mono text-[11px] text-app-secondary">
          {binding.id} · {binding.api_format}
        </span>
      ))}
      {bindings.length > 4 ? <span className="text-[11px] text-slate-600">+{bindings.length - 4}</span> : null}
    </div>
  )
}

function PolicyCardSummary({ policy, imageBindings }: { policy: LlmExecutionPolicy; imageBindings: ImageBindingInfo[] }) {
  const usableCandidates = policy.candidates.filter((candidate) => candidate.enabled && findImageBinding(imageBindings, candidate.provider_id, candidate.model_binding_id)).length
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
      <span className="font-mono"><ModelInlineMetric label="id" value={policy.policy_group_id} /></span>
      <span className="font-mono"><ModelInlineMetric label="分组" value={policy.group || "default"} /></span>
      <ModelInlineMetric label="可用候选" value={`${usableCandidates}/${policy.candidates.length}`} />
      <span className={policy.enabled ? "text-emerald-300" : "text-app-muted"}>{policy.enabled ? "enabled" : "disabled"}</span>
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
      {policy.candidates.length > 4 ? <span className="text-[11px] text-slate-600">+{policy.candidates.length - 4}</span> : null}
    </div>
  )
}

function TextField({ label, value, onChange, disabled, mono, required }: { label: string; value: string; onChange: (value: string) => void; disabled?: boolean; mono?: boolean; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-app-muted">{label}{required ? <span className="text-red-300"> *</span> : null}</span>
      <input value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className={inputClass(mono)} />
    </label>
  )
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-app-muted">{label}</span>
      <input value={value} disabled className={inputClass(true)} />
    </label>
  )
}

function SelectField({ label, value, onChange, options, required }: { label: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }>; required?: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-app-muted">{label}{required ? <span className="text-red-300"> *</span> : null}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} className={inputClass(true)}>
        <option value="">请选择</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  )
}

function MultilineField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-app-muted">{label}</span>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} rows={3} className={[inputClass(), "resize-y"].join(" ")} />
    </label>
  )
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-app-secondary">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  )
}

function EditorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-app-border/80 bg-app-surface/70 p-4">
      <h3 className="mb-4 text-sm font-semibold text-app-primary">{title}</h3>
      <div className="space-y-4">{children}</div>
    </section>
  )
}

function EditorActions({ saving, error, onCancel, onSave }: { saving: boolean; error?: string; onCancel: () => void; onSave: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {error ? <span className="max-w-[32rem] truncate text-xs text-red-300" title={error}>{error}</span> : null}
      <button type="button" onClick={onCancel} className="rounded border border-app-border/80 px-3 py-1.5 text-sm text-app-secondary hover:bg-app-surface-hover">取消</button>
      <button type="button" onClick={onSave} disabled={saving} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "保存中..." : "保存"}</button>
    </div>
  )
}

function KeyValueRows({ rows, onChange, keyPlaceholder, valuePlaceholder }: { rows: KeyValueRow[]; onChange: (rows: KeyValueRow[]) => void; keyPlaceholder: string; valuePlaceholder: string }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.uiId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2">
          <input value={row.key} onChange={(event) => onChange(rows.map((item) => item.uiId === row.uiId ? { ...item, key: event.target.value } : item))} placeholder={keyPlaceholder} className={inputClass(true)} />
          <input value={row.value} onChange={(event) => onChange(rows.map((item) => item.uiId === row.uiId ? { ...item, value: event.target.value } : item))} placeholder={valuePlaceholder} className={inputClass(true)} />
          <button type="button" onClick={() => onChange(rows.filter((item) => item.uiId !== row.uiId))} className="rounded px-2 text-xs text-red-400 hover:bg-red-500/10">删除</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { uiId: crypto.randomUUID(), key: "", value: "" }])} className="rounded px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/10">新增一行</button>
    </div>
  )
}

function ApiKeyRows({ rows, onChange }: { rows: ApiKeyRow[]; onChange: (rows: ApiKeyRow[]) => void }) {
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.uiId} className="grid grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] gap-2">
          <input value={row.key} onChange={(event) => onChange(rows.map((item) => item.uiId === row.uiId ? { ...item, key: event.target.value } : item))} placeholder="API Key 或环境变量引用" className={inputClass(true)} />
          <input value={row.name ?? ""} onChange={(event) => onChange(rows.map((item) => item.uiId === row.uiId ? { ...item, name: event.target.value } : item))} placeholder="名称" className={inputClass(false)} />
          <button type="button" onClick={() => onChange(rows.filter((item) => item.uiId !== row.uiId))} className="rounded px-2 text-xs text-red-400 hover:bg-red-500/10">删除</button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { uiId: crypto.randomUUID(), key: "", name: null }])} className="rounded px-2 py-1 text-xs text-blue-300 hover:bg-blue-500/10">新增 API Key</button>
    </div>
  )
}

function ModelInlineMetric({ label, value }: { label: string; value: unknown }) {
  return <span><span className="text-slate-600">{label}</span> <span>{String(value)}</span></span>
}

function collectImageBindings(providers: LlmProviderDefinition[]): ImageBindingInfo[] {
  return providers.flatMap((provider) => provider.models.filter(isImageGenerationBinding).map((binding) => ({ provider, binding })))
}

function findImageBinding(imageBindings: ImageBindingInfo[], providerId: string, bindingId: string) {
  return imageBindings.find((item) => item.provider.provider_id === providerId && item.binding.id === bindingId) ?? null
}

function matchesProvider(provider: LlmProviderDefinition, search: string) {
  return matchesQuery([provider.provider_id, provider.group, provider.api_base_url, provider.models.map((binding) => `${binding.id} ${binding.model_id} ${binding.model_alias}`).join(" ")], search)
}

function matchesImageModel(model: LlmModelMetadata, search: string) {
  return matchesQuery([model.model_id, model.group, model.source, model.supported_input_modalities.join(" ")], search)
}

function matchesPolicy(policy: LlmExecutionPolicy, imageBindings: ImageBindingInfo[], search: string) {
  const candidates = policy.candidates.map((candidate) => `${candidate.provider_id} ${candidate.model_binding_id} ${findImageBinding(imageBindings, candidate.provider_id, candidate.model_binding_id)?.binding.model_alias ?? ""}`).join(" ")
  return matchesQuery([policy.policy_group_id, policy.name, policy.description, policy.group, candidates], search)
}

function objectToRows(value: Record<string, string> | null | undefined) {
  return Object.entries(value ?? {}).map(([key, rowValue]) => ({ uiId: crypto.randomUUID(), key, value: rowValue }))
}

function rowsToObject(rows: KeyValueRow[]) {
  return Object.fromEntries(rows.filter((row) => row.key.trim()).map((row) => [row.key.trim(), row.value]))
}

function apiKeysToRows(keys: LlmApiKey[]) {
  return keys.map((item) => ({ ...item, uiId: crypto.randomUUID() }))
}

function normalizeApiKeys(rows: ApiKeyRow[]) {
  return rows.filter((row) => row.key.trim()).map(({ key, name }) => ({ key: key.trim(), name: name?.trim() || null }))
}

function bindingToRow(binding: LlmProviderModelBinding): BindingRow {
  return {
    uiId: crypto.randomUUID(),
    id: binding.id,
    model_id: binding.model_id,
    model_alias: binding.model_alias,
    api_format: binding.api_format || IMAGE_API_FORMAT,
    api_base_url: binding.api_base_url ?? null,
    custom_headers: objectToRows(binding.custom_headers),
    api_keys: apiKeysToRows(binding.api_keys ?? []),
  }
}

function normalizeBindings(rows: BindingRow[]): LlmProviderModelBinding[] {
  const seenIds = new Set<string>()
  return rows.map((row) => {
    const id = row.id.trim()
    if (!id) throw new Error("模型接入 ID 不能为空")
    if (seenIds.has(id)) throw new Error(`模型接入 ID 重复: ${id}`)
    seenIds.add(id)
    if (!row.model_id.trim()) throw new Error(`模型接入「${id}」必须选择模型型号`)
    if (!row.model_alias.trim()) throw new Error(`模型接入「${id}」必须填写 API 请求模型名`)
    const apiFormat = row.api_format?.trim() || IMAGE_API_FORMAT
    return {
      id,
      model_id: row.model_id.trim(),
      model_alias: row.model_alias.trim(),
      api_format: apiFormat,
      tool_choice: null,
      thinking: null,
      custom_request_params: null,
      api_base_url: row.api_base_url?.trim() || null,
      custom_headers: rowsToObject(row.custom_headers),
      api_keys: normalizeApiKeys(row.api_keys),
    }
  })
}

function candidateToRow(candidate: LlmExecutionPolicyCandidate): CandidateRow {
  return { ...candidate, uiId: crypto.randomUUID() }
}

function normalizePolicyCandidates(rows: CandidateRow[], providers: LlmProviderDefinition[]): LlmExecutionPolicyCandidate[] {
  const seenIds = new Set<string>()
  return rows.map((row) => {
    const id = row.id.trim()
    if (!id) throw new Error("候选 ID 不能为空")
    if (seenIds.has(id)) throw new Error(`候选 ID 重复: ${id}`)
    seenIds.add(id)
    if (!row.provider_id.trim()) throw new Error(`候选「${id}」必须选择服务商`)
    if (!row.model_binding_id.trim()) throw new Error(`候选「${id}」必须选择模型接入项`)
    const provider = providers.find((item) => item.provider_id === row.provider_id)
    if (!provider) throw new Error(`候选「${id}」引用的服务商不存在: ${row.provider_id}`)
    const binding = provider.models.find((item) => item.id === row.model_binding_id && isImageGenerationBinding(item))
    if (!binding) throw new Error(`候选「${id}」必须引用图片生成模型接入项: ${row.provider_id}/${row.model_binding_id}`)
    return {
      id,
      provider_id: row.provider_id.trim(),
      model_binding_id: row.model_binding_id.trim(),
      enabled: row.enabled,
    }
  })
}

function updateBindingModel(rows: BindingRow[], uiId: string, modelId: string, onChange: (rows: BindingRow[]) => void) {
  onChange(rows.map((row) => {
    if (row.uiId !== uiId) return row
    const previousModelId = row.model_id
    return {
      ...row,
      id: row.id.trim() ? row.id : createUniqueBindingId(modelId || "image-model", rows.filter((item) => item.uiId !== uiId)),
      model_id: modelId,
      model_alias: !row.model_alias.trim() || row.model_alias === previousModelId ? modelId : row.model_alias,
    }
  }))
}

function updateCandidateProvider(rows: CandidateRow[], uiId: string, providerId: string, imageBindings: ImageBindingInfo[], onChange: (rows: CandidateRow[]) => void) {
  const firstBinding = imageBindings.find((item) => item.provider.provider_id === providerId)?.binding.id ?? ""
  onChange(rows.map((row) => row.uiId === uiId ? { ...row, provider_id: providerId, model_binding_id: firstBinding } : row))
}

function moveCandidate(rows: CandidateRow[], uiId: string, direction: -1 | 1, onChange: (rows: CandidateRow[]) => void) {
  const index = rows.findIndex((row) => row.uiId === uiId)
  const target = index + direction
  if (index < 0 || target < 0 || target >= rows.length) return
  const next = [...rows]
  const [item] = next.splice(index, 1)
  next.splice(target, 0, item)
  onChange(next)
}

function uniqueImageProviderOptions(imageBindings: ImageBindingInfo[]) {
  const providerIds = [...new Set(imageBindings.map((item) => item.provider.provider_id))]
  return providerIds.map((providerId) => ({ value: providerId, label: providerId }))
}

function isImageGenerationBinding(binding: LlmProviderModelBinding) {
  return (
    binding.api_format === IMAGE_API_FORMAT
    || binding.api_format === GPT_IMAGE_AGENT_API_FORMAT
    || binding.api_format === "codex_responses"
  )
}

function hasEditableImageProviderBindings(provider: LlmProviderDefinition) {
  return provider.models.some((binding) => binding.api_format === IMAGE_API_FORMAT || binding.api_format === GPT_IMAGE_AGENT_API_FORMAT)
}

function createUniqueBindingId(modelId: string, rows: BindingRow[]) {
  return createUniqueId(toRegistryId(modelId), rows.map((row) => row.id))
}

function createUniqueCandidateId(providerId: string, bindingId: string, rows: CandidateRow[]) {
  return createUniqueId(toRegistryId(`${providerId}-${bindingId}`), rows.map((row) => row.id))
}

function createUniqueId(base: string, existing: string[]) {
  const used = new Set(existing.map((item) => item.trim()).filter(Boolean))
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}-${index}`)) index += 1
  return `${base}-${index}`
}

function toRegistryId(value: string) {
  const normalized = value.trim().replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "").slice(0, 128)
  return normalized || "image-model"
}

function parseNonNegativeInteger(value: string, label: string) {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) throw new Error(`${label} 必须是非负整数`)
  return Number(trimmed)
}

function parseNonNegativeNumber(value: string, label: string) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) throw new Error(`${label} 必须是非负数字`)
  return num
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

function inputClass(mono?: boolean) {
  return ["w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-2 text-sm text-app-primary outline-none placeholder:text-app-subtle focus:border-app-border-strong disabled:cursor-not-allowed disabled:opacity-60", mono ? "font-mono" : ""].join(" ")
}

function errorToText(error: unknown): string {
  if (!error) return ""
  if (error instanceof Error && error.message) return error.message
  return String(error)
}
