import { RadioTower } from "lucide-react"

import type { LacpClientStatusResponse } from "@/features/chat/api/agentRuntimeApi"
import type { StatusTone } from "@/features/chat/runtime/communicationHealth"

export function LacpStatusOverlay({
  status,
  presentation = "floating",
}: {
  status: LacpClientStatusResponse | null | undefined
  presentation?: "floating" | "inline" | "rail"
}) {
  const view = lacpStatusView(status)
  const inline = presentation === "inline"
  const rail = presentation === "rail"
  return (
    <span
      className={`pointer-events-auto inline-flex items-center justify-center transition-colors ${
        rail
          ? "size-9"
          : inline
            ? "h-8 gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-2 text-[11px] font-medium shadow-sm"
            : "absolute left-3 top-10 z-10 rounded-full p-1 hover:bg-white/70 hover:shadow-sm hover:backdrop-blur-sm"
      } ${lacpIconColorForTone(view.tone)}`}
      title={`LACP WS：${view.detail}`}
      aria-label={`LACP WS：${view.label}`}
      role="status"
    >
      <RadioTower className={`size-4 ${view.isBusy ? "animate-pulse" : ""}`} aria-hidden="true" />
      {inline ? <span>LACP</span> : null}
    </span>
  )
}

function lacpStatusView(status: LacpClientStatusResponse | null | undefined): {
  label: string
  detail: string
  tone: StatusTone
  isBusy?: boolean
} {
  if (!status) {
    return {
      label: "未知",
      detail: "LACP WebSocket 状态尚未加载。",
      tone: "neutral",
    }
  }
  if (!status.enabled) {
    return {
      label: "未启用",
      detail: "LACP 客户端未启用。",
      tone: "neutral",
    }
  }
  if (status.connected) {
    return {
      label: "已连接",
      detail: `LACP WebSocket 已连接，已注册 ${status.registered_count}/${status.registration_count} 个实例。`,
      tone: "ok",
    }
  }
  if (status.last_error) {
    return {
      label: "连接异常",
      detail: `LACP WebSocket 连接异常：${status.last_error}`,
      tone: "danger",
    }
  }
  return {
    label: "连接中",
    detail: status.reconnect_attempt > 0
      ? `LACP WebSocket 正在第 ${status.reconnect_attempt} 次重连。`
      : "LACP WebSocket 正在连接。",
    tone: "pending",
    isBusy: true,
  }
}

function lacpIconColorForTone(tone: StatusTone): string {
  if (tone === "ok") return "text-cyan-600"
  if (tone === "pending") return "text-amber-500"
  if (tone === "warning") return "text-amber-600"
  if (tone === "danger") return "text-red-600"
  return "text-stone-400"
}
