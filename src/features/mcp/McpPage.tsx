import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, Trash2 } from "lucide-react"

import {
  addMcpService,
  connectMcpService,
  deleteMcpService,
  disableMcpService,
  enableMcpService,
  getMcpService,
  getMcpToolDetail,
  inspectMcpService,
  listMcpServices,
  listMcpTools,
  updateMcpService,
  type McpServiceDetail,
  type McpServiceSummary,
} from "@/features/studio/studioApi"
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
import { useAppConfirm, useAppNotification } from "@/shared/interaction/AppInteractionProvider"

type ViewMode = { kind: "list" } | { kind: "detail"; serviceId: string } | { kind: "add" } | { kind: "edit"; serviceId: string }

export function McpPage() {
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const deleteServiceClaimRef = useRef<string | null>(null)
  const interactionOwnerMountedRef = useRef(true)
  useEffect(() => {
    interactionOwnerMountedRef.current = true
    return () => {
      interactionOwnerMountedRef.current = false
    }
  }, [])
  const { data, isLoading, error } = useQuery({ queryKey: ["mcp"], queryFn: listMcpServices })
  const services = data ?? []
  const [view, setView] = useState<ViewMode>({ kind: "list" })
  const [search, setSearch] = useState("")
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [activeFacet, setActiveFacet] = useState<string | null>(null)
  const qc = useQueryClient()

  const groupOptions = useMemo(() => filterOptionsFromCounts(countBy(services, (service) => service.group || "default"), services.length), [services])
  const facetOptions = useMemo(() => {
    const transports = [...new Set(services.map((service) => service.transport_type).filter(Boolean))].sort()
    return [
      { value: "__all", label: "全部状态", count: services.length },
      { value: "enabled", label: "已启用", count: services.filter((service) => service.enabled).length },
      { value: "disabled", label: "已禁用", count: services.filter((service) => !service.enabled).length },
      { value: "connected", label: "已连接", count: services.filter((service) => service.connected).length },
      { value: "disconnected", label: "未连接", count: services.filter((service) => !service.connected).length },
      ...transports.map((transport) => ({
        value: `transport:${transport}`,
        label: transport,
        count: services.filter((service) => service.transport_type === transport).length,
      })),
    ]
  }, [services])

  const filtered = useMemo(
    () =>
      services.filter((service) => {
        const group = service.group || "default"
        if (activeGroup && group !== activeGroup) return false
        if (activeFacet === "enabled" && !service.enabled) return false
        if (activeFacet === "disabled" && service.enabled) return false
        if (activeFacet === "connected" && !service.connected) return false
        if (activeFacet === "disconnected" && service.connected) return false
        if (activeFacet?.startsWith("transport:") && service.transport_type !== activeFacet.slice("transport:".length)) return false
        return matchesQuery(
          [service.service_id, service.name, service.description, service.group, service.transport_type, service.enabled ? "启用 enabled" : "禁用 disabled", service.connected ? "连接 connected" : "未连接 disconnected"],
          search,
        )
      }),
    [activeFacet, activeGroup, search, services],
  )

  const enableMut = useMutation({ mutationFn: enableMcpService, onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp"] }) })
  const disableMut = useMutation({ mutationFn: disableMcpService, onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp"] }) })
  const connectMut = useMutation({ mutationFn: connectMcpService, onSuccess: () => qc.invalidateQueries({ queryKey: ["mcp"] }) })
  const deleteMut = useMutation({
    mutationFn: deleteMcpService,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp"] })
      setView({ kind: "list" })
    },
    onSettled: (_data, _error, serviceId) => {
      if (deleteServiceClaimRef.current === serviceId) deleteServiceClaimRef.current = null
    },
  })
  const mcpInteractionStateRef = useRef({ view, services, deletePending: deleteMut.isPending })
  mcpInteractionStateRef.current = { view, services, deletePending: deleteMut.isPending }

  const requestDeleteService = async (serviceId: string) => {
    const current = mcpInteractionStateRef.current
    const service = current.services.find((item) => item.service_id === serviceId)
    const target = {
      resource: "mcp-service" as const,
      id: serviceId,
      displayName: service?.name?.trim() || serviceId,
      deletable: current.view.kind === "detail" && current.view.serviceId === serviceId && Boolean(service),
    }
    if (!target.deletable || deleteMut.isPending || deleteServiceClaimRef.current !== null) return
    deleteServiceClaimRef.current = target.id
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除 MCP 服务",
        description: `确认删除 MCP 服务「${target.displayName}」？`,
        confirmLabel: "删除服务",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = mcpInteractionStateRef.current
      const latestService = latest.services.find((item) => item.service_id === target.id)
      if (
        !interactionOwnerMountedRef.current
        || latest.view.kind !== "detail"
        || latest.view.serviceId !== target.id
        || latest.deletePending
        || !latestService
      ) {
        notify({
          title: "未删除 MCP 服务",
          message: "确认期间目标服务、当前详情或删除任务状态已变化，请重新操作。",
          tone: "warning",
        })
        return
      }
      deleteMut.mutate(target.id)
      mutationStarted = true
    } finally {
      if (!mutationStarted && deleteServiceClaimRef.current === target.id) deleteServiceClaimRef.current = null
    }
  }

  if (view.kind !== "list") {
    const selectedId = view.kind === "detail" || view.kind === "edit" ? view.serviceId : "__add"
    const compactItems = selectedId !== "__add" && filtered.some((service) => service.service_id === selectedId) ? filtered : services
    return (
      <AdaptiveResourceLayout
        list={
          <GroupedCompactResourceList
            items={compactItems}
            selectedKey={selectedId}
            onSelect={(service) => setView({ kind: "detail", serviceId: service.service_id })}
            getKey={(service) => service.service_id}
            getTitle={(service) => service.name}
            getGroup={(service) => service.group || "default"}
            onBack={() => setView({ kind: "list" })}
          />
        }
        detail={
          view.kind === "detail" ? (
            <McpDetailStage
              serviceId={view.serviceId}
              onEdit={() => setView({ kind: "edit", serviceId: view.serviceId })}
              onDelete={() => {
                void requestDeleteService(view.serviceId)
              }}
            />
          ) : (
            <McpServiceForm
              mode={view.kind === "add" ? "add" : "edit"}
              serviceId={view.kind === "edit" ? view.serviceId : undefined}
              onClose={() => (view.kind === "edit" ? setView({ kind: "detail", serviceId: view.serviceId }) : setView({ kind: "list" }))}
              onSaved={(id) => setView({ kind: "detail", serviceId: id })}
            />
          )
        }
      />
    )
  }

  return (
    <ResourceManagementLayout
      count={services.length}
      action={
        <button
          type="button"
          onClick={() => setView({ kind: "add" })}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500"
        >
          <Plus size={13} />
          新增
        </button>
      }
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="搜索 MCP 名称 / Service ID / 描述 / 分组..."
      primaryFilters={groupOptions}
      activePrimary={activeGroup}
      onPrimaryChange={setActiveGroup}
      secondaryFilters={facetOptions}
      activeSecondary={activeFacet}
      onSecondaryChange={setActiveFacet}
    >
      <StatusText isLoading={isLoading} error={error} empty={!isLoading && !error && filtered.length === 0} />
      <ResourceGrid>
        {filtered.map((service) => (
          <McpServiceCard
            key={service.service_id}
            service={service}
            onSelect={() => setView({ kind: "detail", serviceId: service.service_id })}
            onToggle={() => (service.enabled ? disableMut.mutate(service.service_id) : enableMut.mutate(service.service_id))}
            onConnect={() => connectMut.mutate(service.service_id)}
          />
        ))}
      </ResourceGrid>
    </ResourceManagementLayout>
  )
}

function McpServiceCard({ service, onSelect, onToggle, onConnect }: { service: McpServiceSummary; onSelect: () => void; onToggle: () => void; onConnect: () => void }) {
  return (
    <ResourceCard
      title={service.name}
      identifier={service.service_id}
      description={service.description}
      onClick={onSelect}
      actions={
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onToggle()
          }}
          className={[
            "rounded px-2 py-0.5 text-xs font-medium transition",
            service.enabled ? "bg-green-500/20 text-green-400 hover:bg-green-500/30" : "bg-slate-500/20 text-app-secondary hover:bg-slate-500/30",
          ].join(" ")}
        >
          {service.enabled ? "已启用" : "已禁用"}
        </button>
      }
      badges={
        <>
          <span>{service.group || "default"}</span>
          <span className="font-mono">{service.transport_type}</span>
          <span className={service.connected ? "text-emerald-400" : "text-app-muted"}>{service.connected ? "已连接" : "未连接"}</span>
          {!service.connected && service.enabled && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onConnect()
              }}
              className="text-blue-400 hover:text-blue-300"
            >
              连接
            </button>
          )}
        </>
      }
    />
  )
}

