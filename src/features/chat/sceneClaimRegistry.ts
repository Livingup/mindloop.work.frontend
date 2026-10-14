import { createClientId } from "@/shared/utils/clientId"

/**
 * Scene 占用注册表 —— 同浏览器内防止多 Tab 同时驱动同一 scene。
 *
 * 设计：
 * - localStorage 纯状态存储（无时间戳） + BroadcastChannel 即时通知。
 * - 零 timer、零心跳、零 stale 判定 → 完全不受浏览器后台 Tab 节流影响。
 * - BroadcastChannel 消息即使 Tab 在后台也能正常接收（浏览器仅节流 timer）。
 * - crash 残留 claim 通过 BroadcastChannel ping-pong 按需验证清理。
 *
 * 不是后端独占锁的替代品，跨浏览器/跨机器场景不在拦截范围内。
 */

const STORAGE_KEY = "spread-ai-scene-claims-v1"
const CHANNEL_NAME = "spread-ai-scene-claims"
const VERIFY_TIMEOUT_MS = 500

type ClaimEntry = { tabId: string }
type ClaimMap = Record<string, ClaimEntry>

const SELF_TAB_ID = createClientId("tab")

const heldKeys = new Set<string>()

// ── BroadcastChannel（同源跨 Tab 即时通信）────────────────────────────

let channel: BroadcastChannel | null = null

function getChannel(): BroadcastChannel {
  if (!channel) {
    channel = new BroadcastChannel(CHANNEL_NAME)
    // 监听 ping 请求：如果其他 Tab 验证某个 claim 的 owner 是否存活，本 Tab 回复 pong。
    channel.addEventListener("message", (event: MessageEvent) => {
      if (event.data?.type === "ping" && typeof event.data.key === "string") {
        if (heldKeys.has(event.data.key)) {
          channel!.postMessage({ type: "pong", key: event.data.key, tabId: SELF_TAB_ID })
        }
      }
    })
  }
  return channel
}

/** 通知所有其他 Tab：localStorage 状态已变更，请重新读取。 */
function notifyChanged(): void {
  try {
    getChannel().postMessage({ type: "changed" })
  } catch {
    // BroadcastChannel 不可用：退化为仅 storage 事件通知。
  }
}

// ── localStorage 读写 ────────────────────────────────────────────────

function readClaims(): ClaimMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object") return {}
    return parsed as ClaimMap
  } catch {
    return {}
  }
}

function writeClaims(claims: ClaimMap): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(claims))
  } catch {
    // localStorage 不可用 / 配额耗尽：吞掉。最坏情况是退化为不拦截。
  }
}

// ── 公开 API ─────────────────────────────────────────────────────────

/**
 * 把 key 注册为本 Tab 持有。幂等操作。
 */
export function claimScene(key: string): void {
  const claims = readClaims()
  claims[key] = { tabId: SELF_TAB_ID }
  writeClaims(claims)
  heldKeys.add(key)
  notifyChanged()
}

/**
 * 释放 key。仅当 storage 中该 key 仍属于本 Tab 时才删除。
 */
export function releaseScene(key: string): void {
  heldKeys.delete(key)
  const claims = readClaims()
  if (claims[key]?.tabId === SELF_TAB_ID) {
    delete claims[key]
    writeClaims(claims)
  }
  notifyChanged()
}

/**
 * 同步判断 key 是否被同浏览器内其他 Tab 占用。
 */
export function isClaimedByOther(key: string): { claimed: boolean; ownerTabId?: string } {
  const claims = readClaims()
  const entry = claims[key]
  if (!entry) return { claimed: false }
  if (entry.tabId === SELF_TAB_ID) return { claimed: false }
  return { claimed: true, ownerTabId: entry.tabId }
}

/**
 * 验证某个被占用 key 的 owner 是否仍存活（通过 BroadcastChannel ping-pong）。
 * 若 owner 无响应（crash 残留），自动清理并返回 false。
 * 调用场景：用户点击被占用的 scene 时二次确认。
 */
