import { Check, Copy, Loader2, XCircle } from "lucide-react"
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"
import { createPortal } from "react-dom"

type CopyablePreviewImageProps = {
  src: string
  alt: string
  className?: string
  preferredMimeType?: string | null
}

type CopyMenuPosition = {
  x: number
  y: number
}

type CopyImageStatus = "idle" | "copying" | "copied" | "failed"

const COPY_IMAGE_MENU_MARGIN_PX = 8
const COPY_IMAGE_MENU_WIDTH_PX = 184
const COPY_IMAGE_MENU_HEIGHT_PX = 44
const COPY_IMAGE_MENU_CLOSE_DELAY_MS = 1200

/**
 * 图片预览中的可复制图片。
 *
 * 浏览器和 Electron 对原生图片右键菜单支持不一致，因此图片查看浮层统一使用
 * 前端自定义右键菜单，并通过 Async Clipboard API 写入真实图片数据。
 */
export function CopyablePreviewImage({ src, alt, className, preferredMimeType }: CopyablePreviewImageProps) {
  const [menuPosition, setMenuPosition] = useState<CopyMenuPosition | null>(null)
  const [copyStatus, setCopyStatus] = useState<CopyImageStatus>("idle")
  const menuRef = useRef<HTMLDivElement>(null)
  const closeTimerRef = useRef<number | null>(null)

  const clearCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
  }

  const closeMenu = () => {
    clearCloseTimer()
    setMenuPosition(null)
    setCopyStatus("idle")
  }

  useEffect(() => {
    return () => clearCloseTimer()
  }, [])

  useEffect(() => {
    if (!menuPosition) return undefined

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      closeMenu()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu()
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleKeyDown)
    window.addEventListener("resize", closeMenu)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleKeyDown)
      window.removeEventListener("resize", closeMenu)
    }
  }, [menuPosition])

  const handleContextMenu = (event: ReactMouseEvent<HTMLImageElement>) => {
    event.preventDefault()
    event.stopPropagation()
    clearCloseTimer()
    setCopyStatus("idle")
    setMenuPosition(positionCopyImageMenu(event.clientX, event.clientY))
  }

  const handleCopyImage = () => {
    if (copyStatus === "copying") return
    setCopyStatus("copying")
    void writeImageToClipboard(src, preferredMimeType)
      .then(() => {
        setCopyStatus("copied")
        clearCloseTimer()
        closeTimerRef.current = window.setTimeout(() => {
          setMenuPosition(null)
          setCopyStatus("idle")
          closeTimerRef.current = null
        }, COPY_IMAGE_MENU_CLOSE_DELAY_MS)
      })
      .catch((error) => {
        console.warn("[chat] copy preview image failed:", error)
        setCopyStatus("failed")
      })
  }

  return (
    <>
      <img
        src={src}
        alt={alt}
        title="右键复制图片"
        className={className}
        onContextMenu={handleContextMenu}
      />
      {menuPosition ? createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label="图片操作菜单"
          className="fixed z-[70] min-w-44 overflow-hidden rounded-xl border border-app-border bg-app-surface text-sm text-app-primary shadow-2xl"
          style={{ left: menuPosition.x, top: menuPosition.y }}
        >
          <button
            type="button"
            role="menuitem"
            disabled={copyStatus === "copying" || copyStatus === "copied"}
            onClick={handleCopyImage}
            className={`flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-app-selected focus:bg-app-selected focus:outline-none disabled:cursor-default ${copyStatusClassName(copyStatus)}`}
          >
            {copyStatusIcon(copyStatus)}
            <span>{copyStatusLabel(copyStatus)}</span>
          </button>
        </div>,
        document.body,
      ) : null}
    </>
  )
}

function positionCopyImageMenu(clientX: number, clientY: number): CopyMenuPosition {
  const maxX = Math.max(COPY_IMAGE_MENU_MARGIN_PX, window.innerWidth - COPY_IMAGE_MENU_WIDTH_PX - COPY_IMAGE_MENU_MARGIN_PX)
  const maxY = Math.max(COPY_IMAGE_MENU_MARGIN_PX, window.innerHeight - COPY_IMAGE_MENU_HEIGHT_PX - COPY_IMAGE_MENU_MARGIN_PX)
  return {
    x: clamp(clientX, COPY_IMAGE_MENU_MARGIN_PX, maxX),
    y: clamp(clientY, COPY_IMAGE_MENU_MARGIN_PX, maxY),
  }
}