function McpDetailStage({ serviceId, onEdit, onDelete }: { serviceId: string; onEdit: () => void; onDelete: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["mcp-detail", serviceId], queryFn: () => getMcpService(serviceId) })
  const { data: serverInfo } = useQuery({ queryKey: ["mcp-inspect", serviceId], queryFn: () => inspectMcpService(serviceId), enabled: !!data?.connected })
  const { data: tools } = useQuery({ queryKey: ["mcp-tools", serviceId], queryFn: () => listMcpTools(serviceId), enabled: !!data?.connected })

  return (
    <DetailLayout
      title={data?.name ?? serviceId}
      titleMeta={data ? <McpDetailBadges data={data} /> : undefined}
      actions={
        <>
          <button type="button" onClick={onEdit} className="rounded px-2 py-1 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">
            编辑
          </button>
          <button type="button" onClick={onDelete} className="rounded px-2 py-1 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300">
            <Trash2 size={14} />
          </button>
        </>
      }
    >
      <StatusText isLoading={isLoading} error={error} empty={false} />
      {data && <McpDetailContent data={data} serverInfo={serverInfo} tools={tools} />}
    </DetailLayout>
  )
}

function McpDetailContent({ data, serverInfo, tools }: { data: McpServiceDetail; serverInfo?: Awaited<ReturnType<typeof inspectMcpService>>; tools?: Awaited<ReturnType<typeof listMcpTools>> }) {
  return (
    <div className="space-y-5 pb-8">
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-app-border/80 bg-app-surface/70 p-5 text-sm lg:grid-cols-2">
        <Field label="Service ID">{data.service_id}</Field>
        <Field label="分组">{data.group}</Field>
        {data.description && <Field label="描述">{data.description}</Field>}
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-app-muted">Transport</div>
        <pre className="overflow-auto rounded border border-app-border/80 bg-app-surface-muted p-3 font-mono text-xs leading-relaxed text-app-secondary">{JSON.stringify(data.transport, null, 2)}</pre>
      </div>
      {data.usage_guide && (
        <div>
          <div className="mb-1 text-xs font-medium text-app-muted">Usage Guide</div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-app-secondary">{data.usage_guide}</div>
        </div>
      )}
      {data.connected && (
        <div className="border-t border-app-border/80 pt-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-app-secondary">服务端信息</h3>
          {serverInfo && (
            <div className="mb-4 space-y-2">
              <div className="text-xs text-app-secondary"><span className="text-app-muted">Server </span>{serverInfo.server_name} v{serverInfo.server_version}</div>
              <div className="flex items-center gap-3 text-xs">
                <Badge tone={serverInfo.supports_tools ? "green" : "slate"}>Tools {serverInfo.supports_tools ? "✓" : "✗"}</Badge>
                <Badge tone={serverInfo.supports_resources ? "green" : "slate"}>Resources {serverInfo.supports_resources ? "✓" : "✗"}</Badge>
              </div>
              {serverInfo.instructions && <div className="whitespace-pre-wrap text-xs leading-relaxed text-app-secondary">{serverInfo.instructions}</div>}
            </div>
          )}
          {tools && tools.length > 0 && <McpToolList serviceId={data.service_id} tools={tools} />}
        </div>
      )}
    </div>
  )
}

