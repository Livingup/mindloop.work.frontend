export const RUNTIME_ACCESS_TOKEN_STORAGE_KEY = "spread-ai.runtime-access-token"
export const RUNTIME_API_BASE_URL_STORAGE_KEY = "spread-ai.runtime-api-base-url"
export const RUNTIME_DEVICE_ID_STORAGE_KEY = "spread-ai.runtime-device-id"

export type RuntimeClientKind = "electron-desktop" | "desktop-web" | "mobile-web"

export type FrontendWebEntryReference = {
  url: string | null
  localIP: "127.0.0.1" | null
  localPort: number | null
  source: "browser-origin" | "desktop-runtime" | "unavailable"
  reason: string
}

type SpreadDesktopRestartResult = {
  ok?: boolean
  error?: string
}

type SpreadDesktopBridge = {
  isElectron?: boolean
  getRuntimeApiBaseUrl?: () => string | null
  restartRuntime?: () => Promise<SpreadDesktopRestartResult>
}

export function getRuntimeAccessToken(): string | null {
  if (typeof window === "undefined") return null
  return window.localStorage.getItem(RUNTIME_ACCESS_TOKEN_STORAGE_KEY)
}

export function setRuntimeAccessToken(token: string | null): void {
  if (typeof window === "undefined") return
  if (token && token.trim()) {
    window.localStorage.setItem(RUNTIME_ACCESS_TOKEN_STORAGE_KEY, token.trim())
    return
  }
  window.localStorage.removeItem(RUNTIME_ACCESS_TOKEN_STORAGE_KEY)
}

export function getRuntimeApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null
  const desktopBaseUrl = getDesktopRuntimeApiBaseUrl()
  if (desktopBaseUrl) return desktopBaseUrl
  const envValue = getExplicitRuntimeApiBaseUrlFromEnv()
  if (envValue) return envValue
  const sameOriginBaseUrl = getBrowserSameOriginRuntimeApiBaseUrl()
  if (isBrowserReleaseSameOriginRuntimeManaged() && sameOriginBaseUrl) return sameOriginBaseUrl
  const stored = window.localStorage.getItem(RUNTIME_API_BASE_URL_STORAGE_KEY)?.trim()
  if (stored) return trimTrailingSlash(stored)
  return sameOriginBaseUrl
}

export function setRuntimeApiBaseUrl(value: string | null): void {
  if (typeof window === "undefined") return
  const normalized = normalizeRuntimeApiBaseUrl(value)
  if (normalized) {
    window.localStorage.setItem(RUNTIME_API_BASE_URL_STORAGE_KEY, normalized)
    return
  }
  window.localStorage.removeItem(RUNTIME_API_BASE_URL_STORAGE_KEY)
}

export function normalizeRuntimeApiBaseUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? ""
  if (!trimmed) return null
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.hash = ""
    url.search = ""
    return trimTrailingSlash(url.toString())
  } catch {
    return null
  }
}

export function getFrontendWebEntryReference(): FrontendWebEntryReference {
  if (typeof window === "undefined") {
    return unavailableFrontendWebEntryReference("当前运行环境没有浏览器窗口，无法自动判断前端 Web 入口。")
  }

  const browserOrigin = getBrowserSameOriginRuntimeApiBaseUrl()
  if (browserOrigin) return buildFrontendWebEntryReference(browserOrigin, "browser-origin")

  const desktopBaseUrl = getDesktopRuntimeApiBaseUrl()
  if (desktopBaseUrl) return buildFrontendWebEntryReference(desktopBaseUrl, "desktop-runtime")

  return unavailableFrontendWebEntryReference("当前页面不是 http(s) Web 入口，且桌面壳未提供可参考的 Runtime HTTP 地址。")
}

