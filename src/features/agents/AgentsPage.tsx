import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"

import {
  createAgentDefinition,
  deleteAgentDefinition,
  disableAgentDefinition,
  enableAgentDefinition,
  getAgentDefinition,
  listAgents,
  listMcpServices,
  listPromptSnippets,
  listSkills,
  listTools,
  updateAgentDefinition,
  type AgentDefinition,
  type AgentDefinitionUpdateBody,
  type McpServiceSummary,
  type McpToolBinding,
  type PromptSnippet,
  type SkillInfo,
  type SystemPromptSegment,
  type ToolSummary,
} from "@/features/studio/studioApi"
import { McpBindingsWorkbench, McpServiceLibraryPanel } from "@/features/agents/components/McpSelectionPanels"
import { PromptSegmentsEditor, type PromptDraft } from "@/features/agents/components/PromptSegmentsEditor"
import { SystemPromptPreviewDrawer } from "@/features/agents/components/SystemPromptPreviewDrawer"
import { SelectedToolsPanel, ToolLibraryPanel } from "@/features/agents/components/ToolSelectionPanels"
import { listLlmExecutionPolicies, type LlmExecutionPolicy } from "@/features/settings/settingsApi"
import { Badge } from "@/shared/components/Badge"
import { DarkSelect } from "@/shared/components/DarkSelect"
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
import { useAppConfirm, useAppNotification } from "@/shared/interaction/AppInteractionProvider"
import { cn, themeClassNames } from "@/shared/theme/classes"

type ViewMode = { kind: "list" } | { kind: "detail"; agentId: string } | { kind: "create" } | { kind: "edit"; agentId: string }

type AgentFormState = {
  agent_id: string
  name: string
  description: string
  group: string
  system_prompt: PromptDraft[]
  tool_ids: string[]
  mcp_tools: McpToolBinding[]
  skill_ids: string[]
  available_sub_agent_ids: string[]
  default_llm_policy_group_id: string
  allowed_llm_policy_group_ids: string[]
  builtin_background_agent: boolean
  disabled: boolean
}

type EditorPanelId = "basic" | "prompt" | "tools" | "mcp" | "skills" | "subAgents"

type EditorPanelDefinition = {
  id: EditorPanelId
  label: string
  value: string
}

type ResourceStatusFilter = "all" | "selected" | "unselected"

type AgentFormPatch = (next: Partial<AgentFormState>) => void

