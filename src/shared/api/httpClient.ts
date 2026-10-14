import {
  getRuntimeAccessToken,
  resolveRuntimeApiUrl,
  runtimeAuthHeaders,
} from "@/shared/api/runtimeAccess"
import {
  notifyRuntimeAuthInvalid,
  runtimeAuthInvalidCodeFromBody,
} from "@/shared/api/runtimeAuthInvalidation"
import {
  createNetworkTraceId,
  networkOperationFromPath,
  recordRendererNetworkEvent,
  safeNetworkPath,
} from "@/shared/network/networkTrace"

export class HttpError extends Error {
  readonly status: number
  readonly body: unknown

  constructor(message: string, status: number, body: unknown) {
    super(message)
    this.name = "HttpError"
    this.status = status
    this.body = body
  }
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"

/**
 * 默认 HTTP 请求超时（毫秒）。
 *
 * 设计取舍：所有非 SSE 的业务 REST 请求都应该秒级返回（attach scene、list bubbles、
 * heartbeat 等）。一旦某次请求被网络栈 / 代理 / 后端阻塞超过 60s，再等也无意义，
 * 应该让上层 mutation 落到失败态由用户决定重试，而不是把整个 UI 卡死在 pending。
 *
 * SSE 长连接不走 requestJson，因此该超时不影响事件流持久订阅。
 */
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

export type JsonRequestOptions = {
  method?: HttpMethod
  body?: unknown
  signal?: AbortSignal
  /** 可选覆盖默认超时；显式传 0 表示不设超时（罕见，仅在确知是长流式请求时使用）。 */
  timeoutMs?: number
}

export type JsonResponseWithMeta<TResponse> = {
  data: TResponse
  headers: Headers
  status: number
}

export async function requestJson<TResponse>(
  path: string,
  options: JsonRequestOptions = {},
): Promise<TResponse> {
  const result = await requestJsonWithMeta<TResponse>(path, options)
  return result.data
}

export async function requestJsonWithMeta<TResponse>(
  path: string,
  options: JsonRequestOptions = {},
): Promise<JsonResponseWithMeta<TResponse>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
  const traceId = createNetworkTraceId("rest")
  const operation = networkOperationFromPath(path)
  const safePath = safeNetworkPath(path)
  const startedAt = performance.now()
  const { signal, dispose, didTimeout } = composeRequestSignal(options.signal, timeoutMs)
  recordRendererNetworkEvent({
    trace_id: traceId,
    type: "rest.start",
    request_type: "rest",
    operation,
    method: options.method ?? "GET",
    path: safePath,
    timeout_ms: timeoutMs,
  })
  try {
    const sentToken = getRuntimeAccessToken()
    const headers: Record<string, string> = {
      "x-network-trace-id": traceId,
      ...runtimeAuthHeaders(),
    }
    if (options.body !== undefined) headers["Content-Type"] = "application/json"
    const response = await fetch(resolveRuntimeApiUrl(path), {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal,
    })

    const text = await response.text()
    const body = parseResponseBody(text)

    if (!response.ok) {
      const message = errorMessageFromBody(body) ?? (response.statusText || "HTTP request failed")
      recordRendererNetworkEvent({
        trace_id: traceId,
        type: "rest.http_error",
        request_type: "rest",
        operation,
        method: options.method ?? "GET",
        path: safePath,
        status: response.status,
        duration_ms: Math.round(performance.now() - startedAt),
        timeout_ms: timeoutMs,
        error_type: "http_error",
        error_message: message,
      })
      const code = runtimeAuthInvalidCodeFromBody(response.status, body)
      if (code) {
        notifyRuntimeAuthInvalid({ code, detail: message, source: "rest" }, sentToken)
      }
      throw new HttpError(message, response.status, body)
    }

    recordRendererNetworkEvent({
      trace_id: traceId,
      type: "rest.success",
      request_type: "rest",
      operation,
      method: options.method ?? "GET",
      path: safePath,
      status: response.status,
      duration_ms: Math.round(performance.now() - startedAt),
      timeout_ms: timeoutMs,
    })
    return {
      data: body as TResponse,
      headers: response.headers,
      status: response.status,
    }
  } catch (error) {
    if (!(error instanceof HttpError)) {
      const timeout = didTimeout()
      recordRendererNetworkEvent({
        trace_id: traceId,
        type: timeout ? "rest.timeout" : "rest.error",
        request_type: "rest",
        operation,
        method: options.method ?? "GET",
        path: safePath,
        duration_ms: Math.round(performance.now() - startedAt),
        timeout_ms: timeoutMs,
        error_type: timeout ? "timeout" : errorName(error),
        error_message: errorMessage(error),
      })
    }
    throw error
  } finally {
    dispose()
  }
}

/**
 * 把"调用方传入的 abort signal"和"内部超时 abort"合并为单一 signal。
 *
 * 为什么不直接用 AbortSignal.any()：避免对 Electron 内嵌 Chromium / Node 版本下
 * AbortSignal.any 可用性的强假设；手动桥接更稳，并且能在 dispose 时显式清理监听，
 * 防止长生命周期 caller signal 累积事件订阅。
 */
function composeRequestSignal(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal | undefined; dispose: () => void; didTimeout: () => boolean } {
  if (timeoutMs <= 0 && !callerSignal) {
    return { signal: undefined, dispose: () => undefined, didTimeout: () => false }
  }
  const controller = new AbortController()
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let timeoutAborted = false
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      timeoutAborted = true
      const reason = new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError")
      controller.abort(reason)
    }, timeoutMs)
  }
  let abortListener: (() => void) | null = null
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason)
    } else {
      abortListener = () => controller.abort(callerSignal.reason)
      callerSignal.addEventListener("abort", abortListener, { once: true })
    }
  }
  return {
    signal: controller.signal,
    dispose: () => {
      if (timeoutHandle !== null) clearTimeout(timeoutHandle)
      if (abortListener && callerSignal) {
        callerSignal.removeEventListener("abort", abortListener)
      }
    },
    didTimeout: () => timeoutAborted,
  }
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name ? error.name : "network_error"
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return String(error || "network error")
}

function parseResponseBody(text: string): unknown {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function errorMessageFromBody(body: unknown): string | null {
  if (typeof body === "string" && body.trim()) return body
  if (!body || typeof body !== "object") return null
  const record = body as Record<string, unknown>
  const detail = record.detail
  if (typeof detail === "string" && detail.trim()) return detail
  if (Array.isArray(detail) && detail.length > 0) {
    return detail.map((item) => {
      if (!item || typeof item !== "object") return String(item)
      const detailRecord = item as Record<string, unknown>
      const message = typeof detailRecord.msg === "string" ? detailRecord.msg : JSON.stringify(detailRecord)
      const location = Array.isArray(detailRecord.loc) ? detailRecord.loc.join(".") : null
      return location ? `${location}: ${message}` : message
    }).join("; ")
  }
  const message = record.message
  if (typeof message === "string" && message.trim()) return message
  return null
}
