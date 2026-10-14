import ReactMarkdown, { type Components } from "react-markdown"
import { memo, useEffect, useMemo, useRef, type MouseEvent } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import remarkGfm from "remark-gfm"

import { localImageFileContentUrl } from "@/features/chat/api/fileResourceApi"
import { getOrCreateMarkdownRenderCacheHtml } from "@/features/chat/components/markdownRenderCache"
import type { TextFormat } from "@/features/chat/model/agentEvents"

type MessageContentProps = {
  text: string
  format: TextFormat
  inverted?: boolean
  markdownCacheKey?: string | null
}

const BROWSER_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:"])
const MARKDOWN_REMARK_PLUGINS = [remarkGfm]

const markdownComponents: Components = {
  a({ href, children, node: _node, ...props }) {
    const browserUrl = resolveBrowserUrl(href)
    if (browserUrl) {
      return (
        <a
          {...props}
          href={browserUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(event) => {
            event.preventDefault()
            openUrlInBrowser(browserUrl)
          }}
        >
          {children}
        </a>
      )
    }
    const localFilePath = resolveLocalFilePath(href)
    if (localFilePath) {
      return (
        <a
          {...props}
          href={href}
          title={`本地路径: ${localFilePath}`}
          onClick={(event) => {
            event.preventDefault()
            openLocalPath(localFilePath)
          }}
        >
          {children}
        </a>
      )
    }
    return <a {...props} href={href}>{children}</a>
  },
  img({ src, alt, ...props }) {
    const effectiveSrc = resolveLocalImageSrc(src) ?? src
    return <img {...props} src={effectiveSrc} alt={alt} />
  },
}

/**
 * 按 Runtime text_format 渲染聊天消息内容。
 *
 * - `format="html"` 直接渲染 message_user 等 Runtime 已声明为 HTML fragment 的内容，不经过 Markdown 解析。
 * - `format="markdown"` 使用 react-markdown + remark-gfm；非深色气泡复用统一 `.html-document` 文档样式。
 * - `format="json"` 使用 <pre> 代码块；用户侧 `plain_text` / `diff` 直接显示原文本，不再套内层代码块。
 *
 * `inverted=true` 表示消息渲染在深色背景上（如品牌靖蓝用户气泡），
 * 样式翻转为浅色文字 + 白色 strong/code，避免深底深字不可读。
 */
export const MessageContent = memo(function MessageContent({ text, format, inverted = false, markdownCacheKey = null }: MessageContentProps) {
  if (format === "html") {
    return <HtmlDocumentContent html={text} />
  }

  if (format === "json") {
    const className = inverted
      ? "overflow-auto whitespace-pre-wrap rounded-lg bg-app-accent-hover/70 p-3 text-xs text-white"
      : "overflow-auto whitespace-pre-wrap rounded-lg bg-surface-950 p-3 text-xs text-slate-100"
    return <pre className={className}>{text}</pre>
  }

  if (format === "plain_text" || format === "diff") {
    if (inverted) {
      return <div className="max-w-full whitespace-pre-wrap break-words text-sm leading-6 text-white">{text}</div>
    }
    return <pre className="overflow-auto whitespace-pre-wrap rounded-lg bg-app-surface-muted p-3 text-sm leading-6 text-app-primary">{text}</pre>
  }

  const markdownClassName = inverted
    ? "prose-stream prose prose-invert max-w-none text-sm leading-6 text-white prose-p:my-2 prose-ul:my-2 prose-li:my-1 prose-strong:text-white prose-code:text-slate-100 prose-a:text-white hover:prose-a:text-white"
    : "html-document"
  if (markdownCacheKey) {
    const cachedHtml = getOrCreateMarkdownRenderCacheHtml(markdownCacheKey, () => renderMarkdownHtml(text))
    return <HtmlDocumentContent html={cachedHtml} className={markdownClassName} />
  }
  return (
    <div className={markdownClassName}>
      <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} skipHtml components={markdownComponents}>
        {text}
      </ReactMarkdown>
    </div>
  )
})

function renderMarkdownHtml(text: string): string {
  return renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} skipHtml components={markdownComponents}>
      {text}
    </ReactMarkdown>,
  )
}

/**
 * HTML 文档内容渲染器。React 会把普通字符串子节点作为文本转义，
 * 因此 HTML fragment 必须通过 dangerouslySetInnerHTML 注入为真实 DOM。
 *
 * 注入前先将 `<img src="file:///...">` 或本地图片路径转换为 Runtime 代理接口 URL，
 * 避免浏览器/Chromium 内核出于同源与安全策略拦截 file:// 并报 broken image。
 * HTML/Markdown 里的外部 URL 统一在浏览器打开；本地非图片文件路径支持在桌面端唤起系统程序打开。
 */
