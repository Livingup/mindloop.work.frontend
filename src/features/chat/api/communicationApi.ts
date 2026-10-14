import { HttpError, requestJsonWithMeta } from "@/shared/api/httpClient"
import type { AgentEvent } from "@/features/chat/model/agentEvents"

/**
 * 通信流历史消息列表。
 *
 * 后端响应模型 CommunicationMessageResponse 与 SSE 推送的事件载荷字段一致，
 * 因此前端复用 AgentEvent 类型；调用方可以直接把它喂给 chatStore.appendEvent / hydrateScene。
 */
export type CommunicationMessage = AgentEvent

export type ListCommunicationMessagesQuery = {
  // 仅返回 seq > after_seq 的消息，用于 SSE 断线续传或翻页。默认 0。
  after_seq?: number
  // 单次最多返回多少条；后端默认 500，最大 5000。
  limit?: number
  // 是否读取最新 N 条消息窗口；用于打开 scene 时恢复最近对话上下文。
  latest?: boolean
}

export type ListCommunicationMessagesOptions = {
  timeoutMs?: number
}

export type CommunicationGapErrorBody = {
  error_code?: string
  after_seq?: number
  ring_first_seq?: number
  ring_last_seq?: number
  stream_id?: string
}

export class CommunicationGapUnrecoverableError extends Error {
  readonly afterSeq: number
  readonly ringFirstSeq: number
  readonly ringLastSeq: number

  constructor(body: CommunicationGapErrorBody) {
    super("communication_gap_unrecoverable")
    this.name = "CommunicationGapUnrecoverableError"
    this.afterSeq = typeof body.after_seq === "number" ? body.after_seq : 0
    this.ringFirstSeq = typeof body.ring_first_seq === "number" ? body.ring_first_seq : 0
    this.ringLastSeq = typeof body.ring_last_seq === "number" ? body.ring_last_seq : 0
  }
}

export type ListCommunicationMessagesResult = {
  messages: CommunicationMessage[]
  runtimeBootId: string | null
}

/**
 * 拉取指定通信流的历史消息（按 seq 升序）。
 *
 * 用于前端 attach 后 hydrate 最近 N 条事件，重建已运行场景的对话上下文。
 */
export function listCommunicationMessages(
  streamId: string,
  query: ListCommunicationMessagesQuery = {},
  options: ListCommunicationMessagesOptions = {},
) {
  return listCommunicationMessagesWithMeta(streamId, query, options).then((result) => result.messages)
}

export async function listCommunicationMessagesWithMeta(
  streamId: string,
  query: ListCommunicationMessagesQuery = {},
  options: ListCommunicationMessagesOptions = {},
): Promise<ListCommunicationMessagesResult> {
  const search = new URLSearchParams()
  if (typeof query.after_seq === "number") {
    search.set("after_seq", String(query.after_seq))
  }
  if (typeof query.limit === "number") {
    search.set("limit", String(query.limit))
  }
  if (typeof query.latest === "boolean") {
    search.set("latest", String(query.latest))
  }
  const queryString = search.toString()
  const url = `/api/communication/streams/${encodeURIComponent(streamId)}/messages${
    queryString ? `?${queryString}` : ""
  }`
  try {
    const result = await requestJsonWithMeta<CommunicationMessage[]>(url, { timeoutMs: options.timeoutMs })
    return {
      messages: result.data,
      runtimeBootId: result.headers.get("X-Runtime-Boot-Id") ?? result.headers.get("x-runtime-boot-id"),
    }
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) {
      const body = (error.body && typeof error.body === "object" ? error.body : {}) as Record<string, unknown>
      const detail = body.detail
      const gapBody = (detail && typeof detail === "object" ? detail : body) as CommunicationGapErrorBody
      if (gapBody.error_code === "communication_gap_unrecoverable" || error.status === 409) {
        throw new CommunicationGapUnrecoverableError(gapBody)
      }
    }
    throw error
  }
}

