import { createRequire } from "node:module"
import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import http from "node:http"
import https from "node:https"
import { createServer } from "node:net"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// 这是开发者本地自用的 Agent 工作台，渲染端只加载我们自己仓库里的前端源码，
// 不会执行任何第三方网页脚本；CSP / eval 等限制对该使用场景没有实际收益，
// 反而会在 Vite HMR 等开发流程中制造噪音。这里显式关闭 Electron 内置的
// 安全提示开关，避免控制台被反复打印的 CSP / unsafe-eval 警告淹没。
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true"

function earlyElectronMainLogFilePath() {
  const appDataRoot = process.env.APPDATA || process.cwd()
  const userDataName = process.env.ELECTRON_RENDERER_URL ? "spread-ai-web-dev" : "spread-ai-web"
  return path.join(appDataRoot, userDataName, "logs", "electron-main.log")
}

function earlyElectronErrorLogFilePath() {
  const appDataRoot = process.env.APPDATA || process.cwd()
  const userDataName = process.env.ELECTRON_RENDERER_URL ? "spread-ai-web-dev" : "spread-ai-web"
  return path.join(appDataRoot, userDataName, "logs", "electron-error.log")
}

function appendEarlyElectronMainLog(message, error = null) {
  try {
    const line = [
      new Date().toISOString(),
      `[pid:${process.pid}]`,
      message,
      error ? error.stack || error.message || String(error) : "",
    ].filter(Boolean).join(" ")
    const filePath = earlyElectronMainLogFilePath()
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true })
    fsSync.appendFileSync(filePath, `${line}\n`, "utf8")
    if (error) {
      const errorFilePath = earlyElectronErrorLogFilePath()
      fsSync.mkdirSync(path.dirname(errorFilePath), { recursive: true })
      fsSync.appendFileSync(errorFilePath, `${line}\n`, "utf8")
    }
  } catch {
  }
}

appendEarlyElectronMainLog("main module loading")
process.on("uncaughtException", (error) => appendEarlyElectronMainLog("uncaughtException", error))
process.on("unhandledRejection", (error) => appendEarlyElectronMainLog("unhandledRejection", error))

const require = createRequire(import.meta.url)
const { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, shell, Tray } = require("electron")
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, "..")
const distRoot = path.resolve(projectRoot, "dist")
const distRootWithSeparator = `${distRoot}${path.sep}`
const devServerUrl = process.env.ELECTRON_RENDERER_URL
const isDebugMode = process.env.ELECTRON_DEBUG_MODE === "1" || Boolean(devServerUrl)
if (devServerUrl) {
  app.setPath("userData", path.join(app.getPath("appData"), "spread-ai-web-dev"))
}
const llmStreamLogFilePath = () => path.join(app.getPath("temp"), "spread-ai", "llm-stream.log")
const packagedRoot = app.isPackaged ? path.dirname(process.execPath) : projectRoot
const appIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icons", "icon.png")
  : path.join(projectRoot, "build-resources", "icons", "icon.png")
const appTrayIconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icons", "icon.ico")
  : path.join(projectRoot, "build-resources", "icons", "icon.ico")

const windows = new Set()
let primaryWindow = null
let tray = null
let explicitQuitRequested = false
let packagedBackendProcess = null
let packagedBackendBaseUrl = null
let packagedBackendStartupPromise = null
let packagedBackendCleanupStarted = false
let packagedBackendCleanupFinished = false
let packagedBackendCleanupPromise = null
let packagedBackendClientRegistered = false
let packagedBackendClientHeartbeatTimer = null

const PACKAGED_BACKEND_POLL_INTERVAL_MS = 500
const PACKAGED_BACKEND_START_TIMEOUT_MS = 120_000
const PACKAGED_BACKEND_MAX_MAINTENANCE_TIMEOUT_MS = 900_000
const PACKAGED_BACKEND_MAINTENANCE_HEARTBEAT_STALE_MS = 30_000
const PACKAGED_BACKEND_MAINTENANCE_EXTENSION_MS = 30_000
const PACKAGED_BACKEND_LOCK_STALE_MS = 150_000
const PACKAGED_BACKEND_CLIENT_STALE_MS = 30_000
const PACKAGED_BACKEND_CLIENT_HEARTBEAT_MS = 10_000
const PACKAGED_BACKEND_STOP_POLL_INTERVAL_MS = 250
const PACKAGED_BACKEND_GRACEFUL_STOP_TIMEOUT_MS = 5_000
const PACKAGED_BACKEND_FORCE_STOP_TIMEOUT_MS = 5_000
const PACKAGED_BACKEND_TASKKILL_TIMEOUT_MS = 5_000
const NETWORK_LOG_MAX_BYTES = 10 * 1024 * 1024
const NETWORK_LOG_MAX_FILES = 5
const NETWORK_LOG_BATCH_SIZE = 100
const NETWORK_LOG_QUEUE_MAX_RECORDS = 2000
const NETWORK_LOG_FLUSH_INTERVAL_MS = 1000
const NETWORK_SNAPSHOT_INTERVAL_MS = 10_000
const NETWORK_REST_WARN_MS = 1000
const NETWORK_REST_ERROR_MS = 3000
const NETWORK_SSE_OPEN_WARN_MS = 3000
const NETWORK_MAX_STRING_LENGTH = 500
const PROXY_REST_HEALTH_TIMEOUT_MS = 5000
const PROXY_REST_CONTROL_TIMEOUT_MS = 15000
const PROXY_REST_DEFAULT_TIMEOUT_MS = 65000
const PROXY_REST_MAX_SOCKETS = 128
const PROXY_SSE_OPEN_TIMEOUT_MS = 15000
const PROXY_SSE_MAX_SOCKETS = 128
const PROXY_HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
])

let activeProxyRestRequests = 0
let activeProxySseStreams = 0
let networkLogQueue = []
let networkLogFlushTimer = null
let networkLogFlushInFlight = false
let networkSnapshotTimer = null
let droppedNetworkLogRecords = 0
const restHttpAgent = new http.Agent({ keepAlive: true, maxSockets: PROXY_REST_MAX_SOCKETS })
const restHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: PROXY_REST_MAX_SOCKETS })
const sseHttpAgent = new http.Agent({ keepAlive: true, maxSockets: PROXY_SSE_MAX_SOCKETS })
const sseHttpsAgent = new https.Agent({ keepAlive: true, maxSockets: PROXY_SSE_MAX_SOCKETS })

if (app.isPackaged && !devServerUrl) {
  const gotSingleInstanceLock = app.requestSingleInstanceLock()
  if (!gotSingleInstanceLock) {
    app.exit(0)
  } else {
    app.on("second-instance", () => {
      app.whenReady().then(() => showOrCreateMainWindow())
    })
  }
}

const packagedBackendRuntimeDir = () => path.join(app.getPath("userData"), "backend-runtime")
const packagedBackendStateFilePath = () => path.join(packagedBackendRuntimeDir(), "backend-state.json")
const packagedBackendLockFilePath = () => path.join(packagedBackendRuntimeDir(), "backend.lock")
const packagedBackendStartupProgressFilePath = () => path.join(packagedBackendRuntimeDir(), "startup-progress.json")
const packagedBackendClientsDir = () => path.join(packagedBackendRuntimeDir(), "clients")
const packagedBackendClientFilePath = () => path.join(packagedBackendClientsDir(), `${process.pid}.json`)

function electronMainLogFilePath() {
  let userDataPath
  try {
    userDataPath = app.getPath("userData")
  } catch {
    userDataPath = path.join(process.env.APPDATA || process.cwd(), "spread-ai-web")
  }
  return path.join(userDataPath, "logs", "electron-main.log")
}

function networkLogFilePath() {
  let userDataPath
  try {
    userDataPath = app.getPath("userData")
  } catch {
    userDataPath = path.join(process.env.APPDATA || process.cwd(), "spread-ai-web")
  }
  return path.join(userDataPath, "logs", "network-electron.jsonl")
}

function electronErrorLogFilePath() {
  let userDataPath
  try {
    userDataPath = app.getPath("userData")
  } catch {
    userDataPath = path.join(process.env.APPDATA || process.cwd(), "spread-ai-web")
  }
  return path.join(userDataPath, "logs", "electron-error.log")
}

function appendElectronMainLog(message, error = null) {
  try {
    const line = [
      new Date().toISOString(),
      `[pid:${process.pid}]`,
      message,
      error ? error.stack || error.message || String(error) : "",
    ].filter(Boolean).join(" ")
    const filePath = electronMainLogFilePath()
    fsSync.mkdirSync(path.dirname(filePath), { recursive: true })
    fsSync.appendFileSync(filePath, `${line}\n`, "utf8")
    if (error) {
      const errorFilePath = electronErrorLogFilePath()
      fsSync.mkdirSync(path.dirname(errorFilePath), { recursive: true })
      fsSync.appendFileSync(errorFilePath, `${line}\n`, "utf8")
    }
  } catch {
  }
}

