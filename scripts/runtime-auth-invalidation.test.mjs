import assert from "node:assert/strict"
import path from "node:path"
import { after, before, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

// Setup global mocks before modules load
const storage = new Map()
globalThis.window = {
  location: {
    protocol: "http:",
    origin: "http://127.0.0.1:18000",
  },
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, val) => storage.set(key, String(val)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  },
}

class FakeEventSource {
  static OPEN = 1
  static CLOSED = 2
  constructor(url) {
    this.url = url
    this.readyState = FakeEventSource.OPEN
    this.listeners = new Map()
    this.closed = false
    FakeEventSource.lastInstance = this
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(listener)
  }
  removeEventListener(type, listener) {
    const list = this.listeners.get(type)
    if (!list) return
    const idx = list.indexOf(listener)
    if (idx >= 0) list.splice(idx, 1)
  }
  emit(type, data) {
    const list = this.listeners.get(type)
    if (list) {
      for (const listener of list) {
        listener({ type, data })
      }
    }
  }
  close() {
    this.readyState = FakeEventSource.CLOSED
    this.closed = true
  }
}
globalThis.EventSource = FakeEventSource

let viteServer
let invalidationModule
let httpClientModule
let sseClientModule
let runtimeAccessModule
let agentRuntimeApiModule

before(async () => {
  viteServer = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  })
  runtimeAccessModule = await viteServer.ssrLoadModule("/src/shared/api/runtimeAccess.ts")
  invalidationModule = await viteServer.ssrLoadModule("/src/shared/api/runtimeAuthInvalidation.ts")
  httpClientModule = await viteServer.ssrLoadModule("/src/shared/api/httpClient.ts")
  sseClientModule = await viteServer.ssrLoadModule("/src/shared/api/sseClient.ts")
  agentRuntimeApiModule = await viteServer.ssrLoadModule("/src/features/chat/api/agentRuntimeApi.ts")
})

after(async () => {
  await viteServer?.close()
})

beforeEach(() => {
  storage.clear()
  invalidationModule.resetRuntimeAuthInvalidationForTest()
})

test("T1-a: 收到 401 且 code=auth_session_expired 时通知一次，连续 3 次只通知一次", async () => {
  runtimeAccessModule.setRuntimeAccessToken("token-test-1")
  const signals = []
  const unsubscribe = invalidationModule.subscribeRuntimeAuthInvalid((signal) => {
    signals.push(signal)
  })

  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    headers: new Headers(),
    text: async () => JSON.stringify({ code: "auth_session_expired", detail: "登录已过期" }),
  })

  for (let i = 0; i < 3; i++) {
    await assert.rejects(
      async () => httpClientModule.requestJson("/api/test-auth"),
      (err) => err instanceof httpClientModule.HttpError && err.status === 401,
    )
  }

  assert.equal(signals.length, 1)
  assert.equal(signals[0].code, "auth_session_expired")
  assert.equal(signals[0].source, "rest")
  assert.equal(signals[0].detail, "登录已过期")
  unsubscribe()
})

test("T1-b: 401 不带 code（如 login 密码错误）不通知", async () => {
  runtimeAccessModule.setRuntimeAccessToken("token-test-2")
  const signals = []
  const unsubscribe = invalidationModule.subscribeRuntimeAuthInvalid((signal) => {
    signals.push(signal)
  })

  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    statusText: "Unauthorized",
    headers: new Headers(),
    text: async () => JSON.stringify({ detail: "账号或密码错误。" }),
  })

  await assert.rejects(
    async () => httpClientModule.requestJson("/api/auth/login"),
    (err) => err instanceof httpClientModule.HttpError && err.status === 401,
  )

  assert.equal(signals.length, 0)
  unsubscribe()
})

test("T1-c: sentToken 与当前 Token 不同时不通知", () => {
  runtimeAccessModule.setRuntimeAccessToken("token-current")
  const signals = []
  const unsubscribe = invalidationModule.subscribeRuntimeAuthInvalid((signal) => {
    signals.push(signal)
  })

  invalidationModule.notifyRuntimeAuthInvalid(
    { code: "auth_session_expired", detail: "过期", source: "rest" },
    "token-old",
  )

  assert.equal(signals.length, 0)
  unsubscribe()
})