function copyStatusIcon(status: CopyImageStatus) {
  if (status === "copying") return <Loader2 size={14} className="shrink-0 animate-spin" />
  if (status === "copied") return <Check size={14} className="shrink-0" />
  if (status === "failed") return <XCircle size={14} className="shrink-0" />
  return <Copy size={14} className="shrink-0" />
}

function copyStatusLabel(status: CopyImageStatus): string {
  if (status === "copying") return "正在复制图片…"
  if (status === "copied") return "已复制图片"
  if (status === "failed") return "复制失败，请重试"
  return "复制图片"
}

function copyStatusClassName(status: CopyImageStatus): string {
  if (status === "copied") return "text-app-success"
  if (status === "failed") return "text-app-danger"
  return "text-app-primary"
}

async function writeImageToClipboard(src: string, preferredMimeType?: string | null): Promise<void> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("当前环境不支持写入图片剪切板")
  }

  const response = await fetch(src)
  if (!response.ok) {
    throw new Error(`图片加载失败：${response.status}`)
  }

  const sourceBlob = await response.blob()
  const { blob, mimeType } = await normalizeClipboardImageBlob(sourceBlob, src, preferredMimeType)
  await navigator.clipboard.write([new ClipboardItem({ [mimeType]: blob })])
}

async function normalizeClipboardImageBlob(blob: Blob, src: string, preferredMimeType?: string | null): Promise<{ blob: Blob; mimeType: string }> {
  const mimeType = imageMimeType(blob.type) ?? imageMimeType(preferredMimeType) ?? inferImageMimeType(src)
  if (!mimeType) {
    throw new Error("无法识别图片 MIME 类型")
  }

  const typedBlob = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType })
  const clipboardItemWithSupports = ClipboardItem as typeof ClipboardItem & { supports?: (type: string) => boolean }
  if (mimeType === "image/png" || clipboardItemWithSupports.supports?.(mimeType) === true) {
    return { blob: typedBlob, mimeType }
  }

  return { blob: await convertImageBlobToPng(typedBlob), mimeType: "image/png" }
}

function imageMimeType(value?: string | null): string | null {
  const normalized = value?.split(";")[0]?.trim().toLowerCase()
  return normalized?.startsWith("image/") ? normalized : null
}

function inferImageMimeType(src: string): string | null {
  try {
    const pathname = new URL(src, window.location.href).pathname.toLowerCase()
    if (pathname.endsWith(".png")) return "image/png"
    if (pathname.endsWith(".jpg") || pathname.endsWith(".jpeg")) return "image/jpeg"
    if (pathname.endsWith(".webp")) return "image/webp"
  } catch {
    // URL 解析失败时只能依赖响应头或调用方传入的 MIME。
  }
  return null
}

function convertImageBlobToPng(blob: Blob): Promise<Blob> {
  const objectUrl = URL.createObjectURL(blob)
  return new Promise<Blob>((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      try {
        const width = image.naturalWidth || image.width
        const height = image.naturalHeight || image.height
        if (width <= 0 || height <= 0) {
          reject(new Error("图片尺寸无效，无法复制"))
          return
        }
        const canvas = document.createElement("canvas")
        canvas.width = width
        canvas.height = height
        const context = canvas.getContext("2d")
        if (!context) {
          reject(new Error("无法创建图片复制画布"))
          return
        }
        context.drawImage(image, 0, 0)
        canvas.toBlob((pngBlob) => {
          if (!pngBlob) {
            reject(new Error("图片转 PNG 失败"))
            return
          }
          resolve(pngBlob)
        }, "image/png")
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)))
      }
    }
    image.onerror = () => reject(new Error("图片解码失败，无法复制"))
    image.src = objectUrl
  }).finally(() => URL.revokeObjectURL(objectUrl))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