export function AgentsPage() {
  const qc = useQueryClient()
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const deleteAgentClaimRef = useRef<string | null>(null)
  const interactionOwnerMountedRef = useRef(true)
  useEffect(() => {
    interactionOwnerMountedRef.current = true
    return () => {
      interactionOwnerMountedRef.current = false
    }
  }, [])
  const { data, isLoading, error } = useQuery({ queryKey: ["agents"], queryFn: listAgents })
  const agents = data ?? []
  const [view, setView] = useState<ViewMode>({ kind: "list" })
  const [search, setSearch] = useState("")
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [activeState, setActiveState] = useState<string | null>(null)

  const groupOptions = useMemo(() => filterOptionsFromCounts(countBy(agents, (agent) => agent.group), agents.length), [agents])
  const stateOptions = useMemo(
    () => [
      { value: "__all", label: "全部状态", count: agents.length },
      { value: "enabled", label: "启用", count: agents.filter((agent) => !agent.disabled).length },
      { value: "disabled", label: "禁用", count: agents.filter((agent) => agent.disabled).length },
      { value: "builtin", label: "系统内置", count: agents.filter((agent) => agent.builtin_background_agent).length },
    ],
    [agents],
  )

  const filtered = useMemo(
    () =>
      agents.filter((agent) => {
        if (activeGroup && agent.group !== activeGroup) return false
        if (activeState === "enabled" && agent.disabled) return false
        if (activeState === "disabled" && !agent.disabled) return false
        if (activeState === "builtin" && !agent.builtin_background_agent) return false
        return matchesQuery(
          [
            agent.agent_id,
            agent.name,
            agent.description,
            agent.group,
            agent.disabled ? "禁用 disabled" : "启用 enabled",
            agent.builtin_background_agent ? "系统内置 builtin" : "",
            agent.tool_ids.join(" "),
            agent.skill_ids.join(" "),
            agent.available_sub_agent_ids.join(" "),
            agent.mcp_tools.map((item) => `${item.service_id} ${item.tool_ids.join(" ")}`).join(" "),
          ],
          search,
        )
      }),
    [activeGroup, activeState, agents, search],
  )

  const enableMut = useMutation({
    mutationFn: enableAgentDefinition,
    onSuccess: (agent) => {
      qc.invalidateQueries({ queryKey: ["agents"] })
      qc.invalidateQueries({ queryKey: ["agent", agent.agent_id] })
    },
  })
  const disableMut = useMutation({
    mutationFn: disableAgentDefinition,
    onSuccess: (agent) => {
      qc.invalidateQueries({ queryKey: ["agents"] })
      qc.invalidateQueries({ queryKey: ["agent", agent.agent_id] })
    },
  })
  const deleteMut = useMutation({
    mutationFn: deleteAgentDefinition,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agents"] })
      setView({ kind: "list" })
    },
    onSettled: (_data, _error, agentId) => {
      if (deleteAgentClaimRef.current === agentId) deleteAgentClaimRef.current = null
    },
  })
  const agentInteractionStateRef = useRef({ view, agents, deletePending: deleteMut.isPending })
  agentInteractionStateRef.current = { view, agents, deletePending: deleteMut.isPending }

  const requestDeleteAgent = async (agentId: string) => {
    const current = agentInteractionStateRef.current
    const agent = current.agents.find((item) => item.agent_id === agentId)
    const target = {
      resource: "agent-definition" as const,
      id: agentId,
      displayName: agent?.name?.trim() || agentId,
      builtinBackgroundAgent: agent?.builtin_background_agent ?? false,
      deletable: current.view.kind === "detail" && current.view.agentId === agentId && Boolean(agent),
    }
    if (!target.deletable || deleteMut.isPending || deleteAgentClaimRef.current !== null) return
    deleteAgentClaimRef.current = target.id
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除 Agent 定义",
        description: `确认删除 Agent 定义「${target.displayName}」？`,
        confirmLabel: "删除 Agent",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = agentInteractionStateRef.current
      const latestAgent = latest.agents.find((item) => item.agent_id === target.id)
      if (
        !interactionOwnerMountedRef.current
        || latest.view.kind !== "detail"
        || latest.view.agentId !== target.id
        || latest.deletePending
        || !latestAgent
      ) {
        notify({
          title: "未删除 Agent 定义",
          message: "确认期间目标 Agent、当前详情或删除任务状态已变化，请重新操作。",
          tone: "warning",
        })
        return
      }
      deleteMut.mutate(target.id)
      mutationStarted = true
    } finally {
      if (!mutationStarted && deleteAgentClaimRef.current === target.id) deleteAgentClaimRef.current = null
    }
  }

  if (view.kind === "create" || view.kind === "edit") {
    return (
      <AgentEditor
        mode={view.kind === "create" ? "create" : "edit"}
        agentId={view.kind === "edit" ? view.agentId : undefined}
        agents={agents}
        onClose={() => (view.kind === "edit" ? setView({ kind: "detail", agentId: view.agentId }) : setView({ kind: "list" }))}
        onSaved={(agentId) => setView({ kind: "detail", agentId })}
      />
    )
  }

  if (view.kind === "detail") {
    const selectedKey = view.agentId
    const compactItems = selectedKey !== "__create" && filtered.some((agent) => agent.agent_id === selectedKey) ? filtered : agents
    return (
      <AdaptiveResourceLayout
        list={
          <GroupedCompactResourceList
            items={compactItems}
            selectedKey={selectedKey}
            onSelect={(agent) => setView({ kind: "detail", agentId: agent.agent_id })}
            getKey={(agent) => agent.agent_id}
            getTitle={(agent) => agent.name ?? agent.agent_id}
            getGroup={(agent) => agent.group || "default"}
            onBack={() => setView({ kind: "list" })}
          />
        }
        detail={
          <AgentDetailStage
            agentId={view.agentId}
            onEdit={() => setView({ kind: "edit", agentId: view.agentId })}
            onToggle={(agent) => (agent.disabled ? enableMut.mutate(agent.agent_id) : disableMut.mutate(agent.agent_id))}
            onDelete={() => {
              void requestDeleteAgent(view.agentId)
            }}
          />
        }
      />
    )
  }

  return (
    <ResourceManagementLayout
      count={agents.length}
      action={
        <button
          type="button"
          onClick={() => setView({ kind: "create" })}
          className={cn(themeClassNames.button.primaryCompact, "gap-1")}
        >
          <Plus size={13} />
          新建
        </button>
      }
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="搜索 Agent 名称 / ID / 描述 / 能力..."
      primaryFilters={groupOptions}
      activePrimary={activeGroup}
      onPrimaryChange={setActiveGroup}
      secondaryFilters={stateOptions}
      activeSecondary={activeState}
      onSecondaryChange={setActiveState}
    >
      <StatusText isLoading={isLoading} error={error} empty={!isLoading && !error && filtered.length === 0} />
      <ResourceGrid>
        {filtered.map((agent) => (
          <AgentCard
            key={agent.agent_id}
            agent={agent}
            onSelect={() => setView({ kind: "detail", agentId: agent.agent_id })}
            onToggle={() => (agent.disabled ? enableMut.mutate(agent.agent_id) : disableMut.mutate(agent.agent_id))}
          />
        ))}
      </ResourceGrid>
    </ResourceManagementLayout>
  )
}

function AgentCard({ agent, onSelect, onToggle }: { agent: AgentDefinition; onSelect: () => void; onToggle: () => void }) {
  return (
    <ResourceCard
      title={agent.name ?? agent.agent_id}
      identifier={agent.agent_id}
      description={agent.description}
      onClick={onSelect}
      actions={
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            "rounded border px-2 py-0.5 text-xs font-medium transition",
            agent.disabled ? "border-app-border bg-app-surface-muted text-app-secondary hover:bg-app-surface-hover" : "border-app-success-border bg-app-success-surface text-app-success hover:border-app-success",
          )}
        >
          {agent.disabled ? "已禁用" : "已启用"}
        </button>
      }
      badges={
        <>
          <span>{agent.group}</span>
          <span>Prompt {agent.system_prompt.length}</span>
          <span>工具 {agent.tool_ids.length}</span>
          <span>MCP {agent.mcp_tools.length}</span>
          <span>Skill {agent.skill_ids.length}</span>
          <span>子Agent {agent.available_sub_agent_ids.length}</span>
          {agent.builtin_background_agent && <Badge tone="purple">系统内置</Badge>}
        </>
      }
    />
  )
}

function AgentDetailStage({
  agentId,
  onEdit,
  onToggle,
  onDelete,
}: {
  agentId: string
  onEdit: () => void
  onToggle: (agent: AgentDefinition) => void
  onDelete: () => void
}) {
  const { data, isLoading, error } = useQuery({ queryKey: ["agent", agentId], queryFn: () => getAgentDefinition(agentId) })

  return (
    <DetailLayout
      title={data?.name ?? agentId}
      identifier={agentId}
      titleMeta={data ? <AgentStatusBadges agent={data} /> : undefined}
      actions={
        <>
          {data && (
            <button type="button" onClick={() => onToggle(data)} className="rounded px-2 py-1 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">
              {data.disabled ? "启用" : "禁用"}
            </button>
          )}
          <button type="button" onClick={onEdit} className="rounded px-2 py-1 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">
            编辑
          </button>
          <button type="button" onClick={onDelete} className={themeClassNames.button.dangerInline}>
            <Trash2 size={14} />
          </button>
        </>
      }
    >
      <StatusText isLoading={isLoading} error={error} empty={false} />
      {data && <AgentDetailContent agent={data} />}
    </DetailLayout>
  )
}

