import type { AgentHydrationState } from "@/features/chat/model/chatStore"

export type MessageListHydrationPresentation = {
  state: AgentHydrationState
  isReadyEmpty: boolean
  isFailure: boolean
  title: string
  detail: string
}

/**
 * MessageList empty/recovery copy is derived from the selected Agent ledger hydration state.
 * Only an authoritative ready + empty Agent history may show the first-message prompt.
 */
export function messageListHydrationPresentation(
  state: AgentHydrationState,
 ): MessageListHydrationPresentation {
  if (state === "ready") {
    return {
      state,
      isReadyEmpty: true,
      isFailure: false,
      title: "Send your first message",
      detail: "The Agent instance is ready. Use the left tree to select project files; terminal output appears on the right.",
    }
  }
  if (state === "failed") {
    return {
      state,
      isReadyEmpty: false,
      isFailure: true,
      title: "历史记录恢复失败",
      detail: "当前 Agent 的历史尚未恢复；再次激活该 Agent 时会定向重试。",
    }
  }
  if (state === "needs_hydration") {
    return {
      state,
      isReadyEmpty: false,
      isFailure: false,
      title: "等待恢复历史记录",
      detail: "当前 Agent 的工作集需要从 ChatBubble 权威存储定向恢复。",
    }
  }
  return {
    state,
    isReadyEmpty: false,
    isFailure: false,
    title: "正在恢复历史记录",
    detail: "正在从 ChatBubble 权威存储恢复当前 Agent，请稍候。",
  }
}