test("T1-d: sceneHeartbeat 遇到带 code 的 401 返回 error 并通知；遇到 404 返回 expired 且不通知", async () => {
  runtimeAccessModule.setRuntimeAccessToken("token-heartbeat")
  const signals = []
  const unsubscribe = invalidationModule.subscribeRuntimeAuthInvalid((signal) => {
    signals.push(signal)
  })

  // 1. 401 with code
  globalThis.fetch = async () => ({
    ok: false,
    status: 401,
    text: async () => JSON.stringify({ code: "auth_session_expired", detail: "心跳会话已过期" }),
  })

  const res1 = await agentRuntimeApiModule.sceneHeartbeat("scene-1")
  assert.equal(res1, "error")
  assert.equal(signals.length, 1)
  assert.equal(signals[0].source, "heartbeat")
  assert.equal(signals[0].code, "auth_session_expired")
  assert.equal(signals[0].detail, "心跳会话已过期")

  // 2. 404
  globalThis.fetch = async () => ({
    ok: false,
    status: 404,
    text: async () => JSON.stringify({ detail: "not found" }),
  })

  const res2 = await agentRuntimeApiModule.sceneHeartbeat("scene-1")
  assert.equal(res2, "expired")
  assert.equal(signals.length, 1) // still 1, no new signal

  unsubscribe()
})

test("T1-e: SseClient 收到终止事件后调用 close 并停止重连，回调拿到解析后的 data", async () => {
  const terminalEvents = []
  const events = []

  const client = new sseClientModule.SseClient({
    url: "http://127.0.0.1:18000/api/stream/events",
    terminalEventTypes: ["communication.auth_invalid"],
    onTerminalEvent: (type, data) => {
      terminalEvents.push({ type, data })
    },
    onEvent: (evt) => {
      events.push(evt)
    },
  })

  client.connect()
  const fakeSource = FakeEventSource.lastInstance
  assert.ok(fakeSource)
  assert.equal(fakeSource.closed, false)

  // Emit terminal event
  fakeSource.emit(
    "communication.auth_invalid",
    JSON.stringify({
      stream_id: "s-123",
      code: "auth_session_expired",
      detail: "未登录或登录已过期",
    }),
  )

  assert.equal(fakeSource.closed, true)
  assert.equal(client.closedByUser, true)
  assert.equal(events.length, 0)
  assert.equal(terminalEvents.length, 1)
  assert.equal(terminalEvents[0].type, "communication.auth_invalid")
  assert.equal(terminalEvents[0].data.code, "auth_session_expired")
  assert.equal(terminalEvents[0].data.stream_id, "s-123")
})

test("T1-f: isRuntimeAuthInvalidError 能正确区分带 code 和不带 code 的 401", () => {
  const errWithCode = new httpClientModule.HttpError("auth failed", 401, {
    code: "auth_session_expired",
    detail: "expired",
  })
  const errWithoutCode = new httpClientModule.HttpError("password wrong", 401, {
    detail: "账号或密码错误。",
  })
  const err500 = new httpClientModule.HttpError("server error", 500, {
    code: "auth_session_expired",
  })
  const normalErr = new Error("network down")

  assert.equal(invalidationModule.isRuntimeAuthInvalidError(errWithCode), true)
  assert.equal(invalidationModule.isRuntimeAuthInvalidError(errWithoutCode), false)
  assert.equal(invalidationModule.isRuntimeAuthInvalidError(err500), false)
  assert.equal(invalidationModule.isRuntimeAuthInvalidError(normalErr), false)
})

test("T2: 模拟 Gate 处理逻辑，验证 cancelQueries、clear 和清除 Token", () => {
  runtimeAccessModule.setRuntimeAccessToken("token-to-invalidate")
  assert.equal(runtimeAccessModule.getRuntimeAccessToken(), "token-to-invalidate")

  let cancelQueriesCalled = false
  let clearCalled = false
  const stubQueryClient = {
    cancelQueries: async () => {
      cancelQueriesCalled = true
    },
    clear: () => {
      clearCalled = true
    },
  }

  // Simulate RuntimeAuthGate handleRuntimeAuthInvalid handler logic
  const handleRuntimeAuthInvalid = (signal) => {
    if (signal.code === "auth_bootstrap_required") return
    runtimeAccessModule.setRuntimeAccessToken(null)
    stubQueryClient.cancelQueries()
    stubQueryClient.clear()
  }

  const unsubscribe = invalidationModule.subscribeRuntimeAuthInvalid(handleRuntimeAuthInvalid)

  invalidationModule.notifyRuntimeAuthInvalid(
    { code: "auth_session_expired", detail: "登录已过期", source: "rest" },
    "token-to-invalidate",
  )

  assert.equal(runtimeAccessModule.getRuntimeAccessToken(), null)
  assert.equal(cancelQueriesCalled, true)
  assert.equal(clearCalled, true)

  unsubscribe()
})
