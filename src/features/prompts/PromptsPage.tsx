import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Braces, ChevronDown, Plus, Search, Trash2 } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import {
  createPromptSnippet,
  deletePromptSnippet,
  listPromptBuiltinVariables,
  listPromptSnippets,
  updatePromptSnippet,
  type PromptBuiltinVariable,
  type PromptSnippet,
} from "@/features/studio/studioApi"
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

type EditingSnippet = { mode: "create" } | { mode: "edit"; original: PromptSnippet }

export function PromptsPage() {
  const qc = useQueryClient()
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const deletePromptClaimRef = useRef<string | null>(null)
  const interactionOwnerMountedRef = useRef(true)
  useEffect(() => {
    interactionOwnerMountedRef.current = true
    return () => {
      interactionOwnerMountedRef.current = false
    }
  }, [])
  const { data, isLoading, error } = useQuery({ queryKey: ["prompts"], queryFn: listPromptSnippets })
  const snippets = data ?? []
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [editing, setEditing] = useState<EditingSnippet | null>(null)

  const categoryOptions = useMemo(
    () => filterOptionsFromCounts(countBy(snippets, (snippet) => snippet.category || "default"), snippets.length),
    [snippets],
  )
  const filtered = useMemo(
    () =>
      snippets.filter((snippet) => {
        const category = snippet.category || "default"
        if (activeCategory && category !== activeCategory) return false
        return matchesQuery([snippet.name, snippet.text, category], search)
      }),
    [activeCategory, search, snippets],
  )

  const deleteMut = useMutation({
    mutationFn: deletePromptSnippet,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["prompts"] }),
    onSettled: (_data, _error, name) => {
      if (deletePromptClaimRef.current === name) deletePromptClaimRef.current = null
    },
  })
  const promptInteractionStateRef = useRef({ editing, snippets, deletePending: deleteMut.isPending })
  promptInteractionStateRef.current = { editing, snippets, deletePending: deleteMut.isPending }

  const requestDeletePrompt = async (snippet: PromptSnippet) => {
    const target = {
      resource: "prompt-snippet" as const,
      name: snippet.name,
      displayName: snippet.name,
      category: snippet.category || "default",
      deletable: true,
    }
    if (deleteMut.isPending || deletePromptClaimRef.current !== null) return
    deletePromptClaimRef.current = target.name
    let mutationStarted = false
    try {
      const confirmed = await confirm({
        title: "删除提示词片段",
        description: `确认删除提示词片段「${target.displayName}」？`,
        confirmLabel: "删除片段",
        cancelLabel: "取消",
        tone: "danger",
      })
      if (!confirmed) return
      const latest = promptInteractionStateRef.current
      const latestSnippet = latest.snippets.find((item) => item.name === target.name)
      if (!interactionOwnerMountedRef.current || latest.editing !== null || latest.deletePending || !latestSnippet) {
        notify({
          title: "未删除提示词片段",
          message: "确认期间提示词列表、当前详情或删除任务状态已变化，请重新操作。",
          tone: "warning",
        })
        return
      }
      deleteMut.mutate(target.name)
      mutationStarted = true
    } finally {
      if (!mutationStarted && deletePromptClaimRef.current === target.name) deletePromptClaimRef.current = null
    }
  }

  if (editing) {
    const selectedKey = editing.mode === "edit" ? editing.original.name : "__create"
    return (
      <AdaptiveResourceLayout
        list={
          <GroupedCompactResourceList
            items={filtered}
            selectedKey={selectedKey}
            onSelect={(snippet) => setEditing({ mode: "edit", original: snippet })}
            getKey={(snippet) => snippet.name}
            getTitle={(snippet) => snippet.name}
            getGroup={(snippet) => snippet.category || "default"}
            onBack={() => setEditing(null)}
          />
        }
        detail={<SnippetEditor key={selectedKey} editing={editing} onClose={() => setEditing(null)} />}
      />
    )
  }

  return (
    <ResourceManagementLayout
      count={snippets.length}
      action={
        <button
          type="button"
          onClick={() => setEditing({ mode: "create" })}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-500"
        >
          <Plus size={13} />
          新建
        </button>
      }
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="搜索提示词名称 / 内容 / 分类..."
      primaryFilters={categoryOptions}
      activePrimary={activeCategory}
      onPrimaryChange={setActiveCategory}
    >
      <StatusText isLoading={isLoading} error={error} empty={!isLoading && !error && filtered.length === 0} />
      <ResourceGrid>
        {filtered.map((snippet) => {
          const text = snippet.text ?? ""
          return (
            <ResourceCard
              key={snippet.name}
              title={snippet.name}
              identifier={snippet.category || "default"}
              description={text}
              actions={<span className="text-xs text-app-secondary">{text.length} 字</span>}
              badges={
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    void requestDeletePrompt(snippet)
                  }}
                  className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                >
                  <Trash2 size={12} />
                  删除
                </button>
              }
              onClick={() => setEditing({ mode: "edit", original: snippet })}
            />
          )
        })}
      </ResourceGrid>
    </ResourceManagementLayout>
  )
}

