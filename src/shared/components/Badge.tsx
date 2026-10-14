import { clsx } from "clsx"
import type { ReactNode } from "react"

type BadgeTone = "slate" | "blue" | "green" | "amber" | "red" | "purple"

const toneClasses: Record<BadgeTone, string> = {
  slate: "border-slate-300/70 bg-slate-100/85 text-slate-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
  purple: "border-purple-200 bg-purple-50 text-purple-700",
}

export function Badge({ children, tone = "slate" }: { children: ReactNode; tone?: BadgeTone }) {
  return (
    <span className={clsx("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", toneClasses[tone])}>
      {children}
    </span>
  )
}