function recordNetworkEvent(event) {
  const record = sanitizeNetworkRecord({
    ...event,
    timestamp: new Date().toISOString(),
    pid: process.pid,
  })
  if (networkLogQueue.length >= NETWORK_LOG_QUEUE_MAX_RECORDS) {
    networkLogQueue.shift()
    droppedNetworkLogRecords += 1
  }
  networkLogQueue.push(record)
  if (networkLogQueue.length >= NETWORK_LOG_BATCH_SIZE) {
    void flushNetworkLogQueue()
    return
  }
  scheduleNetworkLogFlush()
}

function recordRendererNetworkEvents(records) {
  if (!Array.isArray(records)) return { ok: false, error: "records must be array" }
  for (const item of records.slice(0, NETWORK_LOG_BATCH_SIZE)) {
    if (!item || typeof item !== "object") continue
    recordNetworkEvent({ ...item, source: "renderer" })
  }
  return { ok: true }
}

function scheduleNetworkLogFlush() {
  if (networkLogFlushTimer !== null) return
  networkLogFlushTimer = setTimeout(() => {
    networkLogFlushTimer = null
    void flushNetworkLogQueue()
  }, NETWORK_LOG_FLUSH_INTERVAL_MS)
  networkLogFlushTimer.unref?.()
}

