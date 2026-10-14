import { ArrowDownLeft, ArrowUpRight, Bot, Network } from "lucide-react"
import { memo, useMemo, useState } from "react"

import type {
  AgentMessageItem,
  AgentRelationshipItem,
  RemoteAgentMessageItem,
} from "@/features/chat/api/taskNoteApi"
import { TaskNoteSectionCard } from "./TaskNoteSectionCard"

export type TaskNoteCollaborationSectionProps = {
  relationships: AgentRelationshipItem[]
  messages: AgentMessageItem[]
  remoteMessages: RemoteAgentMessageItem[]
  isCollapsed: boolean
  onToggleCollapse: () => void
  densityMode: "compact" | "expanded"
}

interface AgentMessageRecord {
  id: string
  type: "send" | "receive"
  content: string
  createdAt?: string
  isRemote?: boolean
}

interface AgentCollaborationGroup {
  agentId: string
  agentType: "child" | "parent" | "remote" | "peer"
  status?: "unreleased" | "released"
  delegationContent?: string | null
  forkMessageId?: string | null
  messages: AgentMessageRecord[]
}

export const TaskNoteCollaborationSection = memo(function TaskNoteCollaborationSection({
  relationships,
  messages,
  remoteMessages,
  isCollapsed,
  onToggleCollapse,
  densityMode,
}: TaskNoteCollaborationSectionProps) {
  const [expandedAgents, setExpandedAgents] = useState<Record<string, boolean>>({})

  // 按 Agent 实例对象分组整理拓扑关系与往来通信消息
  const groups = useMemo(() => {
    const map = new Map<string, AgentCollaborationGroup>()

    // 1. 记录显式拓扑关系
    for (const rel of relationships) {
      const id = rel.target_agent_instance_id
      if (!map.has(id)) {
        map.set(id, {
          agentId: id,
          agentType: rel.target_agent_type,
          status: rel.status,
          delegationContent: rel.delegation_content,
          forkMessageId: rel.fork_message_id,
          messages: [],
        })
      } else {
        const g = map.get(id)!
        g.agentType = rel.target_agent_type
        g.status = rel.status
        g.delegationContent = rel.delegation_content
        g.forkMessageId = rel.fork_message_id
      }
    }

    // 2. 汇入本地 Agent 专线往来消息
    for (const msg of messages) {
      const id = msg.target_agent_instance_id
      if (!map.has(id)) {
        map.set(id, {
          agentId: id,
          agentType: msg.target_agent_type,
          messages: [],
        })
      }
      map.get(id)!.messages.push({
        id: msg.message_id,
        type: msg.message_type,
        content: msg.message,
        createdAt: msg.created_at,
        isRemote: false,
      })
    }

    // 3. 汇入 LACP 远程 Agent 协同消息
    for (const rMsg of remoteMessages) {
      const id = rMsg.remote_agent_instance_id
      if (!map.has(id)) {
        map.set(id, {
          agentId: id,
          agentType: "remote",
          messages: [],
        })
      }
      map.get(id)!.messages.push({
        id: rMsg.remote_message_id,
        type: rMsg.message_type,
        content: rMsg.message,
        createdAt: rMsg.created_at,
        isRemote: true,
      })
    }

    // 各分组内部消息按时间先后正向排列
    const list = Array.from(map.values())
    for (const g of list) {
      g.messages.sort((a, b) => {
        if (a.createdAt && b.createdAt) {
          return a.createdAt.localeCompare(b.createdAt)
        }
        return 0
      })
    }

    return list
  }, [relationships, messages, remoteMessages])

  const totalAgents = groups.length

  const toggleAgentExpanded = (agentId: string) => {
    setExpandedAgents((prev) => ({
      ...prev,
      [agentId]: !prev[agentId],
    }))
  }

  if (totalAgents === 0) {
    return null
  }

  return (
    <TaskNoteSectionCard
      title="协作网络与专线通信"
      icon={<Network size={14} className="text-blue-500" />}
      count={totalAgents > 0 ? totalAgents : undefined}
      isCollapsed={isCollapsed}
      onToggleCollapse={onToggleCollapse}
    >
      <div className="flex flex-col gap-3.5 text-xs text-app-secondary">
        {groups.map((group) => {
          const isReleased = group.status === "released"
          const isExpanded = densityMode === "expanded" || !!expandedAgents[group.agentId]
          const showToggle = group.messages.length > 3 && densityMode === "compact"
          const visibleMessages = showToggle && !isExpanded ? group.messages.slice(-3) : group.messages

          return (
            <div
              key={group.agentId}
              className="space-y-2 border-b border-app-border/30 pb-3 last:border-b-0"
            >
              {/* Agent 对象标识头 */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Bot size={13} className="shrink-0 text-purple-500" />
                  <code className="truncate font-mono text-[11px] font-semibold text-app-primary">
                    {group.agentId}
                  </code>
                  <span className="shrink-0 rounded bg-app-shell/60 px-1 py-0.2 font-mono text-[9px] uppercase tracking-wider text-app-muted">
                    {group.agentType === "child"
                      ? "子 Agent"
                      : group.agentType === "parent"
                      ? "父级调度"
                      : group.agentType === "remote"
                      ? "远程协同"
                      : "协同 Agent"}
                  </span>
                  {group.status ? (
                    <span
                      className={[
                        "shrink-0 text-[10px]",
                        isReleased ? "text-app-muted" : "font-medium text-emerald-600 dark:text-emerald-400",
                      ].join(" ")}
                    >
                      {isReleased ? "已释放" : "活跃中"}
                    </span>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <span className="font-mono text-[10px] text-app-muted">
                    {group.messages.length > 0 ? `${group.messages.length} 条消息` : "无通信"}
                  </span>
                  {showToggle ? (
                    <button
                      type="button"
                      onClick={() => toggleAgentExpanded(group.agentId)}
                      className="text-[10px] text-blue-600 hover:underline dark:text-blue-400"
                    >
                      {isExpanded ? "收起" : `全部 (${group.messages.length})`}
                    </button>
                  ) : null}
                </div>
              </div>

              {/* 委派任务描述 */}
              {group.delegationContent ? (
                <div className="rounded bg-app-shell/40 px-2.5 py-1.5 text-xs text-app-secondary">
                  <span className="font-medium text-app-primary">委派任务：</span>
                  <span>{group.delegationContent}</span>
                </div>
              ) : null}

              {/* 该 Agent 对象的专线通信消息线程 */}
              {group.messages.length > 0 ? (
                <div className="flex flex-col gap-1.5 pl-2">
                  {visibleMessages.map((msg) => {
                    const isSend = msg.type === "send"
                    return (
                      <div
                        key={msg.id}
                        className={[
                          "border-l-2 py-0.5 pl-2.5 leading-relaxed text-xs",
                          isSend
                            ? "border-blue-400/70 dark:border-blue-500/70"
                            : "border-emerald-400/70 dark:border-emerald-500/70",
                        ].join(" ")}
                      >
                        <div className="flex items-center justify-between font-mono text-[10px]">
                          <span
                            className={[
                              "flex items-center gap-1 font-medium",
                              isSend
                                ? "text-blue-600 dark:text-blue-400"
                                : "text-emerald-600 dark:text-emerald-400",
                            ].join(" ")}
                          >
                            {isSend ? <ArrowUpRight size={11} /> : <ArrowDownLeft size={11} />}
                            <span>{isSend ? "➔ 发送" : "⬅ 接收"}</span>
                            {msg.isRemote ? (
                              <span className="text-[9px] text-app-muted">(LACP 远程)</span>
                            ) : null}
                          </span>
                          {msg.createdAt ? (
                            <span className="text-[9px] text-app-muted">{msg.createdAt}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 whitespace-pre-wrap break-words text-app-secondary">
                          {msg.content}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="pl-2 text-[11px] italic text-app-muted">
                  暂无专线通信记录
                </div>
              )}
            </div>
          )
        })}
      </div>
    </TaskNoteSectionCard>
  )
})