function AgentStatusBadges({ agent }: { agent: AgentDefinition }) {
  return (
    <>
      <Badge tone={agent.disabled ? "red" : "green"}>{agent.disabled ? "已禁用" : "已启用"}</Badge>
      {agent.builtin_background_agent && <Badge tone="purple">系统内置</Badge>}
      <span className="rounded-full border border-app-border/80 bg-app-surface/80 px-2 py-0.5 text-xs text-app-secondary">{agent.group}</span>
    </>
  )
}

function AgentDetailContent({ agent }: { agent: AgentDefinition }) {
  return (
    <div className="space-y-5 pb-8">
      <div className="grid grid-cols-2 gap-3 rounded-lg border border-app-border/80 bg-app-surface/70 p-5 text-xs lg:grid-cols-6">
        <Metric label="Prompt" value={agent.system_prompt.length} />
        <Metric label="本地工具" value={agent.tool_ids.length} />
        <Metric label="MCP 服务" value={agent.mcp_tools.length} />
        <Metric label="MCP 工具" value={agent.mcp_tools.reduce((sum, item) => sum + item.tool_ids.length, 0)} />
        <Metric label="Skill" value={agent.skill_ids.length} />
        <Metric label="子 Agent" value={agent.available_sub_agent_ids.length} />
        {agent.description && (
          <div className="col-span-2 lg:col-span-6">
            <div className="text-app-muted">描述</div>
            <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-app-secondary">{agent.description}</div>
          </div>
        )}
      </div>
      <PromptPreview segments={agent.system_prompt} />
      <Section title="LLM 执行策略">
        <div className="space-y-3 text-xs text-app-secondary">
          <div>
            <span className="text-app-muted">默认策略组：</span>
            <span className="font-mono">{agent.default_llm_policy_group_id ?? "未指定"}</span>
          </div>
        </div>
      </Section>
      <IdSection title="本地工具" ids={agent.tool_ids} />
      <McpBindingPreview bindings={agent.mcp_tools} />
      <IdSection title="Skill" ids={agent.skill_ids} />
      <IdSection title="可用子 Agent" ids={agent.available_sub_agent_ids} />
    </div>
  )
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-app-muted">{label}</div>
      <div className="mt-1 text-sm font-medium text-app-primary">{value}</div>
    </div>
  )
}

