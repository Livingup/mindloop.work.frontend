import { useEffect, useState } from "react"

import { getFileResource } from "@/features/chat/api/fileResourceApi"

export type ResourceLocatorDetails = {
  status: "idle" | "loading" | "ready" | "failed"
  localStoragePath?: string | null
  objectStorageUrl?: string | null
  errorMessage?: string | null
}

type ResourceLocatorPanelTone = "slate" | "stone" | "light"

const PANEL_TONE_CLASSES: Record<ResourceLocatorPanelTone, {
  panel: string
  label: string
  value: string
  loading: string
  failed: string
}> = {
  slate: {
    panel: "shrink-0 space-y-1 border-t border-white/10 bg-slate-950 px-4 py-2 text-[11px] text-slate-300",
    label: "text-slate-500",
    value: "select-text break-all font-mono text-slate-200",
    loading: "shrink-0 border-t border-white/10 bg-slate-950 px-4 py-2 text-[11px] text-slate-400",
    failed: "shrink-0 border-t border-white/10 bg-slate-950 px-4 py-2 text-[11px] text-amber-200/90",
  },
  stone: {
    panel: "shrink-0 space-y-1 border-b border-white/10 bg-stone-950 px-4 py-2 text-[11px] text-stone-300",
    label: "text-stone-500",
    value: "select-text break-all font-mono text-stone-200",
    loading: "shrink-0 border-b border-white/10 bg-stone-950 px-4 py-2 text-[11px] text-stone-400",
    failed: "shrink-0 border-b border-white/10 bg-stone-950 px-4 py-2 text-[11px] text-amber-200/90",
  },
  light: {
    panel: "shrink-0 space-y-1 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-700",
    label: "text-slate-500",
    value: "select-text break-all font-mono text-slate-900",
    loading: "shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-2 text-[11px] text-slate-500",
    failed: "shrink-0 border-t border-slate-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-800",
  },
}

export function useResourceLocatorDetails(resourceId?: string | null): ResourceLocatorDetails {
  const [details, setDetails] = useState<ResourceLocatorDetails>({ status: "idle" })

  useEffect(() => {
    if (!resourceId) {
      setDetails({ status: "idle" })
      return
    }
    let cancelled = false
    setDetails({ status: "loading" })
    void getFileResource(resourceId).then((resource) => {
      if (cancelled) return
      setDetails({
        status: "ready",
        localStoragePath: resource.local_storage_path,
        objectStorageUrl: resource.object_storage_url,
      })
    }).catch((error) => {
      if (cancelled) return
      setDetails({
        status: "failed",
        errorMessage: error instanceof Error ? error.message : "资源定位信息加载失败。",
      })
    })
    return () => {
      cancelled = true
    }
  }, [resourceId])

  return details
}

export function ResourceLocatorPanel({
  details,
  tone = "slate",
}: {
  details: ResourceLocatorDetails
  tone?: ResourceLocatorPanelTone
}) {
  const toneClasses = PANEL_TONE_CLASSES[tone]
  if (details.status === "idle") return null
  if (details.status === "loading") {
    return <div className={toneClasses.loading}>正在加载资源定位信息…</div>
  }
  if (details.status === "failed") {
    return <div className={toneClasses.failed}>定位信息加载失败：{details.errorMessage}</div>
  }
  return (
    <div className={toneClasses.panel}>
      <ResourceLocatorRow label="本地 filepath" value={details.localStoragePath} labelClassName={toneClasses.label} valueClassName={toneClasses.value} />
      <ResourceLocatorRow label="OSS URL" value={details.objectStorageUrl} labelClassName={toneClasses.label} valueClassName={toneClasses.value} />
    </div>
  )
}

function ResourceLocatorRow({
  label,
  value,
  labelClassName,
  valueClassName,
}: {
  label: string
  value?: string | null
  labelClassName: string
  valueClassName: string
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)]">
      <span className={labelClassName}>{label}</span>
      <span className={valueClassName}>{value || "-"}</span>
    </div>
  )
}
