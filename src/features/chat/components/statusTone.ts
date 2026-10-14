/**
 * Chat 模块状态色调共享调色板。
 *
 * 角色定位
 * - `StatusTone` 由 `runtime/communicationHealth.ts` 定义（与状态语义同源）。
 * - 本文件只承担「色调 → Tailwind className 组合」的映射，是渲染层概念，
 *   不放在 runtime/ 内（runtime/ 仅保留纯逻辑、不引入样式）。
 * - 多个渲染组件（CommunicationStatusOverlay、AgentStatusBadge、…）共用同一份
 *   tone → class 映射，保证一致的视觉语言。
 */

import type { StatusTone } from "@/features/chat/runtime/communicationHealth"

export type StatusToneClasses = {
  badge: string
  banner: string
  button: string
  dot: string
}

export function statusToneClasses(tone: StatusTone): StatusToneClasses {
  if (tone === "ok") {
    return {
      badge: "bg-emerald-50 text-emerald-700",
      banner: "border-emerald-200 bg-emerald-50 text-emerald-900",
      button: "border-emerald-300 bg-white text-emerald-800 hover:bg-emerald-100",
      dot: "bg-emerald-600",
    }
  }
  if (tone === "pending") {
    return {
      badge: "bg-sky-50 text-sky-700",
      banner: "border-sky-200 bg-sky-50 text-sky-900",
      button: "border-sky-300 bg-white text-sky-800 hover:bg-sky-100",
      dot: "bg-sky-600",
    }
  }
  if (tone === "warning") {
    return {
      badge: "bg-amber-50 text-amber-800",
      banner: "border-amber-300 bg-amber-50 text-amber-950",
      button: "border-amber-300 bg-white text-amber-900 hover:bg-amber-100",
      dot: "bg-amber-500",
    }
  }
  if (tone === "danger") {
    return {
      badge: "bg-red-50 text-red-700",
      banner: "border-red-200 bg-red-50 text-red-900",
      button: "border-red-300 bg-white text-red-800 hover:bg-red-100",
      dot: "bg-red-600",
    }
  }
  return {
    badge: "bg-stone-100 text-stone-600",
    banner: "border-stone-300 bg-stone-50 text-stone-800",
    button: "border-stone-300 bg-white text-stone-700 hover:bg-stone-100",
    dot: "bg-stone-500",
  }
}