async function flushNetworkLogQueue() {
  if (networkLogFlushInFlight || networkLogQueue.length === 0) return
  networkLogFlushInFlight = true
  const records = networkLogQueue.splice(0, NETWORK_LOG_BATCH_SIZE)
  try {
    const filePath = networkLogFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await rotateNetworkLogIfNeeded(filePath)
    await fs.appendFile(filePath, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8")
  } catch (error) {
    appendElectronMainLog("network log flush failed", error)
  } finally {
    networkLogFlushInFlight = false
    if (networkLogQueue.length > 0) scheduleNetworkLogFlush()
  }
}

async function rotateNetworkLogIfNeeded(filePath) {
  let stat = null
  try {
    stat = await fs.stat(filePath)
  } catch {
    return
  }
  if (stat.size < NETWORK_LOG_MAX_BYTES) return
  for (let index = NETWORK_LOG_MAX_FILES - 1; index >= 1; index -= 1) {
    const from = `${filePath}.${index}`
    const to = `${filePath}.${index + 1}`
    if (index === NETWORK_LOG_MAX_FILES - 1) {
      await removeFileIfExists(to)
    }
    if (fsSync.existsSync(from)) {
      await fs.rename(from, to).catch(() => undefined)
    }
  }
  await fs.rename(filePath, `${filePath}.1`).catch(() => undefined)
}

function sanitizeNetworkRecord(value) {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.slice(0, 20).map(sanitizeNetworkRecord)
  if (typeof value === "string") return sanitizeNetworkString(value)
  if (typeof value !== "object") return value
  const result = {}
  for (const [key, rawValue] of Object.entries(value)) {
    const lowerKey = key.toLowerCase()
    if (lowerKey.includes("body") || lowerKey.includes("payload")) continue
    if (lowerKey.includes("authorization") || lowerKey.includes("cookie")) continue
    result[key] = sanitizeNetworkRecord(rawValue)
  }
  return result
}

function sanitizeNetworkString(value) {
  const trimmed = value.length > NETWORK_MAX_STRING_LENGTH
    ? `${value.slice(0, NETWORK_MAX_STRING_LENGTH)}…`
    : value
  return trimmed
    .replace(/([?&](?:api[_-]?key|token|access_token|refresh_token|key)=)[^&]+/gi, "$1<redacted>")
    .replace(/(authorization\s*[:=]\s*)[^,\s]+/gi, "$1<redacted>")
}

function startNetworkSnapshotTimer() {
  if (networkSnapshotTimer !== null) return
  networkSnapshotTimer = setInterval(() => {
    recordNetworkEvent({
      layer: "electron",
      type: "network.snapshot",
      active_rest: activeProxyRestRequests,
      active_sse: activeProxySseStreams,
      queued_records: networkLogQueue.length,
      dropped_records: droppedNetworkLogRecords,
      backend_base_url: packagedBackendBaseUrl,
      backend_pid: packagedBackendProcess?.pid ?? null,
    })
  }, NETWORK_SNAPSHOT_INTERVAL_MS)
  networkSnapshotTimer.unref?.()
}

function stopNetworkSnapshotTimer() {
  if (networkSnapshotTimer === null) return
  clearInterval(networkSnapshotTimer)
  networkSnapshotTimer = null
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

function registerRendererProtocol() {
  protocol.handle("app", async (request) => {
    const url = new URL(request.url)
    const pathname = decodeURIComponent(url.pathname)
    if (pathname === "/api" || pathname.startsWith("/api/")) {
      return proxyApiRequest(request, pathname, url.search)
    }
    const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "")
    let filePath = path.normalize(path.join(distRoot, relativePath))

    if (filePath !== distRoot && !filePath.startsWith(distRootWithSeparator)) {
      return new Response("Forbidden", { status: 403 })
    }

    try {
      await fs.access(filePath)
    } catch {
      filePath = path.join(distRoot, "index.html")
    }

    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function desktopApiBaseUrl() {
  if (packagedBackendBaseUrl) return packagedBackendBaseUrl.replace(/\/+$/, "")
  const devBaseUrl = devServerUrl ? (process.env.VITE_API_BASE_URL || "http://127.0.0.1:18000") : "http://127.0.0.1:8000"
  return devBaseUrl.replace(/\/+$/, "")
}

async function proxyApiRequest(request, pathname, search) {
  const startedAt = Date.now()
  const traceId = networkTraceIdFromRequest(request, search)
  const requestType = pathname.includes("/events") ? "sse" : "rest"
  const method = request.method.toUpperCase()
  try {
    await ensurePackagedBackendStarted()
  } catch (error) {
    recordNetworkEvent({
      layer: "electron",
      type: "proxy.backend_start_failed",
      trace_id: traceId,
      request_type: requestType,
      method,
      path: safeProxyPath(pathname, search),
      duration_ms: Date.now() - startedAt,
      error_type: error?.name || "backend_start_failed",
      error_message: error?.message ?? String(error),
    })
    return new Response(`Spread AI backend failed to start: ${error?.message ?? String(error)}`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }
  const targetUrl = `${desktopApiBaseUrl()}${pathname}${search}`
  if (requestType === "sse") {
    return proxySseRequestWithNodeHttp({ request, targetUrl, pathname, search, traceId, method, startedAt })
  }
  return proxyRestRequestWithNodeHttp({ request, targetUrl, pathname, search, traceId, method, startedAt })
}

async function proxyRestRequestWithNodeHttp({ request, targetUrl, pathname, search, traceId, method, startedAt }) {
  activeProxyRestRequests += 1
  const timeoutMs = proxyRestTimeoutMs(pathname)
  const proxyTransport = "node_http_rest"
  recordNetworkEvent({
    layer: "electron",
    type: "proxy.request.start",
    trace_id: traceId,
    request_type: "rest",
    proxy_transport: proxyTransport,
    method,
    path: safeProxyPath(pathname, search),
    target_url: safeProxyTargetUrl(targetUrl),
    timeout_ms: timeoutMs,
    active_rest: activeProxyRestRequests,
    active_sse: activeProxySseStreams,
  })
  // REST 也使用显式 Node HTTP(S) agent，避免桌面端业务容量继续依赖 Chromium 对单 host 的连接池。
  // SSE 使用独立 Node HTTP streaming transport；REST 与 SSE 分离后，长连接不会耗尽短请求通道。
  let bodyBuffer = null
  try {
    if (!["GET", "HEAD"].includes(method)) {
      bodyBuffer = Buffer.from(await request.arrayBuffer())
    }
  } catch (error) {
    activeProxyRestRequests = Math.max(activeProxyRestRequests - 1, 0)
    const eventType = request.signal.aborted ? "proxy.request.aborted" : "proxy.request.error"
    recordNetworkEvent({
      layer: "electron",
      type: eventType,
      trace_id: traceId,
      request_type: "rest",
      proxy_transport: proxyTransport,
      method,
      path: safeProxyPath(pathname, search),
      duration_ms: Date.now() - startedAt,
      timeout_ms: timeoutMs,
      active_rest: activeProxyRestRequests,
      active_rest_after: activeProxyRestRequests,
      active_sse: activeProxySseStreams,
      error_type: error?.name || "request_body_error",
      error_message: error?.message ?? String(error),
    })
    return new Response(error?.message ?? "Proxy request failed", {
      status: request.signal.aborted ? 499 : 502,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  }

  return new Promise((resolve) => {
    const target = new URL(targetUrl)
    const isHttps = target.protocol === "https:"
    const transport = isHttps ? https : http
    const headers = headersForNodeProxy(request.headers)
    if (bodyBuffer && bodyBuffer.byteLength > 0 && !hasHeader(headers, "content-length")) {
      headers["content-length"] = String(bodyBuffer.byteLength)
    }
    let responseStarted = false
    let settledBeforeResponse = false
    let upstreamDestroyed = false
    let restFinished = false
    let timeoutFired = false
    let timeout = null
    let upstreamRequest = null

    const cleanup = () => {
      if (timeout !== null) {
        clearTimeout(timeout)
        timeout = null
      }
      request.signal.removeEventListener("abort", abortFromRenderer)
    }
    const finishBeforeResponse = (eventType, status, error) => {
      if (responseStarted || settledBeforeResponse) return
      settledBeforeResponse = true
      cleanup()
      activeProxyRestRequests = Math.max(activeProxyRestRequests - 1, 0)
      recordNetworkEvent({
        layer: "electron",
        type: eventType,
        trace_id: traceId,
        request_type: "rest",
        proxy_transport: proxyTransport,
        method,
        path: safeProxyPath(pathname, search),
        duration_ms: Date.now() - startedAt,
        timeout_ms: timeoutMs,
        active_rest: activeProxyRestRequests,
        active_rest_after: activeProxyRestRequests,
        active_sse: activeProxySseStreams,
        error_type: error?.name || eventType,
        error_message: error?.message ?? String(error ?? eventType),
      })
      resolve(new Response(error?.message ?? "Proxy request failed", {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }))
    }
    const finishAfterResponse = (reason, status, bytes, error = null) => {
      if (restFinished) return
      restFinished = true
      cleanup()
      activeProxyRestRequests = Math.max(activeProxyRestRequests - 1, 0)
      const durationMs = Date.now() - startedAt
      const eventType = error
        ? "proxy.request.error"
        : durationMs >= NETWORK_REST_ERROR_MS
          ? "proxy.rest.error_slow"
          : durationMs >= NETWORK_REST_WARN_MS
            ? "proxy.rest.slow"
            : "proxy.rest.complete"
      recordNetworkEvent({
        layer: "electron",
        type: eventType,
        trace_id: traceId,
        request_type: "rest",
        proxy_transport: proxyTransport,
        method,
        path: safeProxyPath(pathname, search),
        status,
        duration_ms: durationMs,
        bytes,
        close_reason: reason,
        active_rest: activeProxyRestRequests,
        active_rest_after: activeProxyRestRequests,
        active_sse: activeProxySseStreams,
        error_type: error?.name,
        error_message: error?.message,
      })
    }
    const destroyUpstream = (reason, error = null) => {
      if (upstreamDestroyed) return
      upstreamDestroyed = true
      recordNetworkEvent({
        layer: "electron",
        type: "proxy.rest.upstream_destroy",
        trace_id: traceId,
        request_type: "rest",
        proxy_transport: proxyTransport,
        method,
        path: safeProxyPath(pathname, search),
        duration_ms: Date.now() - startedAt,
        close_reason: reason,
        active_rest: activeProxyRestRequests,
        active_sse: activeProxySseStreams,
        error_type: error?.name,
        error_message: error?.message,
      })
      upstreamRequest?.destroy(error ?? new Error(reason))
    }
    const abortFromRenderer = () => {
      destroyUpstream("renderer_abort")
      if (responseStarted) {
        finishAfterResponse("renderer_abort", null, 0, request.signal.reason instanceof Error ? request.signal.reason : null)
      } else {
        finishBeforeResponse("proxy.request.aborted", 499, request.signal.reason)
      }
    }

    upstreamRequest = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      method,
      path: `${target.pathname}${target.search}`,
      headers,
      agent: isHttps ? restHttpsAgent : restHttpAgent,
    })
    timeout = setTimeout(() => {
      timeoutFired = true
      const error = new Error(`Proxy request timed out after ${timeoutMs}ms`)
      error.name = "TimeoutError"
      destroyUpstream("timeout", error)
      finishBeforeResponse("proxy.request.timeout", 504, error)
    }, timeoutMs)
    timeout.unref?.()
    if (request.signal.aborted) abortFromRenderer()
    else request.signal.addEventListener("abort", abortFromRenderer, { once: true })

    upstreamRequest.on("response", (upstreamResponse) => {
      if (settledBeforeResponse) {
        upstreamResponse.destroy()
        return
      }
      responseStarted = true
      if (timeout !== null) {
        clearTimeout(timeout)
        timeout = null
      }
      const firstByteMs = Date.now() - startedAt
      recordNetworkEvent({
        layer: "electron",
        type: "proxy.response.headers",
        trace_id: traceId,
        request_type: "rest",
        proxy_transport: proxyTransport,
        method,
        path: safeProxyPath(pathname, search),
        status: upstreamResponse.statusCode,
        first_byte_ms: firstByteMs,
        duration_ms: firstByteMs,
        active_rest: activeProxyRestRequests,
        active_sse: activeProxySseStreams,
      })
      const responseStatus = upstreamResponse.statusCode ?? 502
      if (isHttpResponseWithoutBody(method, responseStatus)) {
        upstreamResponse.resume()
        finishAfterResponse("no_body", responseStatus, 0)
        resolve(new Response(null, {
          status: responseStatus,
          statusText: upstreamResponse.statusMessage,
          headers: headersFromNodeResponse(upstreamResponse.headers),
        }))
        return
      }
      let bytes = 0
      let paused = false
      const monitoredBody = new ReadableStream({
        start(controller) {
          upstreamResponse.on("data", (chunk) => {
            if (restFinished) return
            bytes += chunk.byteLength
            try {
              controller.enqueue(new Uint8Array(chunk))
              if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                paused = true
                upstreamResponse.pause()
              }
            } catch (error) {
              destroyUpstream("stream_enqueue_error", error)
              controller.error(error)
              finishAfterResponse("stream_enqueue_error", upstreamResponse.statusCode, bytes, error)
            }
          })
          upstreamResponse.on("end", () => {
            if (restFinished) return
            controller.close()
            finishAfterResponse("backend_end", upstreamResponse.statusCode, bytes)
          })
          upstreamResponse.on("error", (error) => {
            if (restFinished) return
            controller.error(error)
            finishAfterResponse("read_error", upstreamResponse.statusCode, bytes, error)
          })
          upstreamResponse.on("close", () => {
            if (restFinished) return
            controller.close()
            finishAfterResponse(upstreamDestroyed ? "upstream_destroyed" : "upstream_close", upstreamResponse.statusCode, bytes)
          })
        },
        pull() {
          if (paused) {
            paused = false
            upstreamResponse.resume()
          }
        },
        cancel(reason) {
          destroyUpstream("renderer_cancel")
          finishAfterResponse("renderer_cancel", upstreamResponse.statusCode, bytes, reason instanceof Error ? reason : null)
        },
      })
      resolve(new Response(monitoredBody, {
        status: upstreamResponse.statusCode ?? 502,
        statusText: upstreamResponse.statusMessage,
        headers: headersFromNodeResponse(upstreamResponse.headers),
      }))
    })
    upstreamRequest.on("error", (error) => {
      if (settledBeforeResponse) return
      if (responseStarted) {
        finishAfterResponse(upstreamDestroyed ? "upstream_destroyed" : "upstream_error", null, 0, error)
        return
      }
      const eventType = timeoutFired
        ? "proxy.request.timeout"
        : request.signal.aborted
          ? "proxy.request.aborted"
          : "proxy.request.error"
      finishBeforeResponse(eventType, timeoutFired ? 504 : request.signal.aborted ? 499 : 502, error)
    })
    if (!upstreamDestroyed && !settledBeforeResponse) {
      if (bodyBuffer && bodyBuffer.byteLength > 0) upstreamRequest.end(bodyBuffer)
      else upstreamRequest.end()
    }
  })
}

function proxySseRequestWithNodeHttp({ request, targetUrl, pathname, search, traceId, method, startedAt }) {
  activeProxySseStreams += 1
  recordNetworkEvent({
    layer: "electron",
    type: "proxy.request.start",
    trace_id: traceId,
    request_type: "sse",
    proxy_transport: "node_http_sse",
    method,
    path: safeProxyPath(pathname, search),
    target_url: safeProxyTargetUrl(targetUrl),
    active_rest: activeProxyRestRequests,
    active_sse: activeProxySseStreams,
  })
  return new Promise((resolve) => {
    const target = new URL(targetUrl)
    const isHttps = target.protocol === "https:"
    const transport = isHttps ? https : http
    const upstreamRequest = transport.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      method,
      path: `${target.pathname}${target.search}`,
      headers: headersForNodeProxy(request.headers),
      agent: isHttps ? sseHttpsAgent : sseHttpAgent,
    })
    let responseStarted = false
    let upstreamDestroyed = false
    let settledBeforeResponse = false
    let openTimeout = null
    const resolveBeforeResponseError = (eventType, status, error, reason = null) => {
      if (responseStarted || settledBeforeResponse) return
      settledBeforeResponse = true
      activeProxySseStreams = Math.max(activeProxySseStreams - 1, 0)
      request.signal.removeEventListener("abort", abortFromRenderer)
      if (openTimeout !== null) {
        clearTimeout(openTimeout)
        openTimeout = null
      }
      recordNetworkEvent({
        layer: "electron",
        type: eventType,
        trace_id: traceId,
        request_type: "sse",
        proxy_transport: "node_http_sse",
        method,
        path: safeProxyPath(pathname, search),
        duration_ms: Date.now() - startedAt,
        timeout_ms: eventType === "proxy.request.timeout" ? PROXY_SSE_OPEN_TIMEOUT_MS : undefined,
        close_reason: reason,
        active_rest: activeProxyRestRequests,
        active_sse: activeProxySseStreams,
        active_sse_after: activeProxySseStreams,
        error_type: error?.name || eventType,
        error_message: error?.message ?? String(error ?? eventType),
      })
      resolve(new Response(error?.message ?? "SSE proxy request failed", {
        status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      }))
    }
    const destroyUpstream = (reason, error = null) => {
      if (upstreamDestroyed) return
      upstreamDestroyed = true
      recordNetworkEvent({
        layer: "electron",
        type: "proxy.sse.upstream_destroy",
        trace_id: traceId,
        request_type: "sse",
        proxy_transport: "node_http_sse",
        method,
        path: safeProxyPath(pathname, search),
        duration_ms: Date.now() - startedAt,
        close_reason: reason,
        active_rest: activeProxyRestRequests,
        active_sse: activeProxySseStreams,
        error_type: error?.name,
        error_message: error?.message,
      })
      upstreamRequest.destroy(error ?? new Error(reason))
    }
    const abortFromRenderer = () => {
      destroyUpstream("renderer_abort")
      resolveBeforeResponseError("proxy.request.aborted", 499, request.signal.reason, "renderer_abort")
    }
    openTimeout = setTimeout(() => {
      const error = new Error(`SSE proxy open timed out after ${PROXY_SSE_OPEN_TIMEOUT_MS}ms`)
      error.name = "TimeoutError"
      destroyUpstream("open_timeout", error)
      resolveBeforeResponseError("proxy.request.timeout", 504, error, "open_timeout")
    }, PROXY_SSE_OPEN_TIMEOUT_MS)
    openTimeout.unref?.()
    if (request.signal.aborted) abortFromRenderer()
    else request.signal.addEventListener("abort", abortFromRenderer, { once: true })
    upstreamRequest.on("response", (upstreamResponse) => {
      if (settledBeforeResponse) {
        upstreamResponse.destroy()
        return
      }
      responseStarted = true
      if (openTimeout !== null) {
        clearTimeout(openTimeout)
        openTimeout = null
      }
      const firstByteMs = Date.now() - startedAt
      recordNetworkEvent({
        layer: "electron",
        type: "proxy.sse.open",
        trace_id: traceId,
        request_type: "sse",
        proxy_transport: "node_http_sse",
        method,
        path: safeProxyPath(pathname, search),
        status: upstreamResponse.statusCode,
        first_byte_ms: firstByteMs,
        duration_ms: firstByteMs,
        active_rest: activeProxyRestRequests,
        active_sse: activeProxySseStreams,
      })
      if (firstByteMs >= NETWORK_SSE_OPEN_WARN_MS) {
        recordNetworkEvent({
          layer: "electron",
          type: "proxy.sse.open_slow",
          trace_id: traceId,
          request_type: "sse",
          proxy_transport: "node_http_sse",
          method,
          path: safeProxyPath(pathname, search),
          status: upstreamResponse.statusCode,
          first_byte_ms: firstByteMs,
          active_rest: activeProxyRestRequests,
          active_sse: activeProxySseStreams,
        })
      }
      let bytes = 0
      let sseFinished = false
      let paused = false
      const finish = (reason, error = null) => {
        if (sseFinished) return
        sseFinished = true
        request.signal.removeEventListener("abort", abortFromRenderer)
        finishProxySse(traceId, method, pathname, search, upstreamResponse.statusCode, startedAt, bytes, reason, error, {
          proxy_transport: "node_http_sse",
          upstream_destroyed: upstreamDestroyed,
        })
      }
      const monitoredBody = new ReadableStream({
        start(controller) {
          upstreamResponse.on("data", (chunk) => {
            if (sseFinished) return
            bytes += chunk.byteLength
            try {
              controller.enqueue(new Uint8Array(chunk))
              if (controller.desiredSize !== null && controller.desiredSize <= 0) {
                paused = true
                upstreamResponse.pause()
              }
            } catch (error) {
              destroyUpstream("stream_enqueue_error", error)
              finish("stream_enqueue_error", error)
            }
          })
          upstreamResponse.on("end", () => {
            if (sseFinished) return
            controller.close()
            finish("backend_end")
          })
          upstreamResponse.on("error", (error) => {
            if (sseFinished) return
            controller.error(error)
            finish("read_error", error)
          })
          upstreamResponse.on("close", () => {
            if (sseFinished) return
            controller.close()
            finish(upstreamDestroyed ? "upstream_destroyed" : "upstream_close")
          })
        },
        pull() {
          if (paused) {
            paused = false
            upstreamResponse.resume()
          }
        },
        cancel(reason) {
          destroyUpstream("renderer_cancel")
          finish("renderer_cancel", reason instanceof Error ? reason : null)
        },
      })
      resolve(new Response(monitoredBody, {
        status: upstreamResponse.statusCode ?? 502,
        statusText: upstreamResponse.statusMessage,
        headers: headersFromNodeResponse(upstreamResponse.headers),
      }))
    })
    upstreamRequest.on("error", (error) => {
      if (responseStarted || upstreamDestroyed) return
      resolveBeforeResponseError(request.signal.aborted ? "proxy.request.aborted" : "proxy.request.error", request.signal.aborted ? 499 : 502, error)
    })
    if (!upstreamDestroyed && !settledBeforeResponse) upstreamRequest.end()
  })
}

function headersForNodeProxy(headers) {
  const result = {}
  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase()
    if (PROXY_HOP_BY_HOP_HEADERS.has(lowerKey) || lowerKey === "host") return
    result[key] = value
  })
  return result
}

