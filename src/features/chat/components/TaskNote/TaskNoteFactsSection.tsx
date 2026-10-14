import { AlertOctagon, CheckCircle, FileCode, Link as LinkIcon, Search, ShieldAlert, Sparkles } from "lucide-react"
import { memo, useState } from "react"

import type { DiscoveryItem, IssueItem, WorkspaceContextItem } from "@/features/chat/api/taskNoteApi"
import { TaskNoteSectionCard } from "./TaskNoteSectionCard"

export type TaskNoteFactsSectionProps = {
  workspaceContexts: WorkspaceContextItem[]
  discoveries: DiscoveryItem[]
  issues: IssueItem[]
  commandLineById: Record<string, string>
  isCollapsed: boolean
  onToggleCollapse: () => void
  densityMode: "compact" | "expanded"
}

function cleanSourcePath(fullPath: string): string {
  if (!fullPath) return ""
  const normalized = fullPath.replace(/\\/g, "/")
  const match = normalized.match(/(?:agentruntime|agent-frontend|src|config|docs)\/.*$/i)
  if (match) {
    return match[0]
  }
  const parts = normalized.split("/")
  if (parts.length > 3) {
    return parts.slice(-3).join("/")
  }
  return normalized
}

export const TaskNoteFactsSection = memo(function TaskNoteFactsSection({
  workspaceContexts,
  discoveries,
  issues,
  commandLineById,
  isCollapsed,
  onToggleCollapse,
  densityMode,
}: TaskNoteFactsSectionProps) {
  const [showAllDiscoveries, setShowAllDiscoveries] = useState(false)
  const totalCount = workspaceContexts.length + discoveries.length + issues.length
  const unresolvedIssues = issues.filter((i) => i.status !== "resolved" && i.status !== "wont_fix")
  const resolvedIssues = issues.filter((i) => i.status === "resolved" || i.status === "wont_fix")

  const visibleDiscoveries =
    densityMode === "expanded" || showAllDiscoveries
      ? discoveries
      : discoveries.slice(0, 4)

  if (totalCount === 0) {
    return null
  }

  return (
    <TaskNoteSectionCard
      title="关键发现与问题复盘"
      icon={<ShieldAlert size={14} className="text-amber-500" />}
      count={totalCount}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      <div className="flex flex-col gap-3 text-xs text-app-secondary">
        {/* 1. 问题与阻塞跟踪 */}
        {issues.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-semibold text-app-primary">
              <div className="flex items-center gap-1.5">
                <AlertOctagon size={13} className="text-rose-500" />
                <span>遇到问题与根因复盘</span>
              </div>
              <span className="text-[10px] font-normal text-app-muted">
                {unresolvedIssues.length} 进行中 · {resolvedIssues.length} 已闭环
              </span>
            </div>

            <div className="flex flex-col gap-2 pl-1">
              {/* 未解决问题 */}
              {unresolvedIssues.map((issue) => {
                const commandLine = issue.command_id ? commandLineById[issue.command_id] : null

                return (
                  <div
                    key={issue.issue_id}
                    className="border-l-2 border-rose-500 py-0.5 pl-2.5 leading-relaxed"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-app-primary">{issue.issue_content}</span>
                      <span className="shrink-0 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                        {issue.status}
                      </span>
                    </div>
                    {issue.impact ? (
                      <div className="mt-0.5 text-xs text-app-secondary">
                        <span className="font-medium text-app-primary">影响：</span>
                        <span>{issue.impact}</span>
                      </div>
                    ) : null}
                    {issue.next_action ? (
                      <div className="text-[11px] text-rose-600 dark:text-rose-400">
                        <span className="font-medium">排查措施：</span>
                        <span>{issue.next_action}</span>
                      </div>
                    ) : null}
                    {commandLine ? (
                      <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[10px] text-app-muted">
                        <span className="shrink-0 font-semibold text-app-secondary">报错命令：</span>
                        <span className="select-none text-app-muted">$</span>
                        <code className="truncate rounded bg-app-shell/60 px-1 py-0.2 text-app-primary">
                          {commandLine}
                        </code>
                      </div>
                    ) : null}
                  </div>
                )
              })}

              {/* 已解决问题与复盘 */}
              {resolvedIssues.map((issue) => {
                const commandLine = issue.command_id ? commandLineById[issue.command_id] : null

                return (
                  <div
                    key={issue.issue_id}
                    className="border-l-2 border-emerald-500/50 py-0.5 pl-2.5 leading-relaxed dark:border-emerald-600/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 font-medium text-app-primary">
                        <CheckCircle size={13} className="shrink-0 text-emerald-600" />
                        <span>{issue.issue_content}</span>
                      </div>
                      <span className="shrink-0 text-[10px] text-emerald-600 dark:text-emerald-400">
                        已解决
                      </span>
                    </div>
                    {issue.resolution ? (
                      <div className="mt-0.5 text-xs text-app-secondary">
                        <span className="font-medium text-app-primary">根因复盘：</span>
                        <span>{issue.resolution}</span>
                      </div>
                    ) : null}
                    {commandLine ? (
                      <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[10px] text-app-muted">
                        <span className="shrink-0 font-semibold text-app-secondary">关联命令：</span>
                        <span className="select-none text-app-muted">$</span>
                        <code className="truncate rounded bg-app-shell/60 px-1 py-0.2 text-app-primary">
                          {commandLine}
                        </code>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* 2. 客观认知发现 */}
        {discoveries.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between font-semibold text-app-primary">
              <div className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-sky-500" />
                <span>认知突破与调查证据</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-normal text-app-muted">
                  共 {discoveries.length} 项
                </span>
                {discoveries.length > 4 && densityMode === "compact" ? (
                  <button
                    type="button"
                    onClick={() => setShowAllDiscoveries(!showAllDiscoveries)}
                    className="text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                  >
                    {showAllDiscoveries ? "仅看前 4 项" : `展开全部 (${discoveries.length})`}
                  </button>
                ) : null}
              </div>
            </div>

            <div className="flex flex-col gap-2.5 pl-1">
              {visibleDiscoveries.map((disc, idx) => {
                const commandLine = disc.command_id ? commandLineById[disc.command_id] : null

                return (
                  <div
                    key={disc.discovery_id}
                    className="border-l-2 border-sky-400/60 py-0.5 pl-2.5 leading-relaxed dark:border-sky-500/60"
                  >
                    {/* 核心认知发现 */}
                    <div className="text-xs leading-relaxed text-app-primary">
                      <span className="mr-1.5 font-mono text-[10px] font-bold text-sky-600 dark:text-sky-400">
                        #{idx + 1}
                      </span>
                      <span className="font-medium text-app-primary">
                        {disc.discovery_content}
                      </span>
                    </div>

                    {/* 业务与架构影响 */}
                    {disc.impact ? (
                      <div className="mt-1 flex items-start gap-1.5 text-[11px] leading-relaxed text-app-secondary">
                        <span className="shrink-0 font-medium text-app-primary">
                          影响：
                        </span>
                        <span className="text-app-secondary">{disc.impact}</span>
                      </div>
                    ) : null}

                    {/* 证据与代码坐标 */}
                    {disc.source_path ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]">
                        <span className="font-medium text-app-muted">证据：</span>
                        <code
                          title={disc.source_path}
                          className="inline-flex max-w-full items-center gap-1 overflow-hidden rounded bg-app-shell/80 px-1.5 py-0.5 font-mono text-[10px] text-app-secondary border border-app-border/40 hover:text-app-primary transition"
                        >
                          <FileCode size={11} className="shrink-0 text-app-muted" />
                          <span className="truncate">{cleanSourcePath(disc.source_path)}</span>
                          {disc.line_ranges?.length ? (
                            <span className="shrink-0 font-semibold text-blue-600 dark:text-blue-400">
                              :L{disc.line_ranges.map((r) => `${r.start_line}-${r.end_line}`).join(", ")}
                            </span>
                          ) : null}
                        </code>
                      </div>
                    ) : null}

                    {/* 关联终端命令 */}
                    {commandLine ? (
                      <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[10px] text-app-muted">
                        <span className="shrink-0 font-semibold text-app-secondary">执行命令：</span>
                        <span className="select-none text-app-muted">$</span>
                        <code className="truncate rounded bg-app-shell/60 px-1 py-0.2 text-app-primary">
                          {commandLine}
                        </code>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        {/* 3. 工作区核心相关上下文 */}
        {workspaceContexts.length > 0 ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between font-semibold text-app-primary">
              <div className="flex items-center gap-1.5">
                <FileCode size={13} className="text-app-muted" />
                <span>工作区核心相关上下文</span>
              </div>
              <span className="text-[10px] font-normal text-app-muted">
                共 {workspaceContexts.length} 项
              </span>
            </div>

            <div className="flex flex-col gap-2.5 pl-1">
              {workspaceContexts.map((ctx, idx) => (
                <div key={ctx.context_id} className="space-y-1 text-xs leading-relaxed">
                  {/* 摘要在上面 */}
                  {ctx.description ? (
                    <div className="font-medium text-app-primary leading-relaxed">
                      <span className="mr-1.5 font-mono text-[10px] font-bold text-sky-600 dark:text-sky-400">
                        #{idx + 1}
                      </span>
                      <span>{ctx.description}</span>
                    </div>
                  ) : null}

                  {/* 范围位置在下面 */}
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    {!ctx.description ? (
                      <span className="mr-1 font-mono text-[10px] font-bold text-sky-600 dark:text-sky-400">
                        #{idx + 1}
                      </span>
                    ) : null}
                    {ctx.source_type === "file" || ctx.source_type === "directory" ? (
                      <FileCode size={11} className="shrink-0 text-app-muted" />
                    ) : ctx.source_type === "web_search" ? (
                      <Search size={11} className="shrink-0 text-app-muted" />
                    ) : (
                      <LinkIcon size={11} className="shrink-0 text-app-muted" />
                    )}
                    <span className="font-mono uppercase text-app-muted">
                      {ctx.source_type || "file"}
                    </span>
                    {ctx.path ? (
                      <code
                        title={ctx.path}
                        className="inline-flex max-w-full items-center gap-1 overflow-hidden rounded bg-app-shell/80 px-1.5 py-0.5 font-mono text-[10px] text-app-secondary border border-app-border/40 hover:text-app-primary transition"
                      >
                        <span className="truncate">{cleanSourcePath(ctx.path)}</span>
                        {ctx.line_ranges?.length ? (
                          <span className="shrink-0 font-semibold text-blue-600 dark:text-blue-400">
                            L{ctx.line_ranges.map((r) => `${r.start_line}-${r.end_line}`).join(", ")}
                          </span>
                        ) : null}
                      </code>
                    ) : ctx.search_content ? (
                      <span className="font-medium text-app-secondary">{ctx.search_content}</span>
                    ) : null}

                    {ctx.line_ranges?.length && !ctx.path ? (
                      <span className="font-mono text-blue-600 dark:text-blue-400">
                        L{ctx.line_ranges.map((r) => `${r.start_line}-${r.end_line}`).join(", ")}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </TaskNoteSectionCard>
  )
})