export function resolveRuntimeApiUrl(pathOrUrl: string): string {
  if (isAbsoluteHttpUrl(pathOrUrl) || pathOrUrl.startsWith("data:")) return pathOrUrl
  const normalizedPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`
  if (isRuntimeApiBaseUrlManagedByDesktop()) return normalizedPath
  const baseUrl = getRuntimeApiBaseUrl()
  if (!baseUrl) return pathOrUrl
  return `${baseUrl}${normalizedPath}`
}

export function runtimeAuthHeaders(): Record<string, string> {
  const token = getRuntimeAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function appendRuntimeAccessToken(pathOrUrl: string): string {
  const resolved = resolveRuntimeApiUrl(pathOrUrl)
  const token = getRuntimeAccessToken()
  if (!token) return resolved
  const separator = resolved.includes("?") ? "&" : "?"
  return `${resolved}${separator}access_token=${encodeURIComponent(token)}`
}

export function getOrCreateRuntimeDeviceId(): string {
  if (typeof window === "undefined") return `device-${randomId()}`
  const existing = window.localStorage.getItem(RUNTIME_DEVICE_ID_STORAGE_KEY)?.trim()
  if (existing) return existing
  const next = `device-${randomId()}`
  window.localStorage.setItem(RUNTIME_DEVICE_ID_STORAGE_KEY, next)
  return next
}

export function isRuntimeApiBaseUrlManagedByDesktop(): boolean {
  return typeof getDesktopBridge()?.getRuntimeApiBaseUrl === "function"
}

export function isRuntimeApiBaseUrlManagedByBrowserReleaseOrigin(): boolean {
  return !getDesktopBridge() && isBrowserReleaseSameOriginRuntimeManaged() && Boolean(getBrowserSameOriginRuntimeApiBaseUrl())
}

export function canRestartRuntimeFromDesktop(): boolean {
  return typeof getDesktopBridge()?.restartRuntime === "function"
}

export async function restartRuntimeFromDesktop(): Promise<void> {
  const bridge = getDesktopBridge()
  if (typeof bridge?.restartRuntime !== "function") {
    throw new Error("当前环境不支持自动重启 Runtime，请手动重启后继续。")
  }
  const result = await bridge.restartRuntime()
  if (!result?.ok) {
    throw new Error(result?.error || "Runtime 自动重启失败，请手动重启后继续。")
  }
}

export function detectRuntimeClientKind(): RuntimeClientKind {
  const bridge = getDesktopBridge()
  if (bridge?.isElectron !== false && bridge) return "electron-desktop"
  if (typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) {
    return "mobile-web"
  }
  return "desktop-web"
}

export function isMobileRuntimeClient(): boolean {
  return detectRuntimeClientKind() === "mobile-web"
}

function getExplicitRuntimeApiBaseUrlFromEnv(): string | null {
  const envValue = typeof import.meta !== "undefined"
    ? (import.meta.env.VITE_RUNTIME_API_BASE_URL || import.meta.env.VITE_API_BASE_URL || "").trim()
    : ""
  return envValue ? trimTrailingSlash(envValue) : null
}

function getBrowserSameOriginRuntimeApiBaseUrl(): string | null {
  if (typeof window === "undefined") return null
  if (window.location.protocol !== "http:" && window.location.protocol !== "https:") return null
  return trimTrailingSlash(window.location.origin)
}

function isBrowserReleaseSameOriginRuntimeManaged(): boolean {
  return typeof import.meta !== "undefined" && Boolean(import.meta.env.PROD)
}

function getDesktopRuntimeApiBaseUrl(): string | null {
  const bridge = getDesktopBridge()
  if (typeof bridge?.getRuntimeApiBaseUrl !== "function") return null
  try {
    return normalizeRuntimeApiBaseUrl(bridge.getRuntimeApiBaseUrl())
  } catch {
    return null
  }
}

function buildFrontendWebEntryReference(urlText: string, source: FrontendWebEntryReference["source"]): FrontendWebEntryReference {
  const parsed = parseHttpUrl(urlText)
  if (!parsed) return unavailableFrontendWebEntryReference("自动判断出的地址不是有效的 http(s) URL。")
  const fallbackPort = parsed.protocol === "https:" ? 443 : 80
  return {
    url: trimTrailingSlash(parsed.toString()),
    localIP: "127.0.0.1",
    localPort: Number.parseInt(parsed.port || String(fallbackPort), 10),
    source,
    reason: source === "browser-origin"
      ? "当前页面通过 http(s) 加载，外部 FRP 可参考这个浏览器页面入口作为本机回源地址。"
      : "当前处于 Electron 桌面壳，页面协议不是普通 http(s)，因此使用桌面壳提供的 Runtime HTTP 地址作为外部浏览器回源参考。",
  }
}

function unavailableFrontendWebEntryReference(reason: string): FrontendWebEntryReference {
  return {
    url: null,
    localIP: null,
    localPort: null,
    source: "unavailable",
    reason,
  }
}

function parseHttpUrl(value: string): URL | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    url.hash = ""
    url.search = ""
    url.pathname = ""
    return url
  } catch {
    return null
  }
}

function getDesktopBridge(): SpreadDesktopBridge | null {
  if (typeof window === "undefined" || !("spreadDesktop" in window)) return null
  return (window as Window & { spreadDesktop?: SpreadDesktopBridge }).spreadDesktop ?? null
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "")
}

function isAbsoluteHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value)
}

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}
