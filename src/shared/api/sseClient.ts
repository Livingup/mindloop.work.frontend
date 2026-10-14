import { appendRuntimeAccessToken } from "@/shared/api/runtimeAccess"
import {
  afterSeqFromUrl,
  appendNetworkTraceQuery,
  createNetworkTraceId,
  networkOperationFromPath,
  recordRendererNetworkEvent,
  safeNetworkPath,
} from "@/shared/network/networkTrace"

export type SseEventHandler<TEvent> = (event: TEvent) => void

export type SseActivityKind = "open" | "message" | "ping" | "error"

export type SseActivity = {
  kind: SseActivityKind
  /** 本地接收到该 SSE 活性信号的 ISO 时间。 */
  at: string
  /** 浏览器 MessageEvent.lastEventId；业务 message 时通常是后端 stream seq。 */
  lastEventId?: string
  /** 命名 SSE event 类型，例如 communication.message / communication.ping。 */
  eventType?: string
  /** 当前物理连接已收到的业务 message 数量；ping 不计入。 */
  messageCount: number
  readyState?: number
  /** activity-only 事件解析后的 JSON payload（如 communication.ping 的 runtime_boot_id）。 */
  data?: unknown
}

export type SseClientOptions<TEvent> = {
  /**
   * 静态 URL。与 `buildUrl` 二选一；优先级低于 `buildUrl`。
   * 在需要在重连时携带最新 `after_seq` 等状态参数的场景，请使用 `buildUrl`。
   */
  url?: string
  /**
   * 每次连接（含重连）前调用以得到最新 URL。
   * 用于追加 `?after_seq=<latestSeq>` 从上次中断点续传。
   */
  buildUrl?: () => string
  eventTypes?: string[]
  /** 只作为连接活性信号消费的命名 SSE event 类型，不会进入业务 onEvent。 */
  activityEventTypes?: string[]
  /** 收到即关闭连接并终止重连的命名 SSE event 类型，不会进入业务 onEvent。 */
  terminalEventTypes?: string[]
  onTerminalEvent?: (eventType: string, data: unknown) => void
  onEvent: SseEventHandler<TEvent>
  onOpen?: () => void
  onActivity?: (activity: SseActivity) => void
  onError?: (error: Event) => void
  /** 检测到不可恢复关闭后是否自动重连。默认 true。 */
  autoReconnect?: boolean
  /** 初始重连延迟（毫秒），默认 1000。 */
  initialReconnectDelayMs?: number
  /** 重连延迟上限（毫秒），默认 15000。 */
  maxReconnectDelayMs?: number
}

export class SseClient<TEvent> {
  private source: EventSource | null = null
  private readonly options: SseClientOptions<TEvent>
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private currentReconnectDelayMs: number
  private readonly maxReconnectDelayMs: number
  private readonly autoReconnect: boolean
  private closedByUser = false
  private connectAttempt = 0
  private currentTraceId: string | null = null
  private currentStartedAt = 0
  private currentMessageCount = 0
  private currentFirstEventRecorded = false

  constructor(options: SseClientOptions<TEvent>) {
    if (!options.url && !options.buildUrl) {
      throw new Error("SseClient 需要提供 url 或 buildUrl。")
    }
    this.options = options
    this.autoReconnect = options.autoReconnect ?? true
    this.currentReconnectDelayMs = options.initialReconnectDelayMs ?? 1000
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 15000
  }

