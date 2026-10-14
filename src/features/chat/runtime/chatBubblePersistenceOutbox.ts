import type { CreateChatBubbleMessageRequest } from "@/features/chat/api/agentRuntimeApi"
import { createClientId } from "@/shared/utils/clientId"

/**
 * Chat Bubble 投影持久化 outbox。
 *
 * SSE transport cursor 只表示事件已进入前端运行态；它不能替代 Bubble 已完成 durable ack。
 * 本模块把每个 (sceneId, agentInstanceId, bubbleId) 的最新完整快照保存到 localStorage，直到 REST upsert 成功确认。
 * 刷新/重连后的 attach 可以重试这些快照，不需要把 communication event log 当作完整 UI 历史渲染。
 */

const STORAGE_KEY = "spread-ai-chat-bubble-persistence-outbox-v1"
const OUTBOX_VERSION = 1

export type ChatBubblePersistenceOutboxEntry = {
  version: typeof OUTBOX_VERSION
  snapshotId: string
  sceneId: string
  bubbleId: string
  label: string
  body: CreateChatBubbleMessageRequest
  createdAt: string
  updatedAt: string
}

type StoredOutbox = {
  version: typeof OUTBOX_VERSION
  entries: ChatBubblePersistenceOutboxEntry[]
}

export function saveChatBubblePersistenceSnapshot(
  sceneId: string,
  label: string,
  body: CreateChatBubbleMessageRequest,
  createdAt: string,
): ChatBubblePersistenceOutboxEntry {
  const bubbleId = body.bubble_id
  if (!bubbleId) {
    throw new Error("Chat Bubble persistence outbox requires bubble_id")
  }
  const agentInstanceId = chatBubbleRequestAgentInstanceId(body)
  if (!agentInstanceId) {
    throw new Error("Chat Bubble persistence outbox requires agent_instance_id")
  }
  const now = new Date().toISOString()
  const entry: ChatBubblePersistenceOutboxEntry = {
    version: OUTBOX_VERSION,
    snapshotId: createClientId("chat-bubble-outbox"),
    sceneId,
    bubbleId,
    label,
    body,
    createdAt,
    updatedAt: now,
  }
  const next = readOutbox().filter((candidate) => !(
    candidate.sceneId === sceneId
    && chatBubbleRequestAgentInstanceId(candidate.body) === agentInstanceId
    && candidate.bubbleId === bubbleId
  ))
  next.push(entry)
  writeOutbox(next)
  return entry
}

export function listChatBubblePersistenceSnapshots(sceneId: string): ChatBubblePersistenceOutboxEntry[] {
  return readOutbox()
    .filter((entry) => entry.sceneId === sceneId)
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
}

/** attach/restart 时按持久化顺序重放当前 scene 的 latest snapshots。 */
export function replayChatBubblePersistenceSnapshots(
  sceneId: string,
  restore: (entry: ChatBubblePersistenceOutboxEntry) => void,
): void {
  for (const entry of listChatBubblePersistenceSnapshots(sceneId)) restore(entry)
}

/** 仅移除仍与本次 durable ack 对应的快照，避免旧请求 ack 删除较新的 pending snapshot。 */
export function acknowledgeChatBubblePersistenceSnapshot(snapshotId: string): void {
  const entries = readOutbox()
  const next = entries.filter((entry) => entry.snapshotId !== snapshotId)
  if (next.length !== entries.length) writeOutbox(next)
}

export function clearChatBubblePersistenceSnapshots(sceneId: string): void {
  const entries = readOutbox()
  const next = entries.filter((entry) => entry.sceneId !== sceneId)
  if (next.length !== entries.length) writeOutbox(next)
}

function chatBubbleRequestAgentInstanceId(body: CreateChatBubbleMessageRequest): string | null {
  const direct = body.agent_instance_id
  if (typeof direct === "string" && direct.length > 0) return direct
  const metadataOwner = body.metadata?.agent_instance_id
  return typeof metadataOwner === "string" && metadataOwner.length > 0 ? metadataOwner : null
}

function readOutbox(): ChatBubblePersistenceOutboxEntry[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!isStoredOutbox(parsed)) return []
    return parsed.entries.filter(isOutboxEntry)
  } catch {
    return []
  }
}

function writeOutbox(entries: ChatBubblePersistenceOutboxEntry[]): void {
  if (typeof window === "undefined") return
  try {
    const value: StoredOutbox = { version: OUTBOX_VERSION, entries }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // localStorage 不可用或配额不足时退化为当前会话内重试；不能阻塞实时 UI。
  }
}

function isStoredOutbox(value: unknown): value is StoredOutbox {
  return Boolean(
    value &&
    typeof value === "object" &&
    (value as { version?: unknown }).version === OUTBOX_VERSION &&
    Array.isArray((value as { entries?: unknown }).entries),
  )
}

function isOutboxEntry(value: unknown): value is ChatBubblePersistenceOutboxEntry {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<ChatBubblePersistenceOutboxEntry>
  return candidate.version === OUTBOX_VERSION &&
    typeof candidate.snapshotId === "string" &&
    typeof candidate.sceneId === "string" &&
    typeof candidate.bubbleId === "string" &&
    typeof candidate.label === "string" &&
    Boolean(candidate.body && typeof candidate.body === "object") &&
    Boolean(candidate.body && chatBubbleRequestAgentInstanceId(candidate.body)) &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.updatedAt === "string"
}



