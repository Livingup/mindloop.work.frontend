import { HttpError } from "@/shared/api/httpClient"
import { getRuntimeAccessToken } from "@/shared/api/runtimeAccess"

export type RuntimeAuthInvalidCode =
  | "auth_token_missing"
  | "auth_token_invalid"
  | "auth_session_revoked"
  | "auth_session_expired"
  | "auth_bootstrap_required"

export type RuntimeAuthInvalidSignal = {
  code: RuntimeAuthInvalidCode
  detail: string | null
  source: "rest" | "heartbeat" | "sse" | "me"
}

type RuntimeAuthInvalidListener = (signal: RuntimeAuthInvalidSignal) => void

const listeners = new Set<RuntimeAuthInvalidListener>()
let lastNotifiedToken: string | null | undefined = undefined

export function resetRuntimeAuthInvalidationForTest(): void {
  lastNotifiedToken = undefined
  listeners.clear()
}

export function runtimeAuthInvalidCodeFromBody(
  status: number,
  body: unknown,
): RuntimeAuthInvalidCode | null {
  if (status !== 401) return null
  if (!body || typeof body !== "object") return null
  const code = (body as Record<string, unknown>).code
  if (typeof code === "string" && code.startsWith("auth_")) {
    return code as RuntimeAuthInvalidCode
  }
  return null
}

export function notifyRuntimeAuthInvalid(
  signal: RuntimeAuthInvalidSignal,
  sentToken: string | null,
): void {
  const currentToken = getRuntimeAccessToken()
  if (sentToken !== currentToken) {
    return
  }
  if (lastNotifiedToken !== undefined && lastNotifiedToken === sentToken) {
    return
  }
  lastNotifiedToken = sentToken
  const currentListeners = Array.from(listeners)
  for (const listener of currentListeners) {
    try {
      listener(signal)
    } catch (err) {
      console.error("[RuntimeAuthInvalidation] listener error:", err)
    }
  }
}

export function subscribeRuntimeAuthInvalid(
  listener: RuntimeAuthInvalidListener,
): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isRuntimeAuthInvalidError(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false
  return runtimeAuthInvalidCodeFromBody(error.status, error.body) !== null
}