function hasHeader(headers, targetKey) {
  return Object.keys(headers).some((key) => key.toLowerCase() === targetKey.toLowerCase())
}

function isHttpResponseWithoutBody(method, status) {
  return method === "HEAD" || status === 204 || status === 205 || status === 304
}

function headersFromNodeResponse(headers) {
  const result = new Headers()
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase()
    if (PROXY_HOP_BY_HOP_HEADERS.has(lowerKey)) continue
    if (Array.isArray(value)) {
      for (const item of value) result.append(key, item)
    } else if (value !== undefined) {
      result.set(key, value)
    }
  }
  return result
}

function proxyRestTimeoutMs(pathname) {
  if (pathname === "/api/health") return PROXY_REST_HEALTH_TIMEOUT_MS
  if (pathname.includes("/diagnostics") || pathname.includes("/heartbeat") || pathname.includes("/attach")) {
    return PROXY_REST_CONTROL_TIMEOUT_MS
  }
  return PROXY_REST_DEFAULT_TIMEOUT_MS
}

function finishProxySse(traceId, method, pathname, search, status, startedAt, bytes, reason, error = null, extra = {}) {
  activeProxySseStreams = Math.max(activeProxySseStreams - 1, 0)
  recordNetworkEvent({
    layer: "electron",
    type: "proxy.sse.close",
    trace_id: traceId,
    request_type: "sse",
    ...extra,
    method,
    path: safeProxyPath(pathname, search),
    status,
    duration_ms: Date.now() - startedAt,
    bytes,
    close_reason: reason,
    active_rest: activeProxyRestRequests,
    active_sse: activeProxySseStreams,
    active_sse_after: activeProxySseStreams,
    error_type: error?.name,
    error_message: error?.message,
  })
}

