import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertCircle, FileText, Loader2, Pencil, RefreshCw, Save, XCircle } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useBlocker } from "react-router-dom"

import { useSceneUiStore } from "@/features/chat/model/sceneStore"
import {
  listWorkspaceMemory,
  readWorkspaceMemory,
  saveWorkspaceMemory,
  type WorkspaceMemoryEntry,
  type WorkspaceMemoryReadResponse,
  type WorkspaceMemorySaveResponse,
} from "@/features/memory/memoryApi"
import { useMemoryDraftGuardStore } from "@/features/memory/memoryDraftGuard"
import { listAgents, type AgentDefinition } from "@/features/studio/studioApi"
import {
  AdaptiveResourceLayout,
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
import { themeClassNames } from "@/shared/theme/classes"

type EditorMessage = { tone: "info" | "error"; text: string }

export function MemoryPage() {
  const queryClient = useQueryClient()
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const currentWorkspacePath = useSceneUiStore((state) => state.currentWorkspacePath)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [search, setSearch] = useState("")
  const [activeGroup, setActiveGroup] = useState<string | null>(null)
  const [draftContent, setDraftContent] = useState("")
  const [baselineContent, setBaselineContent] = useState("")
  const [baselineSha256, setBaselineSha256] = useState<string | null>(null)
  const [editorMessage, setEditorMessage] = useState<EditorMessage | null>(null)
  const [editing, setEditing] = useState(false)
  const setMemoryDraftDirty = useMemoryDraftGuardStore((state) => state.setDirty)
  const previousWorkspacePathRef = useRef<string | null>(currentWorkspacePath)
  const pendingMemoryActionRef = useRef<string | null>(null)
  const navigationConfirmationPendingRef = useRef(false)

  const memoryListQuery = useQuery({
    queryKey: ["workspace-memory", "list", currentWorkspacePath],
    queryFn: () => listWorkspaceMemory(currentWorkspacePath as string),
    enabled: Boolean(currentWorkspacePath),
  })
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: listAgents })

  const entries = memoryListQuery.data?.entries ?? []
  const agentDefinitionsById = useMemo(
    () => new Map((agentsQuery.data ?? []).map((agent) => [agent.agent_id, agent])),
    [agentsQuery.data],
  )
  const selectedEntry = entries.find((entry) => entry.agent_id === selectedAgentId) ?? null
  const dirty = draftContent !== baselineContent
  const memoryInteractionStateRef = useRef({
    workspacePath: currentWorkspacePath,
    selectedAgentId,
    draftContent,
    baselineContent,
    entryIds: entries.map((entry) => entry.agent_id),
  })
  memoryInteractionStateRef.current = {
    workspacePath: currentWorkspacePath,
    selectedAgentId,
    draftContent,
    baselineContent,
    entryIds: entries.map((entry) => entry.agent_id),
  }

  useEffect(() => {
    const previousWorkspacePath = previousWorkspacePathRef.current
    if (previousWorkspacePath === currentWorkspacePath) return
    previousWorkspacePathRef.current = currentWorkspacePath
    setSelectedAgentId(null)
    setDraftContent("")
    setBaselineContent("")
    setBaselineSha256(null)
    setEditorMessage(null)
    setSearch("")
    setActiveGroup(null)
    setEditing(false)
  }, [currentWorkspacePath])

  useEffect(() => {
    setMemoryDraftDirty(dirty)
    return () => setMemoryDraftDirty(false)
  }, [dirty, setMemoryDraftDirty])

  useEffect(() => {
    if (!currentWorkspacePath || !selectedAgentId) return
    if (!entries.some((entry) => entry.agent_id === selectedAgentId)) {
      setSelectedAgentId(null)
      setEditing(false)
      setEditorMessage(null)
    }
  }, [currentWorkspacePath, entries, selectedAgentId])

  const memoryContentQuery = useQuery({
    queryKey: ["workspace-memory", "content", currentWorkspacePath, selectedAgentId],
    queryFn: () => readWorkspaceMemory(currentWorkspacePath as string, selectedAgentId as string),
    enabled: Boolean(currentWorkspacePath && selectedAgentId),
  })

  useEffect(() => {
    if (!memoryContentQuery.data) return
    if (dirty && baselineSha256 && memoryContentQuery.data.content_sha256 !== baselineSha256) {
      setEditorMessage({ tone: "error", text: "记忆文件已在外部更新。请复制当前草稿后刷新，再决定如何合并。" })
      return
    }
    if (dirty) return
    setDraftContent(memoryContentQuery.data.content)
    setBaselineContent(memoryContentQuery.data.content)
    setBaselineSha256(memoryContentQuery.data.content_sha256)
    setEditorMessage(null)
  }, [baselineSha256, dirty, memoryContentQuery.data])

  useEffect(() => {
    if (!dirty) return
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [dirty])

  const navigationBlocker = useBlocker(dirty)
  const navigationBlockerRef = useRef(navigationBlocker)
  navigationBlockerRef.current = navigationBlocker
  useEffect(() => {
    if (navigationBlocker.state !== "blocked" || navigationConfirmationPendingRef.current) return
    const targetLocationKey = navigationBlocker.location.key
      || `${navigationBlocker.location.pathname}${navigationBlocker.location.search}${navigationBlocker.location.hash}`
    navigationConfirmationPendingRef.current = true
    void (async () => {
      const confirmed = await confirm({
        title: "离开 Memory 页面",
        description: "当前记忆有未保存修改，离开页面会放弃这些修改。",
        confirmLabel: "放弃修改并离开",
        cancelLabel: "继续编辑",
        tone: "warning",
      })
      const currentBlocker = navigationBlockerRef.current
      if (currentBlocker.state !== "blocked") return
      const currentLocationKey = currentBlocker.location.key
        || `${currentBlocker.location.pathname}${currentBlocker.location.search}${currentBlocker.location.hash}`
      if (currentLocationKey !== targetLocationKey) {
        currentBlocker.reset()
        notify({
          title: "未离开 Memory 页面",
          message: "确认期间目标页面已变化，请重新执行导航。",
          tone: "warning",
        })
        return
      }
      if (confirmed) currentBlocker.proceed()
      else currentBlocker.reset()
    })().finally(() => {
      navigationConfirmationPendingRef.current = false
    })
  }, [confirm, navigationBlocker, notify])

  const saveMutation = useMutation({
    mutationFn: ({
      entry,
      content,
      expectedSha256,
    }: {
      entry: WorkspaceMemoryEntry
      content: string
      expectedSha256: string
    }) => saveWorkspaceMemory({
      workspacePath: currentWorkspacePath as string,
      agentId: entry.agent_id,
      content,
      expectedSha256,
    }),
    onSuccess: (next) => {
      queryClient.setQueryData(
        ["workspace-memory", "content", currentWorkspacePath, next.agent_id],
        { ...next, content: draftContent } satisfies WorkspaceMemoryReadResponse,
      )
      queryClient.setQueryData(
        ["workspace-memory", "list", currentWorkspacePath],
        (previous: { entries?: WorkspaceMemoryEntry[] } | undefined) => updateMemoryListCache(previous, next),
      )
      setBaselineContent(draftContent)
      setBaselineSha256(next.content_sha256)
      setEditing(false)
      setEditorMessage({ tone: "info", text: "已保存项目记忆。" })
    },
    onError: (error) => {
      setEditorMessage({ tone: "error", text: getErrorMessage(error, "保存失败。") })
    },
  })

  const filteredEntries = useFilteredEntries(entries, search, activeGroup, agentDefinitionsById)
  const hasActiveFiltering = Boolean(search.trim() || activeGroup)
  const listEntries = filteredEntries.length > 0 || hasActiveFiltering ? filteredEntries : entries
  const groupOptions = useMemo(
    () => filterOptionsFromCounts(countBy(entries, (entry) => getMemoryGroup(entry, agentDefinitionsById)), entries.length),
    [agentDefinitionsById, entries],
  )

  const discardCurrentDraft = () => {
    setDraftContent(baselineContent)
    setEditing(false)
    setEditorMessage(null)
  }

  const confirmDiscardCurrentDraft = async ({
    actionKey,
    title,
    description,
  }: {
    actionKey: string
    title: string
    description: string
  }) => {
    const snapshot = { ...memoryInteractionStateRef.current }
    if (snapshot.draftContent === snapshot.baselineContent) return snapshot
    if (pendingMemoryActionRef.current !== null) return null
    pendingMemoryActionRef.current = actionKey
    try {
      const confirmed = await confirm({
        title,
        description,
        confirmLabel: "放弃修改并继续",
        cancelLabel: "继续编辑",
        tone: "warning",
      })
      if (!confirmed) return null
      const latest = memoryInteractionStateRef.current
      if (
        latest.workspacePath !== snapshot.workspacePath
        || latest.selectedAgentId !== snapshot.selectedAgentId
        || latest.draftContent !== snapshot.draftContent
        || latest.baselineContent !== snapshot.baselineContent
      ) {
        notify({
          title: "操作已取消",
          message: "确认期间 Memory 草稿或当前对象已变化，请重新执行操作。",
          tone: "warning",
        })
        return null
      }
      return snapshot
    } finally {
      if (pendingMemoryActionRef.current === actionKey) pendingMemoryActionRef.current = null
    }
  }

  const handleSelectEntry = async (entry: WorkspaceMemoryEntry) => {
    const targetAgentId = entry.agent_id
    if (targetAgentId === memoryInteractionStateRef.current.selectedAgentId) return
    const snapshot = await confirmDiscardCurrentDraft({
      actionKey: `select:${targetAgentId}`,
      title: "切换 Memory Agent",
      description: "当前记忆有未保存修改，切换 Agent 会放弃这些修改。",
    })
    if (!snapshot) return
    if (!memoryInteractionStateRef.current.entryIds.includes(targetAgentId)) {
      notify({
        title: "未切换 Agent",
        message: "目标 Agent 的 Memory 条目已变化，请刷新后重试。",
        tone: "warning",
      })
      return
    }
    if (snapshot.draftContent !== snapshot.baselineContent) discardCurrentDraft()
    setSelectedAgentId(targetAgentId)
    setEditing(false)
    setEditorMessage(null)
  }

  const handleBackToList = async () => {
    const snapshot = await confirmDiscardCurrentDraft({
      actionKey: "back-to-list",
      title: "返回 Memory 列表",
      description: "当前记忆有未保存修改，返回列表会放弃这些修改。",
    })
    if (!snapshot) return
    if (snapshot.draftContent !== snapshot.baselineContent) discardCurrentDraft()
    setSelectedAgentId(null)
    setEditing(false)
    setEditorMessage(null)
  }

  const handleRefresh = async () => {
    const snapshot = await confirmDiscardCurrentDraft({
      actionKey: "refresh",
      title: "刷新 Memory",
      description: "当前记忆有未保存修改，刷新会放弃这些修改。",
    })
    if (!snapshot) return
    if (snapshot.draftContent !== snapshot.baselineContent) discardCurrentDraft()
    void queryClient.invalidateQueries({ queryKey: ["workspace-memory", "list", snapshot.workspacePath] })
    if (snapshot.selectedAgentId) {
      void queryClient.invalidateQueries({ queryKey: ["workspace-memory", "content", snapshot.workspacePath, snapshot.selectedAgentId] })
    }
    setEditing(false)
  }

  const handleDiscard = () => {
    setDraftContent(baselineContent)
    setEditing(false)
    setEditorMessage(null)
  }

  const handleSave = () => {
    if (!selectedEntry || !baselineSha256) return
    saveMutation.mutate({ entry: selectedEntry, content: draftContent, expectedSha256: baselineSha256 })
  }

  if (!currentWorkspacePath) {
    return <NoProjectMemoryState />
  }

  if (selectedEntry) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-app-bg text-app-primary">
        <AdaptiveResourceLayout
          list={
            <GroupedCompactResourceList
              items={listEntries}
              selectedKey={selectedEntry.agent_id}
              onSelect={handleSelectEntry}
              getKey={(entry) => entry.agent_id}
              getTitle={(entry) => getMemoryTitle(entry, agentDefinitionsById)}
              getGroup={(entry) => getMemoryGroup(entry, agentDefinitionsById)}
              onBack={handleBackToList}
            />
          }
          detail={
            <MemoryDetailView
              entry={selectedEntry}
              content={memoryContentQuery.data ?? null}
              loading={memoryContentQuery.isLoading}
              error={memoryContentQuery.error}
              draftContent={draftContent}
              onDraftChange={(next) => {
                setDraftContent(next)
                if (editorMessage) setEditorMessage(null)
              }}
              dirty={dirty}
              editing={editing}
              saving={saveMutation.isPending}
              message={editorMessage}
              agentDefinition={agentDefinitionsById.get(selectedEntry.agent_id) ?? null}
              onEdit={() => setEditing(true)}
              onSave={handleSave}
              onDiscard={handleDiscard}
              onRefresh={handleRefresh}
            />
          }
        />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-app-bg text-app-primary">
      <div className="shrink-0 px-4 pt-4 sm:px-6 sm:pt-5">
        <MemoryHomeHeader />
      </div>
      <div className="min-h-0 flex-1">
        <ResourceManagementLayout
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="搜索 Agent 名称 / ID / 摘要..."
          primaryFilters={groupOptions}
          activePrimary={activeGroup}
          onPrimaryChange={setActiveGroup}
          action={
            <button type="button" onClick={handleRefresh} className={`${themeClassNames.button.secondary} gap-1.5`}>
              <RefreshCw size={14} className={memoryListQuery.isFetching ? "animate-spin" : ""} />
              刷新
            </button>
          }
        >
          <StatusText
            isLoading={memoryListQuery.isLoading}
            error={memoryListQuery.error}
            empty={!memoryListQuery.isLoading && !memoryListQuery.error && entries.length > 0 && filteredEntries.length === 0}
          />
          {!memoryListQuery.isLoading && !memoryListQuery.error && entries.length === 0 ? (
            <EmptyMemoryState memoryRootExists={memoryListQuery.data?.memory_root_exists ?? false} />
          ) : null}
          {filteredEntries.length > 0 ? (
            <ResourceGrid>
              {filteredEntries.map((entry) => (
                <ResourceCard
                  key={entry.key}
                  title={getMemoryTitle(entry, agentDefinitionsById)}
                  identifier={entry.agent_id}
                  description={getMemorySummary(entry, agentDefinitionsById)}
                  badges={
                    <>
                      <span>{getMemoryGroup(entry, agentDefinitionsById)}</span>
                      <span className="text-[10px] text-app-muted">更新时间：{formatTimestamp(entry.modified_at)}</span>
                    </>
                  }
                  onClick={() => handleSelectEntry(entry)}
                />
              ))}
            </ResourceGrid>
          ) : null}
        </ResourceManagementLayout>
      </div>
    </div>
  )
}

