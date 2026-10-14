/**
 * 前后端通信健康状态机（pure / 无 React 依赖）。
 *
 * 设计边界：
 * - SSE transport、HTTP heartbeat presence、re-attach restore、后端 control plane 是独立信号轴。
 * - 业务 SSE event / ping / open 都是 SSE transport activity；只要最近仍有 SSE activity，
 *   heartbeat 或其他控制面延迟就不能被折叠成“实时流断开/重连中”。
 * - HTTP heartbeat 只表达 Scene presence 租约续期；404 expired 才表示需要重新 attach presence。
 */

import { HEARTBEAT_STALE_TIMEOUT_MS } from "@/features/chat/runtime/runtimeConfig"

export type CommunicationSseStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error"
  | "stale"

export type CommunicationHeartbeatStatus = "idle" | "ok" | "error" | "expired"

export type CommunicationRestoreStatus = "idle" | "reattaching" | "failed"

export type CommunicationBackendStatus = "unknown" | "ok" | "unhealthy"

export type CommunicationHealthState = {
  /** SSE transport 状态，只能由 EventSource/open/error、SSE activity 和 replay 结果驱动。 */
  sseStatus: CommunicationSseStatus
  /** Scene presence heartbeat 状态，不能反向证明 SSE transport 断链。 */
  heartbeatStatus: CommunicationHeartbeatStatus
  /** re-attach 恢复状态，主要服务 presence/scene attach，不默认等于实时流断开。 */
  restoreStatus: CommunicationRestoreStatus
  /** REST health/attach 等控制面状态。 */
  backendStatus: CommunicationBackendStatus
  /** 最近业务 communication message 创建时间（来自后端 message.created_at）。 */
  lastEventAt?: string
  /** 最近任意 SSE 入站活性时间：open / business message / visible ping。 */
  lastSseActivityAt?: string
  /** 最近 SSE 业务 message 入站时间（本地接收时间）。 */
  lastSseMessageAt?: string
  /** 最近 EventSource error 时间。 */
  lastSseErrorAt?: string
  /** 最近 heartbeat 成功时间。 */
  lastHeartbeatAt?: string
  lastErrorAt?: string
  errorMessage?: string
  reconnectAttempt: number
  /** 连续 heartbeat error 计数；ok 时重置。普通 timeout 不再触发 SSE 重连。 */
  consecutiveHeartbeatErrors: number
  /** 连续 SSE transport error 计数；open/message/ping 成功时重置。 */
  sseErrorCount: number
  /** attach 成功时间戳；供 presence stale watchdog fallback。 */
  attachedAt?: string
}

export type StatusTone = "ok" | "pending" | "warning" | "danger" | "neutral"

export type StatusViewModel = {
  label: string
  detail: string
  tone: StatusTone
  bannerText?: string
  isBusy?: boolean
  canRetry?: boolean
}

export const IDLE_COMMUNICATION_HEALTH_STATE: CommunicationHealthState = {
  sseStatus: "idle",
  heartbeatStatus: "idle",
  restoreStatus: "idle",
  backendStatus: "unknown",
  reconnectAttempt: 0,
  consecutiveHeartbeatErrors: 0,
  sseErrorCount: 0,
}

/**
 * 判断 SSE transport 当前是否可用。该判断只看 SSE 轴，不受 heartbeat 或控制面失败影响。
 */
export function hasUsableSseTransport(state: CommunicationHealthState): boolean {
  return state.sseStatus === "connected"
}

/** 最近是否有 SSE 入站活性。业务事件和 ping/open 都算 activity。 */
export function hasRecentSseActivity(
  state: CommunicationHealthState,
  now: number = Date.now(),
  windowMs: number = HEARTBEAT_STALE_TIMEOUT_MS,
 ): boolean {
  if (!state.lastSseActivityAt) return false
  const activityAt = Date.parse(state.lastSseActivityAt)
  return Number.isFinite(activityAt) && now - activityAt <= windowMs
}

/**
 * Scene 级前后端通信健康度统一视图。
 *
 * UI 合成规则：SSE transport 证据优先于 heartbeat/control-plane 失败。
 * 只要 SSE transport 仍 connected，restore/heartbeat/control-plane 的 transient 失败不能显示为“实时流重连中”。
 */
