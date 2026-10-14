import { Database, FileCheck, Package } from "lucide-react"
import { memo, useState } from "react"

import type {
  ArtifactItem,
  ExternalStateItem,
  ValidationItem,
} from "@/features/chat/api/taskNoteApi"
import type { FileChangeEntry } from "@/features/chat/model/taskNoteArtifacts"
import { TaskNoteSectionCard } from "./TaskNoteSectionCard"

export type TaskNoteDeliverySectionProps = {
  fileChanges: FileChangeEntry[]
  otherArtifacts: ArtifactItem[]
  validations: ValidationItem[]
  externalStates: ExternalStateItem[]
  commandLineById: Record<string, string>
  isCollapsed: boolean
  onToggleCollapse: () => void
  densityMode: "compact" | "expanded"
}

export const TaskNoteDeliverySection = memo(function TaskNoteDeliverySection({
  fileChanges,
  otherArtifacts,
  validations,
  externalStates,
  commandLineById,
  isCollapsed,
  onToggleCollapse,
  densityMode,
}: TaskNoteDeliverySectionProps) {
  const [expandedFileKeys, setExpandedFileKeys] = useState<Record<string, boolean>>({})

  const totalCount =
    fileChanges.length + otherArtifacts.length + validations.length + externalStates.length

  if (totalCount === 0) {
    return null
  }

  const toggleExpandFile = (key: string) => {
    setExpandedFileKeys((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  return (
    <TaskNoteSectionCard
      title="交付产物与验证保障"
      icon={<Package size={14} className="text-emerald-500" />}
      count={totalCount}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      <div className="flex flex-col gap-3 text-xs text-app-secondary">
        {/* 1. 验证检查结论 */}
        {validations.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-app-primary">
              <FileCheck size={13} className="text-emerald-500" />
              <span>质量验证结论</span>
            </div>

            <div className="flex flex-col gap-2 pl-1">
              {validations.map((val) => {
                const isPassed = val.conclusion === "passed"
                const isFailed = val.conclusion === "failed"
                const commandLine = val.command_id ? commandLineById[val.command_id] : null

                return (
                  <div
                    key={val.validation_id}
                    className={[
                      "border-l-2 py-0.5 pl-2.5 leading-relaxed",
                      isPassed
                        ? "border-emerald-500/60 dark:border-emerald-600/60"
                        : isFailed
                        ? "border-rose-500 dark:border-rose-600"
                        : "border-app-border",
                    ].join(" ")}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-app-primary">
                        {val.validation_scope}
                      </span>
                      <span
                        className={[
                          "font-mono text-[10px] font-semibold uppercase",
                          isPassed
                            ? "text-emerald-600 dark:text-emerald-400"
                            : isFailed
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-amber-600 dark:text-amber-400",
                        ].join(" ")}
                      >
                        {val.conclusion}
                      </span>
                    </div>

                    <div className="mt-0.5 text-xs text-app-secondary">
                      {val.validation_content}
                    </div>

                    {val.uncovered_scope ? (
                      <div className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-300">
                        未覆盖范围：{val.uncovered_scope}
                      </div>
                    ) : null}

                    {commandLine ? (
                      <div className="mt-1 flex items-baseline gap-1.5 font-mono text-[10px] text-app-muted">
                        <span className="shrink-0 font-semibold text-app-secondary">验证命令：</span>
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

        {/* 2. 交付产物账本 (按路径折叠净变化 UI-3) */}
        {fileChanges.length > 0 || otherArtifacts.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-app-primary">
              <Package size={13} className="text-blue-500" />
              <span>文件与代码产物账本</span>
            </div>

            <div className="flex flex-col gap-2 pl-1">
              {/* 折叠后的文件净变化 */}
              {fileChanges.map((file) => {
                const isExpanded = densityMode === "expanded" || Boolean(expandedFileKeys[file.key])
                const hasManyBlocks = file.edits.length > 3
                const visibleEdits =
                  densityMode === "expanded" || isExpanded
                    ? file.edits
                    : file.edits.slice(0, 3)

                const pathDisplay =
                  file.netType === "move" && file.originalPath
                    ? `${file.originalPath} → ${file.path}`
                    : file.path

                return (
                  <div key={file.key} className="space-y-1 text-xs">
                    <div className="flex items-center justify-between gap-2 py-0.5">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span
                          className={[
                            "font-mono text-[9px] font-semibold uppercase",
                            file.netType === "create"
                              ? "text-emerald-600 dark:text-emerald-400"
                              : file.netType === "modify"
                              ? "text-blue-600 dark:text-blue-400"
                              : file.netType === "delete"
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-app-muted",
                          ].join(" ")}
                        >
                          {file.netType}
                        </span>
                        <code className="truncate rounded bg-app-shell/60 px-1 py-0.2 font-mono text-[11px] text-app-primary">
                          {pathDisplay}
                        </code>
                      </div>

                      <span className="shrink-0 font-mono text-[10px] text-app-muted">
                        Runtime
                      </span>
                    </div>

                    {/* 统计行 */}
                    <div className="flex items-center justify-between pl-1 font-mono text-[10px] text-app-muted">
                      <div>
                        {file.netType === "modify" ? (
                          <span>
                            {file.edits.length} 处修改 · +{file.insertedTotal} −{file.deletedTotal}
                          </span>
                        ) : file.netType === "create" ? (
                          <span>
                            新建 · {file.createdLineCount ?? 0} 行
                            {file.edits.length > 0 ? ` · ${file.edits.length} 处修改` : ""}
                          </span>
                        ) : file.netType === "move" ? (
                          <span>移动自 {file.originalPath}</span>
                        ) : null}
                      </div>

                      {hasManyBlocks && densityMode === "compact" ? (
                        <button
                          type="button"
                          onClick={() => toggleExpandFile(file.key)}
                          className="text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                        >
                          {isExpanded ? "收起" : `全部 (${file.edits.length})`}
                        </button>
                      ) : null}
                    </div>

                    {file.netType === "move" && file.moveReason ? (
                      <div className="pl-1 text-[11px] text-app-muted">
                        原因：{file.moveReason}
                      </div>
                    ) : null}

                    {/* 修改块列表 */}
                    {visibleEdits.length > 0 ? (
                      <div className="ml-1 flex flex-col gap-0.5 border-l-2 border-app-border/70 pl-2.5 text-[11px] leading-relaxed text-app-secondary">
                        {visibleEdits.map((edit, eIdx) => {
                          const hasLine = edit.start_line != null && edit.end_line != null
                          const desc = edit.feature_desc || "（未填写说明）"

                          return (
                            <div key={eIdx} className="leading-snug">
                              {hasLine ? (
                                <span className="font-mono text-[10px] text-app-muted">
                                  L{edit.start_line}-L{edit.end_line}
                                </span>
                              ) : null}
                              {hasLine ? " " : ""}
                              <span>{desc}</span>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}

              {/* 通用交付物 (other) */}
              {otherArtifacts.map((art) => (
                <div
                  key={art.artifact_id}
                  className="flex items-center justify-between gap-2 py-0.5 text-xs"
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="font-mono text-[9px] font-semibold uppercase text-app-muted">
                      other
                    </span>
                    <span className="truncate text-app-primary">
                      {art.content || "(无描述)"}
                    </span>
                  </div>

                  <span className="shrink-0 font-mono text-[10px] text-app-muted">
                    Agent
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {/* 3. 外部持久状态变更 */}
        {externalStates.length > 0 ? (
          <div className="space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-app-primary">
              <Database size={13} className="text-purple-500" />
              <span>外部基础设施与持久状态</span>
            </div>

            <div className="flex flex-col gap-2 pl-1">
              {externalStates.map((ext) => {
                const commandLine = ext.command_id ? commandLineById[ext.command_id] : null

                return (
                  <div
                    key={ext.external_state_id}
                    className="border-l-2 border-purple-400/50 py-0.5 pl-2.5 leading-relaxed dark:border-purple-600/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-app-primary">
                        {ext.target_identifier} ({ext.target_type})
                      </span>
                      <span className="font-mono text-[10px] text-app-muted">
                        {ext.reversibility}
                      </span>
                    </div>

                    <div className="mt-0.5 text-xs text-app-secondary">
                      <span className="font-medium text-app-primary">变更：</span>
                      <span>{ext.change_content}</span>
                    </div>

                    <div className="text-[11px] text-app-muted">
                      <span className="font-medium text-app-secondary">当前状态：</span>
                      <span>{ext.current_state}</span>
                    </div>

                    {ext.rollback_info ? (
                      <div className="text-[11px] text-amber-700 dark:text-amber-300">
                        <span className="font-medium">回滚方案：</span>
                        <span>{ext.rollback_info}</span>
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
      </div>
    </TaskNoteSectionCard>
  )
})
