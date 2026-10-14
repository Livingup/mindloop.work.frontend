import { CircleStop, FileText, ImageIcon, Loader2, Paperclip, Send, X, XCircle } from "lucide-react"
import { memo, useCallback, useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type DragEvent, type KeyboardEvent, type MutableRefObject } from "react"

import { getAgentInstanceFileInputState, type FileInputLimits, type FileInputStats } from "@/features/chat/api/agentRuntimeApi"
import {
  cancelFileResourceUploadTask,
  createFileResourceUploadTask,
  fileResourceContentUrl,
  fileResourceToAttachment,
  getFileResourceUploadTask,
  subscribeFileResourceUploadTaskEvents,
  type FileResourceUploadTaskEvent,
  type FileResourceUploadTaskResponse,
  type UserMessageAttachment,
} from "@/features/chat/api/fileResourceApi"
import { CopyablePreviewImage } from "@/features/chat/components/CopyablePreviewImage"
import { ResourceLocatorPanel, useResourceLocatorDetails } from "@/features/chat/components/ResourceLocatorPanel"
import { useChatStore } from "@/features/chat/model/chatStore"
import { createClientId } from "@/shared/utils/clientId"

const SUPPORTED_ATTACHMENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"])
const FILE_URI_FALLBACK_NOTICE = "获取不到文本 URI，已插入文件名。"

type ComposerAttachment = UserMessageAttachment & {
  localId: string
  status: "uploading" | "cancelling" | "ready" | "failed" | "cancelled"
  previewUrl?: string
  errorMessage?: string
  uploadTaskId?: string
  uploadMessage?: string
  uploadProgressPercent?: number
}

type CandidateFileInput = {
  kind: "image" | "pdf"
  name: string
  sizeInBytes: number
  pageCount: number | null
}

type ImagePreview = { title: string; url: string; resourceId?: string | null; preferredMimeType?: string | null }

type SpreadDesktopFileBridge = {
  getFileUri?: (file: File) => string | null | Promise<string | null>
}

