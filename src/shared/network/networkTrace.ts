type NetworkLayer = "renderer"

type RendererNetworkEvent = {
  layer: NetworkLayer
  type: string
  trace_id: string
  timestamp: string
  operation?: string
  method?: string
  path?: string
  status?: number
  duration_ms?: number
  timeout_ms?: number
  error_type?: string
  error_message?: string
  request_type?: "rest" | "sse"
  attempt?: number
  ready_state?: number
  reconnect_delay_ms?: number
  message_count?: number
  after_seq?: number
}

type SpreadDesktopNetworkBridge = {
  appendNetworkLog?: (records: RendererNetworkEvent[]) => Promise<unknown>
}

type NetworkWindow = Window & {
  spreadDesktop?: SpreadDesktopNetworkBridge
}

const MAX_RENDERER_NETWORK_EVENTS = 500
const NETWORK_LOG_BATCH_SIZE = 50
const MAX_PENDING_NETWORK_LOG_RECORDS = 1000
const NETWORK_LOG_FLUSH_INTERVAL_MS = 1000
const NETWORK_LOG_MIN_SAMPLE_INTERVAL_MS = 10_000

const rendererNetworkEvents: RendererNetworkEvent[] = []
const pendingNetworkLogRecords: RendererNetworkEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let lastSampledSuccessAt = 0
let droppedRendererNetworkLogRecords = 0

export function createNetworkTraceId(prefix = "net") {
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

export function networkOperationFromPath(path: string): string {
  const pathname = safePathname(path)
  if (pathname === "/api/health") return "health"
  if (pathname.includes("/attach")) return "attach"
  if (pathname.includes("/heartbeat")) return "heartbeat"
  if (pathname.includes("/events")) return "sse"
  if (pathname.includes("/messages")) return "communication_messages"
  return "api"
}

export function appendNetworkTraceQuery(url: string, traceId: string): string {
  const separator = url.includes("?") ? "&" : "?"
  return `${url}${separator}network_trace_id=${encodeURIComponent(traceId)}`
}

export function afterSeqFromUrl(url: string): number | undefined {
  try {
    const parsed = new URL(url, window.location.href)
    const value = parsed.searchParams.get("after_seq")
    if (!value) return undefined
    const parsedValue = Number.parseInt(value, 10)
    return Number.isFinite(parsedValue) ? parsedValue : undefined
  } catch {
    return undefined
  }
}

export function safeNetworkPath(input: string): string {
  try {
    const parsed = new URL(input, window.location.href)
    const allowedParams = new URLSearchParams()
    for (const key of ["after_seq", "limit", "latest"]) {
      const value = parsed.searchParams.get(key)
      if (value !== null) allowedParams.set(key, value)
    }
    const pathname = redactCodexNetworkPath(parsed.pathname)
    const query = allowedParams.toString()
    return query ? `${pathname}?${query}` : pathname
  } catch {
    return input.split("?")[0] || input
  }
}

function redactCodexNetworkPath(pathname: string): string {
  if (!pathname.startsWith("/api/codex-oauth/")) return pathname
  const segments = pathname.split("/")
  if (segments.length > 5 && segments[3] === "auth") {
    if (segments[4] === "attempts") segments[5] = "<attempt>"
    else if ((segments[4] === "browser" || segments[4] === "device") && segments[5] !== "start") segments[5] = "<attempt>"
  } else if (segments.length > 4 && segments[3] === "accounts" && segments[4] !== "reorder") {
    segments[4] = "<account>"
  } else if (segments.length > 4 && segments[3] === "operations") {
    segments[4] = "<operation>"
  }
  return segments.join("/")
}

export function recordRendererNetworkEvent(event: Omit<RendererNetworkEvent, "layer" | "timestamp">) {
  const record: RendererNetworkEvent = {
    ...event,
    layer: "renderer",
    timestamp: new Date().toISOString(),
  }
  rendererNetworkEvents.push(record)
  while (rendererNetworkEvents.length > MAX_RENDERER_NETWORK_EVENTS) rendererNetworkEvents.shift()
  if (!shouldPersistRecord(record)) return
  if (pendingNetworkLogRecords.length >= MAX_PENDING_NETWORK_LOG_RECORDS) {
    pendingNetworkLogRecords.shift()
    droppedRendererNetworkLogRecords += 1
  }
  pendingNetworkLogRecords.push(record)
  if (pendingNetworkLogRecords.length >= NETWORK_LOG_BATCH_SIZE) {
    void flushNetworkLogRecords()
    return
  }
  scheduleNetworkLogFlush()
}

export function flushNetworkLogRecords() {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (pendingNetworkLogRecords.length === 0) return Promise.resolve()
  const bridge = typeof window !== "undefined"
    ? (window as NetworkWindow).spreadDesktop
    : undefined
  if (!bridge?.appendNetworkLog) {
    pendingNetworkLogRecords.length = 0
    return Promise.resolve()
  }
  const records = pendingNetworkLogRecords.splice(0, NETWORK_LOG_BATCH_SIZE)
  if (droppedRendererNetworkLogRecords > 0) {
    records.push({
      layer: "renderer",
      type: "network.renderer_log_dropped",
      trace_id: createNetworkTraceId("renderer"),
      timestamp: new Date().toISOString(),
      error_type: "queue_full",
      message_count: droppedRendererNetworkLogRecords,
    })
    droppedRendererNetworkLogRecords = 0
  }
  return bridge.appendNetworkLog(records).catch(() => undefined)
}

function scheduleNetworkLogFlush() {
  if (flushTimer !== null) return
  flushTimer = setTimeout(() => {
    void flushNetworkLogRecords()
  }, NETWORK_LOG_FLUSH_INTERVAL_MS)
}

function shouldPersistRecord(record: RendererNetworkEvent): boolean {
  if (record.type.includes("error") || record.type.includes("timeout") || record.type.includes("close")) return true
  if (record.duration_ms !== undefined && record.duration_ms >= 1000) return true
  if (record.operation === "health" || record.operation === "attach") return true
  if (record.request_type === "sse") return true
  if (!record.type.endsWith("success")) return true
  const now = Date.now()
  if (now - lastSampledSuccessAt >= NETWORK_LOG_MIN_SAMPLE_INTERVAL_MS) {
    lastSampledSuccessAt = now
    return true
  }
  return false
}

function safePathname(input: string): string {
  try {
    return new URL(input, window.location.href).pathname
  } catch {
    return input.split("?")[0] || input
  }
}