function networkTraceIdFromRequest(request, search) {
  const headerValue = request.headers.get("x-network-trace-id")
  if (headerValue) return headerValue
  try {
    const params = new URLSearchParams(search || "")
    const queryValue = params.get("network_trace_id")
    if (queryValue) return queryValue
  } catch {
  }
  return `electron-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function safeProxyPath(pathname, search) {
  const params = new URLSearchParams(search || "")
  const allowed = new URLSearchParams()
  for (const key of ["after_seq", "limit", "latest", "network_trace_id"]) {
    const value = params.get(key)
    if (value !== null) allowed.set(key, value)
  }
  const query = allowed.toString()
  return query ? `${pathname}?${query}` : pathname
}

function safeProxyTargetUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl)
    return `${parsed.origin}${safeProxyPath(parsed.pathname, parsed.search)}`
  } catch {
    return targetUrl.split("?")[0] || targetUrl
  }
}

function stripYamlScalarValue(rawValue) {
  const trimmed = rawValue.trim()
  if (!trimmed) return ""
  const quote = trimmed[0]
  if (quote === '"' || quote === "'") {
    let escaped = false
    for (let index = 1; index < trimmed.length; index += 1) {
      const char = trimmed[index]
      if (quote === '"' && char === "\\" && !escaped) {
        escaped = true
        continue
      }
      if (char === quote && !escaped) return trimmed.slice(1, index)
      escaped = false
    }
    return trimmed.slice(1)
  }
  const commentIndex = trimmed.indexOf("#")
  return (commentIndex >= 0 ? trimmed.slice(0, commentIndex) : trimmed).trim()
}

function resolveReleaseYamlScalarTemplates(value, fieldName, configFilePath) {
  return value.replace(/\$\{([^}:]+)(?::-([^}]*))?\}/g, (match, envName, defaultValue) => {
    if (defaultValue !== undefined) return defaultValue
    throw new Error(
      `agent_runtime.yaml 字段 ${fieldName} 使用了无默认值环境变量占位符 ${match}。` +
      `正式桌面版 release 不读取目标机器 env，请在 ${configFilePath} 中写入明确启动元数据。`,
    )
  })
}

function parseAgentRuntimeServiceMetadata(rawYaml, configFilePath) {
  const values = {}
  let inServiceSection = false
  let serviceSectionIndent = -1

  for (const rawLine of rawYaml.split(/\r?\n/)) {
    const line = rawLine.replace(/\r$/, "")
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const indentMatch = line.match(/^\s*/)
    const indent = indentMatch ? indentMatch[0].length : 0

    if (!inServiceSection) {
      if (trimmed === "agent_runtime_service:") {
        inServiceSection = true
        serviceSectionIndent = indent
      }
      continue
    }

    if (indent <= serviceSectionIndent) break
    const entry = trimmed.match(/^([A-Za-z0-9_]+)\s*:\s*(.*)$/)
    if (!entry) continue
    const key = entry[1]
    if (key !== "service_host" && key !== "service_port") continue
    values[key] = resolveReleaseYamlScalarTemplates(
      stripYamlScalarValue(entry[2]),
      `agent_runtime_service.${key}`,
      configFilePath,
    )
  }

  const host = String(values.service_host || "").trim()
  const port = Number.parseInt(String(values.service_port || ""), 10)
  if (!host) throw new Error(`agent_runtime.yaml 缺少 agent_runtime_service.service_host: ${configFilePath}`)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    throw new Error(`agent_runtime.yaml 中 agent_runtime_service.service_port 不是合法端口: ${values.service_port || "<empty>"}`)
  }
  return { host, port }
}

function backendClientHost(bindHost) {
  if (bindHost === "0.0.0.0" || bindHost === "::" || bindHost === "[::]") return "127.0.0.1"
  return bindHost
}

function formatHttpHost(host) {
  if (host.includes(":") && !host.startsWith("[")) return `[${host}]`
  return host
}

function packagedBackendBaseUrlFromServiceConfig(serviceConfig) {
  return `http://${formatHttpHost(backendClientHost(serviceConfig.host))}:${serviceConfig.port}`
}

function extractYamlEnvironmentPlaceholderKeys(rawYaml) {
  const keys = new Set()
  for (const match of rawYaml.matchAll(/\$\{([^}:]+)(?::-[^}]*)?\}/g)) {
    keys.add(match[1])
  }
  return keys
}

async function loadPackagedRuntimeStartupMetadata() {
  const { configFilePath } = await ensurePackagedRuntimeConfig()
  const rawYaml = await fs.readFile(configFilePath, "utf8")
  const serviceConfig = parseAgentRuntimeServiceMetadata(rawYaml, configFilePath)
  return {
    configFilePath,
    rawYaml,
    serviceConfig,
    baseUrl: packagedBackendBaseUrlFromServiceConfig(serviceConfig),
  }
}

function createPackagedBackendEnvironment(logFiles, rawConfigYaml) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  for (const key of Object.keys(env)) {
    if (key.startsWith("SPREAD_AI_") || key.startsWith("VITE_")) delete env[key]
  }
  for (const key of extractYamlEnvironmentPlaceholderKeys(rawConfigYaml)) {
    delete env[key]
  }
  env.SPREAD_AI_DESKTOP_BACKEND_STDOUT_LOG = logFiles.stdoutPath
  env.SPREAD_AI_DESKTOP_BACKEND_STDERR_LOG = logFiles.stderrPath
  env.SPREAD_AI_DESKTOP_BACKEND_ERROR_LOG = packagedBackendLogFilePath("error")
  env.SPREAD_AI_BACKEND_RUNTIME_DIR = packagedBackendRuntimeDir()
  return env
}

function assertPackagedBackendPortAvailable(runtimeMetadata) {
  return new Promise((resolve, reject) => {
    const { host, port } = runtimeMetadata.serviceConfig
    const server = createServer()
    let settled = false
    const finish = (error = null) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve()
    }
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        finish(new Error(
          `agent_runtime.yaml 指定的正式版后端端口已被占用: ${runtimeMetadata.baseUrl}。` +
          "请退出旧版 Spread AI、停止旧的 spread-ai.exe serve 或释放该端口后重新启动。",
        ))
        return
      }
      finish(error)
    })
    server.listen(port, host, () => {
      server.close(() => finish())
    })
  })
}

async function ensurePackagedRuntimeConfig() {
  const runtimeConfigDir = path.join(app.getPath("userData"), "runtime-config")
  await fs.mkdir(runtimeConfigDir, { recursive: true })

  const targetConfigPath = path.join(runtimeConfigDir, "agent_runtime.yaml")
  const templateConfigPath = path.join(process.resourcesPath, "runtime-config", "agent_runtime.yaml")
  if (!fsSync.existsSync(targetConfigPath)) {
    await fs.copyFile(templateConfigPath, targetConfigPath)
  }

  return { configFilePath: targetConfigPath }
}

function packagedBackendExecutablePath() {
  if (process.env.SPREAD_AI_BACKEND_EXECUTABLE) {
    return process.env.SPREAD_AI_BACKEND_EXECUTABLE
  }
  const executableName = process.platform === "win32" ? "spread-ai-runtime.exe" : "spread-ai-runtime"
  const onedirExecutablePath = path.join(process.resourcesPath, "backend", "spread-ai-runtime", executableName)
  if (fsSync.existsSync(onedirExecutablePath)) {
    return onedirExecutablePath
  }
  return path.join(process.resourcesPath, "backend", executableName)
}

function packagedFrontendDistDir() {
  if (process.env.SPREAD_AI_FRONTEND_DIST_DIR) {
    return process.env.SPREAD_AI_FRONTEND_DIST_DIR
  }
  return path.join(process.resourcesPath, "frontend")
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function readJsonFile(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"))
  } catch {
    return null
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
  await fs.writeFile(tempFilePath, JSON.stringify(value, null, 2), "utf8")
  await fs.rename(tempFilePath, filePath)
}

async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath)
  } catch (error) {
    if (error?.code !== "ENOENT") throw error
  }
}

function isProcessAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await sleep(PACKAGED_BACKEND_STOP_POLL_INTERVAL_MS)
  }
  return !isProcessAlive(pid)
}

function runWindowsTaskkill(pid) {
  return new Promise((resolve) => {
    let settled = false
    let timeout = null
    const finish = (result) => {
      if (settled) return
      settled = true
      if (timeout !== null) clearTimeout(timeout)
      resolve(result)
    }

    let taskkillProcess
    try {
      taskkillProcess = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      })
    } catch (error) {
      appendElectronMainLog(`failed to spawn taskkill for packaged backend pid=${pid}`, error)
      finish(false)
      return
    }

    timeout = setTimeout(() => {
      appendElectronMainLog(`taskkill timed out for packaged backend pid=${pid}`)
      try {
        taskkillProcess.kill()
      } catch {
      }
      finish(false)
    }, PACKAGED_BACKEND_TASKKILL_TIMEOUT_MS)
    timeout.unref?.()

    taskkillProcess.on("error", (error) => {
      appendElectronMainLog(`taskkill failed for packaged backend pid=${pid}`, error)
      finish(false)
    })
    taskkillProcess.on("exit", (code, signal) => {
      appendElectronMainLog(`taskkill exited for packaged backend pid=${pid} code=${code} signal=${signal || ""}`)
      finish(code === 0 || !isProcessAlive(pid))
    })
  })
}

async function forceStopProcessTreeOnWindows(pid) {
  if (process.platform !== "win32") return false
  if (!isProcessAlive(pid)) return true

  appendElectronMainLog(`force stopping packaged backend process tree with taskkill pid=${pid}`)
  const taskkillSucceeded = await runWindowsTaskkill(pid)
  if (!taskkillSucceeded && isProcessAlive(pid)) return false
  return waitForProcessExit(pid, PACKAGED_BACKEND_FORCE_STOP_TIMEOUT_MS)
}