  connect() {
    this.cancelReconnect()
    this.closeSource()
    this.closedByUser = false
    this.connectAttempt += 1
    this.currentTraceId = createNetworkTraceId("sse")
    this.currentStartedAt = performance.now()
    this.currentMessageCount = 0
    this.currentFirstEventRecorded = false
    const rawUrl = this.options.buildUrl ? this.options.buildUrl() : this.options.url!
    const url = appendNetworkTraceQuery(appendRuntimeAccessToken(rawUrl), this.currentTraceId)
    const safePath = safeNetworkPath(rawUrl)
    const operation = networkOperationFromPath(rawUrl)
    const afterSeq = afterSeqFromUrl(rawUrl)
    recordRendererNetworkEvent({
      trace_id: this.currentTraceId,
      type: "sse.connect",
      request_type: "sse",
      operation,
      method: "GET",
      path: safePath,
      attempt: this.connectAttempt,
      after_seq: afterSeq,
    })
    const source = new EventSource(url)
    this.source = source

    source.onopen = () => {
      this.currentReconnectDelayMs = this.options.initialReconnectDelayMs ?? 1000
      if (this.currentTraceId) {
        recordRendererNetworkEvent({
          trace_id: this.currentTraceId,
          type: "sse.open",
          request_type: "sse",
          operation,
          method: "GET",
          path: safePath,
          duration_ms: Math.round(performance.now() - this.currentStartedAt),
          attempt: this.connectAttempt,
          ready_state: source.readyState,
          after_seq: afterSeq,
        })
      }
      this.recordActivity("open", { readyState: source.readyState })
      this.options.onOpen?.()
    }
    source.onerror = (error) => {
      if (this.currentTraceId) {
        recordRendererNetworkEvent({
          trace_id: this.currentTraceId,
          type: "sse.error",
          request_type: "sse",
          operation,
          method: "GET",
          path: safePath,
          duration_ms: Math.round(performance.now() - this.currentStartedAt),
          attempt: this.connectAttempt,
          ready_state: source.readyState,
          message_count: this.currentMessageCount,
          after_seq: afterSeq,
          error_type: eventErrorType(error),
        })
      }
      this.recordActivity("error", { readyState: source.readyState })
      this.options.onError?.(error)
      if (this.closedByUser) return
      // EventSource 自带重连无法携带最新 after_seq；需手动重建。
      if (source.readyState === EventSource.CLOSED) {
        this.scheduleReconnect()
      } else if (this.autoReconnect && source.readyState !== EventSource.OPEN) {
        // 处于 CONNECTING 但多次报错时，主动关闭后带 after_seq 重连，避免重复从 0 拉取。
        this.closeSource()
        this.scheduleReconnect()
      }
    }

    if (this.options.eventTypes?.length) {
      for (const eventType of this.options.eventTypes) {
        source.addEventListener(eventType, (message) => {
          this.handleMessage(message as MessageEvent<string>, operation, safePath, afterSeq, eventType)
        })
      }
    } else {
      source.onmessage = (message) => {
        this.handleMessage(message, operation, safePath, afterSeq, "message")
      }
    }
    if (this.options.activityEventTypes?.length) {
      for (const eventType of this.options.activityEventTypes) {
        source.addEventListener(eventType, (message) => {
          const event = message as MessageEvent<string>
          let data: unknown
          if (typeof event.data === "string" && event.data.length > 0) {
            try {
              data = JSON.parse(event.data)
            } catch {
              data = event.data
            }
          }
          this.recordActivity("ping", {
            eventType,
            lastEventId: event.lastEventId || undefined,
            readyState: source.readyState,
            data,
          })
        })
      }
    }
    if (this.options.terminalEventTypes?.length) {
      for (const eventType of this.options.terminalEventTypes) {
        source.addEventListener(eventType, (message) => {
          const event = message as MessageEvent<string>
          let data: unknown
          if (typeof event.data === "string" && event.data.length > 0) {
            try {
              data = JSON.parse(event.data)
            } catch {
              data = event.data
            }
          }
          this.close()
          this.options.onTerminalEvent?.(eventType, data)
        })
      }
    }
  }

  close() {
    this.closedByUser = true
    this.recordClose("user")
    this.cancelReconnect()
    this.closeSource()
  }

  private closeSource() {
    this.source?.close()
    this.source = null
  }

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  private scheduleReconnect() {
    if (!this.autoReconnect || this.closedByUser || this.reconnectTimer) return
    const delay = this.currentReconnectDelayMs
    this.currentReconnectDelayMs = Math.min(delay * 2, this.maxReconnectDelayMs)
    if (this.currentTraceId) {
      recordRendererNetworkEvent({
        trace_id: this.currentTraceId,
        type: "sse.reconnect_scheduled",
        request_type: "sse",
        duration_ms: Math.round(performance.now() - this.currentStartedAt),
        attempt: this.connectAttempt,
        reconnect_delay_ms: delay,
        message_count: this.currentMessageCount,
      })
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.recordClose("reconnect")
      this.connect()
    }, delay)
  }

  private handleMessage(message: MessageEvent<string>, operation: string, path: string, afterSeq: number | undefined, eventType?: string) {
    this.currentMessageCount += 1
    this.recordActivity("message", {
      eventType,
      lastEventId: message.lastEventId || undefined,
      readyState: this.source?.readyState,
    })
    if (this.currentTraceId && !this.currentFirstEventRecorded) {
      this.currentFirstEventRecorded = true
      recordRendererNetworkEvent({
        trace_id: this.currentTraceId,
        type: "sse.first_event",
        request_type: "sse",
        operation,
        method: "GET",
        path,
        duration_ms: Math.round(performance.now() - this.currentStartedAt),
        attempt: this.connectAttempt,
        message_count: this.currentMessageCount,
        after_seq: afterSeq,
      })
    }
    this.options.onEvent(JSON.parse(message.data) as TEvent)
  }

  private recordActivity(kind: SseActivityKind, details: { eventType?: string; lastEventId?: string; readyState?: number; data?: unknown } = {}) {
    this.options.onActivity?.({
      kind,
      at: new Date().toISOString(),
      eventType: details.eventType,
      lastEventId: details.lastEventId,
      readyState: details.readyState,
      messageCount: this.currentMessageCount,
      data: details.data,
    })
  }

  private recordClose(reason: string) {
    if (!this.currentTraceId) return
    recordRendererNetworkEvent({
      trace_id: this.currentTraceId,
      type: "sse.close",
      request_type: "sse",
      duration_ms: Math.round(performance.now() - this.currentStartedAt),
      attempt: this.connectAttempt,
      message_count: this.currentMessageCount,
      error_type: reason,
    })
    this.currentTraceId = null
  }
}

function eventErrorType(error: Event): string {
  return error.type || "sse_error"
}