export const HtmlDocumentContent = memo(function HtmlDocumentContent({ html, className = "html-document" }: { html: string; className?: string }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const transformedHtml = useMemo(() => transformHtmlDocumentImages(html), [html])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    container.querySelectorAll("a[href]").forEach((anchor) => {
      const href = anchor.getAttribute("href")
      const browserUrl = resolveBrowserUrl(href)
      if (browserUrl) {
        anchor.setAttribute("href", browserUrl)
        anchor.setAttribute("target", "_blank")
        anchor.setAttribute("rel", "noopener noreferrer")
        return
      }
      const localFilePath = resolveLocalFilePath(href)
      if (localFilePath) {
        anchor.setAttribute("title", `本地路径: ${localFilePath}`)
      }
    })
  }, [transformedHtml])

  return (
    <div
      ref={containerRef}
      className={className}
      onClick={handleHtmlDocumentLinkClick}
      dangerouslySetInnerHTML={{ __html: transformedHtml }}
    />
  )
})

function handleHtmlDocumentLinkClick(event: MouseEvent<HTMLDivElement>) {
  const target = event.target
  if (!(target instanceof Element)) return
  const anchor = target.closest("a[href]")
  if (!(anchor instanceof HTMLAnchorElement) || !event.currentTarget.contains(anchor)) return

  const rawHref = anchor.getAttribute("href")
  const browserUrl = resolveBrowserUrl(rawHref)
  if (browserUrl) {
    event.preventDefault()
    event.stopPropagation()
    openUrlInBrowser(browserUrl)
    return
  }

  const localFilePath = resolveLocalFilePath(rawHref)
  if (localFilePath) {
    event.preventDefault()
    event.stopPropagation()
    openLocalPath(localFilePath)
  }
}

export function transformHtmlDocumentImages(html: string): string {
  if (!html || !html.includes("<img")) return html
  return html.replace(/<img\b([^>]*?)\bsrc=(["']?)([^"'\s>]+)\2([^>]*?)>/gi, (match, prefix, quote, src, suffix) => {
    const converted = resolveLocalImageSrc(src)
    if (converted) {
      const q = quote || '"'
      return `<img${prefix}src=${q}${converted}${q}${suffix}>`
    }
    return match
  })
}

export function resolveLocalFilePath(href: string | null | undefined): string | null {
  const trimmed = href?.trim()
  if (!trimmed || trimmed.startsWith("#")) return null

  if (/^(https?|mailto|data|blob|javascript):/i.test(trimmed)) {
    return null
  }

  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed)
      let pathname = decodeURIComponent(url.pathname)
      if (/^\/[a-zA-Z]:[/|\\]/.test(pathname)) {
        pathname = pathname.slice(1)
      }
      return pathname.replace(/\//g, "\\")
    } catch {
      let clean = trimmed.replace(/^file:\/{2,3}/i, "")
      clean = decodeURIComponent(clean)
      return clean.replace(/\//g, "\\")
    }
  }

  // 匹配 Windows 盘符路径：如 G:\... 或 G:/...
  if (/^[a-zA-Z]:[/\\]/.test(trimmed)) {
    return trimmed.replace(/\//g, "\\")
  }

  // 匹配 Unix 绝对路径：如 /Users/... 或 /home/...
  if (trimmed.startsWith("/") && !trimmed.startsWith("//")) {
    return trimmed
  }

  return null
}

export function resolveLocalImageSrc(src: string | null | undefined): string | null {
  if (!src) return null
  const trimmed = src.trim()
  if (/^(https?:\/\/|data:|blob:)/i.test(trimmed)) {
    return null
  }
  const localPath = resolveLocalFilePath(trimmed)
  if (localPath) {
    return localImageFileContentUrl(localPath)
  }
  return null
}

function resolveBrowserUrl(href: string | null | undefined): string | null {
  const trimmed = href?.trim()
  if (!trimmed || trimmed.startsWith("#")) return null

  try {
    const parsed = new URL(trimmed, window.location.href)
    if (!BROWSER_URL_PROTOCOLS.has(parsed.protocol)) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function openUrlInBrowser(url: string) {
  const bridge = window.spreadDesktop
  if (bridge?.openExternalUrl) {
    void bridge.openExternalUrl(url).catch((error) => {
      console.warn("[chat] open external url failed:", error)
      openUrlWithWindowOpen(url)
    })
    return
  }
  openUrlWithWindowOpen(url)
}

function openUrlWithWindowOpen(url: string) {
  const opened = window.open(url, "_blank", "noopener,noreferrer")
  if (opened) opened.opener = null
}

function openLocalPath(filePath: string) {
  const bridge = window.spreadDesktop
  if (bridge?.isElectron && typeof bridge.openSystemPath === "function") {
    void bridge.openSystemPath(filePath).then((result) => {
      if (!result?.ok && typeof bridge.revealSystemPath === "function") {
        void bridge.revealSystemPath(filePath)
      }
    }).catch((error) => {
      console.warn("[chat] open system path failed:", error)
      if (typeof bridge.revealSystemPath === "function") {
        void bridge.revealSystemPath(filePath)
      }
    })
    return
  }
  if (typeof navigator !== "undefined" && navigator?.clipboard?.writeText) {
    void navigator.clipboard.writeText(filePath).then(() => {
      console.info("[chat] local file path copied to clipboard:", filePath)
    }).catch((error) => {
      console.warn("[chat] copy local file path failed:", error)
    })
  }
}
