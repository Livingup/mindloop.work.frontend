import type { UserMessageAttachmentRequest } from "@/features/chat/api/agentRuntimeApi"
import type { UserMessageAttachment as UiUserMessageAttachment } from "@/features/chat/api/fileResourceApi"

export function requestAttachmentToUiAttachment(attachment: UserMessageAttachmentRequest): UiUserMessageAttachment {
  return {
    kind: attachment.kind,
    resourceId: attachment.resource_id,
    name: attachment.name ?? null,
    mimeType: attachment.mime_type ?? null,
    sizeInBytes: attachment.size_in_bytes ?? null,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    pageCount: attachment.page_count ?? null,
  }
}

export function normalizeAttachmentList(value: unknown): UiUserMessageAttachment[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const record = item as Record<string, unknown>
    const resourceId = textValue(record.resourceId) ?? textValue(record.resource_id)
    const kind = textValue(record.kind)
    if (!resourceId || (kind !== "image" && kind !== "pdf")) return []
    return [{
      kind,
      resourceId,
      name: textValue(record.name),
      mimeType: textValue(record.mimeType) ?? textValue(record.mime_type),
      sizeInBytes: numberValue(record.sizeInBytes) ?? numberValue(record.size_in_bytes),
      width: numberValue(record.width),
      height: numberValue(record.height),
      pageCount: numberValue(record.pageCount) ?? numberValue(record.page_count),
    }]
  })
}

export function attachmentToMetadata(attachment: UiUserMessageAttachment): UserMessageAttachmentRequest {
  return {
    kind: attachment.kind,
    resource_id: attachment.resourceId,
    name: attachment.name ?? null,
    mime_type: attachment.mimeType ?? null,
    size_in_bytes: attachment.sizeInBytes ?? null,
    width: attachment.width ?? null,
    height: attachment.height ?? null,
    page_count: attachment.pageCount ?? null,
  }
}

function textValue(value: unknown): string | null {
  if (typeof value !== "string") return null
  return value.length > 0 ? value : null
}

function numberValue(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null
  return value
}