export function verifyClaimAlive(key: string): Promise<boolean> {
  const claims = readClaims()
  const entry = claims[key]
  if (!entry || entry.tabId === SELF_TAB_ID) return Promise.resolve(false)

  return new Promise((resolve) => {
    const ch = getChannel()
    const onMsg = (event: MessageEvent) => {
      if (event.data?.type === "pong" && event.data.key === key && event.data.tabId === entry.tabId) {
        ch.removeEventListener("message", onMsg)
        clearTimeout(timer)
        resolve(true)
      }
    }
    ch.addEventListener("message", onMsg)
    ch.postMessage({ type: "ping", key })
    const timer = setTimeout(() => {
      ch.removeEventListener("message", onMsg)
      // 无响应 → crash 残留，清理
      const current = readClaims()
      if (current[key]?.tabId === entry.tabId) {
        delete current[key]
        writeClaims(current)
        notifyChanged()
      }
      resolve(false)
    }, VERIFY_TIMEOUT_MS)
  })
}

/**
 * 返回当前所有被"其他 Tab"占用的 claim key 集合。
 */
export function getKeysClaimedByOther(): Set<string> {
  const claims = readClaims()
  const result = new Set<string>()
  for (const [k, v] of Object.entries(claims)) {
    if (v.tabId !== SELF_TAB_ID) result.add(k)
  }
  return result
}

/**
 * 订阅"被其他 Tab 占用"集合的变化。注册时立即回调一次初始值。
 *
 * 触发机制：
 * - BroadcastChannel `changed` 消息：其他 Tab claim/release 时即时触发（不受后台 Tab 节流）。
 * - `storage` 事件：兜底通知（部分浏览器对 BroadcastChannel 支持不同）。
 * - 首次订阅时校验所有他方 claim 存活性，异步清理 crash 残留。
 *
 * 返回取消订阅函数。
 */
export function subscribeOccupiedKeys(cb: (keys: Set<string>) => void): () => void {
  if (typeof window === "undefined") {
    cb(new Set())
    return () => {}
  }

  let disposed = false
  const emit = () => cb(getKeysClaimedByOther())
  const emitAndVerify = () => {
    const keys = getKeysClaimedByOther()
    cb(keys)
    if (keys.size === 0) return
    void Promise.all(Array.from(keys, verifyClaimAlive)).then(() => {
      if (!disposed) emit()
    })
  }
  emitAndVerify()

  // BroadcastChannel：即时通知（核心路径）
  const ch = getChannel()
  const onChannelMsg = (event: MessageEvent) => {
    if (event.data?.type === "changed") emitAndVerify()
  }
  ch.addEventListener("message", onChannelMsg)

  // storage 事件：兜底（BroadcastChannel 的补充，例如 beforeunload 写 localStorage 但无法 postMessage）
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) emitAndVerify()
  }
  window.addEventListener("storage", onStorage)

  return () => {
    disposed = true
    ch.removeEventListener("message", onChannelMsg)
    window.removeEventListener("storage", onStorage)
  }
}

// ── 全局生命周期 ─────────────────────────────────────────────────────

// pagehide / beforeunload：Tab 正常关闭时立即释放所有 claim。
// 注意：卸载期间 BroadcastChannel.postMessage 不可靠，但 localStorage 写入会触发
// 其他 Tab 的 storage 事件，确保通知送达。
if (typeof window !== "undefined") {
  // 确保 channel 创建（激活 ping 监听）
  getChannel()

  const releaseHeldClaims = () => {
    if (heldKeys.size === 0) return
    const claims = readClaims()
    let changed = false
    for (const k of heldKeys) {
      if (claims[k]?.tabId === SELF_TAB_ID) {
        delete claims[k]
        changed = true
      }
    }
    if (changed) writeClaims(claims)
  }

  window.addEventListener("pagehide", (event) => {
    if (!event.persisted) releaseHeldClaims()
  })
  window.addEventListener("beforeunload", releaseHeldClaims)
}
