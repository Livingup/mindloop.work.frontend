import { Check, Circle, Copy, Loader2, XCircle } from "lucide-react"
import { createPortal } from "react-dom"
import { Link } from "react-router-dom"
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"

import type { ChatMessage } from "@/features/chat/model/chatTypes"
import { useAgentTimelineProjection } from "@/features/chat/hooks/useAgentUiProjection"
import { chatTimelineDebug } from "@/features/chat/runtime/chatTimelineDebug"
import { MAX_EXECUTION_MONITOR_BLOCKS } from "@/features/chat/runtime/runtimeConfig"
import {
  isExecutionProcessMessage,
  isTaskBoundaryMessage,
  parseExecutionProcessIterations,
  parseTaskBoundary,
  type ExecutionProcessIterationView,
  type ExecutionProcessLlmView,
  type ExecutionProcessToolView,
  type TaskBoundaryView,
} from "@/features/chat/runtime/executionProcess"

const COPY_FEEDBACK_DURATION_MS = 1200
const SIDEBAR_MONITOR_WIDTH = "clamp(28ch, 32ch, min(42ch, 36vw))"

type ToolParameterTab = "request" | "response"

type ExecutionMonitorExecutionBlock = {
  kind: "execution"
  messageId: string
  sourceMessageId: string
  createdAt: string
  round: number
  iteration: ExecutionProcessIterationView
}

type ExecutionMonitorTaskBoundaryBlock = {
  kind: "task_boundary"
  messageId: string
  createdAt: string
  boundary: TaskBoundaryView
}

type ExecutionMonitorBlock = ExecutionMonitorExecutionBlock | ExecutionMonitorTaskBoundaryBlock

/**
 * 工具流水面板。
 *
 * 该组件只从已存在的 execution_process 气泡 metadata 派生只读时间线，
 * 不创建第二套执行状态模型；左侧仍负责渲染用户可消费消息和工具结果内容。
 */
