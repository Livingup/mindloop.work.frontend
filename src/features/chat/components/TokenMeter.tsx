import { Gauge } from "lucide-react"

import type { TokenUsage } from "@/features/chat/model/agentEvents"

const NUMBER_FORMATTER = new Intl.NumberFormat("en-US")

function formatNumber(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  return NUMBER_FORMATTER.format(Math.max(0, Math.round(value)))
}

function formatCompactTokenCount(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-"
  const normalized = Math.max(0, Math.round(value))
  const compact = normalized / 1000
  return `${compact.toFixed(1)}k`
}

function clampPercent(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio < 0) return 0
  if (ratio > 1) return 1
  return ratio
}

/**
 * 紧凑型 token 用量表头组件。
 *
 * 展示：
 * - 当前模型上下文窗口的占用量（基于本轮 total_tokens）；
 * - 上下文窗口上限；
 * - 鼠标悬停时展示精确占用量与百分比。
 *
 * 数据来源于 LlmRequestService 在 `llm.response.completed` 事件中归一化后的 token_usage 与 context_window_max；
 * 缺失字段全部按 0 处理，缺失上下文窗口时进度条隐藏。
 */
export function TokenMeter({
  lastTokenUsage,
  contextWindowMax,
}: {
  lastTokenUsage: TokenUsage | null
  contextWindowMax: number | null
}) {
  const lastTotal = lastTokenUsage?.total_tokens ?? 0

  const showWindow = typeof contextWindowMax === "number" && contextWindowMax > 0
  if (!showWindow) return null

  const ratio = clampPercent(lastTotal / contextWindowMax!)
  const ratioPercentLabel = `${(ratio * 100).toFixed(1)}%`

  return (
    <div
      className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px]"
      title={`上下文窗口 ${formatNumber(contextWindowMax!)} · 当前占用 ${formatNumber(lastTotal)} (${ratioPercentLabel})`}
      aria-label={`上下文窗口占用 ${ratioPercentLabel}`}
    >
      <Gauge size={12} className="shrink-0 text-slate-500" aria-hidden />
      <span className="font-medium tabular-nums text-slate-800">{formatCompactTokenCount(lastTotal)}</span>
      <span className="tabular-nums text-slate-400">/ {formatCompactTokenCount(contextWindowMax!)}</span>
    </div>
  )
}