async function readPackagedBackendState() {
  return readJsonFile(packagedBackendStateFilePath())
}

async function writePackagedBackendState(state) {
  await writeJsonFile(packagedBackendStateFilePath(), state)
}

async function checkPackagedBackendHealth(baseUrl) {
  try {
    const response = await net.fetch(`${baseUrl}/api/health`)
    return response.ok
  } catch {
    return false
  }
}

async function resolveHealthyPackagedBackend(state, runtimeMetadata = null) {
  const pid = Number(state?.pid)
  const baseUrl = typeof state?.baseUrl === "string" ? state.baseUrl.replace(/\/+$/, "") : ""
  if (!baseUrl || !isProcessAlive(pid)) return null
  if (runtimeMetadata) {
    const statePort = Number(state?.port)
    const expectedBaseUrl = runtimeMetadata.baseUrl.replace(/\/+$/, "")
    if (baseUrl !== expectedBaseUrl || statePort !== runtimeMetadata.serviceConfig.port) return null
  }
  if (await checkPackagedBackendHealth(baseUrl)) return { ...state, baseUrl, pid }
  return null
}

async function acquirePackagedBackendStartupLock() {
  await fs.mkdir(packagedBackendRuntimeDir(), { recursive: true })
  const lockFilePath = packagedBackendLockFilePath()
  try {
    const handle = await fs.open(lockFilePath, "wx")
    try {
      await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: Date.now() }, null, 2), "utf8")
    } finally {
      await handle.close()
    }
    return true
  } catch (error) {
    if (error?.code !== "EEXIST") throw error
    const lock = await readJsonFile(lockFilePath)
    const createdAt = Number(lock?.createdAt)
    const progress = await readJsonFile(packagedBackendStartupProgressFilePath())
    const isMaintenanceActive = Boolean(
      progress &&
      progress.phase === "database_compaction" &&
      Number.isFinite(progress.heartbeatAt) &&
      Date.now() - progress.heartbeatAt <= PACKAGED_BACKEND_MAINTENANCE_HEARTBEAT_STALE_MS
    )
    if (!isMaintenanceActive && (!Number.isFinite(createdAt) || Date.now() - createdAt > PACKAGED_BACKEND_LOCK_STALE_MS)) {
      await removeFileIfExists(lockFilePath)
      return acquirePackagedBackendStartupLock()
    }
    return false
  }
}

async function releasePackagedBackendStartupLock() {
  const lock = await readJsonFile(packagedBackendLockFilePath())
  if (Number(lock?.pid) === process.pid) {
    await removeFileIfExists(packagedBackendLockFilePath())
  }
}

async function waitForPackagedBackend(baseUrl, backendPid = null) {
  const startedAt = Date.now()
  let deadline = startedAt + PACKAGED_BACKEND_START_TIMEOUT_MS
  let lastError = null
  let lastLogTime = 0

  while (Date.now() < deadline) {
    if (backendPid && !isProcessAlive(backendPid)) {
      throw new Error(`Packaged backend process (PID ${backendPid}) exited unexpectedly before becoming ready.`)
    }

    try {
      const response = await net.fetch(`${baseUrl}/api/health`)
      if (response.ok) {
        await removeFileIfExists(packagedBackendStartupProgressFilePath())
        return
      }
    } catch (error) {
      lastError = error
    }

    const progress = await readJsonFile(packagedBackendStartupProgressFilePath())
    const now = Date.now()
    if (
      progress &&
      (!backendPid || Number(progress.pid) === backendPid) &&
      progress.phase === "database_compaction" &&
      Number.isFinite(progress.heartbeatAt) &&
      now - progress.heartbeatAt <= PACKAGED_BACKEND_MAINTENANCE_HEARTBEAT_STALE_MS &&
      now - startedAt <= PACKAGED_BACKEND_MAX_MAINTENANCE_TIMEOUT_MS
    ) {
      deadline = Math.max(deadline, now + PACKAGED_BACKEND_MAINTENANCE_EXTENSION_MS)
      if (now - lastLogTime >= 5000) {
        appendElectronMainLog(
          `packaged backend offline compaction in progress: store=${progress.store_id ?? progress.storeId ?? "unknown"} elapsed=${Math.round((now - startedAt) / 1000)}s`
        )
        lastLogTime = now
      }
    }

    await sleep(PACKAGED_BACKEND_POLL_INTERVAL_MS)
  }
  throw new Error(`Timed out waiting for packaged backend: ${lastError?.message ?? "unknown error"}`)
}

function packagedBackendLogFilePath(streamName) {
  const logDir = path.join(app.getPath("userData"), "logs")
  fsSync.mkdirSync(logDir, { recursive: true })
  return path.join(logDir, `backend-${streamName}.log`)
}

function openPackagedBackendLogFiles() {
  const stdoutPath = packagedBackendLogFilePath("stdout")
  const stderrPath = packagedBackendLogFilePath("stderr")
  return {
    stdoutPath,
    stderrPath,
    stdout: fsSync.openSync(stdoutPath, "a"),
    stderr: fsSync.openSync(stderrPath, "a"),
  }
}

async function writePackagedBackendClientHeartbeat() {
  if (!packagedBackendClientRegistered) return
  try {
    await writeJsonFile(packagedBackendClientFilePath(), {
      pid: process.pid,
      updatedAt: Date.now(),
    })
  } catch (error) {
    console.warn("Failed to write packaged backend client heartbeat", error)
  }
}

async function registerPackagedBackendClient() {
  if (packagedBackendClientRegistered) return
  packagedBackendClientRegistered = true
  await fs.mkdir(packagedBackendClientsDir(), { recursive: true })
  await writePackagedBackendClientHeartbeat()
  packagedBackendClientHeartbeatTimer = setInterval(
    () => {
      writePackagedBackendClientHeartbeat()
    },
    PACKAGED_BACKEND_CLIENT_HEARTBEAT_MS,
  )
  packagedBackendClientHeartbeatTimer.unref?.()
}

async function unregisterPackagedBackendClient() {
  if (packagedBackendClientHeartbeatTimer) {
    clearInterval(packagedBackendClientHeartbeatTimer)
    packagedBackendClientHeartbeatTimer = null
  }
  packagedBackendClientRegistered = false
  await removeFileIfExists(packagedBackendClientFilePath())
}

async function listActivePackagedBackendClientPids() {
  let entries = []
  try {
    entries = await fs.readdir(packagedBackendClientsDir())
  } catch {
    return []
  }
  const now = Date.now()
  const activePids = []
  for (const entry of entries) {
    const filePath = path.join(packagedBackendClientsDir(), entry)
    const client = await readJsonFile(filePath)
    const pid = Number(client?.pid ?? path.basename(entry, ".json"))
    const updatedAt = Number(client?.updatedAt)
    if (
      Number.isFinite(pid) &&
      pid > 0 &&
      isProcessAlive(pid) &&
      Number.isFinite(updatedAt) &&
      now - updatedAt <= PACKAGED_BACKEND_CLIENT_STALE_MS
    ) {
      activePids.push(pid)
    } else {
      await removeFileIfExists(filePath)
    }
  }
  return activePids
}

async function launchPackagedBackend(backendExecutable, runtimeMetadata) {
  await assertPackagedBackendPortAvailable(runtimeMetadata)

  const { configFilePath, rawYaml, serviceConfig, baseUrl } = runtimeMetadata
  const frontendDistDir = packagedFrontendDistDir()
  if (!fsSync.existsSync(path.join(frontendDistDir, "index.html"))) {
    throw new Error(`Packaged frontend dist not found or missing index.html: ${frontendDistDir}`)
  }
  const logFiles = openPackagedBackendLogFiles()

  try {
    packagedBackendProcess = spawn(
      backendExecutable,
      [
        "--config-file",
        configFilePath,
        "--frontend-dist-dir",
        frontendDistDir,
      ],
      {
        cwd: path.dirname(backendExecutable),
        windowsHide: true,
        detached: true,
        stdio: ["ignore", logFiles.stdout, logFiles.stderr],
        env: createPackagedBackendEnvironment(logFiles, rawYaml),
      },
    )
  } finally {
    fsSync.closeSync(logFiles.stdout)
    fsSync.closeSync(logFiles.stderr)
  }

  const backendPid = packagedBackendProcess.pid
  packagedBackendProcess.unref()
  packagedBackendBaseUrl = baseUrl
  await writePackagedBackendState({
    pid: backendPid,
    ownerPid: process.pid,
    host: serviceConfig.host,
    port: serviceConfig.port,
    baseUrl,
    configFilePath,
    startedAt: Date.now(),
  })

  packagedBackendProcess.on("exit", async () => {
    const state = await readPackagedBackendState()
    if (Number(state?.pid) === backendPid) {
      await removeFileIfExists(packagedBackendStateFilePath())
    }
    if (Number(packagedBackendProcess?.pid) === backendPid) {
      packagedBackendProcess = null
      packagedBackendBaseUrl = null
    }
  })

  try {
    await waitForPackagedBackend(baseUrl, backendPid)
  } catch (error) {
    try {
      if (Number.isFinite(backendPid)) process.kill(backendPid)
    } catch {
    }
    await removeFileIfExists(packagedBackendStateFilePath())
    await removeFileIfExists(packagedBackendStartupProgressFilePath())
    throw error
  }

  return baseUrl
}

