import type { ReactNode } from "react"

import { cn, themeClassNames } from "@/shared/theme/classes"

export function Panel({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <section className={cn(themeClassNames.surface.panel, className)}>{children}</section>
}

export function PanelHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-app-border/80 px-5 py-4">
      <div>
        <h2 className="text-base font-semibold text-app-primary">{title}</h2>
        {description ? <p className="mt-1 text-sm text-app-secondary">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}
