import { ChevronDown, ChevronRight } from "lucide-react"
import { type ReactNode } from "react"

export type SectionSourceOrigin = "agent" | "runtime" | "mixed"

export type TaskNoteSectionCardProps = {
  title: string
  icon?: ReactNode
  count?: number
  origin?: SectionSourceOrigin
  isCollapsed: boolean
  onToggleCollapse: () => void
  isEmpty?: boolean
  emptyText?: string
  children: ReactNode
  className?: string
  action?: ReactNode
}

export function TaskNoteSectionCard({
  title,
  icon,
  count,
  origin,
  isCollapsed,
  onToggleCollapse,
  isEmpty = false,
  emptyText = "暂无记录（按需发生）",
  children,
  className = "",
  action,
}: TaskNoteSectionCardProps) {
  if (isEmpty) {
    return null
  }

  return (
    <section
      className={[
        "border-b border-app-border/40 pb-4 pt-2 last:border-b-0",
        className,
      ].join(" ")}
    >
      <header
        onClick={onToggleCollapse}
        className="flex cursor-pointer select-none items-center justify-between gap-2 py-1 hover:opacity-85"
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-app-muted transition-transform">
            {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
          </span>
          {icon ? <span className="text-app-muted">{icon}</span> : null}
          <h3 className="truncate text-xs font-bold uppercase tracking-wider text-app-primary">
            {title}
          </h3>
          {typeof count === "number" && count > 0 ? (
            <span className="text-[11px] font-normal text-app-muted">
              ({count})
            </span>
          ) : null}
        </div>

        {action ? (
          <div className="flex shrink-0 items-center" onClick={(e) => e.stopPropagation()}>
            {action}
          </div>
        ) : null}
      </header>

      {!isCollapsed ? (
        <div className="pt-2">
          {isEmpty ? (
            <div className="py-2 text-xs italic text-app-muted">
              {emptyText}
            </div>
          ) : (
            children
          )}
        </div>
      ) : null}
    </section>
  )
}
