import { Check, Compass, FileText, X } from "lucide-react"
import { memo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import type { MissionItem } from "@/features/chat/api/taskNoteApi"
import { formatTaskNoteTime, isMissionPruned } from "@/features/chat/model/taskNoteView"
import { TaskNoteSectionCard } from "./TaskNoteSectionCard"

export type TaskNoteMissionSectionProps = {
  missions: MissionItem[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  densityMode: "compact" | "expanded"
}

export const TaskNoteMissionSection = memo(function TaskNoteMissionSection({
  missions,
  isCollapsed,
  onToggleCollapse,
  densityMode,
}: TaskNoteMissionSectionProps) {
  const [showAllPromptsByMission, setShowAllPromptsByMission] = useState<Record<string, boolean>>({})

  if (!missions || missions.length === 0) {
    return null
  }

  const toggleShowAllPrompts = (missionId: string) => {
    setShowAllPromptsByMission((prev) => ({
      ...prev,
      [missionId]: !prev[missionId],
    }))
  }

  return (
    <TaskNoteSectionCard
      title="任务意图与需求规格"
      icon={<Compass size={14} className="text-blue-500" />}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      <div className="flex flex-col gap-3 text-xs text-app-secondary">
        {missions.map((mission) => {
          const mid = mission.mission_id
          const pruned = isMissionPruned(mission)
          const rawPrompts = mission.raw_prompts ?? []
          const showAll = Boolean(showAllPromptsByMission[mid])
          const visiblePrompts =
            densityMode === "expanded" || showAll
              ? rawPrompts
              : rawPrompts.slice(-1)

          return (
            <div
              key={mid || mission.title}
              className="space-y-2 border-b border-app-border/30 pb-3 last:border-b-0"
            >
              {/* 1. 任务标题与生命周期状态 */}
              {mission.title ? (
                <div className="flex items-start justify-between gap-3">
                  <h4 className="text-sm font-bold leading-snug text-app-primary">
                    {mission.title}
                  </h4>
                  {mission.status ? (
                    <div className="flex shrink-0 items-center gap-1.5 text-[11px]">
                      {mission.status === "completed" ? (
                        <>
                          <Check size={12} strokeWidth={2.5} className="text-emerald-600 dark:text-emerald-400" />
                          <span className="text-emerald-600 dark:text-emerald-400">已完成</span>
                        </>
                      ) : mission.status === "in_progress" ? (
                        <>
                          <span className="inline-block size-1.5 rounded-full bg-blue-500 animate-pulse" />
                          <span className="text-blue-600 dark:text-blue-400">执行中</span>
                        </>
                      ) : mission.status === "abandoned" ? (
                        <>
                          <X size={12} strokeWidth={2.5} className="text-app-muted" />
                          <span className="text-app-muted">已废弃</span>
                        </>
                      ) : (
                        <span className="text-app-muted">待处理</span>
                      )}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {/* 已裁剪 Mission：只显示归档时间和结果摘要 (UI-2) */}
              {pruned ? (
                <>
                  <div className="text-[11px] text-app-muted">
                    {mission.pruned_at
                      ? `已归档 · ${formatTaskNoteTime(mission.pruned_at)}`
                      : "已归档"}
                  </div>
                  {mission.outcome_summary ? (
                    <div className="space-y-1">
                      <div className="font-semibold text-app-primary">结果摘要</div>
                      <div className="leading-relaxed text-app-secondary">
                        {mission.outcome_summary}
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  {/* 2. 正式需求规格 */}
                  {mission.refined_requirement ? (
                    <div className="space-y-1">
                      <div className="flex items-center gap-1.5 font-semibold text-app-primary">
                        <FileText size={13} className="text-app-muted" />
                        <span>正式需求规格与验收边界</span>
                      </div>
                      <div className="prose prose-xs max-w-none text-app-secondary dark:prose-invert">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {densityMode === "compact" && mission.refined_requirement.length > 360
                            ? `${mission.refined_requirement.slice(0, 360)}...`
                            : mission.refined_requirement}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ) : null}

                  {/* 3. 用户原始意图指令 */}
                  {rawPrompts.length > 0 ? (
                    <div className="space-y-1 pt-1">
                      <div className="flex items-center justify-between text-[11px] text-app-muted">
                        <span className="font-semibold text-app-primary">
                          用户原始指令 ({rawPrompts.length})
                        </span>
                        {rawPrompts.length > 1 && densityMode === "compact" ? (
                          <button
                            type="button"
                            onClick={() => toggleShowAllPrompts(mid)}
                            className="text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                          >
                            {showAll ? "仅看最新" : `全部 (${rawPrompts.length})`}
                          </button>
                        ) : null}
                      </div>

                      <div className="flex flex-col gap-1 pl-1">
                        {visiblePrompts.map((p, idx) => {
                          const promptText =
                            typeof p === "string"
                              ? p
                              : typeof p === "object" && p !== null
                              ? (p as { prompt?: string }).prompt || JSON.stringify(p)
                              : String(p)

                          const promptTime =
                            typeof p === "object" && p !== null
                              ? (p as { timestamp?: string }).timestamp
                              : null

                          return (
                            <div
                              key={idx}
                              className="border-l-2 border-app-border/70 py-0.5 pl-2.5 text-[11px] leading-relaxed text-app-secondary"
                            >
                              <div className="italic text-app-primary">"{promptText}"</div>
                              {promptTime ? (
                                <div className="mt-0.5 font-mono text-[10px] text-app-muted">
                                  {promptTime}
                                </div>
                              ) : null}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )
        })}
      </div>
    </TaskNoteSectionCard>
  )
})
