import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from "react"
import { ChevronDown, ChevronRight, FileText, Folder, FolderOpen, Loader2, RefreshCw, Search, X } from "lucide-react"

const WORKSPACE_FILE_DRAG_MIME = "application/x-spread-ai-workspace-files"

export type WorkspaceNode = {
  name: string
  path: string
  type: "folder" | "file"
  children?: WorkspaceNode[]
  children_loaded?: boolean
}

export type WorkspaceTreeStatus = "empty" | "loading" | "ready" | "error"

const EMPTY_LOADING_DIRECTORY_PATHS: ReadonlySet<string> = new Set()
const EMPTY_DIRECTORY_LOAD_ERRORS: Record<string, string | undefined> = {}

export function WorkspaceTree({
  workspaceName,
  workspacePath,
  nodes,
  status,
  selectedPath,
  error,
  isRefreshing,
  loadingDirectoryPaths,
  directoryLoadErrors,
  onRefresh,
  onSelectNode,
  onLoadDirectory,
  onOpenNode,
}: {
  workspaceName: string | null
  workspacePath: string | null
  nodes: WorkspaceNode[]
  status: WorkspaceTreeStatus
  selectedPath?: string | null
  error?: string | null
  isRefreshing?: boolean
  loadingDirectoryPaths?: ReadonlySet<string>
  directoryLoadErrors?: Record<string, string | undefined>
  onRefresh?: () => void
  onSelectNode?: (node: WorkspaceNode) => void
  onLoadDirectory?: (node: WorkspaceNode) => void
  onOpenNode?: (node: WorkspaceNode) => void
}) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => collectInitiallyExpandedPaths(nodes))
  const [selectedFilePaths, setSelectedFilePaths] = useState<Set<string>>(() => new Set())
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const expandedPathsWorkspaceRef = useRef<string | null>(null)
  const hasWorkspace = Boolean(workspaceName && workspacePath)
  const isTreeBusy = status === "loading" || Boolean(isRefreshing)
  const activeLoadingDirectoryPaths = loadingDirectoryPaths ?? EMPTY_LOADING_DIRECTORY_PATHS
  const activeDirectoryLoadErrors = directoryLoadErrors ?? EMPTY_DIRECTORY_LOAD_ERRORS
  const normalizedSearchQuery = searchQuery.trim().toLowerCase()
  const visibleNodes = useMemo(
    () => filterWorkspaceNodes(nodes, normalizedSearchQuery),
    [nodes, normalizedSearchQuery],
  )
  const visibleExpandedPaths = useMemo(
    () => normalizedSearchQuery ? collectExpandedPaths(visibleNodes) : expandedPaths,
    [expandedPaths, normalizedSearchQuery, visibleNodes],
  )

  useEffect(() => {
    setExpandedPaths((current) => {
      if (!workspacePath) {
        expandedPathsWorkspaceRef.current = null
        return new Set()
      }

      if (expandedPathsWorkspaceRef.current !== workspacePath) {
        if (nodes.length === 0) return new Set()
        expandedPathsWorkspaceRef.current = workspacePath
        return collectInitiallyExpandedPaths(nodes)
      }

      return retainExistingExpandedPaths(current, nodes)
    })
  }, [nodes, workspacePath])

  useEffect(() => {
    setSelectedFilePaths(new Set())
  }, [workspacePath])

  useEffect(() => {
    if (!hasWorkspace) setSearchOpen(false)
  }, [hasWorkspace])

  useEffect(() => {
    if (!searchOpen) {
      setSearchQuery("")
      return
    }
    searchInputRef.current?.focus()
  }, [searchOpen])

  const togglePath = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const handleRootClick = () => {
    if (workspaceName && workspacePath) {
      onSelectNode?.({ name: workspaceName, path: workspacePath, type: "folder", children: nodes })
    }
    setSelectedFilePaths(new Set())
  }

  const handleRefreshClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!hasWorkspace || isTreeBusy || !onRefresh) return
    onRefresh()
  }

  const handleSearchToggleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    if (!hasWorkspace) return
    setSearchOpen((current) => !current)
  }

  const handleSearchCloseClick = () => {
    if (searchQuery) {
      setSearchQuery("")
      searchInputRef.current?.focus()
      return
    }
    setSearchOpen(false)
  }

  const handleNodeClick = (node: WorkspaceNode, event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) return
    if (node.type === "file" && (event.ctrlKey || event.metaKey)) {
      setSelectedFilePaths((current) => {
        const next = new Set(current)
        if (next.has(node.path)) next.delete(node.path)
        else next.add(node.path)
        return next
      })
      return
    }

    setSelectedFilePaths(node.type === "file" ? new Set([node.path]) : new Set())
    onSelectNode?.(node)
  }

  const handleFolderToggle = (node: WorkspaceNode, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault()
    event.stopPropagation()
    if (node.type !== "folder") return
    const willExpand = !expandedPaths.has(node.path)
    togglePath(node.path)
    if (willExpand && node.children_loaded === false && !activeLoadingDirectoryPaths.has(node.path)) {
      onLoadDirectory?.(node)
    }
  }

  const handleNodeDoubleClick = (node: WorkspaceNode, event: MouseEvent<HTMLButtonElement>) => {
    if (!onOpenNode) return
    event.preventDefault()
    event.stopPropagation()
    onOpenNode(node)
  }

  const handleFileDragStart = (node: WorkspaceNode, event: DragEvent<HTMLButtonElement>) => {
    if (node.type !== "file") return
    const draggedPaths = selectedFilePaths.has(node.path) ? Array.from(selectedFilePaths) : [node.path]
    const payload = draggedPaths.join("\n")
    event.dataTransfer.effectAllowed = "copy"
    event.dataTransfer.setData("text/plain", payload)
    event.dataTransfer.setData(WORKSPACE_FILE_DRAG_MIME, JSON.stringify(draggedPaths.map((path) => ({ path }))))
  }

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-r border-slate-200/80 bg-[#eef2f6] text-slate-900">
      <div className="shrink-0 px-2 pt-3">
        <div
          className={[
            "mb-2 flex h-7 w-full items-center rounded-md px-1 text-xs font-semibold text-slate-600",
            workspacePath && selectedPath === workspacePath
              ? "bg-slate-200/60 text-slate-700 ring-1 ring-slate-300/40"
              : "hover:bg-slate-200/55 hover:text-slate-800",
          ].join(" ")}
        >
          <button
            type="button"
            title={workspacePath ?? undefined}
            disabled={!hasWorkspace}
            onClick={handleRootClick}
            onDoubleClick={onOpenNode ? (event) => {
              if (!workspaceName || !workspacePath) return
              handleNodeDoubleClick({ name: workspaceName, path: workspacePath, type: "folder", children: nodes }, event)
            } : undefined}
            className="flex h-full min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left disabled:cursor-not-allowed"
          >
            {status === "loading" ? <Loader2 size={14} className="shrink-0 animate-spin" /> : <FolderOpen size={14} className="shrink-0" />}
            <span className="min-w-0 truncate whitespace-nowrap">{workspaceName ?? "No workspace selected"}</span>
          </button>
          <div className="ml-auto flex h-full shrink-0 items-center gap-0.5">
            <button
              type="button"
              aria-label="刷新文件树"
              title="刷新文件树"
              disabled={!hasWorkspace || isTreeBusy || !onRefresh}
              onClick={handleRefreshClick}
              className="inline-flex size-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-300/35 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isTreeBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            </button>
            <button
              type="button"
              aria-label={searchOpen ? "关闭快速搜索" : "打开快速搜索"}
              aria-pressed={searchOpen}
              title={searchOpen ? "关闭快速搜索" : "快速搜索"}
              disabled={!hasWorkspace}
              onClick={handleSearchToggleClick}
              className={[
                "inline-flex size-6 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-300/35 hover:text-slate-800 focus-visible:bg-app-surface/95 focus-visible:text-app-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45",
                searchOpen ? "bg-app-surface/95 text-app-accent shadow-sm shadow-app-overlay/10 hover:bg-app-surface hover:text-app-accent" : "",
              ].join(" ")}
            >
              <Search size={13} strokeWidth={searchOpen ? 2.75 : 2} className={searchOpen ? "drop-shadow-sm" : undefined} />
            </button>
          </div>
        </div>
        {searchOpen ? (
          <div className="mb-2 flex items-center gap-1 rounded-md border border-slate-200/80 bg-white/75 px-2 py-1 shadow-sm">
            <Search size={13} className="shrink-0 text-slate-400" />
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return
                event.preventDefault()
                if (searchQuery) setSearchQuery("")
                else setSearchOpen(false)
              }}
              placeholder="搜索文件名"
              className="h-6 min-w-0 flex-1 bg-transparent text-xs text-slate-700 outline-none placeholder:text-slate-400"
            />
            <button
              type="button"
              aria-label={searchQuery ? "清空搜索" : "关闭搜索"}
              title={searchQuery ? "清空搜索" : "关闭搜索"}
              onClick={handleSearchCloseClick}
              className="inline-flex size-5 items-center justify-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X size={12} />
            </button>
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 touch-pan-y overflow-auto overscroll-contain">
        <div className="min-w-max px-2 pb-3 pt-1 text-sm">
          {status === "empty" ? (
            <div className="px-2 py-8 text-xs leading-5 text-slate-500">Open a workspace to initialize the file tree.</div>
          ) : null}
          {status === "loading" ? (
            <div className="px-2 py-8 text-xs leading-5 text-slate-500">Loading workspace tree...</div>
          ) : null}
          {status === "error" ? (
            <div className="px-2 py-8 text-xs leading-5 text-red-700">{error ?? "Failed to initialize workspace tree."}</div>
          ) : null}
          {status === "ready" ? (
            normalizedSearchQuery && visibleNodes.length === 0 ? (
              <div className="px-2 py-8 text-xs leading-5 text-slate-500">没有匹配的文件。</div>
            ) : (
              <div className="space-y-0.5">
                {visibleNodes.map((node) => (
                  <TreeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    selectedPath={selectedPath ?? null}
                    selectedFilePaths={selectedFilePaths}
                    expandedPaths={visibleExpandedPaths}
                    loadingDirectoryPaths={activeLoadingDirectoryPaths}
                    directoryLoadErrors={activeDirectoryLoadErrors}
                    highlightQuery={normalizedSearchQuery}
                    onNodeClick={handleNodeClick}
                    onNodeDoubleClick={onOpenNode ? handleNodeDoubleClick : undefined}
                    onFolderToggle={handleFolderToggle}
                    onFileDragStart={handleFileDragStart}
                  />
                ))}
              </div>
            )
          ) : null}
        </div>
      </div>
    </aside>
  )
}

