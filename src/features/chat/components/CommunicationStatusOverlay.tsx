import { Wifi, WifiOff } from "lucide-react"

import { statusToneClasses } from "@/features/chat/components/statusTone"
import type { StatusTone, StatusViewModel } from "@/features/chat/runtime/communicationHealth"

/**
 * Scene 级前后端通信状态浮层。把 SSE 长连、heartbeat 保活、自动恢复三个底层
 * 子流程的视觉表现合并为单一浮层组件——scene 内所有 agent 实例共享一个。
 *
 * 渲染策略：
 * - 「正常 / 未连接」等用户无需关注的中性状态：紧凑的 wifi 图标，悬浮在
 *   对话气泡列表面板左上角。
 * - 「连接中 / 重连中 / 待恢复 / 通信异常 / 连接失败」等异常或过渡状态：
 *   展开为带状态描述与「重新连接」按钮的小卡片，仍以浮层形式叠在面板上，
 *   不占用聊天面板的布局空间。
 */
export function CommunicationStatusOverlay({
  view,
  onRetry,
  presentation = "floating",
}: {
  view: StatusViewModel | null
  onRetry: () => void
  presentation?: "floating" | "inline" | "rail"
}) {
  if (!view) return null
  const Icon = view.tone === "danger" ? WifiOff : Wifi
  const colorClass = communicationIconColorForTone(view.tone)
  if (presentation === "rail") {
    const title = `前后端通信：${view.detail}${view.canRetry ? "，点击重新连接" : ""}`
    const className = `pointer-events-auto inline-flex size-9 items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent-muted/20 ${colorClass}`
    const icon = <Icon className={`size-4 ${view.isBusy ? "animate-pulse" : ""}`} aria-hidden="true" />
    return view.canRetry ? (
      <button
        type="button"
        onClick={onRetry}
        className={className}
        title={title}
        aria-label={`前后端通信：${view.label}，点击重新连接`}
      >
        {icon}
      </button>
    ) : (
      <span
        className={className}
        title={title}
        aria-label={`前后端通信：${view.label}`}
        role="status"
      >
        {icon}
      </span>
    )
  }
  // 任何 pending/warning/danger 都展开为卡片，避免错误信息只靠图标颜色难以察觉；
  // 只有 ok / neutral 状态保持紧凑图标。移动端使用 inline 布局，不占用桌面浮层坐标。
  const isCompact = view.tone === "ok" || view.tone === "neutral"
  if (presentation === "inline" && isCompact) {
    return (
      <span
        className={`pointer-events-auto inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-2 text-[11px] font-medium shadow-sm ${colorClass}`}
        title={`前后端通信：${view.detail}`}
        aria-label={`前后端通信：${view.label}`}
        role="status"
      >
        <Icon className="size-4" aria-hidden="true" />
        <span>通信</span>
      </span>
    )
  }
  if (isCompact) {
    return (
      <span
        className={`pointer-events-auto absolute left-3 top-3 z-10 inline-flex items-center justify-center rounded-full p-1 transition-colors hover:bg-white/70 hover:shadow-sm hover:backdrop-blur-sm ${colorClass}`}
        title={`前后端通信：${view.detail}`}
        aria-label={`前后端通信：${view.label}`}
        role="status"
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
    )
  }
  const classes = statusToneClasses(view.tone)
  const headline = view.bannerText ?? view.detail
  const showDetail = Boolean(view.detail) && view.detail !== headline
  return (
    <div
      className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-xs shadow-md ${
        presentation === "inline" ? "min-w-[12rem] flex-1" : "absolute left-3 top-3 z-10 max-w-md"
      } ${classes.banner}`}
      role={view.tone === "danger" ? "alert" : "status"}
      aria-label={`前后端通信：${view.label}`}
    >
      <Icon
        className={`mt-0.5 size-4 shrink-0 ${colorClass} ${view.isBusy ? "animate-pulse" : ""}`}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{headline}</div>
        {showDetail ? (
          <div className="mt-0.5 text-[11px] opacity-80">{view.detail}</div>
        ) : null}
      </div>
      {view.canRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={`shrink-0 rounded-md border px-2 py-1 text-[11px] font-medium ${classes.button}`}
        >
          重新连接
        </button>
      ) : null}
    </div>
  )
}

function communicationIconColorForTone(tone: StatusTone): string {
  if (tone === "ok") return "text-emerald-600"
  if (tone === "pending") return "text-amber-500"
  if (tone === "warning") return "text-amber-600"
  if (tone === "danger") return "text-red-600"
  return "text-stone-400"
}
