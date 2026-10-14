import { clsx, type ClassValue } from "clsx"

export function cn(...values: ClassValue[]) {
  return clsx(...values)
}

export const themeClassNames = {
  page: "bg-app-bg text-app-primary",
  shell: {
    root: "bg-app-bg text-app-primary",
    header: "border-b border-app-border/80 bg-app-shell text-app-secondary shadow-[0_1px_0_rgb(255_255_255_/_0.75)]",
    rail: "border-app-border/80 bg-app-rail",
    subnav: "border-b border-app-border/80 bg-app-bg",
    footer: "border-app-border/80 bg-app-shell text-app-muted",
  },
  layout: {
    modalOverlay: "bg-app-overlay/35",
    drawerOverlay: "bg-app-overlay/30",
    editorSidebar: "min-h-0 overflow-auto bg-app-bg text-app-primary",
    resourceSidebar: "min-w-0 overflow-auto bg-app-bg text-app-primary",
  },
  surface: {
    card: "rounded-2xl border border-app-border/80 bg-app-surface/88 text-app-primary shadow-card backdrop-blur",
    panel: "rounded-3xl border border-app-border/80 bg-app-surface/88 text-app-primary shadow-card",
    subtle: "rounded-xl border border-app-border/70 bg-app-surface-muted/80 text-app-secondary",
    drawer: "border-app-border/80 bg-app-shell text-app-primary shadow-2xl shadow-app-overlay/16",
  },
  button: {
    primary: "inline-flex items-center justify-center rounded-lg bg-app-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm transition hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:opacity-50",
    primaryCompact: "inline-flex items-center justify-center rounded bg-app-accent px-4 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-app-accent-hover disabled:cursor-not-allowed disabled:opacity-50",
    secondary: "inline-flex items-center justify-center rounded-lg border border-app-border bg-app-surface/90 px-3 py-1.5 text-sm font-medium text-app-secondary shadow-sm transition hover:border-app-border-strong hover:text-app-primary disabled:cursor-not-allowed disabled:opacity-50",
    ghost: "inline-flex items-center justify-center rounded-lg px-3 py-1.5 text-sm font-medium text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary disabled:cursor-not-allowed disabled:opacity-50",
    icon: "inline-flex items-center justify-center rounded-md text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary disabled:cursor-not-allowed disabled:opacity-50",
    danger: "inline-flex items-center justify-center rounded-lg border border-app-danger-border bg-app-danger-surface px-3 py-1.5 text-sm font-medium text-app-danger transition hover:border-app-danger hover:text-app-danger-hover disabled:cursor-not-allowed disabled:opacity-50",
    dangerInline: "inline-flex items-center justify-center rounded px-2 py-1 text-xs text-app-danger transition hover:bg-app-danger-surface hover:text-app-danger-hover disabled:cursor-not-allowed disabled:opacity-50",
    subtle: "inline-flex items-center justify-center rounded bg-app-surface/70 px-2.5 py-1 text-xs text-app-secondary transition hover:bg-app-selected hover:text-app-primary disabled:cursor-not-allowed disabled:opacity-50",
    accentLink: "inline-flex items-center justify-center rounded px-2 py-0.5 text-[11px] text-app-accent transition hover:bg-app-selected/70 hover:text-app-accent-hover disabled:cursor-not-allowed disabled:text-app-subtle",
  },
  form: {
    input: "rounded-lg border border-app-border bg-app-surface/90 text-app-primary outline-none transition placeholder:text-app-subtle focus:border-app-accent-muted focus:ring-2 focus:ring-app-accent-muted/10 disabled:cursor-not-allowed disabled:bg-app-surface-muted disabled:text-app-subtle",
    textarea: "rounded-lg border border-app-border bg-app-surface/90 text-app-primary outline-none transition placeholder:text-app-subtle focus:border-app-accent-muted focus:ring-2 focus:ring-app-accent-muted/10 disabled:cursor-not-allowed disabled:bg-app-surface-muted disabled:text-app-subtle",
    popup: "rounded-lg border border-app-border bg-app-surface p-1 shadow-xl shadow-app-overlay/12",
    option: "rounded px-3 py-2.5 text-left text-sm text-app-secondary transition hover:bg-app-surface-hover hover:text-app-primary",
    optionActive: "bg-app-selected text-app-primary",
  },
  resource: {
    empty: "rounded border border-dashed border-app-border/80 px-3 py-2 text-xs text-app-muted",
    emptyText: "text-xs text-app-muted",
    countText: "font-mono text-app-muted",
    summaryCard: "rounded border border-app-border/80 bg-app-surface/70 px-3 py-2",
    card: "w-full rounded-lg border border-app-border/80 bg-app-surface/80 text-left shadow-sm shadow-app-overlay/5 transition hover:border-app-border-strong hover:bg-app-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-accent-muted/15",
    cardActive: "border-app-accent-muted/65 bg-app-selected/80 shadow-card-soft ring-1 ring-app-accent-muted/15 hover:border-app-accent-muted/75 hover:bg-app-selected/90",
    cardBound: "border-app-accent-muted/45 bg-app-selected/60 ring-1 ring-app-accent-muted/10 hover:border-app-accent-muted/60 hover:bg-app-selected/70",
    groupAccent: "bg-app-accent-muted/55",
    groupDivider: "bg-app-selected",
    groupList: "ml-1.5 space-y-1.5 border-l border-app-border/70 pl-3",
    filterBar: "rounded bg-app-surface/80 p-1",
    filterButtonActive: "bg-app-selected text-app-primary",
    filterButtonInactive: "text-app-muted hover:bg-app-surface/70 hover:text-app-secondary",
  },
  badge: {
    neutral: "rounded bg-app-surface/70 px-1.5 py-0.5 text-[10px] text-app-muted",
    selected: "rounded bg-app-selected-strong/10 px-1.5 py-0.5 text-[10px] font-medium text-app-accent",
    warning: "rounded bg-app-warning-surface px-1.5 py-0.5 text-[10px] text-app-warning",
    success: "rounded bg-app-success-surface px-1.5 py-0.5 text-[10px] text-app-success",
  },
  state: {
    dangerText: "text-app-danger",
    warningText: "text-app-warning",
    successText: "text-app-success",
    dangerAlert: "rounded border border-app-danger-border bg-app-danger-surface px-3 py-2 text-xs text-app-danger",
    warningAlert: "rounded border border-app-warning-border bg-app-warning-surface px-3 py-2 text-xs text-app-warning",
  },
  code: {
    block: "rounded-lg border border-app-border bg-app-surface-muted p-3 font-mono text-xs leading-relaxed text-app-secondary",
    darkBlock: "rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-100",
  },
}
