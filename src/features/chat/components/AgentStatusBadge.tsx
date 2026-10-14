import { statusToneClasses } from "@/features/chat/components/statusTone"
import type { StatusTone } from "@/features/chat/runtime/communicationHealth"

export type AgentInstanceStatusViewModel = {
  label: string
  tone: StatusTone
}

/**
 * Agent 实例运行状态的小圆点徽章（位于 chat header agent_definition_id 后）。
 * 单一职责：渲染 dot + a11y 标签。把 status 文本到色调的判断（运行中 / 等待用户 /
 * 已停止 …）保留在本组件文件内，便于后续单测和扩展。
 */
export function AgentStatusBadge({
  status,
  hasInstance,
}: {
  status: string
  hasInstance: boolean
}) {
  const view = getAgentInstanceStatusView(status, hasInstance)
  const classes = statusToneClasses(view.tone)
  return (
    <span
      className={`inline-block size-2 shrink-0 rounded-full ${classes.dot}`}
      title={`Agent 实例状态：${view.label}`}
      aria-label={`Agent 实例状态：${view.label}`}
    />
  )
}

export function getAgentInstanceStatusView(status: string, hasInstance: boolean): AgentInstanceStatusViewModel {
  if (!hasInstance) return { label: "未创建", tone: "neutral" }
  if (status === "running") return { label: "执行中", tone: "ok" }
  if (status === "paused") return { label: "等待用户", tone: "warning" }
  if (status === "failed" || status === "cancelled") return { label: "已停止", tone: "danger" }
  if (status === "released") return { label: "已释放", tone: "neutral" }
  if (status === "completed") return { label: "已完成", tone: "neutral" }
  return { label: "空闲", tone: "neutral" }
}
