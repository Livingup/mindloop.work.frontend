import { localImageFileContentUrl } from "@/features/chat/api/fileResourceApi"
import type { AgentEvent, ToolCallCompletedPayload } from "@/features/chat/model/agentEvents"
import type { ChatMessage } from "@/features/chat/model/chatTypes"

export type UserVisibleToolResultKind = "web_document" | "image_generation"

export type GeneratedImageResourcePreview = {
  resourceId: string
  mimeType?: string | null
  revisedPrompt?: string | null
}

export type UserVisibleToolResultImageRequestResourcePreview = {
  field: string
  label: string
  value: string
  displayUrl?: string | null
}

export type UserVisibleToolResultImageRequestPreview = {
  prompt: string | null
  resources: UserVisibleToolResultImageRequestResourcePreview[]
}

export type UserVisibleToolResultView = {
  resultKind: UserVisibleToolResultKind
  toolCallId: string
  toolName: string
  title: string
  createdAt: string
  htmlContent?: string | null
  generatedImages: GeneratedImageResourcePreview[]
  generatedImageResultText?: string | null
  imageRequestPrompt?: string | null
  imageRequestResources: UserVisibleToolResultImageRequestResourcePreview[]
}

export type UserVisibleToolResultMetadata = Record<string, unknown> & {
  bubble_kind: "user_visible_tool_result"
  result_kind: UserVisibleToolResultKind
  tool_call_id: string
  tool_name: string
  title: string
  communication_message_id: string
  communication_seq: number
  created_at: string
  ui_preview?: Record<string, unknown> | null
  result_preview?: unknown
  image_request?: UserVisibleToolResultImageRequestPreview | null
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function resultTextValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null
  if (Array.isArray(value)) {
    const texts = value.flatMap((item) => {
      const record = recordValue(item)
      if (!record) return []
      const kind = textValue(record.kind) ?? textValue(record.type)
      const text = textValue(record.text)
      if (!text || (kind && kind !== "text")) return []
      return [text]
    })
    return texts.join("\n\n").trim() || null
  }
  const record = recordValue(value)
  if (!record) return null
  const kind = textValue(record.kind) ?? textValue(record.type)
  const text = textValue(record.text) ?? textValue(record.message)
  if (!text || (kind && kind !== "text")) return null
  return text.trim() || null
}

const IMAGE_REQUEST_FIELD_LABELS: Record<string, string> = {
  image_urls: "图片 URL",
  image_paths: "图片路径",
  mask_url: "Mask URL",
  mask_path: "Mask 路径",
}

function stringListValue(value: unknown): string[] {
  if (typeof value === "string") return value.trim().length > 0 ? [value.trim()] : []
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = textValue(item)
    return text ? [text] : []
  })
}

function isLocalImagePathField(field?: string | null): boolean {
  return field === "image_paths" || field === "mask_path"
}

function displayUrlValue(value: string, field?: string | null): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (/^(https?:\/\/|data:image\/)/i.test(trimmed)) return trimmed
  if (isLocalImagePathField(field)) {
    return localImageFileContentUrl(trimmed)
  }
  return null
}

function parseImageRequestResourceItems(value: Record<string, unknown>): UserVisibleToolResultImageRequestResourcePreview[] {
  const storedResources = Array.isArray(value.resources) ? value.resources : []
  if (storedResources.length > 0) {
    return storedResources.flatMap((item) => {
      const record = recordValue(item)
      if (!record) return []
      const resourceValue = textValue(record.value)
      if (!resourceValue) return []
      const field = textValue(record.field) ?? "resource"
      return [{
        field,
        label: textValue(record.label) ?? textValue(record.field) ?? "请求资源",
        value: resourceValue,
        displayUrl: displayUrlValue(resourceValue, field) ?? textValue(record.displayUrl),
      }]
    })
  }
  const resources: UserVisibleToolResultImageRequestResourcePreview[] = []
  for (const field of ["image_urls", "image_paths", "mask_url", "mask_path"] as const) {
    const values = stringListValue(value[field])
    const fieldLabel = IMAGE_REQUEST_FIELD_LABELS[field] ?? field
    values.forEach((resourceValue, index) => {
      resources.push({
        field,
        label: values.length > 1 ? `${fieldLabel} ${index + 1}` : fieldLabel,
        value: resourceValue,
        displayUrl: displayUrlValue(resourceValue, field),
      })
    })
  }
  return resources
}

export function buildImageGenerationRequestPreview(value: unknown): UserVisibleToolResultImageRequestPreview | null {
  const record = recordValue(value)
  if (!record) return null
  const prompt = textValue(record.prompt)
  const resources = parseImageRequestResourceItems(record)
  if (!prompt && resources.length === 0) return null
  return {
    prompt,
    resources,
  }
}

