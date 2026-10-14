import { useEffect, useMemo } from "react"

import {
  CHAT_BUBBLE_PERSISTENCE_RETRY_DELAY_MS,
  CHAT_BUBBLE_PERSISTENCE_RETRY_LIMIT,
  CHAT_BUBBLE_PERSISTENCE_TIMEOUT_MS,
} from "@/features/chat/runtime/runtimeConfig"
import {
  createChatBubblePersistenceQueue,
  type ChatBubblePersistenceQueue,
} from "@/features/chat/runtime/chatBubblePersistenceQueue"

/**
 * 在 React 组件树中持有一个稳定的 Chat Bubble 持久化队列实例。
 *
 * - 使用 useMemo 保证整个组件生命周期内引用稳定，避免事件回调闭包逐帧失效。
 * - unmount 时调用 clearAll()：释放所有 pending AbortController 与 Map 引用，
 *   保证 ChatPage 卸载（路由切换 / Tab 切换）后不出现网络请求或内存泄漏。
 */
export function useChatBubblePersistence(): ChatBubblePersistenceQueue {
  const queue = useMemo(
    () => createChatBubblePersistenceQueue({
      timeoutMs: CHAT_BUBBLE_PERSISTENCE_TIMEOUT_MS,
      retryLimit: CHAT_BUBBLE_PERSISTENCE_RETRY_LIMIT,
      retryDelayMs: CHAT_BUBBLE_PERSISTENCE_RETRY_DELAY_MS,
    }),
    [],
  )
  useEffect(() => () => { queue.clearAll() }, [queue])
  return queue
}
