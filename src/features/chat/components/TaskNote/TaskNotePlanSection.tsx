import { Check, CheckSquare, Circle, Clock, GitCommit, Layers, Lightbulb } from "lucide-react"
import { memo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import type { DecisionItem, SolutionItem, TodoItem } from "@/features/chat/api/taskNoteApi"
import { TaskNoteSectionCard } from "./TaskNoteSectionCard"

export type TaskNotePlanSectionProps = {
  solutions: SolutionItem[]
  decisions: DecisionItem[]
  todos: TodoItem[]
  missionTitleById: Record<string, string>
  isCollapsed: boolean
  onToggleCollapse: () => void
  densityMode: "compact" | "expanded"
}

export const TaskNotePlanSection = memo(function TaskNotePlanSection({
  solutions,
  decisions,
  todos,
  missionTitleById,
  isCollapsed,
  onToggleCollapse,
  densityMode,
}: TaskNotePlanSectionProps) {
  const hasContent = Boolean(solutions.length > 0 || decisions.length > 0 || todos.length > 0)
  const sortedTodos = [...todos].sort((a, b) => a.priority - b.priority)

  if (!hasContent) {
    return null
  }

  const showMissionTag = solutions.length > 1

  return (
    <TaskNoteSectionCard
      title="技术方案与计划待办"
      icon={<Layers size={14} className="text-purple-500" />}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      <div className="flex flex-col gap-3 text-xs text-app-secondary">
        {/* 1. 宏观架构方案 (支持多条平铺渲染) */}
        {solutions.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 font-semibold text-app-primary">
              <Lightbulb size={13} className="text-amber-500" />
              <span>宏观实施方案</span>
            </div>

            <div className="flex flex-col gap-2">
              {solutions.map((solution, idx) => {
                const missionTitle = solution.mission_id ? missionTitleById[solution.mission_id] : ""
                const tagText = missionTitle || (showMissionTag ? "未命名任务" : "")

                return (
                  <div
                    key={solution.solution_id || solution.mission_id || idx}
                    className="space-y-1.5 border-b border-app-border/30 pb-2.5 last:border-b-0"
                  >
                    {showMissionTag && tagText ? (
                      <div>
                        <span className="inline-block max-w-full truncate rounded bg-app-shell/60 px-1 py-0.2 font-mono text-[10px] text-app-muted">
                          {tagText}
                        </span>
                      </div>
                    ) : null}

                    <div className="prose prose-xs max-w-none text-app-secondary dark:prose-invert">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {densityMode === "compact" && solution.solution_content.length > 360
                          ? `${solution.solution_content.slice(0, 360)}...`
                          : solution.solution_content}
                      </ReactMarkdown>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* 2. 计划与待办清单 */}
        {sortedTodos.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-semibold text-app-primary">
              <div className="flex items-center gap-1.5">
                <CheckSquare size={13} className="text-blue-500" />
                <span>待办任务清单</span>
              </div>
              <span className="text-[10px] font-normal text-app-muted">
                {sortedTodos.filter((t) => t.status === "已完成").length} / {sortedTodos.length} 已完成
              </span>
            </div>

            <div className="flex flex-col gap-1 pl-1">
              {sortedTodos.map((todo) => {
                const isDone = todo.status === "已完成"
                const isDoing = todo.status === "执行中"
                return (
                  <div key={todo.todo_id} className="flex items-start gap-2 py-0.5 leading-snug">
                    <span className="mt-0.5 inline-flex size-3.5 shrink-0 select-none items-center justify-center">
                      {isDone ? (
                        <Check size={13} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400" />
                      ) : isDoing ? (
                        <Clock size={13} className="animate-pulse text-blue-600 dark:text-blue-400" />
                      ) : (
                        <Circle size={11} className="text-app-muted/60" />
                      )}
                    </span>

                    <span className="shrink-0 font-mono text-[10px] text-app-muted">
                      P{todo.priority}
                    </span>

                    <span className="min-w-0 flex-1 text-app-secondary">
                      {todo.todo_content}
                    </span>

                    <span
                      className={[
                        "shrink-0 text-[10px]",
                        isDone
                          ? "text-emerald-600 dark:text-emerald-400"
                          : isDoing
                          ? "font-medium text-blue-600 dark:text-blue-400"
                          : "text-app-muted",
                      ].join(" ")}
                    >
                      {todo.status}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* 3. 关键架构与技术决策 */}
        {decisions.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-app-primary">
              <GitCommit size={13} className="text-purple-500" />
              <span>关键技术决策与权衡</span>
            </div>

            <div className="flex flex-col gap-2 pl-1">
              {decisions.map((dec) => (
                <div
                  key={dec.decision_id}
                  className="border-l-2 border-purple-400/50 py-0.5 pl-2.5 leading-relaxed dark:border-purple-600/50"
                >
                  <div className="font-semibold text-app-primary">
                    {dec.decision_content}
                    {dec.decision_status === "superseded" ? (
                      <span className="ml-2 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-normal text-amber-600 dark:text-amber-400">
                        已废弃
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-app-secondary">
                    <span className="font-medium text-app-primary">采纳理由：</span>
                    <span>{dec.rationale}</span>
                  </div>
                  {dec.superseded_reason ? (
                    <div className="text-[11px] text-amber-600 dark:text-amber-400">
                      <span className="font-medium">废弃理由：</span>
                      <span>{dec.superseded_reason}</span>
                    </div>
                  ) : null}
                  {dec.alternatives ? (
                    <div className="text-[11px] text-app-muted">
                      <span className="font-medium">放弃备选：</span>
                      <span>{dec.alternatives}</span>
                    </div>
                  ) : null}
                  {dec.impact ? (
                    <div className="text-[11px] text-purple-700 dark:text-purple-300">
                      <span className="font-medium">约束影响：</span>
                      <span>{dec.impact}</span>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </TaskNoteSectionCard>
  )
})
