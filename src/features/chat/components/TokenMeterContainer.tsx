import { useMemo } from "react"
import { useShallow } from "zustand/react/shallow"

import { TokenMeter } from "@/features/chat/components/TokenMeter"
import type { TokenUsage } from "@/features/chat/model/agentEvents"
import { useChatStore } from "@/features/chat/model/chatStore"

function tokenUsageFromContext(contextUsage: { token_usage?: TokenUsage | null; context_window_used_tokens?: number | null } | null | undefined): TokenUsage | null {
  if (!contextUsage) return null
  const usage = contextUsage.token_usage ?? null
  const usedTokens = typeof contextUsage.context_window_used_tokens === "number" && Number.isFinite(contextUsage.context_window_used_tokens)
    ? Math.max(0, Math.round(contextUsage.context_window_used_tokens))
    : typeof usage?.total_tokens === "number" && Number.isFinite(usage.total_tokens)
      ? Math.max(0, Math.round(usage.total_tokens))
      : 0
  return {
    input_tokens: usage?.input_tokens ?? usedTokens,
    output_tokens: usage?.output_tokens ?? 0,
    total_tokens: usedTokens,
    cached_tokens: usage?.cached_tokens ?? 0,
    ...(usage?.reasoning_tokens !== undefined ? { reasoning_tokens: usage.reasoning_tokens } : {}),
    ...(usage?.cache_creation_tokens !== undefined ? { cache_creation_tokens: usage.cache_creation_tokens } : {}),
  }
}

/**
 * 把 chatStore 中指定 agent instance 的 context usage 数据 wrap 给 TokenMeter。
 * 单独成文件目的：avoid 在 ChatPage 内部直接订阅 store 字段以减少 ChatPage rerender。
 */
export function TokenMeterContainer({ sceneId, agentInstanceId }: { sceneId: string; agentInstanceId: string }) {
  const contextUsage = useChatStore(useShallow((state) => (
    state.scenes[sceneId]?.agentInstances[agentInstanceId]?.context_usage ?? null
  )))
  const lastTokenUsage = useMemo(() => tokenUsageFromContext(contextUsage), [contextUsage])
  const contextWindowMax = typeof contextUsage?.context_window_max === "number" && contextUsage.context_window_max > 0
    ? contextUsage.context_window_max
    : null
  return (
    <TokenMeter
      lastTokenUsage={lastTokenUsage}
      contextWindowMax={contextWindowMax}
    />
  )
}
