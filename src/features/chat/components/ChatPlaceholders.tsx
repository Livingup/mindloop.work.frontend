import { useMemo, useState, type KeyboardEvent } from "react"
import { FolderOpen, Loader2, RefreshCcw } from "lucide-react"

import { cn, themeClassNames } from "@/shared/theme/classes"

/**
 * Chat 工作台主区域在「workspace 未选 / project 未加载 / scene 未连接」三种空态下
 * 的占位 UI 集合。三者结构相似（卡片 + loading/error/idle 状态），合并到一个文件
 * 以减少文件数。
 */

export type WorkspaceHistoryItem = {
  workspace_path: string
  project_name: string
  last_opened_at: string
}

export function WorkspacePicker({
  value,
  onChange,
  isLoading,
  error,
  onOpen,
  recentWorkspaces = [],
  isRecentLoading = false,
  recentError = null,
  onSelectRecent,
}: {
  value: string
  onChange: (value: string) => void
  isLoading: boolean
  error: string | null
  onOpen: () => void
  recentWorkspaces?: WorkspaceHistoryItem[]
  isRecentLoading?: boolean
  recentError?: string | null
  onSelectRecent?: (workspacePath: string) => void
}) {
  const [recentOpen, setRecentOpen] = useState(false)
  const [activeRecentIndex, setActiveRecentIndex] = useState<number | null>(null)
  const filteredRecentWorkspaces = useMemo(() => {
    const query = value.trim().toLocaleLowerCase()
    const candidates = query
      ? recentWorkspaces.filter((workspace) => {
        const projectName = workspace.project_name.toLocaleLowerCase()
        const workspacePath = workspace.workspace_path.toLocaleLowerCase()
        return projectName.includes(query) || workspacePath.includes(query)
      })
      : recentWorkspaces
    return candidates.slice(0, 8)
  }, [recentWorkspaces, value])
  const showRecentPanel = recentOpen

  const selectRecentWorkspace = (workspacePath: string) => {
    setRecentOpen(false)
    setActiveRecentIndex(null)
    onChange(workspacePath)
    onSelectRecent?.(workspacePath)
  }

  const openCurrentWorkspace = () => {
    setRecentOpen(false)
    setActiveRecentIndex(null)
    onOpen()
  }

  const handleWorkspaceInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && filteredRecentWorkspaces.length > 0) {
      event.preventDefault()
      setRecentOpen(true)
      setActiveRecentIndex((current) => (current === null || current >= filteredRecentWorkspaces.length - 1 ? 0 : current + 1))
      return
    }
    if (event.key === "ArrowUp" && filteredRecentWorkspaces.length > 0) {
      event.preventDefault()
      setRecentOpen(true)
      setActiveRecentIndex((current) => (current === null || current <= 0 ? filteredRecentWorkspaces.length - 1 : current - 1))
      return
    }
    if (event.key === "Escape") {
      setRecentOpen(false)
      setActiveRecentIndex(null)
      return
    }
    if (event.key === "Enter") {
      const activeWorkspace = activeRecentIndex === null ? null : filteredRecentWorkspaces[activeRecentIndex]
      if (recentOpen && activeWorkspace) {
        event.preventDefault()
        selectRecentWorkspace(activeWorkspace.workspace_path)
        return
      }
      openCurrentWorkspace()
    }
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className={cn(themeClassNames.surface.card, "w-full max-w-xl p-6")}>
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-app-accent text-white shadow-[0_10px_24px_rgba(38,58,99,0.20)]">
            <FolderOpen size={20} />
          </div>
          <div>
            <div className="text-base font-semibold text-app-primary">Open workspace</div>
            <div className="mt-1 text-sm text-app-muted">Enter a project path accessible by the backend service.</div>
          </div>
        </div>
        <div className="mt-5 flex gap-2">
          <div className="relative min-w-0 flex-1">
            <input
              value={value}
              onFocus={() => setRecentOpen(true)}
              onClick={() => setRecentOpen(true)}
              onBlur={() => {
                setRecentOpen(false)
                setActiveRecentIndex(null)
              }}
              onChange={(event) => {
                onChange(event.target.value)
                setRecentOpen(true)
                setActiveRecentIndex(null)
              }}
              onKeyDown={handleWorkspaceInputKeyDown}
              className={cn(themeClassNames.form.input, "w-full px-3 py-2 text-sm")}
              placeholder="Example: G:\\project\\AgentRuntime"
              aria-autocomplete="list"
              aria-expanded={showRecentPanel}
            />
            {showRecentPanel ? (
              <div className={cn(themeClassNames.form.popup, "absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 max-h-72 overflow-auto")}>
                <div className="px-3 py-2 text-xs font-medium text-app-muted">最近打开</div>
                {isRecentLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-app-muted">
                    <Loader2 size={12} className="animate-spin" />
                    加载历史项目...
                  </div>
                ) : recentError ? (
                  <div className="px-3 py-2.5 text-xs text-app-danger">历史项目加载失败：{recentError}</div>
                ) : filteredRecentWorkspaces.length > 0 ? (
                  filteredRecentWorkspaces.map((workspace, index) => {
                    const lastOpenedText = formatRecentWorkspaceTime(workspace.last_opened_at)
                    const active = activeRecentIndex === index
                    return (
                      <button
                        type="button"
                        key={workspace.workspace_path}
                        onMouseDown={(event) => event.preventDefault()}
                        onMouseEnter={() => setActiveRecentIndex(index)}
                        onClick={() => selectRecentWorkspace(workspace.workspace_path)}
                        className={cn(
                          "flex w-full flex-col rounded px-3 py-2.5 text-left transition",
                          active
                            ? themeClassNames.form.optionActive
                            : "text-app-secondary hover:bg-app-surface-hover hover:text-app-primary",
                        )}
                      >
                        <span className="flex w-full items-center justify-between gap-3">
                          <span className="truncate text-sm font-medium">{workspace.project_name || "Untitled project"}</span>
                          {lastOpenedText ? <span className="shrink-0 text-[11px] text-app-muted">{lastOpenedText}</span> : null}
                        </span>
                        <span className="mt-1 block max-w-full truncate font-mono text-[11px] text-app-muted">
                          {workspace.workspace_path}
                        </span>
                      </button>
                    )
                  })
                ) : (
                  <div className="px-3 py-2.5 text-xs text-app-muted">
                    {recentWorkspaces.length > 0 ? "没有匹配的历史项目" : "暂无历史项目，打开项目后会自动记录。"}
                  </div>
                )}
              </div>
            ) : null}
          </div>
          <button
            onClick={openCurrentWorkspace}
            disabled={isLoading || !value.trim()}
            className={cn(themeClassNames.button.primary, "gap-2 px-4 py-2 shadow-[0_10px_22px_rgba(38,58,99,0.18)]")}
          >
            {isLoading ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}
            Open
          </button>
        </div>
        {error ? <div className="mt-3 text-sm text-app-danger">{error}</div> : null}
      </div>
    </div>
  )
}

