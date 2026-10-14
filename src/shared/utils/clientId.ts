let fallbackCounter = 0

function randomHexFromBytes(byteCount: number): string | null {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.getRandomValues !== "function") return null
  try {
    const bytes = new Uint8Array(byteCount)
    cryptoApi.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  } catch {
    return null
  }
}

export function createClientId(prefix: string): string {
  const cryptoApi = globalThis.crypto
  if (typeof cryptoApi?.randomUUID === "function") {
    try {
      return `${prefix}-${cryptoApi.randomUUID()}`
    } catch {
      // 某些移动 WebView 会暴露 crypto 但拒绝 randomUUID；继续走 getRandomValues / 时间戳兜底。
    }
  }

  const randomHex = randomHexFromBytes(16)
  if (randomHex) return `${prefix}-${randomHex}`

  const timestamp = Date.now().toString(36)
  const counter = (fallbackCounter++).toString(36)
  const random = Math.random().toString(36).slice(2)
  return `${prefix}-${timestamp}-${counter}-${random}`
}
