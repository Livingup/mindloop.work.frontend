import { ArrowLeft, Search } from "lucide-react"
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"

type FilterOption = {
  value: string
  label: string
  count?: number
}

type FilterChipSection = {
  id: string
  options: FilterOption[]
  activeValue: string | null
  onChange: (value: string | null) => void
  compact?: boolean
}

type FilterChipEntry = FilterChipSection & {
  key: string
  option: FilterOption
}

export function ResourceManagementLayout({
  action,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  primaryFilters,
  activePrimary,
  onPrimaryChange,
  secondaryFilters,
  activeSecondary,
  onSecondaryChange,
  children,
}: {
  count?: number
  action?: ReactNode
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  primaryFilters?: FilterOption[]
  activePrimary?: string | null
  onPrimaryChange?: (value: string | null) => void
  secondaryFilters?: FilterOption[]
  activeSecondary?: string | null
  onSecondaryChange?: (value: string | null) => void
  children: ReactNode
}) {
  const filterSections: FilterChipSection[] = []
  if (primaryFilters && onPrimaryChange) {
    filterSections.push({
      id: "primary",
      options: primaryFilters,
      activeValue: activePrimary ?? null,
      onChange: onPrimaryChange,
    })
  }
  if (secondaryFilters && onSecondaryChange && secondaryFilters.length > 0) {
    filterSections.push({
      id: "secondary",
      options: secondaryFilters,
      activeValue: activeSecondary ?? null,
      onChange: onSecondaryChange,
      compact: true,
    })
  }

  return (
    <div className="h-full overflow-auto bg-app-bg px-4 py-4 text-app-primary sm:px-6 sm:py-5">
      <div className="mb-5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-start">
        <div className="relative w-full min-w-0 flex-none sm:min-w-[18rem] sm:flex-[0_1_22rem]">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-app-muted" />
          <input
            value={searchValue}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder}
            className="h-9 w-full rounded-lg border border-app-border bg-app-surface/90 py-2 pl-9 pr-3 text-sm text-app-primary shadow-sm outline-none placeholder:text-app-subtle focus:border-app-accent-muted focus:ring-2 focus:ring-app-accent-muted/10"
          />
        </div>
        <div className="w-full min-w-0 flex-1 pt-1 sm:min-w-[14rem]">
          {filterSections.length > 0 && <FilterChipGroups sections={filterSections} />}
        </div>
        {action && <div className="flex w-full shrink-0 items-center gap-2 sm:ml-auto sm:w-auto">{action}</div>}
      </div>
      {children}
    </div>
  )
}

export function FilterChips({
  options,
  activeValue,
  onChange,
  compact,
}: {
  options: FilterOption[]
  activeValue: string | null
  onChange: (value: string | null) => void
  compact?: boolean
}) {
  return <FilterChipGroups sections={[{ id: "default", options, activeValue, onChange, compact }]} />
}