export function parseGeneratedImageResources(uiPreview: Record<string, unknown> | null | undefined): GeneratedImageResourcePreview[] {
  if (!uiPreview) return []
  const output = recordValue(uiPreview.output) ?? uiPreview
  const uiKind = textValue(uiPreview.ui_kind) ?? textValue(output.ui_kind)
  if (uiKind !== "image_generation") return []
  const resources = Array.isArray(output.resources) ? output.resources : []
  return resources.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const resourceId = textValue(record.resource_id) ?? textValue(record.resourceId)
    if (!resourceId) return []
    return [{
      resourceId,
      mimeType: textValue(record.mime_type) ?? textValue(record.mimeType),
      revisedPrompt: textValue(record.revised_prompt) ?? textValue(record.revisedPrompt),
    }]
  })
}

export function userVisibleToolResultHtmlContent(
  uiPreview: Record<string, unknown> | null | undefined,
  resultPreview: unknown,
): string | null {
  const htmlContent = textValue(uiPreview?.html_content)
  if (htmlContent) return htmlContent
  if (typeof resultPreview === "string" && resultPreview.trim().startsWith("<")) {
    return resultPreview.trim()
  }
  return null
}

export function userVisibleToolResultKindFromPreview(
  uiPreview: Record<string, unknown> | null | undefined,
  resultPreview: unknown,
  toolName?: string | null,
): UserVisibleToolResultKind | null {
  const normalizedToolName = textValue(toolName)?.toLowerCase() ?? null
  const uiKind = textValue(uiPreview?.ui_kind)
  if (normalizedToolName === "generate_image") {
    return (uiKind === "image_generation" || uiKind === null) && parseGeneratedImageResources(uiPreview).length > 0 ? "image_generation" : null
  }
  if (normalizedToolName === "web_search" || normalizedToolName === "read_url_context") {
    return (uiKind === "web_tools" || uiKind === null) && userVisibleToolResultHtmlContent(uiPreview, resultPreview) ? "web_document" : null
  }
  return null
}

export function buildUserVisibleToolResultMetadata(event: AgentEvent): UserVisibleToolResultMetadata | null {
  if (event.type !== "tool.call.completed") return null
  const payload = event.payload as ToolCallCompletedPayload
  if (!textValue(payload.tool_call_id)) return null
  const resultKind = userVisibleToolResultKindFromPreview(payload.ui_preview ?? null, payload.result_preview, payload.tool_name)
  if (!resultKind) return null
  return {
    bubble_kind: "user_visible_tool_result",
    result_kind: resultKind,
    tool_call_id: payload.tool_call_id,
    tool_name: payload.tool_name,
    title: payload.tool_name,
    communication_message_id: event.message_id,
    communication_seq: event.seq,
    created_at: event.created_at,
    ui_preview: payload.ui_preview ?? null,
    result_preview: payload.result_preview ?? null,
  }
}

export function userVisibleToolResultText(metadata: UserVisibleToolResultMetadata): string {
  if (metadata.result_kind === "image_generation") return `${metadata.tool_name} 图片生成结果`
  return `${metadata.tool_name} 网页结果`
}

export function isUserVisibleToolResultMessage(message: ChatMessage): boolean {
  return message.content.metadata?.bubble_kind === "user_visible_tool_result"
}

export function parseUserVisibleToolResult(message: ChatMessage): UserVisibleToolResultView | null {
  const metadata = recordValue(message.content.metadata)
  if (!metadata || metadata.bubble_kind !== "user_visible_tool_result") return null
  const toolCallId = textValue(metadata.tool_call_id) ?? message.id
  const toolName = textValue(metadata.tool_name) ?? "tool"
  const resultKind = metadata.result_kind === "image_generation" ? "image_generation" : metadata.result_kind === "web_document" ? "web_document" : null
  if (!resultKind) return null
  const uiPreview = recordValue(metadata.ui_preview) ?? null
  const resultPreview = metadata.result_preview
  const imageRequest = buildImageGenerationRequestPreview(metadata.image_request)
  return {
    resultKind,
    toolCallId,
    toolName,
    title: textValue(metadata.title) ?? toolName,
    createdAt: textValue(metadata.created_at) ?? message.createdAt,
    htmlContent: userVisibleToolResultHtmlContent(uiPreview, resultPreview),
    generatedImages: parseGeneratedImageResources(uiPreview),
    generatedImageResultText: resultTextValue(resultPreview),
    imageRequestPrompt: imageRequest?.prompt ?? null,
    imageRequestResources: imageRequest?.resources ?? [],
  }
}