export const ExecutionMonitorPanel = memo(function ExecutionMonitorPanel({
  sceneId,
  agentInstanceId,
  hasTerminalPanel,
  presentation = "sidebar",
  headerLeading,
}: {
  sceneId: string
  agentInstanceId?: string | null
  hasTerminalPanel: boolean
  presentation?: "sidebar" | "full"
  headerLeading?: ReactNode
}) {
  const {
    blocks,
    hiddenBlockCount,
    totalToolCallCount,
    visibleToolCallCount,
    latestFingerprint,
  } = useAgentTimelineProjection(sceneId, agentInstanceId)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const panelStyle: CSSProperties | undefined = hasTerminalPanel || presentation === "full"
    ? undefined
    : {
        inlineSize: SIDEBAR_MONITOR_WIDTH,
        maxInlineSize: SIDEBAR_MONITOR_WIDTH,
      }

  useLayoutEffect(() => {
    chatTimelineDebug("timeline_panel.snapshot", { sceneId, agentInstanceId: agentInstanceId ?? "", blockCount: blocks.length, hiddenBlockCount, visibleToolCallCount })
    const element = scrollRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [latestFingerprint])


  return (
    <aside
      className={[
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-app-bg text-app-primary",
        presentation === "full" ? "w-full flex-1" : hasTerminalPanel ? "basis-[42%] shrink-0" : "shrink-0",
      ].join(" ")}
      style={panelStyle}
      aria-label="工具流水"
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-app-border/80 bg-app-shell/70 px-2">
        <div className="min-w-0">
          {headerLeading ?? (
            <div className="truncate text-xs font-semibold text-app-primary">LLM TimeLine</div>
          )}
        </div>
        <span className="shrink-0 rounded bg-app-surface/80 px-1.5 py-0.5 text-[11px] text-app-muted">
          {totalToolCallCount > 0
            ? hiddenBlockCount > 0
              ? `工具 ${visibleToolCallCount}/${totalToolCallCount} · 最近 ${MAX_EXECUTION_MONITOR_BLOCKS} 组`
              : `工具 ${totalToolCallCount}`
            : "等待工具"}
        </span>
      </header>
      <div ref={scrollRef} className="execution-monitor-scrollbar min-h-0 flex-1 overflow-y-scroll py-2 pl-1.5 pr-2.5 [scrollbar-gutter:stable]">
        {blocks.length === 0 ? (
          <div className="flex h-full min-h-[10rem] items-center justify-center text-center text-xs leading-5 text-app-muted">
            <div>执行过程会在这里以紧凑流水展示。<br />左侧只保留用户可消费内容。</div>
          </div>
        ) : (
          <div className="space-y-0.5">
            {hiddenBlockCount > 0 ? (
              <div className="mb-1 rounded-md border border-app-border/70 bg-app-shell/70 px-2 py-1 text-center text-[11px] text-app-muted">
                已隐藏更早 {hiddenBlockCount} 组，仅显示最近 {MAX_EXECUTION_MONITOR_BLOCKS} 组
              </div>
            ) : null}
            {blocks.map((block) => (
              block.kind === "task_boundary"
                ? <ExecutionMonitorTaskBoundaryView key={block.messageId} block={block} />
                : <ExecutionMonitorBlockView key={block.messageId} block={block} />
            ))}
          </div>
        )}
      </div>
    </aside>
  )
})

function ExecutionMonitorBlockView({ block }: { block: ExecutionMonitorExecutionBlock }) {
  return (
    <div className="border-b border-app-border/70 py-2 last:border-b-0">
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1 text-[10px] uppercase tracking-[0.14em] text-app-subtle">
        <span>Execution · 第 {block.round} 轮</span>
        <span>{formatTime(block.createdAt)}</span>
      </div>
      <ExecutionMonitorIteration iteration={block.iteration} />
    </div>
  )
}

function ExecutionMonitorTaskBoundaryView({ block }: { block: ExecutionMonitorTaskBoundaryBlock }) {
  const failed = block.boundary.status === "failed"
  const cancelled = block.boundary.status === "cancelled"
  return (
    <div className="border-b border-app-border/70 py-2 last:border-b-0" role="separator" aria-label={block.boundary.label}>
      <div className={`flex items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-[11px] ${
        failed
          ? "border-app-danger-border bg-app-danger-surface text-app-danger"
          : cancelled
            ? "border-app-border bg-app-surface text-app-muted"
            : "border-app-success-border bg-app-success-surface text-app-success"
      }`}>
        <span className="font-medium">{block.boundary.label}</span>
        <span className="shrink-0 text-app-subtle">{formatTime(block.createdAt)}</span>
      </div>
      {block.boundary.failureMessage ? <div className="mt-1 break-words px-1 text-[11px] text-app-danger">{block.boundary.failureMessage}</div> : null}
    </div>
  )
}

function ExecutionMonitorIteration({ iteration }: { iteration: ExecutionProcessIterationView }) {
  return (
    <section className="min-w-0">
      {iteration.llm ? <LlmTimelineRow llm={iteration.llm} /> : null}
      {iteration.tools.length > 0 ? (
        <div className="ml-2 border-l border-dashed border-app-border/80 pl-2">
          {iteration.tools.map((tool) => (
            <ToolTimelineRow key={tool.toolCallId} tool={tool} />
          ))}
        </div>
      ) : null}
    </section>
  )
}

function LlmTimelineRow({ llm }: { llm: ExecutionProcessLlmView }) {
  const durationLabel = llm.durationMs !== undefined ? formatDuration(llm.durationMs) : null
  return (
    <div className="flex min-w-0 items-start gap-1.5 rounded px-1 py-1 text-xs text-app-secondary">
      <StatusIcon status={llm.status} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-max items-center gap-x-1.5 whitespace-nowrap">
          {llm.modelAlias ? (
            <>
              <span className="shrink-0 text-app-accent">{llm.modelAlias}</span>
              <span className="shrink-0 font-medium text-app-primary">·</span>
            </>
          ) : null}
          <span className="shrink-0 font-medium text-app-primary">{llm.label}</span>
          {durationLabel ? <span className="shrink-0 font-medium text-app-primary">· {durationLabel}</span> : null}
        </div>
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-app-muted">
          {llm.attemptLabel ? <span>{llm.attemptLabel}</span> : null}
          {llm.llmRequestId ? <LlmRequestIdChip requestId={llm.llmRequestId} /> : null}
          {llm.contentStarted ? <span>· 正文在左侧</span> : null}
        </div>
        {llm.errorMessage ? <div className="mt-0.5 break-words text-[11px] text-app-danger">{llm.errorMessage}</div> : null}
      </div>
    </div>
  )
}

function ToolTimelineRow({ tool }: { tool: ExecutionProcessToolView }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<ToolParameterTab>("request")
  return (
    <div className="flex min-w-0 items-start gap-1.5 rounded px-1 py-1 text-xs text-app-secondary">
      <StatusIcon status={tool.status} compact />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setDetailsOpen(true)}
            className="min-w-0 truncate rounded font-mono text-[12px] font-medium text-app-primary underline-offset-2 transition hover:text-app-accent hover:underline focus:outline-none focus:ring-1 focus:ring-app-accent/40"
            title="查看工具请求和响应参数"
            aria-label={`查看工具 ${tool.toolName} 的请求和响应参数`}
          >
            {tool.toolName}
          </button>
          <span className="shrink-0 text-[11px] text-app-muted">{toolDurationLabel(tool)}</span>
        </div>
        {tool.title !== tool.toolName ? <div className="truncate text-[11px] text-app-muted">{tool.title}</div> : null}
        {tool.errorMessage ? <div className="mt-0.5 break-words text-[11px] text-app-danger">{tool.errorMessage}</div> : null}
      </div>
      {detailsOpen ? (
        <ToolParametersDialog
          tool={tool}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          onClose={() => setDetailsOpen(false)}
        />
      ) : null}
    </div>
  )
}