function PromptPreview({ segments }: { segments: SystemPromptSegment[] }) {
  return (
    <Section title="系统提示词">
      {segments.length === 0 ? (
        <EmptyText />
      ) : (
        <div className="space-y-2">
          {segments.map((segment, index) => (
            <div key={index} className="rounded border border-app-border/80 bg-app-surface-muted/90 p-3">
              <div className="mb-2 text-[11px] font-medium text-app-muted">{segment.template_id ? "Template" : "Text"}</div>
              <div className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-app-secondary">{segment.template_id ?? segment.text}</div>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function McpBindingPreview({ bindings }: { bindings: McpToolBinding[] }) {
  return (
    <Section title="MCP 工具权限">
      {bindings.length === 0 ? (
        <EmptyText />
      ) : (
        <div className="space-y-2">
          {bindings.map((binding) => (
            <div key={binding.service_id} className="rounded border border-app-border/80 bg-app-surface/70 p-3">
              <div className="mb-2 font-mono text-xs font-medium text-app-secondary">{binding.service_id}</div>
              <ChipList values={binding.tool_ids} />
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

function IdSection({ title, ids }: { title: string; ids: string[] }) {
  return (
    <Section title={title}>
      {ids.length === 0 ? <EmptyText /> : <ChipList values={ids} />}
    </Section>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-app-border/80 bg-app-surface/70 p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-app-muted">{title}</h3>
      {children}
    </section>
  )
}

function ChipList({ values }: { values: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {values.map((value) => (
        <span key={value} className="rounded-full border border-app-border/80 bg-app-surface/85 px-2 py-0.5 font-mono text-xs text-app-secondary">
          {value}
        </span>
      ))}
    </div>
  )
}

function EmptyText() {
  return <div className={themeClassNames.resource.emptyText}>未配置</div>
}

function AgentEditor({
  mode,
  agentId,
  agents,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit"
  agentId?: string
  agents: AgentDefinition[]
  onClose: () => void
  onSaved: (agentId: string) => void
}) {
  const qc = useQueryClient()
  const isCreate = mode === "create"
  const { data: existing, isLoading } = useQuery({
    queryKey: ["agent", agentId],
    queryFn: () => getAgentDefinition(agentId!),
    enabled: mode === "edit" && !!agentId,
  })
  const { data: tools = [] } = useQuery({ queryKey: ["tools"], queryFn: listTools })
  const { data: mcpServices = [] } = useQuery({ queryKey: ["mcp"], queryFn: listMcpServices })
  const { data: skills = [] } = useQuery({ queryKey: ["skills"], queryFn: listSkills })
  const { data: promptSnippets = [] } = useQuery({ queryKey: ["prompts"], queryFn: listPromptSnippets })
  const { data: llmPolicies = [] } = useQuery({ queryKey: ["llm", "execution-policies"], queryFn: listLlmExecutionPolicies })
  const [form, setForm] = useState<AgentFormState>(() => emptyAgentForm())
  const [errMsg, setErrMsg] = useState("")
  const [activePanel, setActivePanel] = useState<EditorPanelId>("basic")
  const [activeMcpServiceId, setActiveMcpServiceId] = useState<string | null>(null)
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false)

  useEffect(() => {
    if (mode === "edit" && existing) {
      const next = agentToForm(existing)
      setForm(next)
      setActiveMcpServiceId(next.mcp_tools[0]?.service_id ?? null)
    }
    if (mode === "create") {
      setForm(emptyAgentForm())
      setActiveMcpServiceId(null)
    }
  }, [existing, mode])

  const createMut = useMutation({
    mutationFn: createAgentDefinition,
    onSuccess: (agent) => {
      qc.invalidateQueries({ queryKey: ["agents"] })
      onSaved(agent.agent_id)
    },
    onError: (error: Error) => setErrMsg(error.message || "创建失败"),
  })
  const updateMut = useMutation({
    mutationFn: (body: AgentDefinitionUpdateBody) => updateAgentDefinition(agentId!, body),
    onSuccess: (agent) => {
      qc.invalidateQueries({ queryKey: ["agents"] })
      qc.invalidateQueries({ queryKey: ["agent", agent.agent_id] })
      onSaved(agent.agent_id)
    },
    onError: (error: Error) => setErrMsg(error.message || "保存失败"),
  })

  function patch(next: Partial<AgentFormState>) {
    setForm((current) => ({ ...current, ...next }))
  }

  function addMcpBindings(bindingsToAdd: McpToolBinding[]) {
    setForm((current) => {
      const existingServiceIds = new Set(current.mcp_tools.map((binding) => binding.service_id))
      const newBindings = bindingsToAdd.filter((binding) => {
        if (existingServiceIds.has(binding.service_id)) return false
        existingServiceIds.add(binding.service_id)
        return true
      })
      if (newBindings.length === 0) return current
      return { ...current, mcp_tools: [...current.mcp_tools, ...newBindings] }
    })
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setErrMsg("")
    if (isCreate && !form.agent_id.trim()) {
      setErrMsg("Agent ID 不能为空")
      return
    }
    const normalized = normalizeAgentForm(form)
    if (isCreate) {
      createMut.mutate({ agent_id: normalized.agent_id, ...agentPayloadFromForm(normalized) })
      return
    }
    updateMut.mutate(agentPayloadFromForm(normalized))
  }

  const saving = createMut.isPending || updateMut.isPending
  const availableSubAgents = useMemo(() => agents.filter((agent) => agent.agent_id !== form.agent_id), [agents, form.agent_id])
  const panels = useMemo<EditorPanelDefinition[]>(
    () => [
      { id: "basic", label: "基础", value: form.group || "default" },
      { id: "prompt", label: "提示词", value: String(form.system_prompt.length) },
      { id: "tools", label: "本地工具", value: `${form.tool_ids.length}/${tools.length}` },
      { id: "mcp", label: "MCP", value: String(form.mcp_tools.reduce((sum, binding) => sum + binding.tool_ids.length, 0)) },
      { id: "skills", label: "Skill", value: `${form.skill_ids.length}/${skills.length}` },
      { id: "subAgents", label: "子 Agent", value: `${form.available_sub_agent_ids.length}/${availableSubAgents.length}` },
    ],
    [availableSubAgents.length, form.available_sub_agent_ids.length, form.group, form.mcp_tools, form.skill_ids.length, form.system_prompt.length, form.tool_ids.length, skills.length, tools.length],
  )
  const activePanelInfo = panels.find((panel) => panel.id === activePanel) ?? panels[0]

  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col bg-app-bg">
      <div className="flex shrink-0 items-center justify-between gap-4 px-5 py-4">
        <div>
          <h2 className="text-base font-semibold text-app-primary">{isCreate ? "新建 Agent 定义" : "编辑 Agent 定义"}</h2>
          {!isCreate && agentId && <div className="mt-1 font-mono text-xs text-app-muted">{agentId}</div>}
        </div>
        <div className="flex items-center gap-2">
          {errMsg && <span className="max-w-96 truncate text-xs text-app-danger">{errMsg}</span>}
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">
            取消
          </button>
          <button type="submit" disabled={saving || isLoading} className={themeClassNames.button.primaryCompact}>
            {saving ? "保存中" : "保存"}
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 border-t border-app-border/80">
        <div className="grid h-full min-h-0 grid-cols-[12rem_minmax(0,1fr)_20rem]">
          <AgentEditorSidebar panels={panels} activePanel={activePanel} onSelect={setActivePanel} />
          <main className="min-w-0 overflow-auto border-x border-app-border/80 px-5 py-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-app-primary">{activePanelInfo.label}</h3>
              </div>
              {activePanel === "prompt" && (
                <button type="button" onClick={() => setPromptPreviewOpen(true)} className="rounded bg-app-surface/70 px-2.5 py-1 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">
                  预览
                </button>
              )}
            </div>
            <AgentEditorMainPanel
              activePanel={activePanel}
              isCreate={isCreate}
              form={form}
              patch={patch}
              promptSnippets={promptSnippets}
              tools={tools}
              mcpServices={mcpServices}
              activeMcpServiceId={activeMcpServiceId}
              onActiveMcpServiceChange={setActiveMcpServiceId}
              skills={skills}
              availableSubAgents={availableSubAgents}
              llmPolicies={llmPolicies}
            />
          </main>
          <AgentEditorResourcePanel
            activePanel={activePanel}
            form={form}
            patch={patch}
            promptSnippets={promptSnippets}
            tools={tools}
            mcpServices={mcpServices}
            activeMcpServiceId={activeMcpServiceId}
            onActiveMcpServiceChange={setActiveMcpServiceId}
            onAddMcpBindings={addMcpBindings}
            skills={skills}
            availableSubAgents={availableSubAgents}
          />
        </div>
      </div>
      {promptPreviewOpen && <SystemPromptPreviewDrawer segments={form.system_prompt} snippets={promptSnippets} onClose={() => setPromptPreviewOpen(false)} />}
    </form>
  )
}

function AgentEditorSidebar({
  panels,
  activePanel,
  onSelect,
}: {
  panels: EditorPanelDefinition[]
  activePanel: EditorPanelId
  onSelect: (panelId: EditorPanelId) => void
}) {
  return (
    <aside className={cn(themeClassNames.layout.editorSidebar, "p-3")}>
      <div className="mb-3 px-2 text-xs font-medium text-app-muted">配置域</div>
      <div className="space-y-1">
        {panels.map((panel) => {
          const active = panel.id === activePanel
          return (
            <button
              key={panel.id}
              type="button"
              onClick={() => onSelect(panel.id)}
              className={[
                "flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-left text-xs transition",
                active ? themeClassNames.resource.filterButtonActive : "text-app-secondary hover:bg-app-surface-hover hover:text-app-primary",
              ].join(" ")}
            >
              <span className="truncate">{panel.label}</span>
              <span className="shrink-0 rounded bg-app-surface-hover px-1.5 py-0.5 font-mono text-[10px] text-app-muted">{panel.value}</span>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function AgentEditorMainPanel({
  activePanel,
  isCreate,
  form,
  patch,
  promptSnippets,
  tools,
  mcpServices,
  activeMcpServiceId,
  onActiveMcpServiceChange,
  skills,
  availableSubAgents,
  llmPolicies,
}: {
  activePanel: EditorPanelId
  isCreate: boolean
  form: AgentFormState
  patch: AgentFormPatch
  promptSnippets: PromptSnippet[]
  tools: ToolSummary[]
  mcpServices: McpServiceSummary[]
  activeMcpServiceId: string | null
  onActiveMcpServiceChange: (serviceId: string | null) => void
  skills: SkillInfo[]
  availableSubAgents: AgentDefinition[]
  llmPolicies: LlmExecutionPolicy[]
}) {
  if (activePanel === "basic") return <BasicInfoEditor isCreate={isCreate} form={form} patch={patch} policies={llmPolicies} />
  if (activePanel === "prompt") return <PromptSegmentsEditor value={form.system_prompt} snippets={promptSnippets} onChange={(system_prompt) => patch({ system_prompt })} />
  if (activePanel === "tools") {
    return <SelectedToolsPanel selectedToolIds={form.tool_ids} tools={tools} onChange={(tool_ids) => patch({ tool_ids })} />
  }
  if (activePanel === "mcp") {
    return <McpBindingsWorkbench bindings={form.mcp_tools} services={mcpServices} activeServiceId={activeMcpServiceId} onActiveServiceChange={onActiveMcpServiceChange} onChange={(mcp_tools) => patch({ mcp_tools })} />
  }
  if (activePanel === "skills") {
    return (
      <SelectedResourceList
        emptyText="未选择 Skill"
        ids={form.skill_ids}
        items={skills}
        getId={(skill) => skill.skill_id}
        getTitle={getSkillDisplayName}
        getMeta={(skill) => `${skill.skill_id} · ${skill.group || "default"}`}
        getDescription={(skill) => skill.description}
        onRemove={(skillId) => patch({ skill_ids: form.skill_ids.filter((id) => id !== skillId) })}
      />
    )
  }
  return (
    <SelectedResourceList
      emptyText="未配置可用子 Agent"
      ids={form.available_sub_agent_ids}
      items={availableSubAgents}
      getId={(agent) => agent.agent_id}
      getTitle={(agent) => agent.name ?? agent.agent_id}
      getMeta={(agent) => `${agent.agent_id} · ${agent.group}${agent.disabled ? " · disabled" : ""}`}
      getDescription={(agent) => agent.description ?? ""}
      onRemove={(agentId) => patch({ available_sub_agent_ids: form.available_sub_agent_ids.filter((id) => id !== agentId) })}
    />
  )
}

function BasicInfoEditor({ isCreate, form, patch, policies }: { isCreate: boolean; form: AgentFormState; patch: AgentFormPatch; policies: LlmExecutionPolicy[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {isCreate && (
        <FormField label="Agent ID">
          <input value={form.agent_id} onChange={(event) => patch({ agent_id: event.target.value })} placeholder="research_assistant" className={inputClassName("font-mono")} />
        </FormField>
      )}
      <FormField label="名称">
        <input value={form.name} onChange={(event) => patch({ name: event.target.value })} placeholder="展示名称" className={inputClassName()} />
      </FormField>
      <FormField label="分组">
        <input value={form.group} onChange={(event) => patch({ group: event.target.value })} placeholder="default" className={inputClassName()} />
      </FormField>
      <FormField label="默认执行策略组">
        <DarkSelect
          value={form.default_llm_policy_group_id}
          options={[{ value: "", label: "不指定" }, ...policies.map((policy) => ({ value: policy.policy_group_id, label: policy.name ?? policy.policy_group_id }))]}
          onChange={(value) => patch({ default_llm_policy_group_id: value })}
          placeholder="不指定"
          mono
        />
      </FormField>
      <div className="flex items-center gap-4">
        <Toggle checked={form.disabled} label="禁用" onChange={(checked) => patch({ disabled: checked })} />
      </div>
      <div className="lg:col-span-2">
        <FormField label="描述">
          <textarea value={form.description} onChange={(event) => patch({ description: event.target.value })} rows={5} placeholder="说明这个 Agent 的用途" className={textareaClassName()} />
        </FormField>
      </div>
    </div>
  )
}

function AgentEditorResourcePanel({
  activePanel,
  form,
  patch,
  promptSnippets,
  tools,
  mcpServices,
  activeMcpServiceId,
  onActiveMcpServiceChange,
  onAddMcpBindings,
  skills,
  availableSubAgents,
}: {
  activePanel: EditorPanelId
  form: AgentFormState
  patch: AgentFormPatch
  promptSnippets: PromptSnippet[]
  tools: ToolSummary[]
  mcpServices: McpServiceSummary[]
  activeMcpServiceId: string | null
  onActiveMcpServiceChange: (serviceId: string | null) => void
  onAddMcpBindings: (bindings: McpToolBinding[]) => void
  skills: SkillInfo[]
  availableSubAgents: AgentDefinition[]
}) {
  if (activePanel === "basic") return <BasicResourcePanel form={form} />
  if (activePanel === "prompt") {
    return (
      <PromptTemplateLibrary
        snippets={promptSnippets}
        referencedTemplateIds={form.system_prompt.map((segment) => segment.template_id).filter(Boolean)}
        onInsert={(templateId) => patch({ system_prompt: [...form.system_prompt, { kind: "template", text: "", template_id: templateId }] })}
        onInsertMany={(templateIds) => patch({ system_prompt: [...form.system_prompt, ...templateIds.map((templateId) => ({ kind: "template" as const, text: "", template_id: templateId }))] })}
      />
    )
  }
  if (activePanel === "tools") {
    return <ToolLibraryPanel tools={tools} selectedToolIds={form.tool_ids} onChange={(tool_ids) => patch({ tool_ids })} />
  }
  if (activePanel === "mcp") {
    return (
      <McpServiceLibraryPanel
        services={mcpServices}
        bindings={form.mcp_tools}
        activeServiceId={activeMcpServiceId}
        onActiveServiceChange={onActiveMcpServiceChange}
        onAdd={onAddMcpBindings}
      />
    )
  }
  if (activePanel === "skills") {
    return (
      <ResourceLibraryList
        title="Skill 库"
        items={skills}
        selectedIds={form.skill_ids}
        getId={(skill) => skill.skill_id}
        getTitle={getSkillDisplayName}
        getGroup={(skill) => skill.group || "default"}
        getMeta={(skill) => `${skill.skill_id} · ${skill.group || "default"}`}
        getDescription={(skill) => skill.description}
        onChange={(skill_ids) => patch({ skill_ids })}
      />
    )
  }
  return (
    <ResourceLibraryList
      title="Agent 定义"
      items={availableSubAgents}
      selectedIds={form.available_sub_agent_ids}
      getId={(agent) => agent.agent_id}
      getTitle={(agent) => agent.name ?? agent.agent_id}
      getGroup={(agent) => agent.group || "default"}
      getMeta={(agent) => `${agent.agent_id} · ${agent.group}${agent.disabled ? " · disabled" : ""}`}
      getDescription={(agent) => agent.description ?? ""}
      onChange={(available_sub_agent_ids) => patch({ available_sub_agent_ids })}
    />
  )
}

function BasicResourcePanel({ form }: { form: AgentFormState }) {
  return (
    <ResourcePanelShell title="当前定义">
      <div className="space-y-3">
        <ResourceSummaryRow label="Agent ID" value={form.agent_id || "未填写"} />
        <ResourceSummaryRow label="名称" value={form.name || "未填写"} />
        <ResourceSummaryRow label="分组" value={form.group || "default"} />
        <ResourceSummaryRow label="状态" value={form.disabled ? "禁用" : "启用"} />
      </div>
    </ResourcePanelShell>
  )
}

function PromptTemplateLibrary({
  snippets,
  referencedTemplateIds,
  onInsert,
  onInsertMany,
}: {
  snippets: PromptSnippet[]
  referencedTemplateIds: string[]
  onInsert: (templateId: string) => void
  onInsertMany: (templateIds: string[]) => void
}) {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ResourceStatusFilter>("all")
  const referenced = useMemo(() => new Set(referencedTemplateIds), [referencedTemplateIds])
  const filtered = useMemo(
    () =>
      snippets.filter((snippet) => {
        const active = referenced.has(snippet.name)
        if (statusFilter === "selected") return active && matchesQuery([snippet.name, snippet.category, snippet.text], query)
        if (statusFilter === "unselected") return !active && matchesQuery([snippet.name, snippet.category, snippet.text], query)
        return matchesQuery([snippet.name, snippet.category, snippet.text], query)
      }),
    [query, referenced, snippets, statusFilter],
  )
  const groups = useMemo(() => groupItems(filtered, (snippet) => snippet.category || "default"), [filtered])

  function insertGroup(snippetsInGroup: PromptSnippet[]) {
    onInsertMany(snippetsInGroup.map((snippet) => snippet.name).filter((templateId) => !referenced.has(templateId)))
  }

  return (
    <ResourcePanelShell title="提示词模板">
      <ResourceSearch value={query} onChange={setQuery} />
      <ResourceStatusFilterBar value={statusFilter} onChange={setStatusFilter} />
      <div className="mt-3 space-y-2">
        {filtered.length === 0 && <EmptyText />}
        {groups.map((group) => (
          <ResourceGroupSection
            key={group.name}
            name={group.name}
            totalCount={group.items.length}
            selectedCount={group.items.filter((snippet) => referenced.has(snippet.name)).length}
            onSelectAll={() => insertGroup(group.items)}
          >
            {group.items.map((snippet) => (
              <button
                key={snippet.name}
                type="button"
                onClick={() => onInsert(snippet.name)}
                className={cn(
                  themeClassNames.resource.card,
                  "p-3",
                  referenced.has(snippet.name) && themeClassNames.resource.cardActive,
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-mono text-xs text-app-primary">{snippet.name}</span>
                  <span className={cn("shrink-0", referenced.has(snippet.name) ? themeClassNames.badge.selected : themeClassNames.badge.neutral)}>{referenced.has(snippet.name) ? "已引用" : "插入"}</span>
                </div>
                <div className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-app-muted">{snippet.text}</div>
              </button>
            ))}
          </ResourceGroupSection>
        ))}
      </div>
    </ResourcePanelShell>
  )
}

function ResourceLibraryList<TItem>({
  title,
  items,
  selectedIds,
  getId,
  getTitle,
  getGroup,
  getMeta,
  getDescription,
  onChange,
}: {
  title: string
  items: TItem[]
  selectedIds: string[]
  getId: (item: TItem) => string
  getTitle: (item: TItem) => ReactNode
  getGroup: (item: TItem) => string
  getMeta: (item: TItem) => ReactNode
  getDescription: (item: TItem) => string
  onChange: (ids: string[]) => void
}) {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ResourceStatusFilter>("all")
  const selected = useMemo(() => new Set(selectedIds), [selectedIds])
  const filtered = useMemo(
    () =>
      items.filter((item) => {
        const active = selected.has(getId(item))
        if (statusFilter === "selected" && !active) return false
        if (statusFilter === "unselected" && active) return false
        return matchesQuery([getId(item), getTitle(item), getMeta(item), getDescription(item)], query)
      }),
    [getDescription, getId, getMeta, getTitle, items, query, selected, statusFilter],
  )
  const groups = useMemo(() => groupItems(filtered, getGroup), [filtered, getGroup])

  function selectGroup(groupItems: TItem[]) {
    onChange(uniqueStrings([...selectedIds, ...groupItems.map((item) => getId(item))]))
  }

  return (
    <ResourcePanelShell title={title}>
      <ResourceSearch value={query} onChange={setQuery} />
      <ResourceStatusFilterBar value={statusFilter} onChange={setStatusFilter} />
      <div className="mt-3 space-y-2">
        {filtered.length === 0 && <EmptyText />}
        {groups.map((group) => (
          <ResourceGroupSection
            key={group.name}
            name={group.name}
            totalCount={group.items.length}
            selectedCount={group.items.filter((item) => selected.has(getId(item))).length}
            onSelectAll={() => selectGroup(group.items)}
          >
            {group.items.map((item) => {
              const id = getId(item)
              const active = selected.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange(toggleId(selectedIds, id))}
                  className={cn(
                    themeClassNames.resource.card,
                    "p-3",
                    active && themeClassNames.resource.cardActive,
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-xs font-medium text-app-primary">{getTitle(item)}</span>
                    <span className={cn("shrink-0", active ? themeClassNames.badge.selected : themeClassNames.badge.neutral)}>{active ? "已选" : "添加"}</span>
                  </div>
                  <div className="mt-1 truncate text-[11px] text-app-muted">{getMeta(item)}</div>
                  {getDescription(item) && <div className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-app-muted">{getDescription(item)}</div>}
                </button>
              )
            })}
          </ResourceGroupSection>
        ))}
      </div>
    </ResourcePanelShell>
  )
}

function ResourceGroupSection({ name, totalCount, selectedCount, onSelectAll, children }: { name: string; totalCount: number; selectedCount: number; onSelectAll: () => void; children: ReactNode }) {
  const allSelected = totalCount > 0 && selectedCount >= totalCount
  const [collapsed, setCollapsed] = useState(false)
  return (
    <section className="space-y-1.5">
      <div className="flex items-center gap-2 px-1 py-1">
        <button type="button" onClick={() => setCollapsed((value) => !value)} aria-expanded={!collapsed} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <svg viewBox="0 0 16 16" className={["h-3 w-3 shrink-0 text-app-muted transition-transform", collapsed ? "-rotate-90" : "rotate-0"].join(" ")} fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className={cn("h-3 w-0.5 shrink-0 rounded-full", themeClassNames.resource.groupAccent)} />
          <span className="min-w-0 truncate text-[11px] font-medium text-app-secondary">
            {name} <span className="font-mono text-app-muted">{selectedCount}/{totalCount}</span>
          </span>
          <span className={cn("h-px min-w-4 flex-1", themeClassNames.resource.groupDivider)} />
        </button>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={allSelected}
          className={cn("shrink-0", allSelected ? "rounded px-2 py-0.5 text-[11px] text-app-subtle" : themeClassNames.button.accentLink)}
        >
          {allSelected ? "已全选" : "全选"}
        </button>
      </div>
      {!collapsed && <div className={themeClassNames.resource.groupList}>{children}</div>}
    </section>
  )
}

function SelectedResourceList<TItem>({
  emptyText,
  ids,
  items,
  getId,
  getTitle,
  getMeta,
  getDescription,
  onRemove,
}: {
  emptyText: string
  ids: string[]
  items: TItem[]
  getId: (item: TItem) => string
  getTitle: (item: TItem) => ReactNode
  getMeta: (item: TItem) => ReactNode
  getDescription: (item: TItem) => string
  onRemove: (id: string) => void
}) {
  const itemMap = useMemo(() => new Map(items.map((item) => [getId(item), item])), [getId, items])
  if (ids.length === 0) return <EmptyText />

  return (
    <div className="space-y-2">
      {ids.map((id) => {
        const item = itemMap.get(id)
        return (
          <div key={id} className="rounded border border-app-border/80 bg-app-surface/70 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-xs font-medium text-app-primary">{item ? getTitle(item) : id}</div>
                <div className="mt-1 truncate text-[11px] text-app-muted">{item ? getMeta(item) : "未在资源库中找到"}</div>
              </div>
              <button type="button" onClick={() => onRemove(id)} className={cn("shrink-0", themeClassNames.button.dangerInline)}>
                移除
              </button>
            </div>
            {item && getDescription(item) && <div className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-app-muted">{getDescription(item)}</div>}
          </div>
        )
      })}
      {ids.length === 0 && <div className={themeClassNames.resource.emptyText}>{emptyText}</div>}
    </div>
  )
}

function ResourcePanelShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className={cn(themeClassNames.layout.resourceSidebar, "px-3 py-4")}>
      <div className="mb-3 px-1 text-xs font-medium text-app-muted">{title}</div>
      {children}
    </aside>
  )
}

function ResourceSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <input value={value} onChange={(event) => onChange(event.target.value)} placeholder="搜索..." className={inputClassName("h-8 text-xs")} />
}

function ResourceStatusFilterBar({ value, onChange }: { value: ResourceStatusFilter; onChange: (value: ResourceStatusFilter) => void }) {
  return (
    <div className={cn("mt-2 grid grid-cols-3 gap-1", themeClassNames.resource.filterBar)}>
      <ResourceStatusFilterButton active={value === "all"} onClick={() => onChange("all")}>全部</ResourceStatusFilterButton>
      <ResourceStatusFilterButton active={value === "unselected"} onClick={() => onChange("unselected")}>未选</ResourceStatusFilterButton>
      <ResourceStatusFilterButton active={value === "selected"} onClick={() => onChange("selected")}>已选</ResourceStatusFilterButton>
    </div>
  )
}

function ResourceStatusFilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded px-2 py-1 text-xs transition", active ? themeClassNames.resource.filterButtonActive : themeClassNames.resource.filterButtonInactive)}>
      {children}
    </button>
  )
}

function ResourceSummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded border border-app-border/80 bg-app-surface/70 px-3 py-2">
      <div className="text-[11px] text-app-muted">{label}</div>
      <div className="mt-1 truncate text-xs text-app-secondary">{value}</div>
    </div>
  )
}

function getSkillDisplayName(skill: SkillInfo) {
  return skill.metadata?.["display-name"] || skill.name
}

function FormField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-app-muted">{label}</label>
      {children}
    </div>
  )
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-app-secondary">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="h-3.5 w-3.5 accent-app-accent" />
      {label}
    </label>
  )
}

function emptyAgentForm(): AgentFormState {
  return {
    agent_id: "",
    name: "",
    description: "",
    group: "default",
    system_prompt: [],
    tool_ids: [],
    mcp_tools: [],
    skill_ids: [],
    available_sub_agent_ids: [],
    default_llm_policy_group_id: "",
    allowed_llm_policy_group_ids: [],
    builtin_background_agent: false,
    disabled: false,
  }
}

function agentToForm(agent: AgentDefinition): AgentFormState {
  return {
    agent_id: agent.agent_id,
    name: agent.name ?? "",
    description: agent.description ?? "",
    group: agent.group || "default",
    system_prompt: agent.system_prompt.map((segment) => ({
      kind: segment.template_id ? "template" : "text",
      text: segment.text ?? "",
      template_id: segment.template_id ?? "",
    })),
    tool_ids: agent.tool_ids,
    mcp_tools: agent.mcp_tools,
    skill_ids: agent.skill_ids,
    available_sub_agent_ids: agent.available_sub_agent_ids,
    default_llm_policy_group_id: agent.default_llm_policy_group_id ?? "",
    allowed_llm_policy_group_ids: agent.allowed_llm_policy_group_ids,
    builtin_background_agent: agent.builtin_background_agent,
    disabled: agent.disabled,
  }
}

function normalizeAgentForm(form: AgentFormState): AgentFormState {
  return {
    ...form,
    agent_id: form.agent_id.trim(),
    name: form.name.trim(),
    description: form.description.trim(),
    group: form.group.trim() || "default",
    tool_ids: uniqueStrings(form.tool_ids),
    mcp_tools: form.mcp_tools
      .map((binding) => ({ service_id: binding.service_id.trim(), tool_ids: uniqueStrings(binding.tool_ids) }))
      .filter((binding) => binding.service_id && binding.tool_ids.length > 0),
    skill_ids: uniqueStrings(form.skill_ids),
    available_sub_agent_ids: uniqueStrings(form.available_sub_agent_ids).filter((id) => id !== form.agent_id.trim()),
    default_llm_policy_group_id: form.default_llm_policy_group_id.trim(),
    allowed_llm_policy_group_ids: uniqueStrings(form.allowed_llm_policy_group_ids),
  }
}

function agentPayloadFromForm(form: AgentFormState): AgentDefinitionUpdateBody {
  return {
    name: form.name || null,
    description: form.description || null,
    group: form.group || "default",
    system_prompt: normalizePromptSegments(form.system_prompt),
    tool_ids: form.tool_ids,
    mcp_tools: form.mcp_tools,
    skill_ids: form.skill_ids,
    available_sub_agent_ids: form.available_sub_agent_ids,
    default_llm_policy_group_id: form.default_llm_policy_group_id || null,
    allowed_llm_policy_group_ids: form.allowed_llm_policy_group_ids,
    builtin_background_agent: form.builtin_background_agent,
    disabled: form.disabled,
  }
}

function normalizePromptSegments(segments: PromptDraft[]): SystemPromptSegment[] {
  const normalized: SystemPromptSegment[] = []
  for (const segment of segments) {
    if (segment.kind === "template") {
      const templateId = segment.template_id.trim()
      if (templateId) normalized.push({ template_id: templateId })
      continue
    }
    const text = segment.text.trim()
    if (text) normalized.push({ text })
  }
  return normalized
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
}

function groupItems<TItem>(items: TItem[], getGroup: (item: TItem) => string) {
  const groupMap = new Map<string, TItem[]>()
  items.forEach((item) => {
    const group = getGroup(item) || "default"
    groupMap.set(group, [...(groupMap.get(group) ?? []), item])
  })
  return Array.from(groupMap.entries())
    .map(([name, groupItems]) => ({ name, items: groupItems }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function inputClassName(extra = "") {
  return cn("w-full px-3 py-1.5 text-sm", themeClassNames.form.input, extra)
}

function textareaClassName(extra = "") {
  return cn("w-full resize-y px-3 py-2 text-sm leading-relaxed", themeClassNames.form.textarea, extra)
}