export const Composer = memo(function Composer({
  sceneId,
  agentInstanceId,
  disabled,
  placeholder = "输入消息，或使用 / 触发指令",
  isRunning = false,
  isInterrupting = false,
  isCompletingTask = false,
  textAreaElementRef,
  presentation = "desktop",
  onInterrupt,
  onCompleteTask,
  onSubmit,
  onDebug,
  onDiagnostic,
}: {
  sceneId: string
  agentInstanceId?: string | null
  disabled?: boolean
  placeholder?: string
  isRunning?: boolean
  isInterrupting?: boolean
  isCompletingTask?: boolean
  textAreaElementRef?: MutableRefObject<HTMLTextAreaElement | null>
  presentation?: "desktop" | "mobile"
  onInterrupt?: () => void
  onCompleteTask?: () => void
  onSubmit: (message: string, attachments?: UserMessageAttachment[]) => void
  onDebug?: (label: string, payload?: unknown) => void
  onDiagnostic?: (message: string) => void
}) {
  const composerScopeId = agentInstanceId ?? sceneId
  const value = useChatStore((state) => {
    const slice = state.scenes[sceneId]
    if (!slice) return ""
    if (!agentInstanceId) return slice.composerDraft
    return slice.composerDraftsByAgentInstanceId?.[agentInstanceId] ?? ""
  })
  const setComposerDraft = useChatStore((state) => state.setComposerDraft)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const setTextAreaElement = useCallback((element: HTMLTextAreaElement | null) => {
    textAreaRef.current = element
    if (textAreaElementRef) textAreaElementRef.current = element
  }, [textAreaElementRef])
  const noticeTimerByScopeIdRef = useRef<Map<string, number>>(new Map())
  const [attachmentsByScopeId, setAttachmentsByScopeId] = useState<Record<string, ComposerAttachment[]>>({})
  const attachmentsByScopeIdRef = useRef<Record<string, ComposerAttachment[]>>({})
  const attachmentsRef = useRef<ComposerAttachment[]>([])
  const fileValidationChainRef = useRef<Promise<void>>(Promise.resolve())
  const [noticeByScopeId, setNoticeByScopeId] = useState<Record<string, string | null>>({})
  const [imagePreviewByScopeId, setImagePreviewByScopeId] = useState<Record<string, ImagePreview | null>>({})
  const uploadCleanupByLocalIdRef = useRef<Map<string, () => void>>(new Map())
  const locallyCancelledUploadIdsRef = useRef<Set<string>>(new Set())
  const attachments = attachmentsByScopeId[composerScopeId] ?? []
  const notice = noticeByScopeId[composerScopeId] ?? null
  const imagePreview = imagePreviewByScopeId[composerScopeId] ?? null
  const imagePreviewLocatorDetails = useResourceLocatorDetails(imagePreview?.resourceId)
  const isUploading = attachments.some((attachment) => attachment.status === "uploading" || attachment.status === "cancelling")
  const readyAttachments = attachments.filter((attachment) => attachment.status === "ready")
  const trimmedValue = value.trim()
  const sendDisabledReason = disabled
    ? "上一条消息仍在发送，请稍候。"
    : isUploading
      ? "附件仍在上传，请等上传完成后再发送。"
      : !trimmedValue && readyAttachments.length === 0
        ? "请输入消息，或先选择图片 / PDF 附件。"
        : null
  const sendDisabled = Boolean(sendDisabledReason)
  const isMobilePresentation = presentation === "mobile"

  const readCurrentDraft = () => {
    const slice = useChatStore.getState().scenes[sceneId]
    if (!slice) return ""
    if (!agentInstanceId) return slice.composerDraft
    return slice.composerDraftsByAgentInstanceId?.[agentInstanceId] ?? ""
  }

  const updateComposerDraft = (nextValue: string, source: "input" | "change") => {
    if (readCurrentDraft() === nextValue) return
    setComposerDraft(sceneId, nextValue, agentInstanceId)
    onDebug?.("composer.draft.change", {
      sceneId,
      agentInstanceId: agentInstanceId ?? null,
      composerScopeId,
      presentation,
      source,
      draftLength: nextValue.trim().length,
    })
  }

  const applyAttachments = (updater: (current: ComposerAttachment[]) => ComposerAttachment[]) => {
    const scopeId = composerScopeId
    setAttachmentsByScopeId((currentByScope) => {
      const next = updater(currentByScope[scopeId] ?? [])
      const nextByScope = { ...currentByScope, [scopeId]: next }
      attachmentsByScopeIdRef.current = nextByScope
      attachmentsRef.current = next
      return nextByScope
    })
  }

  useEffect(() => {
    attachmentsRef.current = attachments
  }, [attachments])

  useEffect(() => {
    return () => {
      for (const timerId of noticeTimerByScopeIdRef.current.values()) {
        window.clearTimeout(timerId)
      }
      noticeTimerByScopeIdRef.current.clear()
      for (const scopedAttachments of Object.values(attachmentsByScopeIdRef.current)) {
        for (const attachment of scopedAttachments) {
          if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
        }
      }
      for (const cleanup of uploadCleanupByLocalIdRef.current.values()) {
        cleanup()
      }
      uploadCleanupByLocalIdRef.current.clear()
    }
  }, [])

  useEffect(() => {
    onDebug?.("composer.state", {
      sceneId,
      agentInstanceId: agentInstanceId ?? null,
      composerScopeId,
      presentation,
      draftLength: trimmedValue.length,
      attachmentCount: attachments.length,
      readyAttachmentCount: readyAttachments.length,
      isUploading,
      disabled: Boolean(disabled),
      sendDisabled,
      sendDisabledReason,
    })
  }, [agentInstanceId, attachments.length, composerScopeId, disabled, isUploading, onDebug, presentation, readyAttachments.length, sceneId, sendDisabled, sendDisabledReason, trimmedValue.length])

  const submit = (source: "button" | "keyboard" = "button") => {
    const text = value.trim()
    const debugPayload = {
      sceneId,
      agentInstanceId: agentInstanceId ?? null,
      composerScopeId,
      source,
      presentation,
      draftLength: text.length,
      attachmentCount: attachments.length,
      readyAttachmentCount: readyAttachments.length,
      isUploading,
      disabled: Boolean(disabled),
      sendDisabled,
      sendDisabledReason,
    }
    onDebug?.("composer.submit.attempt", debugPayload)
    if (sendDisabledReason) {
      showNotice(sendDisabledReason)
      onDiagnostic?.(sendDisabledReason)
      onDebug?.("composer.submit.blocked", { ...debugPayload, reason: sendDisabledReason })
      return
    }
    onSubmit(text, readyAttachments)
    onDebug?.("composer.submit.dispatched", debugPayload)
    setComposerDraft(sceneId, "", agentInstanceId)
    clearAttachments()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      event.currentTarget.blur()
      return
    }
    if (event.nativeEvent.isComposing || event.keyCode === 229) return
    if (event.key !== "Enter") return
    if (event.shiftKey) return
    event.preventDefault()
    submit("keyboard")
  }

  const showNotice = (message: string) => {
    const scopeId = composerScopeId
    setNoticeByScopeId((current) => ({ ...current, [scopeId]: message }))
    const existingTimerId = noticeTimerByScopeIdRef.current.get(scopeId)
    if (existingTimerId !== undefined) window.clearTimeout(existingTimerId)
    const timerId = window.setTimeout(() => {
      setNoticeByScopeId((current) => ({ ...current, [scopeId]: null }))
      noticeTimerByScopeIdRef.current.delete(scopeId)
    }, 2600)
    noticeTimerByScopeIdRef.current.set(scopeId, timerId)
  }

  const insertTextAtCursor = (text: string) => {
    const selectionStart = textAreaRef.current?.selectionStart ?? value.length
    const selectionEnd = textAreaRef.current?.selectionEnd ?? value.length
    const result = insertTextBlockAtRange(value, text, selectionStart, selectionEnd)
    setComposerDraft(sceneId, result.text, agentInstanceId)
    window.requestAnimationFrame(() => {
      textAreaRef.current?.focus()
      textAreaRef.current?.setSelectionRange(result.cursorPosition, result.cursorPosition)
    })
  }

  const insertFileReferenceText = async (files: File[]) => {
    const scopedAgentInstanceId = agentInstanceId ?? null
    const initialDraft = value
    const selectionStart = textAreaRef.current?.selectionStart ?? initialDraft.length
    const selectionEnd = textAreaRef.current?.selectionEnd ?? initialDraft.length
    const references = await Promise.all(files.map(fileToTextReference))
    const insertedText = references.map((reference) => reference.text).join("\n")
    const latestSlice = useChatStore.getState().scenes[sceneId]
    const latestDraft = scopedAgentInstanceId
      ? latestSlice?.composerDraftsByAgentInstanceId?.[scopedAgentInstanceId] ?? ""
      : latestSlice?.composerDraft ?? ""
    const useOriginalSelection = latestDraft === initialDraft
    const result = insertTextBlockAtRange(
      latestDraft,
      insertedText,
      useOriginalSelection ? selectionStart : latestDraft.length,
      useOriginalSelection ? selectionEnd : latestDraft.length,
    )
    setComposerDraft(sceneId, result.text, scopedAgentInstanceId)
    if (references.some((reference) => !reference.uri)) {
      showNotice(FILE_URI_FALLBACK_NOTICE)
    }
    window.requestAnimationFrame(() => {
      textAreaRef.current?.focus()
      if ((agentInstanceId ?? null) === scopedAgentInstanceId) {
        textAreaRef.current?.setSelectionRange(result.cursorPosition, result.cursorPosition)
      }
    })
  }

  const handleFiles = (files: FileList | File[]) => {
    const candidates = Array.from(files)
    onDebug?.("composer.files.received", {
      sceneId,
      agentInstanceId: agentInstanceId ?? null,
      composerScopeId,
      presentation,
      fileCount: candidates.length,
      fileNames: candidates.map((file) => file.name),
    })
    if (isMobilePresentation) {
      onDiagnostic?.(candidates.length > 0 ? `已选择 ${candidates.length} 个文件，正在校验…` : "没有读取到已选择的文件。")
    }
    const supported = candidates.filter(isSupportedAttachmentFile)
    const fileReferenceCandidates = candidates.filter((file) => !isSupportedAttachmentFile(file))
    if (fileReferenceCandidates.length > 0) {
      void insertFileReferenceText(fileReferenceCandidates)
    }
    if (supported.length === 0) {
      onDebug?.("composer.files.unsupported", {
        sceneId,
        agentInstanceId: agentInstanceId ?? null,
        composerScopeId,
        presentation,
        fileCount: candidates.length,
      })
      if (isMobilePresentation && candidates.length > 0) {
        onDiagnostic?.("所选文件会作为路径文本插入，图片 / PDF 才会上传预览。")
      }
      return
    }
    if (isMobilePresentation) {
      onDiagnostic?.(`开始上传 ${supported.length} 个附件…`)
    }
    fileValidationChainRef.current = fileValidationChainRef.current.then(
      () => validateAndUploadFiles(supported),
      () => validateAndUploadFiles(supported),
    )
    void fileValidationChainRef.current
  }

  const validateAndUploadFiles = async (files: File[]) => {
    if (!agentInstanceId) {
      showNotice("当前 Agent 实例未就绪，无法上传文件。")
      return
    }
    try {
      const inputState = await getAgentInstanceFileInputState(agentInstanceId)
      const candidates = files.map(toCandidateFileInput)
      const composerStats = statsFromAttachments(attachmentsRef.current)
      const candidateStats = statsFromCandidates(candidates)
      const predictedStats = mergeFileInputStats(
        inputState.next_request_file_stats,
        composerStats,
        candidateStats,
      )
      const rejection = validatePredictedFileInput(
        inputState.limits,
        predictedStats,
        candidates,
      )
      if (rejection) {
        showNotice(rejection)
        return
      }
      void uploadFiles(files, candidates)
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "文件限制检测失败，已取消上传。")
    }
  }

  const uploadFiles = async (files: File[], candidates: CandidateFileInput[]) => {
    const drafts: ComposerAttachment[] = files.map((file, index) => ({
      localId: createClientId("local"),
      status: "uploading",
      kind: file.type === "application/pdf" ? "pdf" : "image",
      resourceId: "",
      name: file.name,
      mimeType: file.type,
      sizeInBytes: file.size,
      pageCount: candidates[index]?.pageCount ?? null,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      uploadMessage: "读取文件中…",
      uploadProgressPercent: 0,
    }))
    applyAttachments((current) => [...current, ...drafts])
    files.forEach((file, index) => {
      void uploadSingleFile(file, drafts[index])
    })
  }

  const uploadSingleFile = async (file: File, draft: ComposerAttachment) => {
    try {
      const base64Content = await fileToBase64Content(file)
      if (locallyCancelledUploadIdsRef.current.delete(draft.localId)) return
      const task = await createFileResourceUploadTask([{
        name: file.name,
        mime_type: file.type,
        base64_content: base64Content,
      }])
      if (locallyCancelledUploadIdsRef.current.delete(draft.localId)) {
        void cancelFileResourceUploadTask(task.task_id)
        return
      }
      applyAttachments((current) => current.map((attachment) =>
        attachment.localId === draft.localId
          ? {
              ...attachment,
              uploadTaskId: task.task_id,
              uploadMessage: task.message,
              uploadProgressPercent: task.progress_percent,
            }
          : attachment,
      ))
      const cleanup = subscribeFileResourceUploadTaskEvents(
        task.events_url,
        (event) => applyUploadTaskEvent([draft], event),
        () => {
          void recoverUploadTaskFromSnapshot(task.task_id, [draft])
        },
      )
      uploadCleanupByLocalIdRef.current.set(draft.localId, cleanup)
    } catch (error) {
      if (locallyCancelledUploadIdsRef.current.delete(draft.localId)) return
      const errorMessage = error instanceof Error ? error.message : "上传失败"
      applyAttachments((current) => current.map((attachment) =>
        attachment.localId === draft.localId
          ? { ...attachment, status: "failed", errorMessage }
          : attachment,
      ))
    }
  }

  const recoverUploadTaskFromSnapshot = async (taskId: string, drafts: ComposerAttachment[]) => {
    try {
      const snapshot = await getFileResourceUploadTask(taskId)
      applyUploadTaskEvent(drafts, uploadTaskSnapshotToEvent(snapshot))
    } catch {
      applyAttachments((current) => current.map((attachment) => {
        const draftIndex = drafts.findIndex((draft) => draft.localId === attachment.localId)
        if (draftIndex < 0 || attachment.status !== "uploading") return attachment
        return {
          ...attachment,
          errorMessage: undefined,
          uploadMessage: "上传进度连接恢复中…",
        }
      }))
    }
  }

  const applyUploadTaskEvent = (drafts: ComposerAttachment[], event: FileResourceUploadTaskEvent) => {
    if (event.status === "completed") {
      for (const draft of drafts) cleanupUploadSubscription(draft.localId)
    }
    if (event.status === "failed" || event.status === "cancelled") {
      for (const draft of drafts) cleanupUploadSubscription(draft.localId)
    }
    applyAttachments((current) => current.map((attachment) => {
      const draftIndex = drafts.findIndex((draft) => draft.localId === attachment.localId)
      if (draftIndex < 0) return attachment
      if (event.status === "completed") {
        const resource = event.resources?.[draftIndex]
        if (!resource) return { ...attachment, status: "failed", errorMessage: "上传响应缺少资源信息。" }
        return {
          ...attachment,
          ...fileResourceToAttachment(resource, attachment.name),
          localId: attachment.localId,
          status: "ready",
          previewUrl: attachment.previewUrl,
          uploadMessage: event.message,
          uploadProgressPercent: 100,
        }
      }
      if (event.status === "failed") {
        return {
          ...attachment,
          status: "failed",
          errorMessage: event.error_message ?? event.message ?? "上传失败",
          uploadMessage: event.error_message ?? event.message ?? "上传失败",
          uploadProgressPercent: event.progress_percent,
        }
      }
      if (event.status === "cancelled") {
        return {
          ...attachment,
          status: "cancelled",
          errorMessage: "已取消上传",
          uploadMessage: "已取消上传",
          uploadProgressPercent: event.progress_percent,
        }
      }
      return {
        ...attachment,
        status: event.status === "cancelling" ? "cancelling" : "uploading",
        uploadMessage: event.message,
        uploadProgressPercent: event.progress_percent,
      }
    }))
  }

  const uploadTaskSnapshotToEvent = (snapshot: FileResourceUploadTaskResponse): FileResourceUploadTaskEvent => ({
    task_id: snapshot.task_id,
    seq: snapshot.latest_seq,
    status: snapshot.status,
    phase: snapshot.phase,
    message: snapshot.message,
    progress_percent: snapshot.progress_percent,
    resources: snapshot.resources,
    error_message: snapshot.error_message,
    created_at: new Date().toISOString(),
  })

  const removeAttachment = (localId: string) => {
    const target = attachments.find((attachment) => attachment.localId === localId)
    if ((target?.status === "uploading" || target?.status === "cancelling") && !target.uploadTaskId) {
      locallyCancelledUploadIdsRef.current.add(localId)
      applyAttachments((current) => {
        const removed = current.find((attachment) => attachment.localId === localId)
        if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
        cleanupUploadSubscription(localId)
        return current.filter((attachment) => attachment.localId !== localId)
      })
      return
    }
    if ((target?.status === "uploading" || target?.status === "cancelling") && target.uploadTaskId) {
      applyAttachments((current) => current.map((attachment) =>
        attachment.localId === localId
          ? { ...attachment, status: "cancelling", uploadMessage: "正在取消上传…" }
          : attachment,
      ))
      void cancelFileResourceUploadTask(target.uploadTaskId).catch((error) => {
        const errorMessage = error instanceof Error ? error.message : "取消上传失败"
        applyAttachments((current) => current.map((attachment) =>
          attachment.localId === localId
            ? { ...attachment, status: "failed", errorMessage, uploadMessage: errorMessage }
            : attachment,
        ))
      })
      return
    }
    applyAttachments((current) => {
      const removed = current.find((attachment) => attachment.localId === localId)
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
      cleanupUploadSubscription(localId)
      return current.filter((attachment) => attachment.localId !== localId)
    })
  }

  const cleanupUploadSubscription = (localId: string) => {
    const cleanup = uploadCleanupByLocalIdRef.current.get(localId)
    cleanup?.()
    uploadCleanupByLocalIdRef.current.delete(localId)
  }

  const openAttachment = (attachment: ComposerAttachment) => {
    if (attachment.status === "failed") return
    const title = attachment.name ?? (attachment.kind === "pdf" ? "PDF 文件" : "图片")
    if (attachment.kind === "pdf") {
      if (attachment.status !== "ready" || !attachment.resourceId) return
      openPdfResource(attachment.resourceId, title)
      return
    }
    const url = attachment.previewUrl ?? (attachment.resourceId ? fileResourceContentUrl(attachment.resourceId) : null)
    if (!url) return
    setImagePreviewByScopeId((current) => ({
      ...current,
      [composerScopeId]: { title, url, resourceId: attachment.resourceId || null, preferredMimeType: attachment.mimeType },
    }))
  }

  const clearAttachments = () => {
    applyAttachments((current) => {
      for (const attachment of current) {
        if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
        cleanupUploadSubscription(attachment.localId)
      }
      return []
    })
  }

  const openMobileFilePicker = (inputKind: "image" | "file", input: HTMLInputElement | null) => {
    onDebug?.("composer.mobile_picker.button", {
      sceneId,
      agentInstanceId: agentInstanceId ?? null,
      composerScopeId,
      presentation,
      inputKind,
      disabled: Boolean(disabled),
      hasInput: Boolean(input),
    })
    if (!input) {
      onDiagnostic?.(`${inputKind === "image" ? "图片" : "文件"}选择器未挂载。`)
      return
    }
    try {
      input.click()
      onDebug?.("composer.mobile_picker.click_called", {
        sceneId,
        agentInstanceId: agentInstanceId ?? null,
        composerScopeId,
        presentation,
        inputKind,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      onDebug?.("composer.mobile_picker.click_error", {
        sceneId,
        agentInstanceId: agentInstanceId ?? null,
        composerScopeId,
        presentation,
        inputKind,
        message,
      })
      onDiagnostic?.(`打开${inputKind === "image" ? "图片" : "文件"}选择器失败：${message}`)
    }
  }

  const logFileInputEvent = (eventName: string, inputKind: "image" | "file", input: HTMLInputElement) => {
    onDebug?.(`composer.file_input.${eventName}`, {
      sceneId,
      agentInstanceId: agentInstanceId ?? null,
      composerScopeId,
      presentation,
      inputKind,
      fileCount: input.files?.length ?? 0,
      hasValue: Boolean(input.value),
    })
  }

  const handleFileInputChange = (event: ChangeEvent<HTMLInputElement>, inputKind: "image" | "file" = "file") => {
    const files = event.target.files
    onDebug?.("composer.file_input.change", {
      sceneId,
      agentInstanceId: agentInstanceId ?? null,
      composerScopeId,
      presentation,
      inputKind,
      fileCount: files?.length ?? 0,
      hasValue: Boolean(event.target.value),
    })
    if (isMobilePresentation) {
      onDiagnostic?.(files && files.length > 0 ? `选择器返回 ${files.length} 个文件。` : "选择器没有返回文件。")
    }
    if (files) handleFiles(files)
    event.target.value = ""
  }

  const handlePaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    handleFiles(files)
  }

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files)
    const droppedText = extractDroppedText(event.dataTransfer)
    if (files.length === 0 && !droppedText) return
    event.preventDefault()
    if (files.length > 0) {
      handleFiles(files)
      return
    }
    if (droppedText) insertTextAtCursor(droppedText)
  }

  return (
    <>
      <div className={isMobilePresentation ? "shrink-0 border-t border-slate-200/80 bg-white px-3 pb-2 pt-2" : "shrink-0 border-t border-slate-200/80 bg-white/[0.36] px-3 pb-2 pt-4 backdrop-blur"}>
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDrop}
        className={isMobilePresentation ? "rounded-xl border border-slate-200 bg-white p-2 shadow-[0_4px_16px_rgba(15,23,42,0.06)]" : "rounded-2xl border border-slate-200/90 bg-white/[0.92] p-3 shadow-[0_16px_44px_rgba(15,23,42,0.12)]"}
      >
        {notice ? (
          <div className="mb-2 rounded-xl border border-amber-200/80 bg-amber-50/80 px-3 py-2 text-xs text-amber-900 shadow-sm">
            {notice}
          </div>
        ) : null}
        {attachments.length > 0 ? (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((attachment) => (
              <AttachmentPreviewCard
                key={attachment.localId}
                attachment={attachment}
                onOpen={() => openAttachment(attachment)}
                onRemove={() => removeAttachment(attachment.localId)}
              />
            ))}
          </div>
        ) : null}
        <textarea
          ref={setTextAreaElement}
          value={value}
          onInput={(event) => updateComposerDraft(event.currentTarget.value, "input")}
          onChange={(event) => updateComposerDraft(event.currentTarget.value, "change")}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          disabled={disabled}
          className={isMobilePresentation ? "h-12 w-full resize-none bg-transparent px-1 text-[15px] leading-6 text-slate-900 outline-none placeholder:text-slate-400" : "h-20 w-full resize-none bg-transparent px-1 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400"}
          placeholder={placeholder}
        />
        <div className={isMobilePresentation ? "mt-1.5 flex items-center justify-between gap-2" : "mt-2 flex items-center justify-between gap-3"}>
          <div className={isMobilePresentation ? "flex min-w-0 flex-wrap items-center gap-2 text-slate-600" : "flex items-center gap-2 text-slate-500"}>
            {isMobilePresentation ? (
              <>
                <button
                  type="button"
                  onClick={() => openMobileFilePicker("file", fileInputRef.current)}
                  disabled={disabled}
                  className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="选择图片或 PDF 附件"
                >
                  <Paperclip size={15} />
                  <span>附件</span>
                  <span className="text-[10px] font-normal text-slate-500">图片/PDF</span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  className="hidden"
                  onClick={(event) => logFileInputEvent("click", "file", event.currentTarget)}
                  onInput={(event) => logFileInputEvent("input", "file", event.currentTarget)}
                  onChange={(event) => handleFileInputChange(event, "file")}
                />
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={disabled}
                  className="rounded-lg p-1.5 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Paperclip size={16} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  multiple
                  className="hidden"
                  onChange={handleFileInputChange}
                />
              </>
            )}
            {onCompleteTask ? (
              <button
                type="button"
                onClick={onCompleteTask}
                disabled={isCompletingTask}
                title="结束任务会话"
                aria-label="结束任务会话"
                className={isMobilePresentation
                  ? "inline-flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                  : "rounded-lg p-1.5 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
                }
              >
                {isCompletingTask ? <Loader2 size={15} className="animate-spin" /> : <CircleStop size={15} />}
              </button>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {isRunning && onInterrupt ? (
              <button
                type="button"
                onClick={onInterrupt}
                disabled={isInterrupting}
                title="中断当前 Agent 运行"
                aria-label={isInterrupting ? "正在中断当前 Agent 运行" : "中断当前 Agent 运行"}
                className="group relative inline-flex size-8 shrink-0 items-center justify-center disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="absolute size-7 animate-pulse rounded-full bg-emerald-400/20 blur-sm transition group-hover:bg-red-400/25" />
                <span className="absolute size-5 animate-ping rounded-full border border-emerald-400/60 transition group-hover:border-red-400/60" />
                <span className="absolute size-5 rounded-full border border-emerald-500/70 shadow-[0_0_16px_rgba(16,185,129,0.6)] transition group-hover:border-red-500/70 group-hover:shadow-[0_0_16px_rgba(239,68,68,0.6)]" />
                <span className="relative size-2.5 rounded-[2px] bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.85)] transition group-hover:bg-red-500 group-hover:shadow-[0_0_10px_rgba(239,68,68,0.85)]" />
              </button>
            ) : null}
            <button
              type="button"
              onPointerDown={() => onDebug?.("composer.send.pointer_down", {
                sceneId,
                agentInstanceId: agentInstanceId ?? null,
                composerScopeId,
                presentation,
                draftLength: trimmedValue.length,
                readyAttachmentCount: readyAttachments.length,
                sendDisabled,
                sendDisabledReason,
              })}
              onPointerUp={(event) => {
                if (!isMobilePresentation) return
                event.preventDefault()
                onDebug?.("composer.send.pointer_up", {
                  sceneId,
                  agentInstanceId: agentInstanceId ?? null,
                  composerScopeId,
                  presentation,
                  draftLength: trimmedValue.length,
                  readyAttachmentCount: readyAttachments.length,
                  sendDisabled,
                  sendDisabledReason,
                })
                submit("button")
              }}
              onClick={(event) => {
                if (isMobilePresentation) {
                  event.preventDefault()
                  return
                }
                submit("button")
              }}
              aria-disabled={sendDisabled}
              title={sendDisabledReason ?? "发送消息"}
              className={[
                "inline-flex items-center gap-2 px-4 font-medium transition",
                isMobilePresentation ? "h-10 rounded-lg text-sm" : "rounded-xl py-2 text-xs",
                sendDisabled
                  ? "cursor-not-allowed bg-slate-300 text-white shadow-none"
                  : "bg-app-accent text-white shadow-[0_10px_22px_rgba(38,58,99,0.18)] hover:bg-app-accent-hover",
              ].join(" ")}
            >
              {isUploading ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              发送
            </button>
          </div>
        </div>
      </div>
      </div>
      {imagePreview ? (
        <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-slate-950/80 p-3 sm:items-center sm:p-6" onClick={() => setImagePreviewByScopeId((current) => ({ ...current, [composerScopeId]: null }))}>
          <div className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100vh-3rem)]" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0 truncate text-sm font-medium text-slate-900">{imagePreview.title}</div>
              <button type="button" onClick={() => setImagePreviewByScopeId((current) => ({ ...current, [composerScopeId]: null }))} className="inline-flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-slate-100">
              <div className="p-3 sm:p-4">
                <CopyablePreviewImage
                  src={imagePreview.url}
                  alt={imagePreview.title}
                  preferredMimeType={imagePreview.preferredMimeType}
                  className="mx-auto max-h-[52dvh] max-w-full rounded-lg object-contain sm:max-h-[calc(100vh-12rem)]"
                />
              </div>
              <ResourceLocatorPanel details={imagePreviewLocatorDetails} tone="light" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
})

function AttachmentPreviewCard({
  attachment,
  onOpen,
  onRemove,
}: {
  attachment: ComposerAttachment
  onOpen: () => void
  onRemove: () => void
}) {
  const failed = attachment.status === "failed"
  const cancelled = attachment.status === "cancelled"
  const active = attachment.status === "uploading" || attachment.status === "cancelling"
  const progress = Math.max(0, Math.min(100, attachment.uploadProgressPercent ?? 0))
  const canOpen = !failed && !cancelled && (attachment.kind === "image" ? Boolean(attachment.previewUrl || attachment.resourceId) : attachment.status === "ready" && Boolean(attachment.resourceId))
  return (
    <div
      role={canOpen ? "button" : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? onOpen : undefined}
      onKeyDown={(event) => {
        if (!canOpen || (event.key !== "Enter" && event.key !== " ")) return
        event.preventDefault()
        onOpen()
      }}
      className={`relative flex max-w-[220px] items-center gap-2 rounded-xl border px-2.5 py-2 text-xs ${
      failed || cancelled ? "border-red-200 bg-red-50 text-red-900" : "border-slate-200 bg-slate-50 text-slate-800"
    } ${canOpen ? "cursor-pointer transition hover:border-slate-300 hover:bg-slate-100" : ""}`}
    >
      {attachment.kind === "image" && attachment.previewUrl ? (
        <img src={attachment.previewUrl} alt={attachment.name ?? "图片"} className="size-10 rounded-lg object-cover" />
      ) : (
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-white text-slate-500">
          {attachment.kind === "pdf" ? <FileText size={18} /> : <ImageIcon size={18} />}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{attachment.name ?? (attachment.kind === "pdf" ? "PDF 文件" : "图片")}</div>
        <div className={failed || cancelled ? "truncate text-red-700" : "truncate text-slate-500"}>
          {active
            ? `${attachment.uploadMessage ?? "上传中…"} ${progress}%`
            : failed
              ? attachment.errorMessage ?? "上传失败"
              : cancelled
                ? "已取消上传"
                : formatAttachmentMeta(attachment)}
        </div>
        {active ? (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200">
            <div className="h-full rounded-full bg-[#4f6f96] transition-all" style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>
      {active ? <Loader2 size={14} className="shrink-0 animate-spin text-slate-500" /> : null}
      {failed || cancelled ? <XCircle size={14} className="shrink-0 text-red-600" /> : null}
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation()
          onRemove()
        }}
        className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-900"
      >
        <X size={13} />
      </button>
    </div>
  )
}

function formatAttachmentMeta(attachment: UserMessageAttachment): string {
  if (attachment.kind === "pdf" && attachment.pageCount) return `${attachment.pageCount} 页 · ${formatBytes(attachment.sizeInBytes)}`
  if (attachment.kind === "image" && attachment.width && attachment.height) return `${attachment.width}×${attachment.height} · ${formatBytes(attachment.sizeInBytes)}`
  return formatBytes(attachment.sizeInBytes)
}

function formatBytes(value?: number | null): string {
  if (!value || value <= 0) return "已上传"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function toCandidateFileInput(file: File): CandidateFileInput {
  return {
    kind: file.type === "application/pdf" ? "pdf" : "image",
    name: file.name,
    sizeInBytes: file.size,
    pageCount: null,
  }
}

function statsFromAttachments(attachments: ComposerAttachment[]): FileInputStats {
  const stats = emptyFileInputStats()
  for (const attachment of attachments) {
    if (attachment.status === "failed" || attachment.status === "cancelled") continue
    addFileInputStats(stats, attachment.kind, attachment.sizeInBytes ?? 0, attachment.pageCount ?? 0)
  }
  return stats
}

function statsFromCandidates(candidates: CandidateFileInput[]): FileInputStats {
  const stats = emptyFileInputStats()
  for (const candidate of candidates) {
    addFileInputStats(stats, candidate.kind, candidate.sizeInBytes, candidate.pageCount ?? 0)
  }
  return stats
}

function emptyFileInputStats(): FileInputStats {
  return {
    file_count: 0,
    total_file_bytes: 0,
    pdf_file_count: 0,
    image_file_count: 0,
    total_pdf_pages: 0,
    total_image_bytes: 0,
    total_input_file_bytes: 0,
  }
}

function addFileInputStats(
  stats: FileInputStats,
  kind: "image" | "pdf",
  sizeInBytes: number,
  pageCount: number,
) {
  const safeSize = Math.max(0, sizeInBytes)
  stats.file_count += 1
  stats.total_file_bytes += safeSize
  if (kind === "pdf") {
    stats.pdf_file_count += 1
    stats.total_pdf_pages += Math.max(0, pageCount)
    stats.total_input_file_bytes += safeSize
    return
  }
  stats.image_file_count += 1
  stats.total_image_bytes += safeSize
}

function mergeFileInputStats(...items: FileInputStats[]): FileInputStats {
  return items.reduce((merged, item) => ({
    file_count: merged.file_count + item.file_count,
    total_file_bytes: merged.total_file_bytes + item.total_file_bytes,
    pdf_file_count: merged.pdf_file_count + item.pdf_file_count,
    image_file_count: merged.image_file_count + item.image_file_count,
    total_pdf_pages: merged.total_pdf_pages + item.total_pdf_pages,
    total_image_bytes: merged.total_image_bytes + item.total_image_bytes,
    total_input_file_bytes: merged.total_input_file_bytes + item.total_input_file_bytes,
  }), emptyFileInputStats())
}

function validatePredictedFileInput(
  limits: FileInputLimits,
  predictedStats: FileInputStats,
  candidates: CandidateFileInput[],
): string | null {
  for (const candidate of candidates) {
    if (candidate.kind === "pdf" && candidate.sizeInBytes >= limits.max_single_input_file_bytes) {
      return `无法上传：${candidate.name} 大小为 ${formatBytes(candidate.sizeInBytes)}，单个 PDF/文件必须小于 ${formatBytes(limits.max_single_input_file_bytes)}。`
    }
  }
  if (predictedStats.image_file_count > limits.max_image_inputs_per_request) {
    return `无法上传：当前请求将包含 ${predictedStats.image_file_count} 张图片，超过上限 ${limits.max_image_inputs_per_request} 张。`
  }
  if (predictedStats.total_image_bytes > limits.max_total_image_bytes_per_request) {
    return `无法上传：当前请求图片总大小 ${formatBytes(predictedStats.total_image_bytes)}，超过上限 ${formatBytes(limits.max_total_image_bytes_per_request)}。`
  }
  if (predictedStats.total_input_file_bytes > limits.max_total_input_file_bytes_per_request) {
    return `无法上传：当前请求 PDF/文件总大小 ${formatBytes(predictedStats.total_input_file_bytes)}，超过上限 ${formatBytes(limits.max_total_input_file_bytes_per_request)}。`
  }
  return null
}

function isSupportedAttachmentFile(file: File): boolean {
  return SUPPORTED_ATTACHMENT_TYPES.has(file.type)
}

function extractDroppedText(dataTransfer: DataTransfer): string {
  const uriList = dataTransfer.getData("text/uri-list")?.trim()
  if (uriList) {
    return uriList
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .join("\n")
  }
  return dataTransfer.getData("text/plain")?.trim() ?? ""
}

function insertTextBlockAtRange(
  source: string,
  insertedText: string,
  selectionStart: number,
  selectionEnd: number,
  ): { text: string; cursorPosition: number } {
  const safeStart = Math.max(0, Math.min(source.length, selectionStart))
  const safeEnd = Math.max(safeStart, Math.min(source.length, selectionEnd))
  const before = source.slice(0, safeStart)
  const after = source.slice(safeEnd)
  const prefix = before.length > 0 && !before.endsWith("\n") ? "\n" : ""
  const suffix = after.length > 0 && !after.startsWith("\n") ? "\n" : ""
  const text = `${before}${prefix}${insertedText}${suffix}${after}`
  return {
    text,
    cursorPosition: before.length + prefix.length + insertedText.length,
  }
}

async function fileToTextReference(file: File): Promise<{ text: string; uri: string | null }> {
  const uri = await getFileUri(file)
  if (!uri) return { text: file.name, uri: null }
  return { text: uri, uri }
}

async function getFileUri(file: File): Promise<string | null> {
  const bridge = (window as Window & { spreadDesktop?: SpreadDesktopFileBridge }).spreadDesktop
  try {
    const uri = await bridge?.getFileUri?.(file)
    return typeof uri === "string" && uri.trim().length > 0 ? uri : null
  } catch (error) {
    console.warn("[chat] get file uri failed:", error)
    return null
  }
}

function fileToBase64Content(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : ""
      const commaIndex = result.indexOf(",")
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error("读取文件失败"))
    reader.readAsDataURL(file)
  })
}

function openPdfResource(resourceId: string, title: string) {
  const url = `/pdf-viewer?resourceId=${encodeURIComponent(resourceId)}&name=${encodeURIComponent(title)}`
  const bridge = (window as Window & { spreadDesktop?: { openPdfWindow?: (targetUrl: string) => Promise<unknown> } }).spreadDesktop
  if (bridge?.openPdfWindow) {
    void bridge.openPdfWindow(url)
    return
  }
  window.open(url, "_blank", "noopener,noreferrer")
}