function MemoryDetailView({
  entry,
  content,
  loading,
  error,
  draftContent,
  onDraftChange,
  dirty,
  editing,
  saving,
  message,
  agentDefinition,
  onEdit,
  onSave,
  onDiscard,
  onRefresh,
}: {
  entry: WorkspaceMemoryEntry
  content: WorkspaceMemoryReadResponse | null
  loading: boolean
  error: unknown
  draftContent: string
  onDraftChange: (value: string) => void
  dirty: boolean
  editing: boolean
  saving: boolean
  message: EditorMessage | null
  agentDefinition: AgentDefinition | null
  onEdit: () => void
  onSave: () => void
  onDiscard: () => void
  onRefresh: () => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-app-bg px-4 py-4 text-app-primary sm:px-6 sm:py-5">
      <div className="mb-6 flex shrink-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="min-w-0 truncate text-xl font-semibold text-app-primary">{getMemoryTitleFromDefinition(entry, agentDefinition)}</h1>
          <div className="mt-1 font-mono text-xs text-app-muted">{entry.agent_id}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button type="button" onClick={onEdit} disabled={editing || saving || loading || Boolean(error)} className={`${themeClassNames.button.secondary} gap-1.5`}>
            <Pencil size={14} />
            编辑
          </button>
          <button type="button" onClick={onRefresh} disabled={saving} className={`${themeClassNames.button.secondary} gap-1.5`}>
            <RefreshCw size={14} />
            刷新
          </button>
          <button type="button" onClick={onDiscard} disabled={!dirty || saving} className={themeClassNames.button.ghost}>
            <XCircle size={14} className="mr-1" />
            放弃
          </button>
          <button type="button" onClick={onSave} disabled={!dirty || saving || loading} className={`${themeClassNames.button.primary} gap-1.5`}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            保存
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="grid shrink-0 grid-cols-1 gap-x-8 gap-y-3 rounded-lg border border-app-border/80 bg-app-surface/70 p-4 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <MetaField label="Agent ID" value={entry.agent_id} />
          <MetaField label="显示名" value={agentDefinition?.name ?? entry.agent_id} />
          <MetaField label="Agent分组" value={agentDefinition?.group ?? getAgentGroup(entry.agent_id)} />
          <MetaField label="更新时间" value={formatTimestamp(content?.modified_at ?? entry.modified_at)} />
        </div>
        {loading ? (
          <div className="flex shrink-0 items-center gap-2 text-sm text-app-secondary">
            <Loader2 size={16} className="animate-spin" />
            正在加载记忆内容…
          </div>
        ) : null}
        {error ? (
          <div className={`${themeClassNames.state.dangerAlert} shrink-0`}>
            <AlertCircle size={14} className="mr-1 inline" />
            {getErrorMessage(error, "读取记忆失败。")}
          </div>
        ) : null}
        {message ? (
          <div className={message.tone === "error" ? `${themeClassNames.state.dangerAlert} shrink-0` : "shrink-0 rounded border border-app-border bg-app-selected/50 px-3 py-2 text-xs text-app-secondary"}>
            {message.text}
          </div>
        ) : null}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="mb-2 shrink-0 text-xs font-medium text-app-muted">Markdown 原文</div>
          <textarea
            value={draftContent}
            onChange={(event) => onDraftChange(event.target.value)}
            disabled={!editing || loading || Boolean(error)}
            spellCheck={false}
            placeholder="当前记忆为空。"
            className={`${themeClassNames.form.textarea} h-full min-h-0 flex-1 resize-none p-3 font-mono text-xs leading-relaxed`}
          />
        </section>
      </div>
    </div>
  )
}

