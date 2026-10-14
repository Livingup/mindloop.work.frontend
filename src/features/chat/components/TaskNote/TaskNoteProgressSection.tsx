import { Activity, AlertTriangle, CheckCircle2 } from "lucide-react"
import { memo } from "react"

import type { ProgressItem } from "@/features/chat/api/taskNoteApi"
import { TaskNoteSectionCard } from "./TaskNoteSectionCard"

export type TaskNoteProgressSectionProps = {
  progresses: ProgressItem[]
  missionTitleById: Record<string, string>
  isCollapsed: boolean
  onToggleCollapse: () => void
  densityMode: "compact" | "expanded"
}

export const TaskNoteProgressSection = memo(function TaskNoteProgressSection({
  progresses,
  missionTitleById,
  isCollapsed,
  onToggleCollapse,
}: TaskNoteProgressSectionProps) {
  if (!progresses || progresses.length === 0) {
    return null
  }

  const showMissionTag = progresses.length > 1

  return (
    <TaskNoteSectionCard
      title="执行进展与当前状态"
      icon={<Activity size={14} className="text-emerald-500" />}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      <div className="flex flex-col gap-3 text-xs text-app-secondary">
        {progresses.map((progress, idx) => {
          const missionTitle = progress.mission_id ? missionTitleById[progress.mission_id] : ""
          const tagText = missionTitle || (showMissionTag ? "未命名任务" : "")

          return (
            <div
              key={progress.progress_id || progress.mission_id || idx}
              className="space-y-2 border-b border-app-border/30 pb-3 last:border-b-0"
            >
              {/* Mission 归属标注 (UI-1) */}
              {showMissionTag && tagText ? (
                <div className="pb-0.5">
                  <span className="inline-block max-w-full truncate rounded bg-app-shell/60 px-1 py-0.2 font-mono text-[10px] text-app-muted">
                    {tagText}
                  </span>
                </div>
              ) : null}

              {/* 1. 当前微观焦点工作 */}
              {progress.current_work ? (
                <div className="space-y-1">
                  <div className="font-semibold text-app-primary">当前微观焦点</div>
                  <div className="leading-relaxed text-app-primary">
                    {progress.current_work}
                  </div>
                </div>
              ) : null}

              {/* 1.5. 即刻下一步 (next_step) */}
              {progress.next_step ? (
                <div className="space-y-1">
                  <div className="font-semibold text-app-primary">下一步</div>
                  <div className="leading-relaxed text-app-primary">
                    {progress.next_step}
                  </div>
                </div>
              ) : null}

              {/* 2. 阶段已完成总结 */}
              {progress.completed_summary ? (
                <div className="space-y-1">
                  <div className="font-semibold text-emerald-600 dark:text-emerald-400">已完成总结</div>
                  <div className="leading-relaxed text-app-secondary">
                    {progress.completed_summary}
                  </div>
                </div>
              ) : null}

              {/* 3. 当前阻塞与风险 */}
              {progress.current_blockers ? (
                <div className="my-0.5 space-y-1 border-l-2 border-amber-500 pl-3 py-1">
                  <div className="flex items-center gap-1.5 font-semibold text-amber-600 dark:text-amber-400">
                    <AlertTriangle size={13} />
                    <span>当前阻塞与风险</span>
                  </div>
                  <div className="leading-relaxed text-amber-900 dark:text-amber-200">
                    {progress.current_blockers}
                  </div>
                </div>
              ) : null}

              {/* 4. 最近重要验证结论 */}
              {progress.recent_validation ? (
                <div className="space-y-1">
                  <div className="flex items-center gap-1.5 font-semibold text-app-primary">
                    <CheckCircle2 size={13} className="shrink-0 text-emerald-600" />
                    <span>最近验证</span>
                  </div>
                  <div className="leading-relaxed text-app-secondary">
                    {progress.recent_validation}
                  </div>
                </div>
              ) : null}

              {/* 5. 交接风险与避坑备忘 */}
              {progress.handoff_notes ? (
                <div className="space-y-1">
                  <div className="font-semibold text-app-primary">交接避坑</div>
                  <div className="text-[11px] leading-relaxed text-app-muted">
                    {progress.handoff_notes}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </TaskNoteSectionCard>
  )
})
