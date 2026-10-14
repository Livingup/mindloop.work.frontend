import { useEffect, useMemo, useState } from "react"

type PageLifecycleSnapshot = {
  visibilityState: DocumentVisibilityState
  isFocused: boolean
  foregroundVersion: number
}

export type PageLifecycleState = PageLifecycleSnapshot & {
  isVisible: boolean
  isBackground: boolean
}

function readPageLifecycleSnapshot(previous?: PageLifecycleSnapshot): PageLifecycleSnapshot {
  const visibilityState = document.visibilityState
  const isFocused = document.hasFocus()
  const wasBackground = previous ? previous.visibilityState !== "visible" : false
  const isNowVisible = visibilityState === "visible"
  const foregroundVersion = previous && wasBackground && isNowVisible
    ? previous.foregroundVersion + 1
    : previous?.foregroundVersion ?? 0
  return {
    visibilityState,
    isFocused,
    foregroundVersion,
  }
}

export function usePageLifecycleState(): PageLifecycleState {
  const [snapshot, setSnapshot] = useState<PageLifecycleSnapshot>(() => readPageLifecycleSnapshot())

  useEffect(() => {
    const updateSnapshot = () => setSnapshot((current) => readPageLifecycleSnapshot(current))
    document.addEventListener("visibilitychange", updateSnapshot)
    window.addEventListener("focus", updateSnapshot)
    window.addEventListener("blur", updateSnapshot)
    window.addEventListener("pageshow", updateSnapshot)
    window.addEventListener("pagehide", updateSnapshot)
    return () => {
      document.removeEventListener("visibilitychange", updateSnapshot)
      window.removeEventListener("focus", updateSnapshot)
      window.removeEventListener("blur", updateSnapshot)
      window.removeEventListener("pageshow", updateSnapshot)
      window.removeEventListener("pagehide", updateSnapshot)
    }
  }, [])

  return useMemo(
    () => ({
      ...snapshot,
      isVisible: snapshot.visibilityState === "visible",
      isBackground: snapshot.visibilityState !== "visible",
    }),
    [snapshot],
  )
}
