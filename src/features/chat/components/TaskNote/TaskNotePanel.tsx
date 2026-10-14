import {
  Check,
  Clock,
  Copy,
  Maximize2,
  Minimize2,
  RefreshCw,
  Sparkles,
} from "lucide-react"
import { memo, useMemo, useState, type ReactNode } from "react"

import { useTaskNoteQuery } from "@/features/chat/hooks/useTaskNoteQuery"
import {
  buildTaskNoteView,
  hasTaskNoteContent,
  taskNoteErrorView,
} from "@/features/chat/model/taskNoteView"
import { useTaskNoteUiStore } from "@/features/chat/model/taskNoteUiStore"
import { TaskNoteCollaborationSection } from "./TaskNoteCollaborationSection"
import { TaskNoteDeliverySection } from "./TaskNoteDeliverySection"
import { TaskNoteFactsSection } from "./TaskNoteFactsSection"
import { TaskNoteMissionSection } from "./TaskNoteMissionSection"
import { TaskNotePlanSection } from "./TaskNotePlanSection"
import { TaskNoteProgressSection } from "./TaskNoteProgressSection"

export type TaskNotePanelProps = {
  sceneId: string
  taskId?: string | null
  agentInstanceId: string
  agentDefinitionId?: string | null
  hasTerminalPanel?: boolean
  presentation?: "sidebar" | "full"
  headerLeading?: ReactNode
}

