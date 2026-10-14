import { FitAddon } from "@xterm/addon-fit"
import { Terminal as XtermTerminal } from "@xterm/xterm"
import "@xterm/xterm/css/xterm.css"
import clsx from "clsx"
import { X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react"

import type { TerminalSession } from "@/features/chat/model/chatTypes"
import {
  buildTerminalPanes,
  buildTerminalPlaybackChunks,
  TERMINAL_SCROLLBACK_LINE_LIMIT,
  terminalPaneTitle,
  type TerminalPane,
} from "@/features/chat/components/terminalXtermPresentation"

const XTERM_THEME = {
  background: "#0d0f10",
  foreground: "#e2e8f0",
  cursor: "#86efac",
  black: "#0f172a",
  red: "#f87171",
  green: "#86efac",
  yellow: "#fde047",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#67e8f9",
  white: "#e2e8f0",
  brightBlack: "#64748b",
  brightRed: "#fca5a5",
  brightGreen: "#bbf7d0",
  brightYellow: "#fef08a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#a5f3fc",
  brightWhite: "#f8fafc",
}

const TERMINAL_RIGHT_GUTTER_PX = 6
const TERMINAL_BOTTOM_GUTTER_PX = 36
const TERMINAL_BACKGROUND = XTERM_THEME.background

type XtermRuntime = {
  terminal: XtermTerminal
  fitAddon: FitAddon
  isDisposed: boolean
  /** 已写入 xterm 的回放片段 ID，避免 terminal.output.delta 到达时重复写入历史。 */
  writtenChunkIds: Set<string>
}

/**
 * Agent 终端观察面板。
 *
 * 该组件只负责展示 Agent 通过后端终端工具执行命令后的实时输出：
 * - xterm.js 负责解析 ANSI 颜色、清行、回车覆盖等真实终端控制序列。
 * - UI 按 terminal_id 提供多终端 tab，避免多个 Agent 终端输出混在一起。
 * - disableStdin=true，明确不提供用户直接输入命令能力，终端输入仍只能由 Agent 工具链触发。
 */
export function TerminalPanel({
  terminalScopeId,
  sessions,
  onCloseTerminal,
}: {
  terminalScopeId: string
  sessions: TerminalSession[]
  onCloseTerminal?: (terminalId: string) => Promise<void> | void
}) {
  const panes = useMemo(() => buildTerminalPanes(sessions), [sessions])
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null)
  const [closingTerminalIds, setClosingTerminalIds] = useState<Set<string>>(() => new Set())
  const activeTerminalIdRef = useRef<string | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const activeTerminalHostRef = useRef<HTMLDivElement | null>(null)
  const runtimeByTerminalIdRef = useRef<Map<string, XtermRuntime>>(new Map())

  const activePane = useMemo(() => {
    if (panes.length === 0) return null
    return panes.find((pane) => pane.terminalId === activeTerminalId) ?? panes[0]
  }, [activeTerminalId, panes])

  const activeRuntimeKey = activePane ? terminalRuntimeKey(terminalScopeId, activePane.terminalId) : null
  const activeRuntime = activeRuntimeKey ? runtimeByTerminalIdRef.current.get(activeRuntimeKey) ?? null : null

  useEffect(() => {
    activeTerminalIdRef.current = activeRuntimeKey
  }, [activeRuntimeKey])

  useEffect(() => {
    if (panes.length === 0) {
      setActiveTerminalId(null)
      return
    }
    if (activeTerminalId && panes.some((pane) => pane.terminalId === activeTerminalId)) return
    setActiveTerminalId(panes[0].terminalId)
  }, [activeTerminalId, panes])

  useEffect(() => {
    // Phase-1 capacity protection: only keep a heavy xterm runtime for the focused tab.
    // Background terminal metadata/output still live in chatStore; switching hydrates from store.
    const runtimeMap = runtimeByTerminalIdRef.current
    if (!activePane) {
      for (const runtimeKey of Array.from(runtimeMap.keys())) {
        disposeXtermRuntime(runtimeMap.get(runtimeKey) ?? null)
        runtimeMap.delete(runtimeKey)
      }
      return
    }

    const activeKey = terminalRuntimeKey(terminalScopeId, activePane.terminalId)
    for (const runtimeKey of Array.from(runtimeMap.keys())) {
      if (runtimeKey === activeKey) continue
      disposeXtermRuntime(runtimeMap.get(runtimeKey) ?? null)
      runtimeMap.delete(runtimeKey)
    }

    const runtime = ensureXtermRuntime(activeKey, runtimeMap)
    const chunks = buildTerminalPlaybackChunks(activePane)
    const currentChunkIds = new Set(chunks.map((chunk) => chunk.id))
    pruneWrittenChunkIds(runtime.writtenChunkIds, currentChunkIds)
    for (const chunk of chunks) {
      if (runtime.writtenChunkIds.has(chunk.id)) continue
      runtime.terminal.write(chunk.text)
      runtime.writtenChunkIds.add(chunk.id)
    }
  }, [activePane, panes, terminalScopeId])

  useEffect(() => {
    const host = activeTerminalHostRef.current
    if (!host || !activePane || !activeRuntimeKey) return
    const runtime = ensureXtermRuntime(activeRuntimeKey, runtimeByTerminalIdRef.current)
    if (runtime.terminal.element) {
      host.replaceChildren(runtime.terminal.element)
    } else {
      host.replaceChildren()
      runtime.terminal.open(host)
    }
    runtime.terminal.element?.style.setProperty("padding-right", `${TERMINAL_RIGHT_GUTTER_PX}px`)
    runtime.terminal.element?.style.setProperty("padding-bottom", `${TERMINAL_BOTTOM_GUTTER_PX}px`)
    runtime.terminal.element?.style.setProperty("background", TERMINAL_BACKGROUND)
    runtime.terminal.element?.querySelector<HTMLElement>(".xterm-scrollable-element")?.style.setProperty("background", TERMINAL_BACKGROUND)
    runtime.terminal.element?.querySelector<HTMLElement>(".xterm-viewport")?.style.setProperty("background", TERMINAL_BACKGROUND)
    runtime.terminal.element?.querySelector<HTMLElement>(".xterm-screen")?.style.setProperty("background", TERMINAL_BACKGROUND)
    const animationFrame = requestAnimationFrame(() => {
      if (runtimeByTerminalIdRef.current.get(activeRuntimeKey) !== runtime) return
      fitAndScrollToBottom(runtime)
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [activePane, activeRuntimeKey])

  useEffect(() => {
    if (!activeRuntime || !activeRuntimeKey) return
    const animationFrame = requestAnimationFrame(() => {
      if (runtimeByTerminalIdRef.current.get(activeRuntimeKey) !== activeRuntime) return
      fitAndScrollToBottom(activeRuntime)
    })
    return () => cancelAnimationFrame(animationFrame)
  }, [activeRuntime, activeRuntimeKey, sessions])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const resizeObserver = new ResizeObserver(() => {
      const runtime = activeTerminalIdRef.current ? runtimeByTerminalIdRef.current.get(activeTerminalIdRef.current) : null
      if (runtime) fitAndScrollToBottom(runtime)
    })
    resizeObserver.observe(viewport)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    return () => {
      for (const runtime of runtimeByTerminalIdRef.current.values()) {
        disposeXtermRuntime(runtime)
      }
      runtimeByTerminalIdRef.current.clear()
    }
  }, [])

  const handleSelectPane = useCallback((pane: TerminalPane) => {
    setActiveTerminalId(pane.terminalId)
  }, [])

  const handleClosePane = useCallback(async (event: ReactMouseEvent, pane: TerminalPane) => {
    event.stopPropagation()
    if (!onCloseTerminal || closingTerminalIds.has(pane.terminalId)) return
    setClosingTerminalIds((current) => new Set(current).add(pane.terminalId))
    try {
      await onCloseTerminal(pane.terminalId)
    } catch (error) {
      console.warn("[terminal] close terminal failed:", error)
    } finally {
      setClosingTerminalIds((current) => {
        const next = new Set(current)
        next.delete(pane.terminalId)
        return next
      })
    }
  }, [closingTerminalIds, onCloseTerminal])

  const handleClearActiveTerminal = useCallback(() => {
    if (!activeRuntimeKey) return
    const runtime = runtimeByTerminalIdRef.current.get(activeRuntimeKey)
    if (!runtime) return
    clearTerminal(runtime)
  }, [activeRuntimeKey])

  const setActiveTerminalHost = useCallback((node: HTMLDivElement | null) => {
    viewportRef.current = node
    activeTerminalHostRef.current = node
  }, [])

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden text-slate-100" style={{ background: TERMINAL_BACKGROUND }}>
      {panes.length > 0 ? (
        <div className="flex shrink-0 items-center border-b border-white/10">
          <div className="terminal-scrollbar flex min-w-0 flex-1 overflow-x-auto px-2">
            {panes.map((pane) => {
              const isActive = activePane?.terminalId === pane.terminalId
              const paneTitle = terminalPaneTitle(pane)
              const isClosing = closingTerminalIds.has(pane.terminalId)
              return (
                <div
                  key={pane.terminalId}
                  className={clsx(
                    "group flex h-8 shrink-0 items-center font-mono text-[11px] transition",
                    isActive
                      ? "bg-white/[0.08] text-cyan-100 shadow-[inset_0_-2px_0_rgba(103,232,249,0.75)]"
                      : "max-w-[128px] bg-transparent text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => handleSelectPane(pane)}
                    className="flex h-full min-w-0 items-center gap-2 px-3 text-left"
                    title={`${paneTitle}\n${pane.latestSession.cwd}`}
                  >
                    <span className={clsx("h-2 w-2 shrink-0 rounded-full", paneDotClassName(pane))} />
                    <span className={isActive ? "whitespace-nowrap" : "truncate"}>{isActive ? paneTitle : shortTerminalPaneTitle(paneTitle)}</span>
                  </button>
                  {onCloseTerminal ? (
                    <button
                      type="button"
                      onClick={(event) => void handleClosePane(event, pane)}
                      disabled={isClosing}
                      className={clsx(
                        "mr-1 inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-500 transition hover:bg-white/[0.08] hover:text-slate-100 disabled:cursor-wait disabled:opacity-50",
                        isActive ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                      )}
                      title="关闭终端并删除终端 ID"
                      aria-label={`关闭终端 ${paneTitle}`}
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
          <button
            type="button"
            onClick={handleClearActiveTerminal}
            className="mr-2 h-7 shrink-0 rounded px-2 text-[11px] text-slate-400 transition hover:bg-white/[0.06] hover:text-slate-100"
            title="清空当前终端视图，不删除历史记录"
          >
            清屏
          </button>
        </div>
      ) : null}

      {activePane ? (
        <div className="min-h-0 flex-1 pl-3 pt-3" style={{ background: TERMINAL_BACKGROUND }}>
          <div ref={setActiveTerminalHost} className="h-full min-h-0 overflow-hidden" style={{ background: TERMINAL_BACKGROUND }} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-sm leading-6 text-slate-500">
          Agent 执行命令后，会在这里以终端 UI 显示输出。
        </div>
      )}
    </aside>
  )
}

function terminalRuntimeKey(terminalScopeId: string, terminalId: string): string {
  return `${terminalScopeId}:${terminalId}`
}

function ensureXtermRuntime(terminalRuntimeId: string, runtimeByTerminalId: Map<string, XtermRuntime>): XtermRuntime {
  const existingRuntime = runtimeByTerminalId.get(terminalRuntimeId)
  if (existingRuntime) return existingRuntime

  const terminal = new XtermTerminal({
    allowProposedApi: false,
    convertEol: false,
    cursorBlink: false,
    disableStdin: true,
    fontFamily: "JetBrains Mono, Cascadia Code, Consolas, ui-monospace, SFMono-Regular, Menlo, Monaco, monospace",
    fontSize: 12,
    lineHeight: 1.45,
    rightClickSelectsWord: true,
    scrollback: TERMINAL_SCROLLBACK_LINE_LIMIT,
    theme: XTERM_THEME,
  })
  installTerminalKeyHandlers(terminal)
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)

  const runtime: XtermRuntime = { terminal, fitAddon, isDisposed: false, writtenChunkIds: new Set() }
  runtimeByTerminalId.set(terminalRuntimeId, runtime)
  return runtime
}

function fitAndScrollToBottom(runtime: XtermRuntime) {
  if (!isXtermRuntimeConnected(runtime)) return
  try {
    runtime.fitAddon.fit()
  } catch {
    // xterm 在 DOM 尚未完成布局时 fit 可能失败；下一次 resize / session 更新会再次触发 fit。
  }
  scrollTerminalToBottom(runtime.terminal)
}

function isXtermRuntimeConnected(runtime: XtermRuntime): boolean {
  const element = runtime.terminal.element
  if (runtime.isDisposed || !element || !element.isConnected || !element.parentElement) return false
  const parentBounds = element.parentElement.getBoundingClientRect()
  return parentBounds.width > 0 && parentBounds.height > 0
}

function scrollTerminalToBottom(terminal: XtermTerminal) {
  try {
    terminal.scrollToBottom()
  } catch {
  }
}

function disposeXtermRuntime(runtime: XtermRuntime | null) {
  if (!runtime || runtime.isDisposed) return
  runtime.isDisposed = true
  runtime.terminal.dispose()
}

function clearTerminal(runtime: XtermRuntime) {
  runtime.terminal.clearSelection()
  runtime.terminal.clear()
  scrollTerminalToBottom(runtime.terminal)
}

function paneDotClassName(pane: TerminalPane): string {
  if (pane.isRunning) return "animate-pulse bg-emerald-300"
  return "bg-slate-500"
}

function shortTerminalPaneTitle(title: string): string {
  const normalizedTitle = title.trim()
  if (normalizedTitle.length <= 8) return normalizedTitle
  const tailSegment = normalizedTitle.split(/[-_:./\\]+/).filter(Boolean).at(-1)
  if (tailSegment && tailSegment.length >= 4 && tailSegment.length <= 8) return tailSegment
  return normalizedTitle.slice(-6)
}

function pruneWrittenChunkIds(writtenChunkIds: Set<string>, currentChunkIds: Set<string>) {
  for (const chunkId of Array.from(writtenChunkIds)) {
    if (!currentChunkIds.has(chunkId)) writtenChunkIds.delete(chunkId)
  }
}

function installTerminalKeyHandlers(terminal: XtermTerminal) {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== "keydown") return true
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c" && terminal.hasSelection()) {
      event.preventDefault()
      event.stopPropagation()
      void writeClipboardText(terminal.getSelection()).catch((error) => {
        console.warn("[terminal] copy selection failed:", error)
      })
      return false
    }
    if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault()
      event.stopPropagation()
      terminal.clearSelection()
      terminal.clear()
      scrollTerminalToBottom(terminal)
      return false
    }
    return true
  })
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "true")
  textarea.style.position = "fixed"
  textarea.style.left = "-9999px"
  textarea.style.top = "0"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand("copy")
  textarea.remove()
  if (!copied) throw new Error("document.execCommand copy failed")
}