async function startPackagedBackend() {
  appendElectronMainLog(`startPackagedBackend enter app.isPackaged=${app.isPackaged} devServerUrl=${devServerUrl || ""}`)
  if (!app.isPackaged || devServerUrl) return
  if (packagedBackendBaseUrl) return
  if (packagedBackendCleanupStarted) return

  const backendExecutable = packagedBackendExecutablePath()
  appendElectronMainLog(`packaged backend executable=${backendExecutable}`)
  if (!fsSync.existsSync(backendExecutable)) {
    throw new Error(`Packaged backend executable not found: ${backendExecutable}`)
  }

  const runtimeMetadata = await loadPackagedRuntimeStartupMetadata()
  appendElectronMainLog(
    `packaged runtime metadata config=${runtimeMetadata.configFilePath} baseUrl=${runtimeMetadata.baseUrl}`,
  )

  await registerPackagedBackendClient()
  const startedAt = Date.now()
  let deadline = startedAt + PACKAGED_BACKEND_START_TIMEOUT_MS

  while (Date.now() < deadline) {
    if (packagedBackendCleanupStarted) return
    const healthyState = await resolveHealthyPackagedBackend(await readPackagedBackendState(), runtimeMetadata)
    if (healthyState) {
      packagedBackendBaseUrl = healthyState.baseUrl
      appendElectronMainLog(`reuse packaged backend pid=${healthyState.pid} baseUrl=${packagedBackendBaseUrl}`)
      return
    }

    const progress = await readJsonFile(packagedBackendStartupProgressFilePath())
    const now = Date.now()
    if (
      progress &&
      progress.phase === "database_compaction" &&
      Number.isFinite(progress.heartbeatAt) &&
      now - progress.heartbeatAt <= PACKAGED_BACKEND_MAINTENANCE_HEARTBEAT_STALE_MS &&
      now - startedAt <= PACKAGED_BACKEND_MAX_MAINTENANCE_TIMEOUT_MS
    ) {
      deadline = Math.max(deadline, now + PACKAGED_BACKEND_MAINTENANCE_EXTENSION_MS)
    }

    const acquired = await acquirePackagedBackendStartupLock()
    appendElectronMainLog(`packaged backend startup lock acquired=${acquired}`)
    if (acquired) {
      try {
        const latestHealthyState = await resolveHealthyPackagedBackend(await readPackagedBackendState(), runtimeMetadata)
        if (latestHealthyState) {
          packagedBackendBaseUrl = latestHealthyState.baseUrl
          appendElectronMainLog(`reuse packaged backend after lock pid=${latestHealthyState.pid} baseUrl=${packagedBackendBaseUrl}`)
          return
        }
        if (packagedBackendCleanupStarted) return
        await launchPackagedBackend(backendExecutable, runtimeMetadata)
        appendElectronMainLog(`launched packaged backend baseUrl=${packagedBackendBaseUrl}`)
        return
      } finally {
        await releasePackagedBackendStartupLock()
      }
    }

    await sleep(PACKAGED_BACKEND_POLL_INTERVAL_MS)
  }

  throw new Error("Timed out waiting for shared packaged backend.")
}

function ensurePackagedBackendStarted() {
  if (!app.isPackaged || devServerUrl || packagedBackendBaseUrl) return Promise.resolve()
  if (!packagedBackendStartupPromise) {
    packagedBackendStartupPromise = startPackagedBackend()
      .then(() => {
        appendElectronMainLog("packaged backend ready")
      })
      .catch((error) => {
        packagedBackendStartupPromise = null
        appendElectronMainLog("packaged backend startup failed", error)
        throw error
      })
  }
  return packagedBackendStartupPromise
}

async function restartPackagedBackendForBootstrap() {
  if (!app.isPackaged || devServerUrl) {
    return { ok: false, error: "Runtime 自动重启仅支持正式桌面版。" }
  }
  try {
    appendElectronMainLog("bootstrap requested packaged backend restart")
    packagedBackendStartupPromise = null
    await stopPackagedBackend({ ignoreActiveClients: true })
    packagedBackendCleanupStarted = false
    packagedBackendCleanupFinished = false
    packagedBackendCleanupPromise = null
    await startPackagedBackend()
    return { ok: true }
  } catch (error) {
    appendElectronMainLog("bootstrap packaged backend restart failed", error)
    return { ok: false, error: error?.message ?? String(error) }
  }
}

async function stopPackagedBackend(options = {}) {
  if (!app.isPackaged || devServerUrl) {
    appendElectronMainLog("stopPackagedBackend skipped outside packaged runtime")
    return
  }

  appendElectronMainLog("stopPackagedBackend enter")
  const ignoreActiveClients = Boolean(options.ignoreActiveClients)
  if (!ignoreActiveClients) await unregisterPackagedBackendClient()
  const activeClientPids = ignoreActiveClients ? [] : await listActivePackagedBackendClientPids()
  if (activeClientPids.length > 0) {
    appendElectronMainLog(`stopPackagedBackend skipped because active clients remain: ${activeClientPids.join(",")}`)
    return
  }

  const state = await readPackagedBackendState()
  const backendPid = Number(state?.pid ?? packagedBackendProcess?.pid)
  const hasValidBackendPid = Number.isFinite(backendPid) && backendPid > 0
  if (hasValidBackendPid && isProcessAlive(backendPid)) {
    appendElectronMainLog(`stopping packaged backend pid=${backendPid}`)
    try {
      process.kill(backendPid)
      appendElectronMainLog(`sent kill signal to packaged backend pid=${backendPid}`)
    } catch (error) {
      appendElectronMainLog(`failed to send kill signal to packaged backend pid=${backendPid}`, error)
    }

    let stopped = await waitForProcessExit(backendPid, PACKAGED_BACKEND_GRACEFUL_STOP_TIMEOUT_MS)
    if (!stopped) {
      appendElectronMainLog(`packaged backend still alive after graceful wait pid=${backendPid}`)
      stopped = await forceStopProcessTreeOnWindows(backendPid)
    }

    if (stopped) {
      appendElectronMainLog(`packaged backend stopped pid=${backendPid}`)
    } else {
      appendElectronMainLog(`packaged backend did not stop pid=${backendPid}`)
    }
  } else {
    appendElectronMainLog(`no live packaged backend to stop pid=${hasValidBackendPid ? backendPid : ""}`)
  }

  if (!hasValidBackendPid || !isProcessAlive(backendPid)) {
    await removeFileIfExists(packagedBackendStateFilePath())
  } else {
    appendElectronMainLog(`preserving packaged backend state because backend is still alive pid=${backendPid}`)
  }
  await removeFileIfExists(packagedBackendLockFilePath())
  packagedBackendProcess = null
  packagedBackendBaseUrl = null
  appendElectronMainLog("stopPackagedBackend complete")
}