function FilterChipGroups({ sections }: { sections: FilterChipSection[] }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const measurementRef = useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = useState(0)
  const entries = useMemo(
    () =>
      sections.flatMap((section) =>
        section.options.map((option) => ({
          ...section,
          key: `${section.id}:${option.value}`,
          option,
        })),
      ),
    [sections],
  )
  const [visibleKeys, setVisibleKeys] = useState<string[]>(() => entries.map((entry) => entry.key))
  const allKeys = useMemo(() => entries.map((entry) => entry.key), [entries])
  const activeEntries = useMemo(() => entries.filter((entry) => isFilterOptionActive(entry.option, entry.activeValue)), [entries])

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => setContainerWidth(element.getBoundingClientRect().width)
    updateWidth()

    if (typeof ResizeObserver === "undefined") return

    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const measurementElement = measurementRef.current
    if (!measurementElement || containerWidth <= 0) {
      setVisibleKeys((current) => (areStringArraysEqual(current, allKeys) ? current : allKeys))
      return
    }

    const chipWidths = new Map<string, number>()
    measurementElement.querySelectorAll<HTMLElement>("[data-filter-chip-key]").forEach((element) => {
      if (element.dataset.filterChipKey) chipWidths.set(element.dataset.filterChipKey, element.offsetWidth)
    })

    const moreButtonWidth = measurementElement.querySelector<HTMLElement>("[data-filter-more]")?.offsetWidth ?? 0
    const totalWidth = entries.reduce((sum, entry, index) => sum + (chipWidths.get(entry.key) ?? 0) + (index > 0 ? 6 : 0), 0)
    if (totalWidth <= containerWidth) {
      setVisibleKeys((current) => (areStringArraysEqual(current, allKeys) ? current : allKeys))
      return
    }

    const usableWidth = Math.max(containerWidth - moreButtonWidth - 6, 0)
    const visibleKeySet = new Set<string>()
    let usedWidth = 0
    const addVisibleEntry = (entry: FilterChipEntry, force = false) => {
      if (visibleKeySet.has(entry.key)) return
      const nextWidth = usedWidth + (chipWidths.get(entry.key) ?? 0) + (visibleKeySet.size > 0 ? 6 : 0)
      if (!force && nextWidth > usableWidth) return
      visibleKeySet.add(entry.key)
      usedWidth = nextWidth
    }

    activeEntries.forEach((entry) => addVisibleEntry(entry, true))
    entries.forEach((entry) => addVisibleEntry(entry))

    const nextVisibleKeys = entries.filter((entry) => visibleKeySet.has(entry.key)).map((entry) => entry.key)
    setVisibleKeys((current) => (areStringArraysEqual(current, nextVisibleKeys) ? current : nextVisibleKeys))
  }, [activeEntries, allKeys, containerWidth, entries])

  const visibleKeySet = useMemo(() => new Set(visibleKeys), [visibleKeys])
  const visibleEntries = entries.filter((entry) => visibleKeySet.has(entry.key))
  const hiddenEntries = entries.filter((entry) => !visibleKeySet.has(entry.key))

  return (
    <div ref={containerRef} className="relative flex min-w-0 flex-1 items-center gap-1.5">
      <div ref={measurementRef} className="pointer-events-none invisible absolute -left-[9999px] top-0 flex items-center gap-1.5 whitespace-nowrap">
        {entries.map((entry) => {
          const active = isFilterOptionActive(entry.option, entry.activeValue)
          return (
            <button
              key={entry.key}
              type="button"
              data-filter-chip-key={entry.key}
              title={entry.option.label}
              className={[
                getFilterChipClassName(entry.compact),
                active ? "bg-app-selected text-app-primary" : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
              ].join(" ")}
            >
              <span>{entry.option.label}</span>
              {active && typeof entry.option.count === "number" ? <span className="shrink-0">{entry.option.count}</span> : null}
            </button>
          )
        })}
        <button
          type="button"
          data-filter-more
          className="inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary"
        >
          更多
        </button>
      </div>
      {visibleEntries.map((entry) => {
        const active = isFilterOptionActive(entry.option, entry.activeValue)
        return (
          <button
            key={entry.key}
            type="button"
            onClick={() => {
              entry.onChange(entry.option.value === "__all" ? null : entry.option.value)
              setOpen(false)
            }}
            title={entry.option.label}
            className={[
              getFilterChipClassName(entry.compact),
              active ? "bg-app-selected text-app-primary" : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
            ].join(" ")}
          >
            <span>{entry.option.label}</span>
            {active && typeof entry.option.count === "number" ? <span className="shrink-0">{entry.option.count}</span> : null}
          </button>
        )
      })}
      {hiddenEntries.length > 0 && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="inline-flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary"
        >
          更多
        </button>
      )}
      {open && hiddenEntries.length > 0 && (
        <div className="absolute left-0 top-8 z-30 max-h-64 w-[min(20rem,calc(100vw-2rem))] overflow-auto rounded-xl border border-app-border bg-app-surface p-2 shadow-2xl shadow-slate-900/12">
          <div className="flex flex-wrap items-center gap-1.5">
            {hiddenEntries.map((entry) => {
              const active = isFilterOptionActive(entry.option, entry.activeValue)
              return (
                <button
                  key={entry.key}
                  type="button"
                  onClick={() => {
                    entry.onChange(entry.option.value === "__all" ? null : entry.option.value)
                    setOpen(false)
                  }}
                  title={entry.option.label}
                  className={[
                    getFilterPopupChipClassName(entry.compact),
                    active ? "bg-app-selected text-app-primary" : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                  ].join(" ")}
                >
                  <span>{entry.option.label}</span>
                  {active && typeof entry.option.count === "number" ? <span className="shrink-0">{entry.option.count}</span> : null}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function getFilterChipClassName(compact?: boolean) {
  return [
    "inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-xs whitespace-nowrap",
    "transition",
  ].join(" ")
}

function getFilterPopupChipClassName(compact?: boolean) {
  return [
    "inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs whitespace-nowrap transition",
  ].join(" ")
}

function isFilterOptionActive(option: FilterOption, activeValue: string | null) {
  return option.value === "__all" ? activeValue === null : option.value === activeValue
}

function areStringArraysEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false
  return left.every((value, index) => value === right[index])
}

export function ResourceGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">{children}</div>
}

export function ResourceCard({
  title,
  identifier,
  description,
  badges,
  selected,
  onClick,
  actions,
}: {
  title: ReactNode
  identifier?: ReactNode
  description?: ReactNode
  badges?: ReactNode
  selected?: boolean
  onClick?: () => void
  actions?: ReactNode
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-app-primary">{title}</div>
          {identifier && <div className="mt-1 truncate font-mono text-xs text-app-muted">{identifier}</div>}
        </div>
        {actions && (
          <div
            className="shrink-0"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
          >
            {actions}
          </div>
        )}
      </div>
      {description && <div className="mt-3 line-clamp-2 text-xs leading-relaxed text-app-secondary">{description}</div>}
      {badges && (
        <div
          className="mt-3 flex flex-wrap items-center gap-2 text-xs text-app-muted"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          {badges}
        </div>
      )}
    </>
  )

  if (onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") onClick()
        }}
        className={[
          "w-full cursor-pointer rounded-lg border p-4 text-left transition",
          selected
            ? "border-app-accent-muted bg-app-selected/80 shadow-sm"
            : "border-app-border/80 bg-app-surface/85 hover:border-app-border-strong hover:bg-app-surface",
        ].join(" ")}
      >
        {content}
      </div>
    )
  }

  return <div className="rounded-lg border border-app-border/80 bg-app-surface/85 p-4 shadow-card">{content}</div>
}

export function StatusText({ isLoading, error, empty }: { isLoading: boolean; error: unknown; empty: boolean }) {
  if (isLoading) return <div className="text-sm text-app-muted">加载中…</div>
  if (error) return <div className="text-sm text-red-600">加载失败</div>
  if (empty) return <div className="rounded-lg border border-dashed border-app-border p-5 text-sm text-app-muted">没有匹配的资源</div>
  return null
}

export function AdaptiveResourceLayout({
  list,
  detail,
}: {
  list: ReactNode
  detail: ReactNode
}) {
  return (
    <div className="flex h-full min-w-0 flex-col bg-app-bg text-app-primary md:flex-row">
      <aside className="max-h-64 w-full shrink-0 overflow-auto border-b border-app-border/80 bg-app-bg px-3 py-3 md:h-full md:max-h-none md:w-44 md:border-b-0 md:border-r md:px-2 md:py-4">
        {list}
      </aside>
      <section className="min-h-0 min-w-0 flex-1 overflow-auto">{detail}</section>
    </div>
  )
}

export function GroupedCompactResourceList<TItem>({
  items,
  selectedKey,
  onSelect,
  getKey,
  getTitle,
  getGroup,
  onBack,
}: {
  items: TItem[]
  selectedKey: string
  onSelect: (item: TItem) => void
  getKey: (item: TItem) => string
  getTitle: (item: TItem) => ReactNode
  getGroup: (item: TItem) => string
  onBack: () => void
}) {
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set())
  const grouped = useMemo(() => {
    const groups = new Map<string, TItem[]>()
    for (const item of items) {
      const group = getGroup(item) || "default"
      groups.set(group, [...(groups.get(group) ?? []), item])
    }
    return [...groups.entries()].sort(([a], [b]) => {
      if (a === "default") return 1
      if (b === "default") return -1
      return a.localeCompare(b)
    })
  }, [getGroup, items])

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 inline-flex items-center gap-1 text-xs text-app-muted hover:text-app-primary">
        <ArrowLeft size={13} />
        返回平铺列表
      </button>
      <div className="space-y-4">
        {grouped.map(([group, groupItems]) => {
          const collapsed = collapsedGroups.has(group)
          return (
            <section key={group}>
              <button
                type="button"
                onClick={() =>
                  setCollapsedGroups((current) => {
                    const next = new Set(current)
                    if (next.has(group)) next.delete(group)
                    else next.add(group)
                    return next
                  })
                }
                className="mb-1.5 flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-left text-[11px] font-medium text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary"
                title={group}
              >
                <span className="truncate">{group}</span>
                <span className="shrink-0 text-[10px] text-app-subtle">{collapsed ? "+" : "−"}</span>
              </button>
              {!collapsed && (
                <div className="space-y-1">
                  {groupItems.map((item) => {
                    const key = getKey(item)
                    const selected = key === selectedKey
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => onSelect(item)}
                        title={String(getTitle(item) ?? "")}
                        className={[
                          "w-full truncate rounded-md px-2 py-1.5 text-left text-xs transition",
                          selected ? "bg-app-selected text-app-primary" : "text-app-secondary hover:bg-app-surface-hover hover:text-app-primary",
                        ].join(" ")}
                      >
                        {getTitle(item)}
                      </button>
                    )
                  })}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

export function DetailLayout({
  title,
  titleMeta,
  identifier,
  actions,
  children,
}: {
  title?: ReactNode
  titleMeta?: ReactNode
  identifier?: ReactNode
  actions?: ReactNode
  children: ReactNode
}) {
  const shouldRenderHeader = Boolean(title || titleMeta || identifier || actions)

  return (
    <div className="h-full overflow-auto bg-app-bg px-4 py-4 text-app-primary sm:px-6 sm:py-5">
      {shouldRenderHeader && (
        <div className="mb-6 flex items-start justify-between gap-4">
          {(title || titleMeta || identifier) && (
            <div className="min-w-0">
              {(title || titleMeta) && (
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  {title && <h1 className="min-w-0 truncate text-xl font-semibold text-app-primary">{title}</h1>}
                  {titleMeta && <div className="flex shrink-0 flex-wrap items-center gap-2">{titleMeta}</div>}
                </div>
              )}
              {identifier && <div className="mt-1 font-mono text-xs text-app-muted">{identifier}</div>}
            </div>
          )}
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export function countBy<TItem>(items: TItem[], getValue: (item: TItem) => string) {
  const counts = new Map<string, number>()
  for (const item of items) {
    const value = getValue(item) || "default"
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return counts
}

export function filterOptionsFromCounts(counts: Map<string, number>, allCount: number) {
  return [
    { value: "__all", label: "全部", count: allCount },
    ...[...counts.entries()]
      .sort(([a], [b]) => {
        if (a === "default") return 1
        if (b === "default") return -1
        return a.localeCompare(b)
      })
      .map(([value, count]) => ({ value, label: value, count })),
  ]
}

export function matchesQuery(values: Array<unknown>, query: string) {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true
  return values.some((value) => String(value ?? "").toLowerCase().includes(normalized))
}