function formatRecentWorkspaceTime(value: string): string | null {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function ProjectLoadingPlaceholder({
  workspacePath,
  isLoading,
  error,
  onRetry,
}: {
  workspacePath: string
  isLoading: boolean
  error: string | null
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/[0.88] p-6 text-center shadow-[0_18px_46px_rgba(15,23,42,0.07)]">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
            <Loader2 size={16} className="animate-spin" />
            正在登记项目 {workspacePath} ...
          </div>
        ) : error ? (
          <>
            <div className="text-sm text-red-700">登记项目失败：{error}</div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
            >
              <RefreshCcw size={12} />
              重试
            </button>
          </>
        ) : (
          <div className="text-sm text-slate-500">准备中...</div>
        )}
      </div>
    </div>
  )
}

export function SceneAttachPlaceholder({
  sceneId,
  isAttaching,
  error,
  onRetry,
}: {
  sceneId: string
  isAttaching: boolean
  error: string | null
  onRetry: () => void
}) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <div className="w-full max-w-md rounded-2xl border border-slate-200/80 bg-white/[0.88] p-6 text-center shadow-[0_18px_46px_rgba(15,23,42,0.07)]">
        {isAttaching ? (
          <div className="flex items-center justify-center gap-2 text-sm text-slate-600">
            <Loader2 size={16} className="animate-spin" />
            正在连接场景 {sceneId} ...
          </div>
        ) : error ? (
          <>
            <div className="text-sm text-red-700">连接场景失败：{error}</div>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
            >
              <RefreshCcw size={12} />
              重试
            </button>
          </>
        ) : (
          <div className="text-sm text-slate-500">等待连接 {sceneId} ...</div>
        )}
      </div>
    </div>
  )
}