function createMainWindow(loadPath = "/", options = {}) {
  const isPrimaryWindow = Boolean(options.primary)
  appendElectronMainLog(`createMainWindow begin loadPath=${loadPath} primary=${isPrimaryWindow}`)
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    // 初始标题与未打开项目时的 document.title 保持一致；打开 workspace 后由 renderer 按根目录名覆盖。
    title: "Spread AI",
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#f8fafc",
      symbolColor: "#475569",
      height: 35,
    },
    icon: appIconPath,
    autoHideMenuBar: true,
    backgroundColor: "#f6f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })

  // 多窗口模式下每个 BrowserWindow 必须独立在打开位置上偏移，避免完全重叠导致用户以为没开新窗口。
  if (windows.size > 0) {
    const baseWindow = [...windows][windows.size - 1]
    if (baseWindow && !baseWindow.isDestroyed()) {
      const [x, y] = baseWindow.getPosition()
      window.setPosition(x + 36, y + 36)
    }
  }

  windows.add(window)
  if (isPrimaryWindow) primaryWindow = window

  window.on("close", (event) => {
    if (isPrimaryWindow && isRuntimeTrayEnabled() && !explicitQuitRequested) {
      event.preventDefault()
      window.hide()
      appendElectronMainLog("primary window hidden to tray")
    }
  })

  window.once("ready-to-show", () => {
    appendElectronMainLog("main window ready-to-show")
    window.setMenuBarVisibility(false)
    window.show()
    appendElectronMainLog("main window shown")
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    // renderer 通过 window.open(同源 url) 或 <a target="_blank"> 触发新窗口时也会落到这里。
    // 把"同源链接"解释为"打开新的工作台窗口"，统一走 createMainWindow() 复用完整安全配置，
    // 让浏览器代码 `window.open(...)` 在 Electron 桌面壳下等价于 IPC openNewWindow。
    // 外部链接（http/https 跨域）仍交给系统浏览器，避免 Electron 退化成通用浏览器。
    try {
      const currentBase = devServerUrl ?? "app://renderer/"
      const targetUrl = new URL(url)
      const currentUrl = new URL(currentBase)
      if (targetUrl.origin === currentUrl.origin) {
        createMainWindow()
        return { action: "deny" }
      }
    } catch {
      // URL 解析失败时落入下方系统浏览器分支。
    }
    shell.openExternal(url)
    return { action: "deny" }
  })

  const normalizedLoadPath = loadPath.startsWith("/") ? loadPath : `/${loadPath}`
  if (devServerUrl) {
    appendElectronMainLog(`main window loadURL dev ${normalizedLoadPath}`)
    window.loadURL(new URL(normalizedLoadPath, devServerUrl).toString())
  } else {
    appendElectronMainLog(`main window loadURL packaged ${normalizedLoadPath}`)
    window.loadURL(`app://renderer${normalizedLoadPath}`)
  }

  if (isDebugMode) {
    window.webContents.openDevTools({ mode: "detach" })
  }

  window.on("closed", () => {
    windows.delete(window)
    if (primaryWindow === window) primaryWindow = null
  })

  return window
}

function isRuntimeTrayEnabled() {
  return app.isPackaged && !devServerUrl
}

function showOrCreateMainWindow(loadPath = "/") {
  const existingWindow = primaryWindow && !primaryWindow.isDestroyed() ? primaryWindow : null
  if (!existingWindow) return createMainWindow(loadPath, { primary: true })
  if (existingWindow.isMinimized()) existingWindow.restore()
  existingWindow.show()
  existingWindow.focus()
  return existingWindow
}

function createRuntimeTray() {
  if (!isRuntimeTrayEnabled() || tray) return
  const iconPath = fsSync.existsSync(appTrayIconPath) ? appTrayIconPath : appIconPath
  try {
    tray = new Tray(iconPath)
    tray.setToolTip("Spread AI")
    tray.setContextMenu(Menu.buildFromTemplate([
      {
        label: "打开 Spread AI",
        click: () => showOrCreateMainWindow(),
      },
      { type: "separator" },
      {
        label: "退出 Spread AI",
        click: () => {
          appendElectronMainLog("runtime tray quit requested")
          explicitQuitRequested = true
          app.quit()
        },
      },
    ]))
    tray.on("click", () => showOrCreateMainWindow())
    tray.on("double-click", () => showOrCreateMainWindow())
    appendElectronMainLog(`runtime tray created icon=${iconPath}`)
  } catch (error) {
    tray = null
    appendElectronMainLog("runtime tray creation failed", error)
  }
}

function desktopPathOperationError(error, fallbackMessage) {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === "string" && error.trim()) return error
  return fallbackMessage
}

async function resolveExistingDesktopPath(targetPath) {
  if (typeof targetPath !== "string" || targetPath.trim().length === 0) {
    return { ok: false, error: "targetPath must be a non-empty string" }
  }
  if (targetPath.includes("\0")) {
    return { ok: false, error: "targetPath must not contain NUL characters" }
  }
  if (!path.isAbsolute(targetPath)) {
    return { ok: false, error: "targetPath must be absolute" }
  }
  try {
    const realPath = await fs.realpath(targetPath)
    await fs.stat(realPath)
    return { ok: true, path: realPath }
  } catch (error) {
    return { ok: false, error: desktopPathOperationError(error, "targetPath does not exist") }
  }
}

app.whenReady().then(async () => {
  appendElectronMainLog("app.whenReady begin")
  registerRendererProtocol()
  // IPC：renderer 通过 preload 暴露的 spreadDesktop.openNewWindow() 触发多窗口创建。
  // 用 invoke/handle 而不是 send/on，便于 renderer 拿到回执并在失败时给用户提示。
  ipcMain.handle("spread:open-new-window", () => {
    createMainWindow()
    return { ok: true }
  })
  ipcMain.handle("spread:open-pdf-window", (_event, targetUrl) => {
    if (typeof targetUrl !== "string" || !targetUrl.startsWith("/pdf-viewer")) {
      return { ok: false, error: "invalid targetUrl" }
    }
    createMainWindow(targetUrl)
    return { ok: true }
  })
  ipcMain.handle("spread:open-external-url", async (_event, targetUrl) => {
    if (typeof targetUrl !== "string") {
      return { ok: false, error: "targetUrl must be string" }
    }
    let parsedUrl
    try {
      parsedUrl = new URL(targetUrl)
    } catch {
      return { ok: false, error: "invalid targetUrl" }
    }
    if (!["http:", "https:", "mailto:"].includes(parsedUrl.protocol)) {
      return { ok: false, error: "unsupported targetUrl protocol" }
    }
    await shell.openExternal(parsedUrl.toString())
    return { ok: true }
  })
  ipcMain.handle("spread:open-system-path", async (_event, targetPath) => {
    const resolvedPath = await resolveExistingDesktopPath(targetPath)
    if (!resolvedPath.ok) return resolvedPath
    try {
      const error = await shell.openPath(resolvedPath.path)
      return error ? { ok: false, error } : { ok: true }
    } catch (error) {
      return { ok: false, error: desktopPathOperationError(error, "failed to open targetPath") }
    }
  })
  ipcMain.handle("spread:reveal-system-path", async (_event, targetPath) => {
    const resolvedPath = await resolveExistingDesktopPath(targetPath)
    if (!resolvedPath.ok) return resolvedPath
    try {
      shell.showItemInFolder(resolvedPath.path)
      return { ok: true }
    } catch (error) {
      return { ok: false, error: desktopPathOperationError(error, "failed to reveal targetPath") }
    }
  })
  ipcMain.handle("spread:append-llm-stream-log", async (_event, line) => {
    if (typeof line !== "string") return { ok: false, error: "line must be string" }
    const filePath = llmStreamLogFilePath()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    await fs.appendFile(filePath, `${line}\n`, "utf8")
    return { ok: true, filePath }
  })
  ipcMain.handle("spread:append-network-log", (_event, records) => recordRendererNetworkEvents(records))
  ipcMain.handle("spread:restart-runtime", () => restartPackagedBackendForBootstrap())
  ipcMain.on("spread:get-runtime-api-base-url", (event) => {
    event.returnValue = desktopApiBaseUrl()
  })
  startNetworkSnapshotTimer()
  createRuntimeTray()
  try {
    await ensurePackagedBackendStarted()
  } catch (error) {
    dialog.showErrorBox("Spread AI 后端启动失败", error?.message ?? String(error))
    explicitQuitRequested = true
    app.quit()
    return
  }
  createMainWindow("/", { primary: true })

  app.on("activate", () => {
    if (isRuntimeTrayEnabled()) {
      showOrCreateMainWindow()
      return
    }
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow("/", { primary: true })
  })
}).catch((error) => {
  appendElectronMainLog("app startup failed", error)
  console.error(error)
  dialog.showErrorBox("Spread AI 启动失败", error?.message ?? String(error))
  explicitQuitRequested = true
  app.quit()
})

app.on("before-quit", (event) => {
  appendElectronMainLog(
    `before-quit received cleanupStarted=${packagedBackendCleanupStarted} cleanupFinished=${packagedBackendCleanupFinished}`,
  )
  explicitQuitRequested = true
  stopNetworkSnapshotTimer()
  void flushNetworkLogQueue()
  if (!app.isPackaged || devServerUrl || packagedBackendCleanupFinished) return

  event.preventDefault()
  if (packagedBackendCleanupPromise) {
    appendElectronMainLog("before-quit ignored because packaged backend cleanup is already running")
    return
  }

  packagedBackendCleanupStarted = true
  packagedBackendCleanupPromise = stopPackagedBackend()
    .then(() => {
      appendElectronMainLog("before-quit packaged backend cleanup resolved")
    })
    .catch((error) => {
      appendElectronMainLog("Failed to stop packaged backend cleanly", error)
      console.warn("Failed to stop packaged backend cleanly", error)
    })
    .finally(() => {
      packagedBackendCleanupFinished = true
      appendElectronMainLog("before-quit cleanup finished; exiting app")
      app.exit(0)
    })
})

app.on("window-all-closed", () => {
  if (isRuntimeTrayEnabled() && !explicitQuitRequested) {
    appendElectronMainLog("all windows closed; app remains in tray")
    return
  }
  if (process.platform !== "darwin") app.quit()
})