export function getCommunicationView(state: CommunicationHealthState): StatusViewModel {
  const sseUsable = hasUsableSseTransport(state)
  const recentSseActivity = hasRecentSseActivity(state)
  const sseProof = sseUsable || recentSseActivity

  if (state.restoreStatus === "failed") {
    return {
      label: "连接失败",
      detail: state.errorMessage ?? "前后端通信恢复失败，请手动重新连接。",
      tone: "danger",
      bannerText: state.errorMessage ?? "前后端通信恢复失败，请手动重新连接。",
      canRetry: true,
    }
  }

  if (state.restoreStatus === "reattaching") {
    if (sseProof) {
      return {
        label: "会话恢复中",
        detail: "实时事件流仍有活动，正在后台刷新 Scene presence；Agent 执行不会受影响。",
        tone: "neutral",
        isBusy: true,
      }
    }
    return {
      label: "自动恢复中",
      detail: state.errorMessage ?? "前后端通信会话恢复中，正在后台重新连接并按通信游标同步消息。",
      tone: state.backendStatus === "unhealthy" ? "warning" : "pending",
      bannerText: state.errorMessage ?? "前后端通信会话恢复中，正在后台重新连接并同步消息。",
      isBusy: true,
      canRetry: true,
    }
  }

  if (state.backendStatus === "unhealthy") {
    if (sseProof) {
      return {
        label: "控制面延迟",
        detail: state.errorMessage ?? "后端 REST 控制面响应较慢，但实时事件流仍可用。",
        tone: "neutral",
      }
    }
    return {
      label: "后端暂不可用",
      detail: state.errorMessage ?? "后端控制面暂时无响应，系统会继续后台检查。",
      tone: "warning",
      bannerText: state.errorMessage ?? "后端控制面暂时无响应，正在等待恢复。",
      isBusy: true,
      canRetry: true,
    }
  }

  if (state.heartbeatStatus === "expired") {
    return {
      label: "会话过期",
      detail: state.errorMessage ?? "Scene presence 已过期，正在尝试重新 attach；Agent 后端执行不受影响。",
      tone: "warning",
      bannerText: state.errorMessage ?? "Scene presence 已过期，正在尝试重新连接。",
      isBusy: true,
      canRetry: true,
    }
  }

  if (state.heartbeatStatus === "error") {
    if (sseProof) {
      return {
        label: "会话保活延迟",
        detail: state.errorMessage ?? "HTTP heartbeat 暂时失败，但实时事件流仍有活动；不会误判为 SSE 断链。",
        tone: "neutral",
      }
    }
    return {
      label: "通信波动",
      detail: state.errorMessage ?? "Scene heartbeat 保活暂时失败，正在自动重试。",
      tone: "warning",
      bannerText: state.errorMessage ?? "Scene heartbeat 保活暂时失败，正在自动重试。",
      isBusy: true,
      canRetry: true,
    }
  }

  if (state.sseStatus === "error") {
    return {
      label: "实时流连接失败",
      detail: state.errorMessage ?? "SSE 实时事件流连接失败。",
      tone: "danger",
      bannerText: state.errorMessage ?? "SSE 实时事件流连接失败，请重新连接。",
      canRetry: true,
    }
  }

  if (state.sseStatus === "stale") {
    return {
      label: "实时流待恢复",
      detail: state.errorMessage ?? "SSE 实时事件流状态不再可信，正在等待自动恢复。",
      tone: "warning",
      bannerText: state.errorMessage ?? "SSE 实时事件流状态不再可信，恢复后会自动同步消息。",
      isBusy: true,
      canRetry: true,
    }
  }

  if (state.sseStatus === "reconnecting") {
    if (sseProof) {
      return {
        label: "实时流仍可用",
        detail: "SSE 实时事件流仍有 open/message/ping 活性证据；后台重连信号暂不显示为断链。",
        tone: "neutral",
      }
    }
    return {
      label: "实时流重连中",
      detail: `SSE 实时事件流连接异常，正在第 ${state.reconnectAttempt} 次重连。`,
      tone: "warning",
      bannerText: "SSE 实时事件流中断，正在重连。Agent 仍会在后端运行，恢复后会自动同步消息。",
      isBusy: true,
    }
  }

  if (state.sseStatus === "connecting") {
    return {
      label: "连接中",
      detail: "正在建立前后端实时事件流。",
      tone: "pending",
      isBusy: true,
    }
  }

  if (state.sseStatus === "idle") {
    return {
      label: "未连接",
      detail: "前后端实时事件流尚未建立。",
      tone: "neutral",
    }
  }

  return {
    label: "正常",
    detail: state.lastEventAt
      ? `前后端实时通信正常，最近业务事件 ${formatConnectionTime(state.lastEventAt)}。`
      : state.lastSseActivityAt
        ? `前后端实时通信正常，最近连接活动 ${formatConnectionTime(state.lastSseActivityAt)}。`
        : "前后端实时通信正常。",
    tone: "ok",
  }
}

/**
 * Presence stale watchdog：只判断 Scene heartbeat 租约是否需要 re-attach。
 *
 * 关键约束：如果 SSE transport 仍 connected 或最近有 SSE activity，则 heartbeat 过旧只说明
 * presence/control-plane 延迟，不能触发“实时流重连中”误报。
 */
export function shouldRecoverStaleHeartbeat(state: CommunicationHealthState, now: number): boolean {
  if (state.restoreStatus !== "idle") return false
  if (hasUsableSseTransport(state) || hasRecentSseActivity(state, now)) return false
  if (state.heartbeatStatus !== "ok" && state.heartbeatStatus !== "error") return false
  const referenceText = state.lastHeartbeatAt ?? state.lastErrorAt ?? state.attachedAt
  if (!referenceText) return false
  const referenceAt = Date.parse(referenceText)
  return Number.isFinite(referenceAt) && now - referenceAt > HEARTBEAT_STALE_TIMEOUT_MS
}

function formatConnectionTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
}
