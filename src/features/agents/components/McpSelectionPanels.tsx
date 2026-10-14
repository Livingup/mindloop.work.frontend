import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"

import { listMcpTools, type McpServiceSummary, type McpToolBinding, type McpToolSummary2 } from "@/features/studio/studioApi"
import { matchesQuery } from "@/shared/components/ResourceManagement"
import { cn, themeClassNames } from "@/shared/theme/classes"

type BindingFilter = "all" | "bound" | "unbound"
type ToolStatusFilter = "all" | "selected" | "unselected"

export function McpBindingsWorkbench({
  bindings,
  services,
  activeServiceId,
  onActiveServiceChange,
  onChange,
}: {
  bindings: McpToolBinding[]
  services: McpServiceSummary[]
  activeServiceId: string | null
  onActiveServiceChange: (serviceId: string | null) => void
  onChange: (bindings: McpToolBinding[]) => void
}) {
  const serviceMap = useMemo(() => new Map(services.map((service) => [service.service_id, service])), [services])
  const activeBinding = bindings.find((binding) => binding.service_id === activeServiceId) ?? bindings[0]
  const activeService = activeBinding ? serviceMap.get(activeBinding.service_id) : undefined

  useEffect(() => {
    if (bindings.length === 0) {
      if (activeServiceId) onActiveServiceChange(null)
      return
    }
    if (!activeServiceId || !bindings.some((binding) => binding.service_id === activeServiceId)) {
      onActiveServiceChange(bindings[0].service_id)
    }
  }, [activeServiceId, bindings, onActiveServiceChange])

  function updateToolIds(serviceId: string, toolIds: string[]) {
    onChange(bindings.map((binding) => (binding.service_id === serviceId ? { ...binding, tool_ids: uniqueStrings(toolIds) } : binding)))
  }

  function removeBinding(serviceId: string) {
    const next = bindings.filter((binding) => binding.service_id !== serviceId)
    onChange(next)
    if (activeServiceId === serviceId) onActiveServiceChange(next[0]?.service_id ?? null)
  }

  if (bindings.length === 0) {
    return <div className={themeClassNames.resource.empty}>未绑定 MCP 服务，可从右侧 MCP 服务库添加。</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {bindings.map((binding) => {
          const service = serviceMap.get(binding.service_id)
          const active = activeBinding?.service_id === binding.service_id
          return (
            <button
              key={binding.service_id}
              type="button"
              onClick={() => onActiveServiceChange(binding.service_id)}
              className={cn(
                themeClassNames.resource.card,
                "min-w-44 px-3 py-2",
                active && themeClassNames.resource.cardActive,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate text-xs font-medium text-app-primary">{service?.name || binding.service_id}</div>
                <ConnectionBadge service={service} />
              </div>
              <div className="mt-1 font-mono text-[11px] text-app-muted">已授权 {binding.tool_ids.length}</div>
            </button>
          )
        })}
      </div>
      {activeBinding && (
        <section className="rounded-lg border border-app-border/80 bg-app-surface-muted/80">
          <div className="flex items-start justify-between gap-3 border-b border-app-border/80 px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-medium text-app-primary">{activeService?.name || activeBinding.service_id}</div>
            </div>
            <button type="button" onClick={() => removeBinding(activeBinding.service_id)} className={cn("shrink-0", themeClassNames.button.dangerInline)}>
              解绑服务
            </button>
          </div>
          <div className="p-3">
            <McpToolPermissionPanel binding={activeBinding} service={activeService} onChange={(toolIds) => updateToolIds(activeBinding.service_id, toolIds)} />
          </div>
        </section>
      )}
    </div>
  )
}

export function McpServiceLibraryPanel({
  services,
  bindings,
  activeServiceId,
  onActiveServiceChange,
  onAdd,
}: {
  services: McpServiceSummary[]
  bindings: McpToolBinding[]
  activeServiceId: string | null
  onActiveServiceChange: (serviceId: string | null) => void
  onAdd: (bindings: McpToolBinding[]) => void
}) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState("")
  const [bindingFilter, setBindingFilter] = useState<BindingFilter>("all")
  const [pendingServiceIds, setPendingServiceIds] = useState<Set<string>>(() => new Set())
  const pendingServiceIdsRef = useRef(new Set<string>())
  const bindingMap = useMemo(() => new Map(bindings.map((binding) => [binding.service_id, binding])), [bindings])
  const filtered = useMemo(
    () =>
      services
        .filter((service) => {
          const bound = bindingMap.has(service.service_id)
          if (bindingFilter === "bound") return bound
          if (bindingFilter === "unbound") return !bound
          return true
        })
        .filter((service) => matchesQuery([service.name, service.service_id, service.group, service.description ?? ""], query))
        .sort((left, right) => left.group.localeCompare(right.group) || left.name.localeCompare(right.name)),
    [bindingFilter, bindingMap, query, services],
  )
  const groups = useMemo(() => groupMcpServices(filtered), [filtered])

  function beginAddingServices(candidateServices: McpServiceSummary[]) {
    const servicesToAdd = candidateServices.filter((service) => !bindingMap.has(service.service_id) && !pendingServiceIdsRef.current.has(service.service_id))
    if (servicesToAdd.length === 0) return servicesToAdd
    servicesToAdd.forEach((service) => pendingServiceIdsRef.current.add(service.service_id))
    setPendingServiceIds(new Set(pendingServiceIdsRef.current))
    return servicesToAdd
  }

  function finishAddingServices(addedServices: McpServiceSummary[]) {
    addedServices.forEach((service) => pendingServiceIdsRef.current.delete(service.service_id))
    setPendingServiceIds(new Set(pendingServiceIdsRef.current))
  }

  async function createDefaultBinding(service: McpServiceSummary): Promise<McpToolBinding> {
    if (!service.connected) return { service_id: service.service_id, tool_ids: [] }
    try {
      const tools = await queryClient.fetchQuery(mcpToolsQueryOptions(service.service_id))
      return { service_id: service.service_id, tool_ids: uniqueStrings(tools.map((tool) => tool.name)) }
    } catch {
      return { service_id: service.service_id, tool_ids: [] }
    }
  }

  async function selectService(service: McpServiceSummary) {
    if (bindingMap.has(service.service_id)) {
      onActiveServiceChange(service.service_id)
      return
    }
    const [serviceToAdd] = beginAddingServices([service])
    if (!serviceToAdd) return
    try {
      const newBinding = await createDefaultBinding(serviceToAdd)
      onAdd([newBinding])
      onActiveServiceChange(serviceToAdd.service_id)
    } finally {
      finishAddingServices([serviceToAdd])
    }
  }

  async function selectGroup(groupServices: McpServiceSummary[]) {
    const servicesToAdd = beginAddingServices(groupServices)
    if (servicesToAdd.length === 0) return
    try {
      const newBindings = await Promise.all(servicesToAdd.map(createDefaultBinding))
      onAdd(newBindings)
      onActiveServiceChange(newBindings[0].service_id)
    } finally {
      finishAddingServices(servicesToAdd)
    }
  }

  return (
    <aside className={cn(themeClassNames.layout.resourceSidebar, "px-3 py-4")}>
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="text-xs font-medium text-app-muted">MCP 服务</div>
        <div className="font-mono text-[11px] text-app-muted">{bindings.length}/{services.length}</div>
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索服务..." className={inputClassName("h-8 text-xs")} />
      <div className={cn("mt-2 grid grid-cols-3 gap-1", themeClassNames.resource.filterBar)}>
        <FilterButton active={bindingFilter === "all"} onClick={() => setBindingFilter("all")}>全部</FilterButton>
        <FilterButton active={bindingFilter === "unbound"} onClick={() => setBindingFilter("unbound")}>未绑定</FilterButton>
        <FilterButton active={bindingFilter === "bound"} onClick={() => setBindingFilter("bound")}>已绑定</FilterButton>
      </div>
      <div className="mt-3 space-y-2">
        {filtered.length === 0 && <div className={themeClassNames.resource.empty}>没有匹配的 MCP 服务</div>}
        {groups.map((group) => (
          <McpGroupSection
            key={group.name}
            name={group.name}
            totalCount={group.services.length}
            selectedCount={group.services.filter((service) => bindingMap.has(service.service_id)).length}
            pendingCount={group.services.filter((service) => pendingServiceIds.has(service.service_id)).length}
            onSelectAll={() => void selectGroup(group.services)}
          >
            {group.services.map((service) => {
              const binding = bindingMap.get(service.service_id)
              const bound = Boolean(binding)
              const pending = pendingServiceIds.has(service.service_id)
              const active = activeServiceId === service.service_id
              return (
                <button
                  key={service.service_id}
                  type="button"
                  onClick={() => void selectService(service)}
                  disabled={pending}
                  aria-busy={pending}
                  className={cn(
                    themeClassNames.resource.card,
                    "px-2.5 py-2 disabled:cursor-wait disabled:opacity-70",
                    active ? themeClassNames.resource.cardActive : bound && themeClassNames.resource.cardBound,
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium text-app-primary">{service.name}</div>
                      {bound && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <McpBadge>{`已授权 ${binding?.tool_ids.length ?? 0}`}</McpBadge>
                        </div>
                      )}
                    </div>
                    <span className={cn("shrink-0", bound ? themeClassNames.badge.selected : themeClassNames.badge.neutral)}>{pending ? "读取中" : bound ? "配置" : "绑定"}</span>
                  </div>
                  <div className="mt-1 truncate font-mono text-[11px] text-app-muted">{service.service_id}</div>
                  {service.description && <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-app-muted">{service.description}</div>}
                </button>
              )
            })}
          </McpGroupSection>
        ))}
      </div>
    </aside>
  )
}

function McpToolPermissionPanel({ binding, service, onChange }: { binding: McpToolBinding; service?: McpServiceSummary; onChange: (toolIds: string[]) => void }) {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ToolStatusFilter>("all")
  const toolsQuery = useQuery({
    ...mcpToolsQueryOptions(binding.service_id),
    enabled: Boolean(service?.connected),
  })
  const tools = toolsQuery.data ?? []
  const selected = useMemo(() => new Set(binding.tool_ids), [binding.tool_ids])
  const knownToolNames = useMemo(() => new Set(tools.map((tool) => tool.name)), [tools])
  const unknownSelectedToolIds = useMemo(() => binding.tool_ids.filter((toolId) => !knownToolNames.has(toolId)), [binding.tool_ids, knownToolNames])
  const filtered = useMemo(() => filterMcpTools(tools, selected, query, statusFilter), [query, selected, statusFilter, tools])

  if (!service?.connected || toolsQuery.isError || tools.length === 0) {
    return <ManualMcpToolIdsField value={binding.tool_ids} onChange={onChange} />
  }

  function toggleTool(toolName: string) {
    onChange(toggleId(binding.tool_ids, toolName))
  }

  function selectAllKnownTools() {
    onChange(uniqueStrings([...unknownSelectedToolIds, ...tools.map((tool) => tool.name)]))
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-app-muted">
          已授权 <span className="font-mono text-app-primary">{binding.tool_ids.length}</span>/<span className="font-mono">{tools.length}</span>
          {unknownSelectedToolIds.length > 0 && <span className={themeClassNames.state.warningText}>  {unknownSelectedToolIds.length} 个未在当前列表中</span>}
        </div>
        <div className="flex gap-1.5">
          <button type="button" onClick={selectAllKnownTools} className="rounded bg-app-surface/70 px-2 py-1 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">全选</button>
          <button type="button" onClick={() => onChange([])} className={themeClassNames.button.dangerInline}>清空</button>
        </div>
      </div>
      <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_12rem]">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工具..." className={inputClassName("h-8 text-xs")} />
        <div className={cn("grid grid-cols-3 gap-1", themeClassNames.resource.filterBar)}>
          <FilterButton active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>全部</FilterButton>
          <FilterButton active={statusFilter === "unselected"} onClick={() => setStatusFilter("unselected")}>未选</FilterButton>
          <FilterButton active={statusFilter === "selected"} onClick={() => setStatusFilter("selected")}>已选</FilterButton>
        </div>
      </div>
      {unknownSelectedToolIds.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded border border-app-warning-border bg-app-warning-surface px-2 py-2">
          {unknownSelectedToolIds.map((toolId) => (
            <button key={toolId} type="button" onClick={() => onChange(binding.tool_ids.filter((id) => id !== toolId))} className="rounded bg-app-warning-surface px-2 py-0.5 font-mono text-[11px] text-app-warning hover:border-app-warning">
              {toolId} 
            </button>
          ))}
        </div>
      )}
      <div className="grid grid-cols-1 gap-1.5 xl:grid-cols-2">
        {filtered.length === 0 && <div className={cn(themeClassNames.resource.empty, "xl:col-span-2")}>没有匹配的工具</div>}
        {filtered.map((tool) => {
          const active = selected.has(tool.name)
          return (
            <button
              key={tool.name}
              type="button"
              onClick={() => toggleTool(tool.name)}
              className={cn(
                themeClassNames.resource.card,
                "px-2.5 py-2",
                active && themeClassNames.resource.cardActive,
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 truncate font-mono text-xs text-app-primary">{tool.name}</div>
                <span className={cn("shrink-0", active ? themeClassNames.badge.selected : themeClassNames.badge.neutral)}>{active ? "已选" : "添加"}</span>
              </div>
              {tool.description && <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-app-muted">{tool.description}</div>}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ManualMcpToolIdsField({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  const [text, setText] = useState(value.join(", "))

  useEffect(() => {
    setText(value.join(", "))
  }, [value])

  return (
    <div className="space-y-2">
      <div className={themeClassNames.state.warningAlert}>
        暂时无法读取可选工具列表，请手动填写允许的 Tool IDs。
      </div>
      <textarea
        value={text}
        onChange={(event) => {
          setText(event.target.value)
          onChange(parseIdList(event.target.value))
        }}
        rows={5}
        placeholder="tool_a, tool_b"
        className={inputClassName("min-h-24 font-mono leading-relaxed")}
      />
    </div>
  )
}

function filterMcpTools(tools: McpToolSummary2[], selected: Set<string>, query: string, statusFilter: ToolStatusFilter) {
  return tools
    .filter((tool) => {
      if (statusFilter === "selected") return selected.has(tool.name)
      if (statusFilter === "unselected") return !selected.has(tool.name)
      return true
    })
    .filter((tool) => matchesQuery([tool.name, tool.description ?? ""], query))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function groupMcpServices(services: McpServiceSummary[]) {
  const groupMap = new Map<string, McpServiceSummary[]>()
  services.forEach((service) => {
    groupMap.set(service.group, [...(groupMap.get(service.group) ?? []), service])
  })
  return Array.from(groupMap.entries()).map(([name, groupServices]) => ({ name, services: groupServices }))
}

function ConnectionBadge({ service }: { service?: McpServiceSummary }) {
  if (!service) return <McpBadge tone="warning">未知</McpBadge>
  if (!service.enabled) return <McpBadge tone="warning">已禁用</McpBadge>
  if (service.connected) return <McpBadge tone="success">已连接</McpBadge>
  return <McpBadge tone="warning">未连接</McpBadge>
}

function FilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded px-2 py-1 text-xs transition", active ? themeClassNames.resource.filterButtonActive : themeClassNames.resource.filterButtonInactive)}>
      {children}
    </button>
  )
}

function McpGroupSection({ name, totalCount, selectedCount, pendingCount, onSelectAll, children }: { name: string; totalCount: number; selectedCount: number; pendingCount: number; onSelectAll: () => void; children: ReactNode }) {
  const allSelected = totalCount > 0 && selectedCount >= totalCount
  const adding = pendingCount > 0
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
        <button type="button" onClick={onSelectAll} disabled={allSelected || adding} className={cn("shrink-0", allSelected || adding ? "rounded px-2 py-0.5 text-[11px] text-app-subtle" : themeClassNames.button.accentLink)}>
          {adding ? `读取中 ${pendingCount}` : allSelected ? "已全选" : "全选"}
        </button>
      </div>
      {!collapsed && <div className={themeClassNames.resource.groupList}>{children}</div>}
    </section>
  )
}

function McpBadge({ children, tone = "default" }: { children: ReactNode; tone?: "default" | "success" | "warning" }) {
  const className = tone === "success" ? themeClassNames.badge.success : tone === "warning" ? themeClassNames.badge.warning : themeClassNames.badge.neutral
  return <span className={className}>{children}</span>
}

function mcpToolsQueryOptions(serviceId: string) {
  return {
    queryKey: ["mcp-tools", serviceId] as const,
    queryFn: () => listMcpTools(serviceId),
    retry: false,
  }
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
}

function parseIdList(value: string) {
  return uniqueStrings(value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean))
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function inputClassName(extra = "") {
  return cn("w-full px-3 py-1.5 text-sm", themeClassNames.form.input, extra)
}
