import { requestJson } from "@/shared/api/httpClient"
import { SseClient } from "@/shared/api/sseClient"
import { appendRuntimeAccessToken } from "@/shared/api/runtimeAccess"

export type UserMessageAttachment = {
  kind: "image" | "pdf"
  resourceId: string
  objectStorageUrl?: string | null
  localStoragePath?: string | null
  name?: string | null
  mimeType?: string | null
  sizeInBytes?: number | null
  width?: number | null
  height?: number | null
  pageCount?: number | null
}

export type FileResourceDto = {
  resource_id: string
  name?: string | null
  mime_type: string
  size_in_bytes: number
  object_storage_url: string
  local_storage_path: string
  width?: number | null
  height?: number | null
  page_count?: number | null
  metadata?: Record<string, unknown>
}

export type CreateFileResourceItem = {
  name?: string | null
  mime_type: string
  base64_content: string
}

export type CreateFileResourcesResponse = {
  resources: FileResourceDto[]
}

export type FileResourceUploadTaskResponse = {
  task_id: string
  status: string
  phase: string
  message: string
  progress_percent: number
  resources?: FileResourceDto[] | null
  error_message?: string | null
  latest_seq: number
  events_url: string
}

export type FileResourceUploadTaskEvent = {
  task_id: string
  seq: number
  status: string
  phase: string
  message: string
  progress_percent: number
  uploaded_bytes?: number | null
  total_bytes?: number | null
  resources?: FileResourceDto[] | null
  error_message?: string | null
  created_at: string
}

export function createFileResources(resources: CreateFileResourceItem[]) {
  return requestJson<CreateFileResourcesResponse>("/api/file-resources", {
    method: "POST",
    body: { resources },
    timeoutMs: 5 * 60 * 1000,
  })
}

export function createFileResourceUploadTask(resources: CreateFileResourceItem[]) {
  return requestJson<FileResourceUploadTaskResponse>("/api/file-resources/upload-tasks", {
    method: "POST",
    body: { resources },
    timeoutMs: 0,
  })
}

export function getFileResourceUploadTask(taskId: string) {
  return requestJson<FileResourceUploadTaskResponse>(`/api/file-resources/upload-tasks/${encodeURIComponent(taskId)}`)
}

export function cancelFileResourceUploadTask(taskId: string) {
  return requestJson<FileResourceUploadTaskResponse>(`/api/file-resources/upload-tasks/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  })
}

export function subscribeFileResourceUploadTaskEvents(
  eventsUrl: string,
  onEvent: (event: FileResourceUploadTaskEvent) => void,
  onError: () => void,
): () => void {
  let latestSeq = 0
  const client = new SseClient<FileResourceUploadTaskEvent>({
    buildUrl: () => appendUploadTaskEventsCursor(eventsUrl, latestSeq),
    eventTypes: ["file_resource_upload_task"],
    onEvent: (event) => {
      latestSeq = Math.max(latestSeq, event.seq)
      onEvent(event)
    },
    onError: () => {
      onError()
    },
  })
  client.connect()
  return () => client.close()
}

export function fileResourceContentUrl(resourceId: string): string {
  return appendRuntimeAccessToken(`/api/file-resources/${encodeURIComponent(resourceId)}/content`)
}

export function localImageFileContentUrl(filePath: string): string {
  return appendRuntimeAccessToken(`/api/file-resources/local-image/content?path=${encodeURIComponent(filePath)}`)
}

function appendUploadTaskEventsCursor(eventsUrl: string, latestSeq: number): string {
  if (!latestSeq || latestSeq <= 0) return eventsUrl
  const separator = eventsUrl.includes("?") ? "&" : "?"
  return `${eventsUrl}${separator}after_seq=${latestSeq}`
}

export function getFileResource(resourceId: string) {
  return requestJson<FileResourceDto>(`/api/file-resources/${encodeURIComponent(resourceId)}`)
}

export function fileResourceToAttachment(resource: FileResourceDto, fallbackName?: string | null): UserMessageAttachment {
  const category = typeof resource.metadata?.resource_category === "string" ? resource.metadata.resource_category : undefined
  return {
    kind: category === "pdf" || resource.mime_type === "application/pdf" ? "pdf" : "image",
    resourceId: resource.resource_id,
    objectStorageUrl: resource.object_storage_url,
    localStoragePath: resource.local_storage_path,
    name: resource.name ?? fallbackName ?? null,
    mimeType: resource.mime_type,
    sizeInBytes: resource.size_in_bytes,
    width: resource.width ?? null,
    height: resource.height ?? null,
    pageCount: resource.page_count ?? null,
  }
}

export function attachmentToRequest(attachment: UserMessageAttachment) {
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
