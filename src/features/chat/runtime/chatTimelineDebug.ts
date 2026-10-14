type ChatTimelineDebugPayload = Record<string, unknown>
type ChatTimelineDebugWindow = Window & {
  spreadDesktop?: {
    appendLlmStreamLog?: (line: string) => Promise<unknown>
  }
}

const PREFIX = "[chat-debug][timeline-recovery]"
const MAX_BUFFERED_LINES = 200
const FLUSH_DELAY_MS = 250
let bufferedLines: string[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

export function chatTimelineDebug(stage: string, payload: ChatTimelineDebugPayload = {}): void {
  const safePayload = sanitizePayload(payload)
  const line = `${PREFIX} ${stage} ${JSON.stringify(safePayload)}`
  if (typeof console !== "undefined") console.debug(line)
  bufferedLines.push(`${new Date().toISOString()} ${line}`)
  if (bufferedLines.length >= MAX_BUFFERED_LINES) {
    void flushChatTimelineDebug()
    return
  }
  if (flushTimer === null) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flushChatTimelineDebug()
    }, FLUSH_DELAY_MS)
  }
}

export async function flushChatTimelineDebug(): Promise<void> {
  if (flushTimer !== null) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (bufferedLines.length === 0) return
  const lines = bufferedLines.splice(0, MAX_BUFFERED_LINES)
  if (typeof window === "undefined") return
  const bridge = (window as ChatTimelineDebugWindow).spreadDesktop
  if (!bridge?.appendLlmStreamLog) return
  await Promise.all(lines.map((line) => bridge.appendLlmStreamLog!(line).catch(() => undefined)))
  if (bufferedLines.length > 0) void flushChatTimelineDebug()
}

function sanitizePayload(payload: ChatTimelineDebugPayload): ChatTimelineDebugPayload {
  const result: ChatTimelineDebugPayload = {}
  for (const [key, value] of Object.entries(payload)) {
    if (isSensitiveKey(key)) continue
    if (typeof value === "string") {
      result[key] = safeIdentifier(value)
    } else if (typeof value === "number" || typeof value === "boolean" || value === null) {
      result[key] = value
    } else if (Array.isArray(value)) {
      result[key] = value.length
    } else if (value && typeof value === "object") {
      result[key] = "[object]"
    }
  }
  return result
}

function isSensitiveKey(key: string): boolean {
  return /(?:text|content|message|token|prompt|arguments|result|payload|authorization|credential|secret|password)/i.test(key)
}

function safeIdentifier(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 18) return trimmed
  return `${trimmed.slice(0, 8)}...${trimmed.slice(-8)}`
}
