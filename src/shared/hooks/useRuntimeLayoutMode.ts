import { useEffect, useState } from "react"

import { detectRuntimeClientKind } from "@/shared/api/runtimeAccess"

export type RuntimeLayoutMode = "desktop" | "mobile"

const NARROW_VIEWPORT_QUERY = "(max-width: 767px)"
const COMPACT_TOUCH_QUERY = "(pointer: coarse) and (max-width: 1024px)"

/**
 * 判断 Runtime Web 当前应使用的布局模式。
 *
 * 这里刻意不只依赖 user-agent：手机 Chrome、微信 WebView、窄屏桌面浏览器、平板折叠屏的 UA 和能力并不等价。
 * Electron 桌面壳保持 desktop，避免桌面窗口缩窄时误切到移动工作流；浏览器端优先根据视口宽度和触控能力进入 mobile。
 */
export function detectRuntimeLayoutMode(): RuntimeLayoutMode {
  if (typeof window === "undefined") return "desktop"

  const clientKind = detectRuntimeClientKind()
  if (clientKind === "electron-desktop") return "desktop"
  if (clientKind === "mobile-web") return "mobile"

  const canUseMatchMedia = typeof window.matchMedia === "function"
  const narrowViewport = canUseMatchMedia
    ? window.matchMedia(NARROW_VIEWPORT_QUERY).matches
    : window.innerWidth <= 767
  const compactTouchViewport = canUseMatchMedia
    ? window.matchMedia(COMPACT_TOUCH_QUERY).matches
    : false

  return narrowViewport || compactTouchViewport ? "mobile" : "desktop"
}

export function useRuntimeLayoutMode(): RuntimeLayoutMode {
  const [layoutMode, setLayoutMode] = useState<RuntimeLayoutMode>(() => detectRuntimeLayoutMode())

  useEffect(() => {
    if (typeof window === "undefined") return undefined

    const update = () => setLayoutMode((current) => {
      const next = detectRuntimeLayoutMode()
      return current === next ? current : next
    })

    const mediaQueries = [
      window.matchMedia?.(NARROW_VIEWPORT_QUERY),
      window.matchMedia?.(COMPACT_TOUCH_QUERY),
    ].filter((query): query is MediaQueryList => Boolean(query))

    for (const query of mediaQueries) {
      query.addEventListener?.("change", update)
    }
    window.addEventListener("resize", update)
    window.addEventListener("orientationchange", update)
    update()

    return () => {
      for (const query of mediaQueries) {
        query.removeEventListener?.("change", update)
      }
      window.removeEventListener("resize", update)
      window.removeEventListener("orientationchange", update)
    }
  }, [])

  return layoutMode
}

export function useIsMobileRuntimeLayout(): boolean {
  return useRuntimeLayoutMode() === "mobile"
}