const VARIABLE_CATEGORY_MAP: Record<string, string> = {
  identity: "身份标识",
  environment: "运行环境",
  tools: "本地工具",
  learning_files: "专属文件",
  mcp: "MCP服务",
  subagent: "子Agent",
  lifecycle: "生命周期",
}

function SnippetEditor({ editing, onClose }: { editing: EditingSnippet; onClose: () => void }) {
  const qc = useQueryClient()
  const isCreate = editing.mode === "create"
  const original = editing.mode === "edit" ? editing.original : null
  const [name, setName] = useState(original?.name ?? "")
  const [text, setText] = useState(original?.text ?? "")
  const [category, setCategory] = useState(original?.category ?? "default")
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const variableMenuRef = useRef<HTMLDivElement>(null)
  const [variableMenuOpen, setVariableMenuOpen] = useState(false)
  const [variableSearch, setVariableSearch] = useState("")

  const { data: builtinVariables = [] } = useQuery({
    queryKey: ["prompt-builtin-variables"],
    queryFn: listPromptBuiltinVariables,
  })

  useEffect(() => {
    if (!variableMenuOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (variableMenuRef.current && !variableMenuRef.current.contains(e.target as Node)) {
        setVariableMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [variableMenuOpen])

  const filteredVariables = useMemo(() => {
    if (!variableSearch.trim()) return builtinVariables
    const q = variableSearch.toLowerCase()
    return builtinVariables.filter(
      (v) =>
        v.placeholder.toLowerCase().includes(q) ||
        v.name.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q) ||
        (VARIABLE_CATEGORY_MAP[v.category] || v.category).toLowerCase().includes(q),
    )
  }, [builtinVariables, variableSearch])

  const groupedVariables = useMemo(() => {
    const groups: Record<string, PromptBuiltinVariable[]> = {}
    for (const v of filteredVariables) {
      const cat = v.category || "other"
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(v)
    }
    return groups
  }, [filteredVariables])

  function insertVariable(placeholder: string) {
    const textarea = textareaRef.current
    if (!textarea) {
      setText((prev) => prev + placeholder)
      setVariableMenuOpen(false)
      return
    }
    const start = textarea.selectionStart ?? text.length
    const end = textarea.selectionEnd ?? text.length
    const next = text.slice(0, start) + placeholder + text.slice(end)
    setText(next)
    setVariableMenuOpen(false)
    requestAnimationFrame(() => {
      textarea.focus()
      const newPos = start + placeholder.length
      textarea.setSelectionRange(newPos, newPos)
    })
  }

  const createMut = useMutation({
    mutationFn: createPromptSnippet,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompts"] })
      onClose()
    },
  })
  const updateMut = useMutation({
    mutationFn: (body: { new_name?: string; new_text?: string; new_category?: string }) => updatePromptSnippet(original!.name, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["prompts"] })
      onClose()
    },
  })

  const saving = createMut.isPending || updateMut.isPending
  const errorMsg = createMut.error?.message || updateMut.error?.message

  function handleSubmit() {
    if (!name.trim() || !text.trim()) return
    if (isCreate) {
      createMut.mutate({ name: name.trim(), text: text.trim(), category: category.trim() || "default" })
      return
    }
    updateMut.mutate({
      new_name: name.trim() !== original!.name ? name.trim() : undefined,
      new_text: text.trim() !== original!.text ? text.trim() : undefined,
      new_category: category.trim() !== original!.category ? category.trim() : undefined,
    })
  }

  return (
    <DetailLayout
      identifier={isCreate ? undefined : original?.name}
      actions={
        <>
          {errorMsg && <span className="text-xs text-red-400">{errorMsg}</span>}
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-app-secondary hover:text-app-primary">
            取消
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving || !name.trim() || !text.trim()}
            className="rounded bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40"
          >
            {saving ? "保存中" : "保存"}
          </button>
        </>
      }
    >
      <div className="flex h-[calc(100vh-12rem)] min-h-[28rem] flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_14rem]">
          <div>
            <label className="mb-1.5 block text-xs text-app-muted">片段名称</label>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="唯一描述名"
              className="w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-2 text-sm text-app-primary outline-none placeholder:text-app-subtle focus:border-app-border-strong"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs text-app-muted">分类</label>
            <input
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="default"
              className="w-full rounded border border-app-border/80 bg-app-surface/70 px-3 py-2 text-sm text-app-primary outline-none placeholder:text-app-subtle focus:border-app-border-strong"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-xs text-app-muted">提示词文本内容</label>
            <div ref={variableMenuRef} className="relative">
              <button
                type="button"
                onClick={() => {
                  setVariableMenuOpen((open) => !open)
                  setVariableSearch("")
                }}
                className="inline-flex items-center gap-1.5 rounded border border-app-border/80 bg-app-surface px-2.5 py-1 text-xs text-app-primary transition hover:border-app-accent-muted hover:bg-app-surface-hover"
                title="在光标处插入系统环境变量占位符"
              >
                <Braces size={13} className="text-blue-600 dark:text-blue-400" />
                <span>插入系统变量</span>
                <ChevronDown size={12} className={["text-app-muted transition", variableMenuOpen ? "rotate-180" : ""].join(" ")} />
              </button>
              {variableMenuOpen && (
                <div
                  className="absolute right-0 top-7 z-30 flex max-h-96 w-80 flex-col overflow-hidden rounded-xl border border-app-border/80 bg-app-surface/95 p-2 shadow-card backdrop-blur"
                  role="menu"
                >
                  <div className="relative mb-2 shrink-0">
                    <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-app-muted" />
                    <input
                      value={variableSearch}
                      onChange={(e) => setVariableSearch(e.target.value)}
                      placeholder="搜索变量..."
                      autoFocus
                      className="h-7 w-full rounded-md border border-app-border bg-app-surface/90 py-1 pl-8 pr-2 text-xs text-app-primary outline-none placeholder:text-app-subtle focus:border-app-accent-muted"
                    />
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                    {Object.keys(groupedVariables).length === 0 ? (
                      <div className="py-4 text-center text-xs text-app-muted">未找到匹配变量</div>
                    ) : (
                      Object.entries(groupedVariables).map(([cat, items]) => (
                        <div key={cat} className="mb-2.5 last:mb-0">
                          <div className="mb-1 px-1.5 text-[10px] font-semibold uppercase tracking-wider text-app-subtle">
                            {VARIABLE_CATEGORY_MAP[cat] || cat}
                          </div>
                          <div className="space-y-0.5">
                            {items.map((v) => (
                              <button
                                key={v.placeholder}
                                type="button"
                                onClick={() => insertVariable(v.placeholder)}
                                title={`${v.name}\n${v.description}\n\n取值：${v.value_logic}`}
                                className="group flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition hover:bg-app-surface-hover"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="truncate text-xs font-medium text-app-primary group-hover:text-blue-600 dark:group-hover:text-blue-400">
                                    {v.name}
                                  </div>
                                  <div className="truncate text-[10px] text-app-muted">{v.description}</div>
                                </div>
                                <code className="shrink-0 rounded bg-app-bg px-1.5 py-0.5 font-mono text-[10px] text-blue-600 dark:text-blue-400">
                                  {v.placeholder}
                                </code>
                              </button>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="输入提示词文本内容"
            className="h-[calc(100%-28px)] w-full resize-none rounded border border-app-border/80 bg-app-surface/70 px-4 py-3 font-mono text-sm leading-6 text-app-primary outline-none placeholder:text-app-subtle focus:border-app-border-strong"
          />
        </div>
      </div>
    </DetailLayout>
  )
}
