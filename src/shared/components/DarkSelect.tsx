import { useState } from "react"

export type DarkSelectOption = {
  value: string
  label: string
}

export function DarkSelect({
  value,
  options,
  onChange,
  placeholder = "未选择",
  className = "",
  containerClassName = "",
  mono = false,
  disabled = false,
  invalid = false,
}: {
  value: string
  options: DarkSelectOption[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  containerClassName?: string
  mono?: boolean
  disabled?: boolean
  invalid?: boolean
}) {
  const [open, setOpen] = useState(false)
  const displayOptions = options.some((option) => option.value === value) ? options : value ? [{ value, label: value }, ...options] : options
  const selectedLabel = displayOptions.find((option) => option.value === value)?.label ?? ""
  const hasValue = Boolean(value)

  return (
    <div
      className={["relative", containerClassName].join(" ")}
      onBlur={(event) => {
        const nextTarget = event.relatedTarget as Node | null
        if (!nextTarget || !event.currentTarget.contains(nextTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={[
          "flex w-full items-center justify-between gap-2 rounded-lg border bg-app-surface/90 px-3 py-2 text-left text-sm outline-none transition shadow-sm",
          mono ? "font-mono" : "",
          invalid ? "border-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-200" : "border-app-border focus:border-app-accent-muted focus:ring-2 focus:ring-app-accent-muted/10",
          disabled ? "cursor-not-allowed bg-slate-100 text-app-subtle opacity-70" : hasValue ? "text-app-primary hover:border-app-border-strong" : "text-app-muted hover:border-app-border-strong",
          className,
        ].join(" ")}
        aria-expanded={open}
        aria-invalid={invalid || undefined}
      >
        <span className="min-w-0 truncate">{selectedLabel || placeholder}</span>
        <span className="shrink-0 text-app-muted">⌄</span>
      </button>
      {open && !disabled && (
        <div className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-app-border bg-app-surface p-1 shadow-xl shadow-slate-900/12">
          {displayOptions.map((option) => {
            const selected = option.value === value
            return (
              <button
                key={option.value || "__empty"}
                type="button"
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
                className={[
                  "block w-full truncate rounded px-3 py-2.5 text-left text-sm transition",
                  mono ? "font-mono" : "",
                  selected ? "bg-app-selected text-app-primary" : "text-app-secondary hover:bg-app-surface-hover hover:text-app-primary",
                  option.value ? "" : "text-app-muted",
                ].join(" ")}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