function McpDetailBadges({ data }: { data: McpServiceDetail }) {
  const transportType = typeof data.transport.type === "string" ? data.transport.type : null
  return (
    <>
      <Badge tone={data.enabled ? "green" : "slate"}>{data.enabled ? "已启用" : "已禁用"}</Badge>
      <Badge tone={data.connected ? "green" : "amber"}>{data.connected ? "已连接" : "未连接"}</Badge>
      {transportType && <span className="rounded-full border border-app-border/80 bg-app-surface/80 px-2 py-0.5 font-mono text-xs text-app-secondary">{transportType}</span>}
      {!data.connected && data.enabled && <ConnectButton serviceId={data.service_id} />}
    </>
  )
}

function McpToolList({ serviceId, tools }: { serviceId: string; tools: Awaited<ReturnType<typeof listMcpTools>> }) {
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null)
  const selectedTool = selectedToolName ? tools.find((tool) => tool.name === selectedToolName) : undefined
  const detailQuery = useQuery({
    queryKey: ["mcp-tool-detail", serviceId, selectedToolName],
    queryFn: () => getMcpToolDetail(serviceId, [selectedToolName!]),
    enabled: !!selectedToolName,
  })
  const toolDetail = detailQuery.data?.[0]

  useEffect(() => {
    if (selectedToolName && !selectedTool) setSelectedToolName(null)
  }, [selectedTool, selectedToolName])

  useEffect(() => {
    if (!selectedToolName) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedToolName(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [selectedToolName])

  return (
    <div>
      <div className="mb-2 text-xs font-medium text-app-muted">工具 ({tools.length})</div>
      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {tools.map((tool) => {
          const selected = tool.name === selectedToolName
          return (
            <button
              key={tool.name}
              type="button"
              onClick={() => setSelectedToolName(tool.name)}
              className={[
                "rounded border px-2.5 py-1.5 text-left transition",
                selected ? "border-blue-400/30 bg-blue-500/10" : "border-app-border/60 bg-app-surface/70 hover:border-app-border/80 hover:bg-app-surface/85",
              ].join(" ")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate font-mono text-xs font-medium text-app-primary">{tool.name}</span>
                <span className="shrink-0 text-[10px] text-slate-600">Schema</span>
              </div>
              {tool.description && <div className="mt-0.5 text-xs text-app-muted">{tool.description}</div>}
            </button>
          )
        })}
      </div>
      {selectedToolName && (
        <div className="fixed bottom-6 right-0 top-9 z-40 flex w-[min(560px,calc(100vw-3rem))] min-w-[min(420px,calc(100vw-3rem))] flex-col border-l border-app-border/80 bg-app-shell shadow-2xl shadow-slate-900/16">
          <div className="flex items-start justify-between gap-3 border-b border-app-border/80 px-4 py-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wider text-app-muted">MCP Tool Schema</div>
              <div className="mt-1 truncate font-mono text-sm font-semibold text-app-primary">{selectedToolName}</div>
              {(toolDetail?.description || selectedTool?.description) && <div className="mt-1 text-xs leading-relaxed text-app-muted">{toolDetail?.description ?? selectedTool?.description}</div>}
            </div>
            <button type="button" onClick={() => setSelectedToolName(null)} className="shrink-0 rounded px-2 py-1 text-xs text-app-muted hover:bg-app-selected hover:text-app-secondary">
              关闭
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <StatusText isLoading={detailQuery.isLoading} error={detailQuery.error} empty={!detailQuery.isLoading && !detailQuery.error && !toolDetail} />
            {toolDetail && <pre className="min-h-full overflow-auto rounded border border-app-border/80 bg-app-surface-muted p-3 font-mono text-xs leading-relaxed text-app-secondary">{JSON.stringify(toolDetail.input_schema, null, 2)}</pre>}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-app-muted">{label}</div>
      <div className="break-words text-sm text-app-secondary">{children}</div>
    </div>
  )
}

function ConnectButton({ serviceId }: { serviceId: string }) {
  const qc = useQueryClient()
  const mut = useMutation({
    mutationFn: connectMcpService,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp"] })
      qc.invalidateQueries({ queryKey: ["mcp-detail", serviceId] })
    },
  })
  return (
    <button type="button" onClick={() => mut.mutate(serviceId)} disabled={mut.isPending} className="rounded bg-blue-600/20 px-2 py-0.5 text-xs font-medium text-blue-400 hover:bg-blue-600/30 disabled:opacity-50">
      {mut.isPending ? "连接中" : mut.isError ? "连接失败，重试" : "连接"}
    </button>
  )
}

function McpServiceForm({ mode, serviceId, onClose, onSaved }: { mode: "add" | "edit"; serviceId?: string; onClose: () => void; onSaved: (id: string) => void }) {
  const qc = useQueryClient()
  const { data: existing } = useQuery({ queryKey: ["mcp-detail", serviceId], queryFn: () => getMcpService(serviceId!), enabled: mode === "edit" && !!serviceId })
  const [formId, setFormId] = useState("")
  const [formName, setFormName] = useState("")
  const [formDesc, setFormDesc] = useState("")
  const [formGroup, setFormGroup] = useState("default")
  const [formTransport, setFormTransport] = useState(STDIO_TEMPLATE)
  const [formGuide, setFormGuide] = useState("")
  const [errMsg, setErrMsg] = useState("")

  useEffect(() => {
    if (mode !== "edit" || !existing) return
    setFormId(existing.service_id)
    setFormName(existing.name)
    setFormDesc(existing.description ?? "")
    setFormGroup(existing.group)
    setFormTransport(JSON.stringify(existing.transport, null, 2))
    setFormGuide(existing.usage_guide ?? "")
  }, [existing, mode])

  const addMut = useMutation({
    mutationFn: addMcpService,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp"] })
      onSaved(formId)
    },
    onError: (error: Error) => setErrMsg(error.message || "添加失败"),
  })
  const updateMut = useMutation({
    mutationFn: (body: Parameters<typeof updateMcpService>[1]) => updateMcpService(serviceId!, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["mcp"] })
      qc.invalidateQueries({ queryKey: ["mcp-detail", serviceId] })
      onSaved(serviceId!)
    },
    onError: (error: Error) => setErrMsg(error.message || "更新失败"),
  })

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setErrMsg("")
    let transport: Record<string, unknown>
    try {
      transport = JSON.parse(formTransport)
    } catch {
      setErrMsg("Transport JSON 格式错误")
      return
    }
    if (mode === "add") {
      if (!formId.trim()) { setErrMsg("Service ID 不能为空"); return }
      if (!formName.trim()) { setErrMsg("名称不能为空"); return }
      addMut.mutate({ service_id: formId.trim(), name: formName.trim(), transport, description: formDesc.trim() || undefined, group: formGroup.trim() || "default", usage_guide: formGuide.trim() || undefined })
      return
    }
    const body: Parameters<typeof updateMcpService>[1] = { transport }
    if (formName.trim() !== existing?.name) body.name = formName.trim()
    if ((formDesc.trim() || null) !== existing?.description) body.description = formDesc.trim() || null
    if (formGroup.trim() !== existing?.group) body.group = formGroup.trim() || "default"
    if (formGuide.trim() !== (existing?.usage_guide ?? "")) body.usage_guide = formGuide.trim() || null
    updateMut.mutate(body)
  }

  const saving = addMut.isPending || updateMut.isPending

  return (
    <form onSubmit={handleSubmit} className="flex min-h-full flex-col px-6 py-5">
      <div className="mb-5 flex items-center justify-between">
        <h2 className="text-base font-semibold text-app-primary">{mode === "add" ? "新增 MCP 服务" : "编辑 MCP 服务"}</h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">取消</button>
          <button type="submit" disabled={saving} className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-50">{saving ? "保存中" : "保存"}</button>
        </div>
      </div>
      <div className="flex-1 space-y-4 overflow-auto">
        {mode === "add" && <FormField label="Service ID"><input value={formId} onChange={(event) => setFormId(event.target.value)} placeholder="my-mcp-service" className="w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-1.5 font-mono text-sm text-app-primary outline-none focus:border-blue-500" /></FormField>}
        <FormField label="名称"><input value={formName} onChange={(event) => setFormName(event.target.value)} placeholder="服务显示名称" className="w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-1.5 text-sm text-app-primary outline-none focus:border-blue-500" /></FormField>
        <FormField label="描述"><input value={formDesc} onChange={(event) => setFormDesc(event.target.value)} placeholder="可选" className="w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-1.5 text-sm text-app-primary outline-none focus:border-blue-500" /></FormField>
        <FormField label="分组"><input value={formGroup} onChange={(event) => setFormGroup(event.target.value)} placeholder="default" className="w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-1.5 text-sm text-app-primary outline-none focus:border-blue-500" /></FormField>
        <FormField label="Transport (JSON)">
          <div className="mb-1.5 flex gap-1">
            {(["stdio", "streamable-http"] as const).map((type) => <button key={type} type="button" onClick={() => setFormTransport(type === "stdio" ? STDIO_TEMPLATE : HTTP_TEMPLATE)} className="rounded bg-app-surface/70 px-2 py-0.5 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">{type} 模板</button>)}
          </div>
          <textarea value={formTransport} onChange={(event) => setFormTransport(event.target.value)} rows={10} className="w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-2 font-mono text-xs leading-relaxed text-app-primary outline-none focus:border-blue-500" />
        </FormField>
        <FormField label="Usage Guide"><textarea value={formGuide} onChange={(event) => setFormGuide(event.target.value)} rows={4} placeholder="可选，MCP 服务使用指南" className="w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-2 text-sm leading-relaxed text-app-primary outline-none focus:border-blue-500" /></FormField>
      </div>
      {errMsg && <div className="mt-3 text-xs text-red-400">{errMsg}</div>}
    </form>
  )
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="mb-1 block text-xs font-medium text-app-muted">{label}</label>{children}</div>
}

const STDIO_TEMPLATE = JSON.stringify({ type: "stdio", command: "", args: [], env: {} }, null, 2)
const HTTP_TEMPLATE = JSON.stringify({ type: "streamable-http", url: "", headers: {} }, null, 2)
