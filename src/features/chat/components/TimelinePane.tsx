import { memo, useMemo, type CSSProperties } from "react"

import { ExecutionMonitorPanel } from "@/features/chat/components/ExecutionMonitorPanel"
import { TaskNotePanel } from "@/features/chat/components/TaskNote/TaskNotePanel"
import { useTaskNoteQuery } from "@/features/chat/hooks/useTaskNoteQuery"
import { hasTaskNoteContent } from "@/features/chat/model/taskNoteView"
import { useTaskNoteUiStore } from "@/features/chat/model/taskNoteUiStore"

export type TimelinePaneProps = {
  sceneId: string
  taskId?: string | null
  agentInstanceId?: string | null
  agentDefinitionId?: string | null
  hasTerminalPanel?: boolean
  presentation?: "sidebar" | "full"
}

const SIDEBAR_MONITOR_WIDTH = "clamp(28ch, 32ch, min(42ch, 36vw))"
const TASK_NOTE_PANE_WIDTH = "clamp(56ch, 64ch, min(84ch, 72vw))"

/**
 * Agent 独立巡检容器 (Inspector)。
 *
 * 封装侧边栏 aside 结构，承载双 Tab 切换：
 * 1. LLM / Tool timeline：工具与大模型流水（宽度 W）
 * 2. Task Note：任务现场工作手记（有实质内容时为 2W，内容为空时保持与 timeline 基础宽度 W 一致，避免空白过大）
 *
 * 宽度离散切换，无 CSS transition 动画，避免连续重排抖动；
 * 仅接收 primitive IDs，与左侧会话面板彻底解耦。
 */
export const TimelinePane = memo(function TimelinePane({
  sceneId,
  taskId,
  agentInstanceId,
  agentDefinitionId,
  hasTerminalPanel = false,
  presentation = "sidebar",
}: TimelinePaneProps) {
  const activeTabByAgent = useTaskNoteUiStore((s) => s.activeTabByAgent)
  const defaultActiveTab = useTaskNoteUiStore((s) => s.activeTab)
  const activeTab = (agentInstanceId ? activeTabByAgent[agentInstanceId] : null) ?? defaultActiveTab ?? "timeline"
  const setActiveTab = useTaskNoteUiStore((s) => s.setActiveTab)

  // 查询当前 Task Note 快照，复用与 TaskNotePanel 相同的 React Query 缓存
  const { data: taskNoteData } = useTaskNoteQuery(taskId, agentInstanceId)

  const hasNoteContent = useMemo(
    () => hasTaskNoteContent(taskNoteData),
    [taskNoteData]
  )

  // 当处于 task_note 且存在实质手记内容时使用 2W 展开宽度；
  // 当手记为空或处于 timeline tab 时，宽度与 timeline 保持完全一致，避免大面积空白
  const currentWidth =
    activeTab === "task_note" && hasNoteContent ? TASK_NOTE_PANE_WIDTH : SIDEBAR_MONITOR_WIDTH

  const panelStyle: CSSProperties | undefined =
    hasTerminalPanel || presentation === "full"
      ? undefined
      : {
          inlineSize: currentWidth,
          maxInlineSize: currentWidth,
        }

  const tabSwitcher = (
    <div className="flex shrink-0 items-center gap-3.5 whitespace-nowrap">
      <button
        type="button"
        onClick={() => setActiveTab("timeline", agentInstanceId)}
        className={[
          "shrink-0 whitespace-nowrap text-xs transition-colors focus:outline-none",
          activeTab === "timeline"
            ? "font-bold text-slate-950 dark:text-white"
            : "font-medium text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300",
        ].join(" ")}
      >
        LLM TimeLine
      </button>
      <button
        type="button"
        onClick={() => setActiveTab("task_note", agentInstanceId)}
        className={[
          "shrink-0 whitespace-nowrap text-xs transition-colors focus:outline-none",
          activeTab === "task_note"
            ? "font-bold text-slate-950 dark:text-white"
            : "font-medium text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300",
        ].join(" ")}
      >
        Task Note
      </button>
    </div>
  )

  return (
    <aside
      className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl border border-app-border/80 bg-app-bg shadow-[0_12px_34px_rgba(15,23,42,0.08)]"
      style={panelStyle}
      aria-label="Agent 巡检监控面板"
    >
      {activeTab === "task_note" && agentInstanceId ? (
        <TaskNotePanel
          sceneId={sceneId}
          taskId={taskId}
          agentInstanceId={agentInstanceId}
          agentDefinitionId={agentDefinitionId}
          hasTerminalPanel={hasTerminalPanel}
          presentation={presentation}
          headerLeading={tabSwitcher}
        />
      ) : (
        <ExecutionMonitorPanel
          sceneId={sceneId}
          agentInstanceId={agentInstanceId}
          hasTerminalPanel={hasTerminalPanel}
          presentation="full"
          headerLeading={tabSwitcher}
        />
      )}
    </aside>
  )
})