function NoProjectMemoryState() {
  return (
    <div className="flex h-full items-center justify-center bg-app-bg px-6 text-center text-app-secondary">
      <div className="max-w-md rounded-2xl border border-app-border/80 bg-app-surface/85 p-6 shadow-card">
        <FileText size={24} className="mx-auto mb-3 text-app-muted" />
        <h1 className="text-lg font-semibold text-app-primary">打开项目后查看 Memory</h1>
        <p className="mt-2 text-sm leading-relaxed text-app-secondary">
          Memory 页面只读取当前打开项目根目录下的 <code className="font-mono text-xs">.spread-ai/memory</code>。请先在 Chat 中打开项目。
        </p>
      </div>
    </div>
  )
}

function EmptyMemoryState({ memoryRootExists }: { memoryRootExists: boolean }) {
  return (
    <div className="rounded-lg border border-dashed border-app-border p-5 text-sm text-app-muted">
      {memoryRootExists ? "当前项目暂无可编辑的 Agent memory.md。" : "当前项目暂无 .spread-ai/memory 目录。"}
    </div>
  )
}

function MemoryHomeHeader() {
  return (
    <section className="mb-3">
      <div className="mb-2">
        <h2 className="text-base font-semibold text-app-primary">Memory</h2>
        <p className="mt-1 text-xs text-app-muted">各个Agent当前项目的长期记忆</p>
      </div>
    </section>
  )
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-app-muted">{label}</dt>
      <dd className={`mt-0.5 break-all text-app-secondary ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  )
}

function useFilteredEntries(
  entries: WorkspaceMemoryEntry[],
  search: string,
  activeGroup: string | null,
  agentDefinitionsById: Map<string, AgentDefinition>,
 ) {
  return useMemo(
    () => entries.filter((entry) => {
      const group = getMemoryGroup(entry, agentDefinitionsById)
      if (activeGroup && group !== activeGroup) return false
      return matchesQuery(
        [
          entry.agent_id,
          group,
          getMemoryTitle(entry, agentDefinitionsById),
          getMemorySummary(entry, agentDefinitionsById),
          formatTimestamp(entry.modified_at),
        ],
        search,
      )
    }),
    [activeGroup, agentDefinitionsById, entries, search],
  )
}

function updateMemoryListCache(
  previous: { workspace_path?: string; memory_root_exists?: boolean; entries?: WorkspaceMemoryEntry[] } | undefined,
  saved: WorkspaceMemorySaveResponse,
 ) {
  if (!previous?.entries) return previous
  return {
    ...previous,
    memory_root_exists: true,
    entries: previous.entries.map((entry) => (entry.agent_id === saved.agent_id ? saved : entry)),
  }
}

function getAgentGroup(agentId: string) {
  const separatorIndex = agentId.indexOf("-")
  return separatorIndex > 0 ? agentId.slice(0, separatorIndex) : "default"
}

function getMemoryTitle(entry: WorkspaceMemoryEntry, agentDefinitionsById: Map<string, AgentDefinition>) {
  return getMemoryTitleFromDefinition(entry, agentDefinitionsById.get(entry.agent_id) ?? null)
}

function getMemoryTitleFromDefinition(entry: WorkspaceMemoryEntry, agentDefinition: AgentDefinition | null) {
  return agentDefinition?.name?.trim() || entry.agent_id
}

function getMemoryGroup(entry: WorkspaceMemoryEntry, agentDefinitionsById: Map<string, AgentDefinition>) {
  return agentDefinitionsById.get(entry.agent_id)?.group || getAgentGroup(entry.agent_id)
}


function getMemorySummary(entry: WorkspaceMemoryEntry, agentDefinitionsById: Map<string, AgentDefinition>) {
  const summary = entry.summary?.trim()
  if (summary) return summary
  const agentDefinition = agentDefinitionsById.get(entry.agent_id)
  if (agentDefinition?.description?.trim()) return agentDefinition.description
  return `${getMemoryTitle(entry, agentDefinitionsById)} 的项目记忆文件，可手动编辑并保存 Markdown 原文。`
}

function formatTimestamp(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "未知"
  return new Date(timestamp * 1000).toLocaleString()
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
