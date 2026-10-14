import { useMemo, useState, type ReactNode } from "react"

import type { ToolSummary } from "@/features/studio/studioApi"
import { matchesQuery } from "@/shared/components/ResourceManagement"
import { cn, themeClassNames } from "@/shared/theme/classes"

type ToolStatusFilter = "all" | "selected" | "unselected"

type ToolGroup = {
  name: string
  ids: string[]
}

export function SelectedToolsPanel({ selectedToolIds, tools, onChange }: { selectedToolIds: string[]; tools: ToolSummary[]; onChange: (toolIds: string[]) => void }) {
  const toolMap = useMemo(() => new Map(tools.map((tool) => [tool.tool_name, tool])), [tools])
  const groups = useMemo(() => groupSelectedToolIds(selectedToolIds, toolMap), [selectedToolIds, toolMap])
  const knownSelectedCount = selectedToolIds.filter((toolId) => toolMap.has(toolId)).length
  const alwaysEnabledCount = selectedToolIds.filter((toolId) => toolMap.get(toolId)?.always_enabled).length

  function removeTool(toolId: string) {
    onChange(selectedToolIds.filter((id) => id !== toolId))
  }

  if (selectedToolIds.length === 0) {
    return <div className={themeClassNames.resource.empty}>未授权本地工具，可从右侧工具库按分组添加。</div>
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-app-border/80 bg-app-surface/70 px-3 py-2">
        <div className="text-xs text-app-secondary">
          已授权 <span className="font-mono text-app-primary">{selectedToolIds.length}</span> 个 · {groups.length} 个分组
          {alwaysEnabledCount > 0 && <span className="text-app-muted"> · {alwaysEnabledCount} 个始终可用</span>}
          {knownSelectedCount !== selectedToolIds.length && <span className={themeClassNames.state.warningText}> · {selectedToolIds.length - knownSelectedCount} 个未在库中</span>}
        </div>
        <button type="button" onClick={() => onChange([])} className={themeClassNames.button.dangerInline}>
          清空
        </button>
      </div>
      <div className="space-y-2">
        {groups.map((group) => (
          <section key={group.name} className="rounded-lg border border-app-border/80 bg-app-surface-muted/80">
            <div className="flex items-center justify-between border-b border-app-border/80 px-3 py-2">
              <div className="min-w-0 truncate text-xs font-medium text-app-secondary">{group.name}</div>
              <div className="font-mono text-[11px] text-app-muted">{group.ids.length}</div>
            </div>
            <div className="divide-y divide-app-border/80">
              {group.ids.map((toolId) => {
                const tool = toolMap.get(toolId)
                return (
                  <div key={toolId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2">
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                        <span className="min-w-0 truncate font-mono text-xs text-app-primary">{tool?.tool_name ?? toolId}</span>
                        {tool && <ToolBadge>{categoryLabel(tool.category)}</ToolBadge>}
                        {tool?.always_enabled && <ToolBadge>始终可用</ToolBadge>}
                        {!tool && <ToolBadge tone="warning">未在库中</ToolBadge>}
                      </div>
                      {tool?.description && <div className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-app-muted">{tool.description}</div>}
                    </div>
                    <button type="button" onClick={() => removeTool(toolId)} className={cn("self-start", themeClassNames.button.dangerInline)}>
                      移除
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}

export function ToolLibraryPanel({ tools, selectedToolIds, onChange }: { tools: ToolSummary[]; selectedToolIds: string[]; onChange: (toolIds: string[]) => void }) {
  const [query, setQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<ToolStatusFilter>("all")
  const selected = useMemo(() => new Set(selectedToolIds), [selectedToolIds])
  const filtered = useMemo(
    () =>
      tools
        .filter((tool) => {
          if (statusFilter === "selected") return selected.has(tool.tool_name)
          if (statusFilter === "unselected") return !selected.has(tool.tool_name)
          return true
        })
        .filter((tool) => matchesQuery([tool.tool_name, tool.group, tool.category, tool.description, tool.wiki ?? "", tool.allowed_loop_decisions.join(" ")], query))
        .sort((left, right) => left.group.localeCompare(right.group) || left.tool_name.localeCompare(right.tool_name)),
    [query, selected, statusFilter, tools],
  )
  const groups = useMemo(() => groupTools(filtered), [filtered])

  function toggleTool(toolId: string) {
    onChange(toggleId(selectedToolIds, toolId))
  }

  function selectGroup(groupTools: ToolSummary[]) {
    onChange(uniqueStrings([...selectedToolIds, ...groupTools.map((tool) => tool.tool_name)]))
  }

  return (
    <aside className={cn(themeClassNames.layout.resourceSidebar, "px-3 py-4")}>
      <div className="mb-3 flex items-center justify-between gap-2 px-1">
        <div className="text-xs font-medium text-app-muted">本地工具库</div>
        <div className="font-mono text-[11px] text-app-muted">{selectedToolIds.length}/{tools.length}</div>
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索工具..." className={inputClassName("h-8 text-xs")} />
      <div className={cn("mt-2 grid grid-cols-3 gap-1", themeClassNames.resource.filterBar)}>
        <ToolFilterButton active={statusFilter === "all"} onClick={() => setStatusFilter("all")}>全部</ToolFilterButton>
        <ToolFilterButton active={statusFilter === "unselected"} onClick={() => setStatusFilter("unselected")}>未选</ToolFilterButton>
        <ToolFilterButton active={statusFilter === "selected"} onClick={() => setStatusFilter("selected")}>已选</ToolFilterButton>
      </div>
      <div className="mt-3 space-y-2">
        {filtered.length === 0 && <div className={themeClassNames.resource.empty}>没有匹配的工具</div>}
        {groups.map((group) => (
          <ToolGroupSection
            key={group.name}
            name={group.name}
            totalCount={group.tools.length}
            selectedCount={group.tools.filter((tool) => selected.has(tool.tool_name)).length}
            onSelectAll={() => selectGroup(group.tools)}
          >
            {group.tools.map((tool) => {
              const active = selected.has(tool.tool_name)
              return (
                <button
                  key={tool.tool_name}
                  type="button"
                  onClick={() => toggleTool(tool.tool_name)}
                  className={cn(
                    themeClassNames.resource.card,
                    "px-2.5 py-2",
                    active && themeClassNames.resource.cardActive,
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-mono text-xs text-app-primary">{tool.tool_name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <ToolBadge>{categoryLabel(tool.category)}</ToolBadge>
                        {tool.always_enabled && <ToolBadge>始终可用</ToolBadge>}
                      </div>
                    </div>
                    <span className={cn("shrink-0", active ? themeClassNames.badge.selected : themeClassNames.badge.neutral)}>{active ? "已选" : "添加"}</span>
                  </div>
                  {tool.description && <div className="mt-1.5 line-clamp-2 text-[11px] leading-relaxed text-app-muted">{tool.description}</div>}
                </button>
              )
            })}
          </ToolGroupSection>
        ))}
      </div>
    </aside>
  )
}

function groupSelectedToolIds(selectedToolIds: string[], toolMap: Map<string, ToolSummary>) {
  const groupMap = new Map<string, string[]>()
  selectedToolIds.forEach((toolId) => {
    const tool = toolMap.get(toolId)
    const groupName = tool?.group || "未在资源库中"
    groupMap.set(groupName, [...(groupMap.get(groupName) ?? []), toolId])
  })
  return Array.from(groupMap.entries()).map(([name, ids]) => ({ name, ids }))
}

function groupTools(tools: ToolSummary[]) {
  const groupMap = new Map<string, ToolSummary[]>()
  tools.forEach((tool) => {
    groupMap.set(tool.group, [...(groupMap.get(tool.group) ?? []), tool])
  })
  return Array.from(groupMap.entries()).map(([name, groupTools]) => ({ name, tools: groupTools }))
}

function toggleId(ids: string[], id: string) {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id]
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function categoryLabel(category: ToolSummary["category"]) {
  if (category === "lifecycle") return "生命周期"
  if (category === "system") return "系统"
  return "业务"
}

function ToolFilterButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className={cn("rounded px-2 py-1 text-xs transition", active ? themeClassNames.resource.filterButtonActive : themeClassNames.resource.filterButtonInactive)}>
      {children}
    </button>
  )
}

function ToolGroupSection({ name, totalCount, selectedCount, onSelectAll, children }: { name: string; totalCount: number; selectedCount: number; onSelectAll: () => void; children: ReactNode }) {
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
        <button type="button" onClick={onSelectAll} disabled={allSelected} className={cn("shrink-0", allSelected ? "rounded px-2 py-0.5 text-[11px] text-app-subtle" : themeClassNames.button.accentLink)}>
          {allSelected ? "已全选" : "全选"}
        </button>
      </div>
      {!collapsed && <div className={themeClassNames.resource.groupList}>{children}</div>}
    </section>
  )
}

function ToolBadge({ children, tone = "default" }: { children: string; tone?: "default" | "warning" }) {
  return <span className={tone === "warning" ? themeClassNames.badge.warning : themeClassNames.badge.neutral}>{children}</span>
}

function inputClassName(extra = "") {
  return cn("w-full px-3 py-1.5 text-sm", themeClassNames.form.input, extra)
}
