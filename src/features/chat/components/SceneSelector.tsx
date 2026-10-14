import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, MessageSquarePlus, Sparkles } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { createScene, deleteScene, listScenesByProject, type Project, type Scene } from "@/features/chat/api/sceneApi"
import { listLlmExecutionPolicies, type LlmExecutionPolicy } from "@/features/settings/settingsApi"
import { listAgents, type AgentDefinition } from "@/features/studio/studioApi"
import { useAppConfirm, useAppNotification } from "@/shared/interaction/AppInteractionProvider"

const SCENE_LIST_KEY = (projectId: string) => ["chat", "scenes", projectId] as const

/** 用户在创建新场景时选定的 fallback LLM 策略组（可选）；选择已有场景时不携带。 */
export type SceneFallbackLlm = {
  llm_policy_group_id: string | null
}

export function SceneSelector({
  project,
  workspacePath,
  isCreatingAgent,
  occupiedSceneIds,
  onSelect,
}: {
  project: Project
  /**
   * 项目所在 workspace 的绝对路径。由 ChatPage 从 workspaceStore/sceneStore 传入，
   * 用于所有 Scene 读写接口（listScenesByProject / createScene / deleteScene）携带的 workspace_path。
   */
  workspacePath: string
  isCreatingAgent: boolean
  /**
   * 同浏览器其他 Tab 当前打开的 scene_id 集合。由 ChatPage 订阅 sceneClaimRegistry 后传入。
   * 仅用于 presence 感知提示；runtime 已支持多客户端同时 attach，同一 scene 不再因其他标签页打开而禁用。
   */
  occupiedSceneIds?: Set<string>
  /**
   * 用户选定一个场景时回调。
   * - 选择已有场景：fallbackLlm 为 null，由 attach 接口走 resumed/recreated/created（后端自动回退到 agent default）；
   * - 创建新场景：fallbackLlm 携带创建表单中用户选定的 policy_group_id（默认是 agent.default_llm_policy_group_id）。
   */
  onSelect: (scene: Scene, fallbackLlm: SceneFallbackLlm | null) => void
}) {
  const queryClient = useQueryClient()
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const archiveConfirmationSceneIdRef = useRef<string | null>(null)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newSceneName, setNewSceneName] = useState("")
  const [newSceneDescription, setNewSceneDescription] = useState("")
  const [selectedAgentId, setSelectedAgentId] = useState<string>("")
  const [selectedPolicyGroupId, setSelectedPolicyGroupId] = useState<string>("")

  const scenesQuery = useQuery({
    queryKey: SCENE_LIST_KEY(project.project_id),
    queryFn: () => listScenesByProject(workspacePath, project.project_id),
  })

  const agentsQuery = useQuery({
    queryKey: ["chat", "agents"],
    queryFn: listAgents,
  })

  const policiesQuery = useQuery({
    queryKey: ["chat", "llm-execution-policies"],
    queryFn: listLlmExecutionPolicies,
  })
  const { refetch: refetchAgents } = agentsQuery
  const { refetch: refetchPolicies } = policiesQuery

  const refetchAgentPolicyOptions = useCallback(() => {
    void refetchAgents()
    void refetchPolicies()
  }, [refetchAgents, refetchPolicies])

  const availableAgents = useMemo<AgentDefinition[]>(
    () => (agentsQuery.data ?? []).filter((agent) => !agent.disabled && !agent.builtin_background_agent),
    [agentsQuery.data],
  )

  const availablePolicies = useMemo<LlmExecutionPolicy[]>(
    () =>
      (policiesQuery.data ?? []).filter(
        (policy) => policy.enabled && (policy.candidates ?? []).some((candidate) => candidate.enabled),
      ),
    [policiesQuery.data],
  )

  const selectedAgent = useMemo(
    () => availableAgents.find((agent) => agent.agent_id === selectedAgentId) ?? null,
    [availableAgents, selectedAgentId],
  )

  /** 当 agent 切换时，把 LLM 策略组下拉默认值同步成该 agent 的 default_llm_policy_group_id。 */
  useEffect(() => {
    if (!selectedAgent) {
      setSelectedPolicyGroupId("")
      return
    }
    const agentDefault = selectedAgent.default_llm_policy_group_id ?? ""
    const allowed = selectedAgent.allowed_llm_policy_group_ids ?? []
    const policyExists = (id: string) =>
      Boolean(id) &&
      availablePolicies.some((policy) => policy.policy_group_id === id) &&
      (allowed.length === 0 || allowed.includes(id))
    if (policyExists(agentDefault)) {
      setSelectedPolicyGroupId(agentDefault)
    } else if (selectedPolicyGroupId && policyExists(selectedPolicyGroupId)) {
      // 保持用户既有选择
    } else {
      setSelectedPolicyGroupId("")
    }
    // 仅在 agent 变化或可用策略列表变化时同步默认值
  }, [selectedAgent, availablePolicies])

  const policyOptions = useMemo<LlmExecutionPolicy[]>(() => {
    if (!selectedAgent) return availablePolicies
    const allowed = selectedAgent.allowed_llm_policy_group_ids ?? []
    if (allowed.length === 0) return availablePolicies
    return availablePolicies.filter((policy) => allowed.includes(policy.policy_group_id))
  }, [availablePolicies, selectedAgent])

  const createSceneMutation = useMutation({
    mutationFn: () =>
      createScene({
        workspace_path: workspacePath,
        project_id: project.project_id,
        name: newSceneName.trim() || "新对话",
        bound_agent_definition_id: selectedAgentId,
        description: newSceneDescription.trim(),
      }),
    onSuccess: (scene) => {
      const fallback: SceneFallbackLlm | null = selectedPolicyGroupId
        ? { llm_policy_group_id: selectedPolicyGroupId }
        : null
      setShowCreateForm(false)
      setNewSceneName("")
      setNewSceneDescription("")
      setSelectedAgentId("")
      setSelectedPolicyGroupId("")
      queryClient.setQueryData<Scene[]>(SCENE_LIST_KEY(project.project_id), (current) => {
        if (!current) return [scene]
        return [scene, ...current]
      })
      onSelect(scene, fallback)
    },
  })

  const deleteSceneMutation = useMutation({
    mutationFn: (sceneId: string) => deleteScene(workspacePath, sceneId),
    onSuccess: (_, sceneId) => {
      queryClient.setQueryData<Scene[]>(SCENE_LIST_KEY(project.project_id), (current) =>
        current ? current.filter((scene) => scene.scene_id !== sceneId) : current,
      )
    },
  })

  const scenes = (scenesQuery.data ?? []).filter((scene) => scene.status !== "archived")
  const archiveInteractionStateRef = useRef({
    projectId: project.project_id,
    workspacePath,
    activeSceneIds: scenes.map((scene) => scene.scene_id),
    deletePending: deleteSceneMutation.isPending,
  })
  archiveInteractionStateRef.current = {
    projectId: project.project_id,
    workspacePath,
    activeSceneIds: scenes.map((scene) => scene.scene_id),
    deletePending: deleteSceneMutation.isPending,
  }
  const isLoading = scenesQuery.isLoading
  const isCreating = createSceneMutation.isPending
  const isLoadingAgents = agentsQuery.isLoading || policiesQuery.isLoading
  const canSubmitCreate = Boolean(selectedAgentId) && !isCreating
  const error =
    scenesQuery.error instanceof Error
      ? scenesQuery.error.message
      : createSceneMutation.error instanceof Error
        ? createSceneMutation.error.message
        : agentsQuery.error instanceof Error
          ? agentsQuery.error.message
          : policiesQuery.error instanceof Error
            ? policiesQuery.error.message
            : null

  const requestArchiveScene = async (scene: Scene) => {
    const targetSceneId = scene.scene_id
    const targetSceneName = scene.name
    const targetProjectId = project.project_id
    const targetWorkspacePath = workspacePath
    if (archiveConfirmationSceneIdRef.current !== null || deleteSceneMutation.isPending) return
    archiveConfirmationSceneIdRef.current = targetSceneId
    try {
      const confirmed = await confirm({
        title: "归档对话场景",
        description: `归档并从对话列表移除 "${targetSceneName}"？相关消息历史不会被清除，后续可通过日志清理清除已归档 Scene 数据。`,
        confirmLabel: "归档 Scene",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = archiveInteractionStateRef.current
      if (
        latest.projectId !== targetProjectId
        || latest.workspacePath !== targetWorkspacePath
        || latest.deletePending
        || !latest.activeSceneIds.includes(targetSceneId)
      ) {
        notify({
          title: "未归档 Scene",
          message: "确认期间项目、工作区、Scene 列表或归档任务状态已变化，请重新操作。",
          tone: "warning",
        })
        return
      }
      deleteSceneMutation.mutate(targetSceneId)
    } finally {
      if (archiveConfirmationSceneIdRef.current === targetSceneId) {
        archiveConfirmationSceneIdRef.current = null
      }
    }
  }

  return (
    <div className="flex min-h-0 flex-1 items-stretch justify-center overflow-hidden">
      <div className="flex min-h-0 w-full max-w-3xl flex-col rounded-2xl border border-slate-200/80 bg-white/[0.88] p-6 shadow-[0_18px_46px_rgba(15,23,42,0.07)] backdrop-blur">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#263a63] text-white shadow-[0_10px_24px_rgba(38,58,99,0.20)]">
              <Sparkles size={20} />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-950">选择对话场景</div>
              <div className="mt-1 text-sm text-slate-500">
                项目 {project.name} · {workspacePath}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!showCreateForm) refetchAgentPolicyOptions()
              setShowCreateForm((value) => !value)
            }}
            disabled={isCreatingAgent}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:border-[#4f6f96]/45 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <MessageSquarePlus size={16} />
            新建对话
          </button>
        </div>

        {showCreateForm ? (
          <div className="mt-5 shrink-0 rounded-2xl border border-slate-200/80 bg-slate-50/[0.72] p-4">
            <label className="block text-xs font-medium text-slate-600">
              对话名称
              <input
                value={newSceneName}
                onChange={(event) => setNewSceneName(event.target.value)}
                placeholder="例如：登录流程重构"
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#4f6f96]/55 focus:ring-2 focus:ring-[#4f6f96]/10"
                autoFocus
              />
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              主 Agent（创建后永久绑定，不可修改）
              <select
                value={selectedAgentId}
                onFocus={refetchAgentPolicyOptions}
                onMouseDown={refetchAgentPolicyOptions}
                onChange={(event) => setSelectedAgentId(event.target.value)}
                disabled={isLoadingAgents || availableAgents.length === 0}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#4f6f96]/55 focus:ring-2 focus:ring-[#4f6f96]/10 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                <option value="">
                  {isLoadingAgents
                    ? "加载 Agent 列表中..."
                    : availableAgents.length === 0
                      ? "暂无可用 Agent，先去 Studio 创建"
                      : "请选择 Agent"}
                </option>
                {availableAgents.map((agent) => (
                  <option key={agent.agent_id} value={agent.agent_id}>
                    {agent.name || agent.agent_id}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              LLM 执行策略组（可选，默认使用 Agent 推荐）
              <select
                value={selectedPolicyGroupId}
                onFocus={refetchAgentPolicyOptions}
                onMouseDown={refetchAgentPolicyOptions}
                onChange={(event) => setSelectedPolicyGroupId(event.target.value)}
                disabled={isLoadingAgents || !selectedAgent || policyOptions.length === 0}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#4f6f96]/55 focus:ring-2 focus:ring-[#4f6f96]/10 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                <option value="">
                  {selectedAgent
                    ? policyOptions.length === 0
                      ? "无可用策略组"
                      : "默认（后端自动回退）"
                    : "先选择 Agent"}
                </option>
                {policyOptions.map((policy) => {
                  const isAgentDefault = selectedAgent?.default_llm_policy_group_id === policy.policy_group_id
                  return (
                    <option key={policy.policy_group_id} value={policy.policy_group_id}>
                      {(policy.name || policy.policy_group_id) + (isAgentDefault ? "（Agent 默认）" : "")}
                    </option>
                  )
                })}
              </select>
            </label>
            <label className="mt-3 block text-xs font-medium text-slate-600">
              说明（可选）
              <textarea
                value={newSceneDescription}
                onChange={(event) => setNewSceneDescription(event.target.value)}
                rows={2}
                placeholder="对该对话的目标做一句话描述。"
                className="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#4f6f96]/55 focus:ring-2 focus:ring-[#4f6f96]/10"
              />
            </label>
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-950"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => createSceneMutation.mutate()}
                disabled={!canSubmitCreate}
                title={!selectedAgentId ? "请先选择主 Agent" : undefined}
                className="inline-flex items-center gap-2 rounded-lg bg-[#263a63] px-3 py-1.5 text-xs font-medium text-white shadow-[0_10px_22px_rgba(38,58,99,0.16)] transition hover:bg-[#304875] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
              >
                {isCreating ? <Loader2 size={14} className="animate-spin" /> : <MessageSquarePlus size={14} />}
                创建并打开
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 size={16} className="animate-spin" />
              正在读取对话场景...
            </div>
          ) : scenes.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-white/[0.82] p-6 text-center text-sm text-slate-500">
              当前项目下还没有对话场景，点击右上角“新建对话”开始第一个对话。
            </div>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2">
              {scenes.map((scene) => {
                const occupied = occupiedSceneIds?.has(scene.scene_id) ?? false
                const isArchived = scene.status === "archived"
                const sceneTitle = occupied
                  ? "该场景已在另一个标签页打开；当前窗口仍可作为新的客户端加入。"
                  : isArchived
                    ? "该场景已归档，仅保留历史，不允许继续对话。"
                    : undefined
                return (
                  <li
                    key={scene.scene_id}
                    title={sceneTitle}
                    className={`group relative flex flex-col gap-2 rounded-2xl border border-slate-200/80 bg-white/[0.88] p-4 shadow-[0_10px_28px_rgba(15,23,42,0.04)] transition ${
                      isArchived ? "opacity-60" : "hover:border-[#4f6f96]/45 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)]"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onSelect(scene, null)}
                      disabled={isCreatingAgent || isArchived}
                      title={sceneTitle}
                      className="flex flex-col items-start gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <div className="text-sm font-semibold text-slate-950">{scene.name}</div>
                      <div className="text-[11px] text-slate-500">
                        最近活动 {new Date(scene.last_active_at).toLocaleString()}
                      </div>
                      {scene.description ? (
                        <div className="line-clamp-2 text-xs leading-5 text-slate-600">{scene.description}</div>
                      ) : null}
                      <div className="text-[11px] text-slate-400">
                        ID {scene.scene_id}
                      </div>
                    </button>
                    {occupied ? (
                      <span
                        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-800"
                        title={sceneTitle}
                      >
                        <span className="size-1.5 rounded-full bg-amber-500" />
                        其他标签页已打开
                      </span>
                    ) : isArchived ? (
                      <span
                        className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600"
                        title={sceneTitle}
                      >
                        已归档
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          void requestArchiveScene(scene)
                        }}
                        className="absolute right-3 top-3 hidden rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] text-slate-500 hover:border-red-400 hover:text-red-600 group-hover:block"
                      >
                        归档
                      </button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {error ? <div className="mt-4 shrink-0 text-sm text-red-700">{error}</div> : null}
      </div>
    </div>
  )
}