function TreeNode({
  node,
  depth,
  selectedPath,
  selectedFilePaths,
  expandedPaths,
  loadingDirectoryPaths,
  directoryLoadErrors,
  highlightQuery,
  onNodeClick,
  onNodeDoubleClick,
  onFolderToggle,
  onFileDragStart,
}: {
  node: WorkspaceNode
  depth: number
  selectedPath: string | null
  selectedFilePaths: Set<string>
  expandedPaths: Set<string>
  loadingDirectoryPaths: ReadonlySet<string>
  directoryLoadErrors: Record<string, string | undefined>
  highlightQuery: string
  onNodeClick: (node: WorkspaceNode, event: MouseEvent<HTMLButtonElement>) => void
  onNodeDoubleClick?: (node: WorkspaceNode, event: MouseEvent<HTMLButtonElement>) => void
  onFolderToggle: (node: WorkspaceNode, event: MouseEvent<HTMLButtonElement>) => void
  onFileDragStart: (node: WorkspaceNode, event: DragEvent<HTMLButtonElement>) => void
}) {
  const isFolder = node.type === "folder"
  const isOpen = isFolder && expandedPaths.has(node.path)
  const isMultiSelected = !isFolder && selectedFilePaths.has(node.path)
  const isSelected = isFolder ? selectedPath === node.path : isMultiSelected
  const isLoadingChildren = isFolder && loadingDirectoryPaths.has(node.path)
  const loadError = isFolder ? directoryLoadErrors[node.path] : undefined
  const isFolderToggleDisabled = isFolder && Boolean(highlightQuery)

  return (
    <div>
      <div
        className={[
          "group flex h-7 w-full items-center gap-1 rounded-md pr-2 text-[13px] transition",
          isMultiSelected
            ? "bg-white/90 text-slate-950 shadow-sm ring-1 ring-[#4f6f96]/35"
            : isSelected
              ? "bg-white/85 text-slate-950 shadow-sm"
              : "text-slate-600 hover:bg-white/65 hover:text-slate-950",
        ].join(" ")}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
      >
        {isFolder ? (
          <button
            type="button"
            aria-label={isFolderToggleDisabled
              ? `搜索期间目录 ${node.name} 的展开状态由搜索结果自动控制`
              : isOpen ? `折叠目录 ${node.name}` : `展开目录 ${node.name}`}
            aria-expanded={isOpen}
            aria-disabled={isFolderToggleDisabled}
            title={isFolderToggleDisabled ? "搜索期间目录由结果自动展开；清除搜索后可手动展开或折叠" : isOpen ? "折叠目录" : "展开目录"}
            disabled={isFolderToggleDisabled}
            onClick={(event) => onFolderToggle(node, event)}
            className="inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#4f6f96]/35 disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-slate-500"
          >
            {isLoadingChildren ? <Loader2 size={14} className="animate-spin" /> : isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        ) : <span className="size-5 shrink-0" />}
        <button
          type="button"
          title={node.path}
          aria-pressed={isSelected}
          draggable={!isFolder}
          onClick={(event) => onNodeClick(node, event)}
          onDoubleClick={onNodeDoubleClick ? (event) => onNodeDoubleClick(node, event) : undefined}
          onDragStart={!isFolder ? (event) => onFileDragStart(node, event) : undefined}
          className={[
            "flex h-full min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-left focus-visible:outline-none",
            !isFolder ? "cursor-grab active:cursor-grabbing" : "",
          ].join(" ")}
        >
          {isFolder ? <Folder size={14} className="shrink-0 text-[#4f6f96]" /> : <FileText size={14} className="shrink-0 text-slate-500" />}
          <span className="min-w-0 whitespace-nowrap">
            {isFolder || !highlightQuery ? node.name : <HighlightedFileName name={node.name} normalizedQuery={highlightQuery} />}
          </span>
        </button>
      </div>
      {isOpen ? (
        <div>
          {isLoadingChildren ? (
            <div className="flex h-6 items-center gap-1.5 pr-2 text-xs text-slate-500" style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }}>
              <Loader2 size={12} className="shrink-0 animate-spin" />
              <span className="whitespace-nowrap">加载目录中...</span>
            </div>
          ) : null}
          {loadError ? (
            <div className="max-w-[18rem] truncate pr-2 text-xs text-red-700" style={{ paddingLeft: `${(depth + 1) * 14 + 8}px` }} title={loadError}>
              加载失败：{loadError}
            </div>
          ) : null}
          {node.children?.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              selectedFilePaths={selectedFilePaths}
              expandedPaths={expandedPaths}
              loadingDirectoryPaths={loadingDirectoryPaths}
              directoryLoadErrors={directoryLoadErrors}
              highlightQuery={highlightQuery}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onFolderToggle={onFolderToggle}
              onFileDragStart={onFileDragStart}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function HighlightedFileName({ name, normalizedQuery }: { name: string; normalizedQuery: string }) {
  const matchIndices = findFuzzyMatchIndices(name, normalizedQuery) ?? []
  const parts = buildHighlightedNameParts(name, matchIndices)
  return (
    <>
      {parts.map((part, index) => part.highlight ? (
        <mark key={`${part.text}:${index}`} className="rounded-sm bg-app-accent-muted/15 px-0.5 font-semibold text-app-accent">
          {part.text}
        </mark>
      ) : (
        <span key={`${part.text}:${index}`}>{part.text}</span>
      ))}
    </>
  )
}

function collectExpandedPaths(nodes: WorkspaceNode[]): Set<string> {
  const paths = new Set<string>()
  const visit = (node: WorkspaceNode) => {
    if (node.type !== "folder") return
    if ((node.children?.length ?? 0) > 0) paths.add(node.path)
    node.children?.forEach(visit)
  }
  nodes.forEach(visit)
  return paths
}

function collectInitiallyExpandedPaths(nodes: WorkspaceNode[]): Set<string> {
  return collectExpandedPaths(nodes)
}

function retainExistingExpandedPaths(current: Set<string>, nodes: WorkspaceNode[]): Set<string> {
  // 懒加载会让 folder 拿到 children，但“已加载/有 children”不等于“用户要展开”。
  // 同 workspace 的 nodes 更新时只保留仍存在于新树中的显式展开路径，避免点击 A 后把兄弟 B 一起展开。
  const existingFolderPaths = collectFolderPaths(nodes)
  const next = new Set<string>()
  for (const path of current) {
    if (existingFolderPaths.has(path)) next.add(path)
  }
  return next
}

function collectFolderPaths(nodes: WorkspaceNode[]): Set<string> {
  const paths = new Set<string>()
  const visit = (node: WorkspaceNode) => {
    if (node.type !== "folder") return
    paths.add(node.path)
    node.children?.forEach(visit)
  }
  nodes.forEach(visit)
  return paths
}

function filterWorkspaceNodes(nodes: WorkspaceNode[], normalizedQuery: string): WorkspaceNode[] {
  if (!normalizedQuery) return nodes
  return nodes
    .map((node) => filterWorkspaceNode(node, normalizedQuery))
    .filter((node): node is WorkspaceNode => node !== null)
}

function filterWorkspaceNode(node: WorkspaceNode, normalizedQuery: string): WorkspaceNode | null {
  if (node.type === "file") {
    return findFuzzyMatchIndices(node.name, normalizedQuery) ? node : null
  }

  const matchedChildren = node.children
    ?.map((child) => filterWorkspaceNode(child, normalizedQuery))
    .filter((child): child is WorkspaceNode => child !== null) ?? []

  if (matchedChildren.length > 0) return { ...node, children: matchedChildren }
  return null
}

function findFuzzyMatchIndices(name: string, normalizedQuery: string): number[] | null {
  if (!normalizedQuery) return []
  const lowerName = name.toLowerCase()
  const indices: number[] = []
  let queryIndex = 0

  for (let nameIndex = 0; nameIndex < lowerName.length && queryIndex < normalizedQuery.length; nameIndex += 1) {
    if (lowerName[nameIndex] !== normalizedQuery[queryIndex]) continue
    indices.push(nameIndex)
    queryIndex += 1
  }

  return queryIndex === normalizedQuery.length ? indices : null
}

function buildHighlightedNameParts(name: string, matchIndices: number[]): Array<{ text: string; highlight: boolean }> {
  if (matchIndices.length === 0) return [{ text: name, highlight: false }]
  const indexSet = new Set(matchIndices)
  const parts: Array<{ text: string; highlight: boolean }> = []
  let cursor = 0

  while (cursor < name.length) {
    const highlight = indexSet.has(cursor)
    let nextCursor = cursor + 1
    while (nextCursor < name.length && indexSet.has(nextCursor) === highlight) {
      nextCursor += 1
    }
    parts.push({ text: name.slice(cursor, nextCursor), highlight })
    cursor = nextCursor
  }

  return parts
}