function LlmRequestIdChip({ requestId }: { requestId: string }) {
  const [copied, setCopied] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    }
  }, [])
  const handleCopy = () => {
    void writeClipboardText(requestId).then(() => {
      setCopied(true)
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
      copyFeedbackTimeoutRef.current = window.setTimeout(() => setCopied(false), COPY_FEEDBACK_DURATION_MS)
    })
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <Link
        to={`/logs/llm-http?id=${encodeURIComponent(requestId)}`}
        className="max-w-[13rem] truncate font-mono text-app-muted transition hover:text-app-primary hover:underline"
        title={requestId}
      >
        · id:{shortRequestId(requestId)}
      </Link>
      <button
        type="button"
        onClick={handleCopy}
        className="inline-flex size-4 shrink-0 items-center justify-center rounded text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary focus:outline-none focus:ring-1 focus:ring-app-accent/40"
        title="复制 LLM Request ID"
        aria-label="复制 LLM Request ID"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
      </button>
    </span>
  )
}

function ToolParametersDialog({
  tool,
  activeTab,
  onActiveTabChange,
  onClose,
}: {
  tool: ExecutionProcessToolView
  activeTab: ToolParameterTab
  onActiveTabChange: (tab: ToolParameterTab) => void
  onClose: () => void
}) {
  const value = activeTab === "request" ? tool.argumentsPreview : tool.resultPreview
  const formattedParameters = formatToolParameters(value, activeTab)
  const [copySucceeded, setCopySucceeded] = useState(false)
  const copyFeedbackTimeoutRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (copyFeedbackTimeoutRef.current !== null) {
        window.clearTimeout(copyFeedbackTimeoutRef.current)
      }
    }
  }, [])
  useEffect(() => {
    setCopySucceeded(false)
  }, [activeTab])
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [onClose])
  const handleCopyParameters = () => {
    void writeClipboardText(formattedParameters)
      .then(() => {
        setCopySucceeded(true)
        if (copyFeedbackTimeoutRef.current !== null) {
          window.clearTimeout(copyFeedbackTimeoutRef.current)
        }
        copyFeedbackTimeoutRef.current = window.setTimeout(() => {
          setCopySucceeded(false)
          copyFeedbackTimeoutRef.current = null
        }, COPY_FEEDBACK_DURATION_MS)
      })
      .catch((error) => {
        console.warn("[execution-monitor] copy tool parameters failed:", error)
      })
  }
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`查看工具参数 ${tool.toolName}`}>
      <button type="button" aria-label="关闭工具参数浮层" className="absolute inset-0 cursor-default" onClick={onClose} />
      <div className="relative z-10 flex max-h-[82vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-app-border/80 bg-app-bg shadow-2xl shadow-slate-950/25">
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-app-border/80 bg-app-shell/80 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate font-mono text-sm font-medium text-app-primary">{tool.toolName}</div>
            {tool.title !== tool.toolName ? <div className="truncate text-xs text-app-muted">{tool.title}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded px-2 py-1 text-xs text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary focus:outline-none focus:ring-2 focus:ring-app-accent/30"
          >
            关闭
          </button>
        </div>
        <div className="flex shrink-0 items-end gap-3 border-b border-app-border/80 px-3 pt-2">
          <div className="flex min-w-0">
            <ToolParameterTabButton active={activeTab === "request"} onClick={() => onActiveTabChange("request")}>
              请求
            </ToolParameterTabButton>
            <ToolParameterTabButton active={activeTab === "response"} onClick={() => onActiveTabChange("response")}>
              响应
            </ToolParameterTabButton>
          </div>
          <button
            type="button"
            onClick={handleCopyParameters}
            title={copySucceeded ? "已复制" : activeTab === "request" ? "复制请求 JSON" : "复制响应 JSON"}
            aria-label={copySucceeded ? "已复制" : activeTab === "request" ? "复制请求 JSON" : "复制响应 JSON"}
            className={[
              "mb-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded text-xs transition focus:outline-none focus:ring-2",
              copySucceeded
                ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 focus:ring-emerald-400"
                : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary focus:ring-app-accent/30",
            ].join(" ")}
          >
            {copySucceeded ? <Check size={13} /> : <Copy size={13} />}
          </button>
        </div>
        <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-app-bg p-4 font-mono text-xs leading-relaxed text-app-primary">
          {formattedParameters}
        </pre>
      </div>
    </div>,
    document.body,
  )
}

function ToolParameterTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-t-lg px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-app-accent/30",
        active
          ? "border border-b-app-bg border-app-border/80 bg-app-bg text-app-primary"
          : "border border-transparent text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

function StatusIcon({
  status,
  compact = false,
}: {
  status: ExecutionProcessLlmView["status"] | ExecutionProcessToolView["status"]
  compact?: boolean
}) {
  const size = compact ? 12 : 14
  if (status === "waiting" || status === "thinking" || status === "running") {
    return <Loader2 size={size} className="mt-0.5 shrink-0 animate-spin text-app-accent" />
  }
  if (status === "completed") {
    return <Check size={size} className="mt-0.5 shrink-0 text-app-success" />
  }
  if (status === "failed") {
    return <XCircle size={size} className="mt-0.5 shrink-0 text-app-danger" />
  }
  if (status === "cancelled") {
    return <XCircle size={size} className="mt-0.5 shrink-0 text-app-muted" />
  }
  return <Circle size={size} className="mt-0.5 shrink-0 text-app-muted" />
}

export function buildExecutionMonitorBlocks(messages: ChatMessage[]): ExecutionMonitorBlock[] {
  const blocks: ExecutionMonitorBlock[] = []
  let previousExecutionRound = 0
  for (const message of messages) {
    if (isTaskBoundaryMessage(message)) {
      const boundary = parseTaskBoundary(message.content.metadata ?? {})
      if (!boundary) continue
      blocks.push({
        kind: "task_boundary",
        messageId: message.id,
        createdAt: message.createdAt,
        boundary,
      })
      previousExecutionRound = 0
      continue
    }
    if (!isExecutionProcessMessage(message)) continue
    const iterations = parseExecutionProcessIterations(message.content.metadata ?? {})
    if (iterations.length === 0) continue
    const persistedRound = executionRoundFromMetadata(message.content.metadata)
    iterations.forEach((iteration, iterationIndex) => {
      const round = iterationIndex === 0 && persistedRound !== undefined
        ? persistedRound
        : previousExecutionRound + 1
      blocks.push({
        kind: "execution",
        messageId: `${message.id}:${iteration.id}`,
        sourceMessageId: message.id,
        createdAt: message.createdAt,
        round,
        iteration,
      })
      previousExecutionRound = round
    })
  }
  return blocks
}

function executionRoundFromMetadata(metadata: Record<string, unknown> | undefined): number | undefined {
  const value = metadata?.execution_round
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.trunc(value) : undefined
}

function countToolCalls(blocks: ExecutionMonitorBlock[]): number {
  return blocks.reduce((sum, block) => {
    if (block.kind === "task_boundary") return sum
    return sum + block.iteration.tools.length
  }, 0)
}

function latestTimelineFingerprint(blocks: ExecutionMonitorBlock[]): string {
  const block = blocks[blocks.length - 1]
  if (!block) return "empty"
  if (block.kind === "task_boundary") {
    return [block.messageId, block.boundary.status, block.boundary.completedAt].join(":")
  }
  const iteration = block.iteration
  const lastTool = iteration.tools[iteration.tools.length - 1]
  return [
    block.messageId,
    block.round,
    iteration.id,
    iteration.llm?.status ?? "no-llm",
    iteration.llm?.durationMs ?? "",
    lastTool?.toolCallId ?? "no-tool",
    lastTool?.status ?? "",
    lastTool?.durationMs ?? "",
  ].join(":")
}

function toolDurationLabel(tool: Pick<ExecutionProcessToolView, "status" | "durationMs" | "source">): string {
  if (tool.status === "running") return tool.source === "llm_generated" ? "生成中..." : "执行中..."
  if (tool.status === "cancelled") return "已取消"
  if (tool.status === "failed") return "失败"
  return tool.durationMs !== undefined ? formatDuration(tool.durationMs) : "完成"
}

function formatTime(value: string): string {
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleTimeString()
}

function formatDuration(durationMs: number): string {
  if (durationMs >= 1000) {
    const seconds = durationMs / 1000
    return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`
  }
  return `${durationMs}ms`
}

function shortRequestId(requestId: string): string {
  if (requestId.length <= 24) return requestId
  return `${requestId.slice(0, 12)}…${requestId.slice(-8)}`
}

function formatToolParameters(value: unknown, tab: ToolParameterTab): string {
  if (value === undefined || value === null || (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0)) {
    return tab === "request" ? "暂无请求参数" : "暂无响应参数"
  }
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

async function writeClipboardText(text: string): Promise<void> {
  if (!text) return
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.style.position = "fixed"
  textarea.style.opacity = "0"
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand("copy")
  document.body.removeChild(textarea)
}
