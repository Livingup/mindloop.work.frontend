import { FileText, Loader2, RotateCcw, ZoomIn, ZoomOut } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy } from "pdfjs-dist"
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url"

import { fileResourceContentUrl } from "@/features/chat/api/fileResourceApi"
import { ResourceLocatorPanel, useResourceLocatorDetails } from "@/features/chat/components/ResourceLocatorPanel"

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export function PdfViewerPage() {
  const [searchParams] = useSearchParams()
  const resourceId = searchParams.get("resourceId") ?? ""
  const name = searchParams.get("name") ?? "PDF 文件"
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "failed">("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const locatorDetails = useResourceLocatorDetails(resourceId)
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const pages = useMemo(() => Array.from({ length: pageCount }, (_, index) => index + 1), [pageCount])
  const isDesktopShell = typeof window !== "undefined" && "spreadDesktop" in window

  useEffect(() => {
    if (!resourceId) {
      setStatus("failed")
      setErrorMessage("缺少 PDF resourceId。")
      return
    }
    let cancelled = false
    let activeDocument: PDFDocumentProxy | null = null
    setStatus("loading")
    setErrorMessage(null)
    setDocument(null)
    setPageCount(0)
    const task = getDocument({ url: fileResourceContentUrl(resourceId) })
    void task.promise.then((pdf) => {
      if (cancelled) {
        void pdf.destroy()
        return
      }
      activeDocument = pdf
      setDocument(pdf)
      setPageCount(pdf.numPages)
      setStatus("ready")
    }).catch((error) => {
      if (cancelled) return
      setStatus("failed")
      setErrorMessage(error instanceof Error ? error.message : "PDF 加载失败。")
    })
    return () => {
      cancelled = true
      task.destroy()
      if (activeDocument) void activeDocument.destroy()
    }
  }, [resourceId])

  const scrollToPage = (pageNumber: number) => {
    pageRefs.current.get(pageNumber)?.scrollIntoView({ block: "start", behavior: "smooth" })
  }

  return (
    <div className="flex h-screen min-h-0 flex-col bg-stone-950 text-stone-100">
      <header className={`flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-stone-900 pl-4 ${isDesktopShell ? "electron-drag-region pr-[148px]" : "pr-4"}`}>
        <div className="flex min-w-0 items-center gap-2">
          <FileText size={18} className="shrink-0 text-red-300" />
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">{name}</div>
            <div className="text-[11px] text-stone-400">{resourceId}</div>
          </div>
        </div>
        <div className="electron-no-drag flex shrink-0 items-center gap-2">
          <button type="button" onClick={() => setScale((value) => Math.max(0.5, value - 0.1))} className="inline-flex size-8 items-center justify-center rounded-md text-stone-300 hover:bg-white/10 hover:text-white" title="缩小 PDF" aria-label="缩小 PDF">
            <ZoomOut size={16} />
          </button>
          <span className="w-14 text-center text-xs text-stone-300">{Math.round(scale * 100)}%</span>
          <button type="button" onClick={() => setScale((value) => Math.min(2.5, value + 0.1))} className="inline-flex size-8 items-center justify-center rounded-md text-stone-300 hover:bg-white/10 hover:text-white" title="放大 PDF" aria-label="放大 PDF">
            <ZoomIn size={16} />
          </button>
          <button type="button" onClick={() => setScale(1.2)} className="inline-flex size-8 items-center justify-center rounded-md text-stone-300 hover:bg-white/10 hover:text-white" title="重置缩放" aria-label="重置缩放">
            <RotateCcw size={16} />
          </button>
        </div>
      </header>
      <ResourceLocatorPanel details={locatorDetails} tone="stone" />
      {status === "loading" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-stone-300">
          <Loader2 size={18} className="animate-spin" />
          正在加载 PDF…
        </div>
      ) : null}
      {status === "failed" ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-8">
          <div className="max-w-md rounded-2xl border border-red-500/40 bg-red-950/30 p-5 text-sm text-red-100">
            <div className="font-semibold">PDF 加载失败</div>
            <div className="mt-2 text-red-200/80">{errorMessage}</div>
          </div>
        </div>
      ) : null}
      {status === "ready" && document ? (
        <div className="grid min-h-0 flex-1 grid-cols-[1fr_160px] overflow-hidden">
          <main className="min-h-0 overflow-auto bg-stone-900/70 px-8 py-6">
            <div className="mx-auto flex max-w-5xl flex-col items-center gap-6">
              {pages.map((pageNumber) => (
                <div key={pageNumber} ref={(element) => {
                  if (element) pageRefs.current.set(pageNumber, element)
                  else pageRefs.current.delete(pageNumber)
                }} className="flex flex-col items-center gap-2">
                  <PdfPage document={document} pageNumber={pageNumber} scale={scale} />
                  <div className="text-xs text-stone-500">{pageNumber} / {pageCount}</div>
                </div>
              ))}
            </div>
          </main>
          <aside className="min-h-0 overflow-auto border-l border-white/10 bg-stone-950 p-3">
            <div className="mb-2 text-xs font-medium text-stone-400">页面</div>
            <div className="grid grid-cols-2 gap-2">
              {pages.map((pageNumber) => (
                <button key={pageNumber} type="button" onClick={() => scrollToPage(pageNumber)} className="rounded-lg border border-white/10 bg-white/5 px-2 py-1.5 text-xs text-stone-300 hover:bg-white/10 hover:text-white">
                  {pageNumber}
                </button>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

function PdfPage({ document, pageNumber, scale }: { document: PDFDocumentProxy; pageNumber: number; scale: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [rendering, setRendering] = useState(true)

  useEffect(() => {
    let cancelled = false
    setRendering(true)
    void document.getPage(pageNumber).then((page) => {
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      const context = canvas?.getContext("2d")
      if (!canvas || !context) return
      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      })
      void renderTask.promise.finally(() => {
        if (!cancelled) setRendering(false)
      })
    })
    return () => {
      cancelled = true
    }
  }, [document, pageNumber, scale])

  return (
    <div className="relative rounded-lg bg-white shadow-2xl shadow-black/40">
      <canvas ref={canvasRef} />
      {rendering ? (
        <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-stone-500">
          <Loader2 size={18} className="animate-spin" />
        </div>
      ) : null}
    </div>
  )
}