export const TaskNotePanel = memo(function TaskNotePanel({
  sceneId,
  taskId,
  agentInstanceId,
  agentDefinitionId,
  hasTerminalPanel = false,
  presentation = "sidebar",
  headerLeading,
}: TaskNotePanelProps) {
  const [copied, setCopied] = useState(false)
  const densityMode = useTaskNoteUiStore((s) => s.densityMode)
  const toggleDensityMode = useTaskNoteUiStore((s) => s.toggleDensityMode)

  // 独立 Section 的展开/折叠状态
  const sectionCollapsed = useTaskNoteUiStore((s) => s.sectionCollapsed)
  const toggleSectionCollapsed = useTaskNoteUiStore((s) => s.toggleSectionCollapsed)

  const isCollapsed = (key: string, defaultCollapsed = false) => {
    const compositeKey = `${agentInstanceId}:${key}`
    return sectionCollapsed[compositeKey] !== undefined
      ? sectionCollapsed[compositeKey]
      : defaultCollapsed
  }

  const handleToggleCollapse = (key: string, defaultCollapsed = false) => {
    const compositeKey = `${agentInstanceId}:${key}`
    toggleSectionCollapsed(compositeKey, defaultCollapsed)
  }

  const hasValidTask = Boolean(taskId && taskId.trim().length > 0)

  // 核心数据查询 hook
  const {
    data,
    isLoading,
    isFetching,
    error,
    refetch,
    errorKind,
  } = useTaskNoteQuery(taskId, agentInstanceId)

  // 派生统一视图模型
  const view = useMemo(() => buildTaskNoteView(data), [data])
  const hasAnySectionContent = useMemo(() => hasTaskNoteContent(data), [data])

  // 复制完整 Markdown
  const handleCopyMarkdown = async () => {
    if (!data?.markdown) return
    try {
      await navigator.clipboard.writeText(data.markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // 忽略剪贴板权限异常
    }
  }

  const shortId = agentInstanceId.length > 12 ? agentInstanceId.slice(0, 12) : agentInstanceId

  // 边界 2：新打开的 Agent 实例，还没发生对话时 task_id 尚未创建
  if (!hasValidTask) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-bg text-app-primary">
        <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-app-border/80 bg-app-shell/70 px-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {headerLeading ? (
              headerLeading
            ) : (
              <>
                <Sparkles size={13} className="text-blue-500" />
                <span className="truncate text-xs font-semibold text-app-primary">
                  {agentDefinitionId || "Agent"} Note
                </span>
                <span
                  className="shrink-0 font-mono text-[10px] text-app-muted cursor-help"
                  title={`完整实例 ID: ${agentInstanceId}`}
                >
                  ({shortId})
                </span>
              </>
            )}
          </div>
        </header>
        <div className="flex flex-1 min-h-0 min-w-0 flex-col items-center justify-center p-6 text-center text-slate-400 dark:text-slate-500">
          <div className="rounded-full bg-slate-100 p-3 dark:bg-slate-800">
            <Clock size={24} className="text-slate-400" />
          </div>
          <div className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
            任务会期尚未开始
          </div>
          <p className="mt-1 max-w-[280px] text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
            在左侧发送第一条用户消息后，系统将自动分配 Task 会期并初始化现场工作手记。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-bg text-app-primary">
      {/* 顶部标题与控制栏 */}
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-app-border/80 bg-app-shell/70 px-3">
        <div className="flex min-w-0 items-center gap-1.5">
          {headerLeading ? (
            headerLeading
          ) : (
            <>
              <Sparkles size={13} className="text-blue-500" />
              <span className="truncate text-xs font-semibold text-app-primary">
                {agentDefinitionId || "Agent"} Note
              </span>
              <span
                className="shrink-0 font-mono text-[10px] text-app-muted cursor-help"
                title={`完整实例 ID: ${agentInstanceId}`}
              >
                ({shortId})
              </span>
            </>
          )}

          {isFetching ? (
            <span title="正在拉取最新手记...">
              <RefreshCw size={11} className="animate-spin text-blue-500" />
            </span>
          ) : null}

          {/* 整理中状态指示 (UI-5a) */}
          {view.observing ? (
            <span
              className="flex shrink-0 items-center gap-1 text-[10px] text-blue-600 dark:text-blue-400"
              title="后台正在整理工作手记"
            >
              <span className="inline-block size-1.5 rounded-full bg-blue-500 animate-pulse" />
              整理中
            </span>
          ) : null}

          {/* 更新时间戳 (UI-5b) */}
          {view.updatedAtText ? (
            <span
              className="shrink-0 font-mono text-[10px] text-app-muted"
              title={`手记版本 v${view.noteVersion}`}
            >
              更新于 {view.updatedAtText}
            </span>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {/* Compact / Expanded 展开密度切换按钮 */}
          {hasAnySectionContent ? (
            <button
              type="button"
              onClick={toggleDensityMode}
              className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-app-muted transition hover:bg-app-surface hover:text-app-primary"
              title={densityMode === "compact" ? "切换为 Expanded 展开视图" : "切换为 Compact 紧凑视图"}
            >
              {densityMode === "compact" ? <Maximize2 size={11} /> : <Minimize2 size={11} />}
              <span>{densityMode === "compact" ? "紧凑" : "展开"}</span>
            </button>
          ) : null}

          {/* 复制 Markdown 按钮 */}
          <button
            type="button"
            onClick={handleCopyMarkdown}
            disabled={!data?.markdown}
            className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-medium text-app-muted transition hover:bg-app-surface hover:text-app-primary disabled:opacity-40"
            title="复制完整 Markdown 现场手记"
          >
            {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
            <span>{copied ? "已复制" : "复制"}</span>
          </button>
        </div>
      </header>

      {/* 滚动内容区 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-2 text-app-primary">
        {isLoading && !data ? (
          <div className="flex flex-col gap-4 py-4 animate-pulse">
            <div className="h-4 w-1/3 rounded bg-app-shell/60" />
            <div className="h-3 w-3/4 rounded bg-app-shell/40" />
            <div className="h-3 w-1/2 rounded bg-app-shell/40" />
            <div className="h-4 w-1/4 rounded bg-app-shell/60 mt-4" />
            <div className="h-3 w-4/5 rounded bg-app-shell/40" />
          </div>
        ) : error ? (
          (() => {
            const ev = taskNoteErrorView(
              errorKind ?? "other",
              error instanceof Error ? error.message : "请求失败",
            )
            return (
              <div className="border-l-2 border-rose-500 pl-3 py-2 text-xs text-rose-600 dark:text-rose-400">
                <div className="font-semibold">{ev.title}</div>
                <div className="mt-0.5 text-[11px] opacity-90">{ev.detail}</div>
                {ev.retryable ? (
                  <button
                    type="button"
                    onClick={() => refetch()}
                    className="mt-2 rounded bg-app-shell/80 px-2 py-0.5 text-[10px] font-medium text-app-primary hover:bg-app-surface"
                  >
                    重试
                  </button>
                ) : null}
              </div>
            )
          })()
        ) : !hasAnySectionContent ? (
          <div className="flex flex-1 min-h-0 flex-col items-center justify-center p-6 text-center text-slate-400 dark:text-slate-500">
            <div className="rounded-full bg-slate-100 p-3 dark:bg-slate-800">
              <Clock size={24} className="text-slate-400" />
            </div>
            <div className="mt-3 text-xs font-semibold text-slate-700 dark:text-slate-300">
              暂无任务手记内容
            </div>
            <p className="mt-1 max-w-[280px] text-[11px] leading-relaxed text-slate-400 dark:text-slate-500">
              Agent 在该会期中尚未记录工作手记章节。
            </p>
          </div>
        ) : (
          <>
            {/* 章节 1：任务意图与需求规格 */}
            <TaskNoteMissionSection
              missions={view.missions}
              isCollapsed={isCollapsed("mission", false)}
              onToggleCollapse={() => handleToggleCollapse("mission", false)}
              densityMode={densityMode}
            />

            {/* 章节 2：执行进展与当前状态 */}
            <TaskNoteProgressSection
              progresses={view.progresses}
              missionTitleById={view.missionTitleById}
              isCollapsed={isCollapsed("progress", false)}
              onToggleCollapse={() => handleToggleCollapse("progress", false)}
              densityMode={densityMode}
            />

            {/* 章节 3：技术方案与计划待办 */}
            <TaskNotePlanSection
              solutions={view.solutions}
              decisions={view.decisions}
              todos={view.todos}
              missionTitleById={view.missionTitleById}
              isCollapsed={isCollapsed("plan", false)}
              onToggleCollapse={() => handleToggleCollapse("plan", false)}
              densityMode={densityMode}
            />

            {/* 章节 4：现场背景与避坑认知 */}
            <TaskNoteFactsSection
              workspaceContexts={view.workspaceContexts}
              discoveries={view.discoveries}
              issues={view.issues}
              commandLineById={view.commandLineById}
              isCollapsed={isCollapsed("facts", densityMode === "compact")}
              onToggleCollapse={() => handleToggleCollapse("facts", densityMode === "compact")}
              densityMode={densityMode}
            />

            {/* 章节 5：交付产物与验证保障 */}
            <TaskNoteDeliverySection
              fileChanges={view.fileChanges}
              otherArtifacts={view.otherArtifacts}
              validations={view.validations}
              externalStates={view.externalStates}
              commandLineById={view.commandLineById}
              isCollapsed={isCollapsed("delivery", densityMode === "compact")}
              onToggleCollapse={() => handleToggleCollapse("delivery", densityMode === "compact")}
              densityMode={densityMode}
            />

            {/* 章节 6：协作网络与专线通信 */}
            <TaskNoteCollaborationSection
              relationships={view.relationships}
              messages={view.agentMessages}
              remoteMessages={view.remoteMessages}
              isCollapsed={isCollapsed("collaboration", false)}
              onToggleCollapse={() => handleToggleCollapse("collaboration", false)}
              densityMode={densityMode}
            />
          </>
        )}
      </div>
    </div>
  )
})
