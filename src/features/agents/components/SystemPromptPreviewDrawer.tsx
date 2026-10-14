import { useMemo } from "react"
import { createPortal } from "react-dom"

import type { PromptSnippet } from "@/features/studio/studioApi"
import type { PromptDraft } from "@/features/agents/components/PromptSegmentsEditor"
import { cn, themeClassNames } from "@/shared/theme/classes"

type ResolvedSegment = {
  index: number
  kind: PromptDraft["kind"]
  label: string
  content: string
  missing: boolean
}

export function SystemPromptPreviewDrawer({ segments, snippets, onClose }: { segments: PromptDraft[]; snippets: PromptSnippet[]; onClose: () => void }) {
  const { resolvedSegments, fullPrompt } = useMemo(() => resolveSystemPrompt(segments, snippets), [segments, snippets])
  const missingCount = resolvedSegments.filter((segment) => segment.missing).length

  return createPortal(
    <div className={cn("fixed inset-0 z-50 flex justify-end", themeClassNames.layout.drawerOverlay)} role="dialog" aria-modal="true" aria-labelledby="system-prompt-preview-title">
      <button type="button" aria-label="关闭系统提示词预览" className="min-w-0 flex-1 cursor-default" onClick={onClose} />
      <aside className="flex h-full w-full max-w-3xl flex-col border-l border-app-border/80 bg-app-bg shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-app-border/80 px-5 py-4">
          <div className="min-w-0">
            <h3 id="system-prompt-preview-title" className="text-base font-semibold text-app-primary">系统提示词预览</h3>
            <div className="mt-1 text-xs text-app-muted">
              {segments.length} 个片段 · {fullPrompt.length} 字符{missingCount ? ` · ${missingCount} 个模板未找到` : ""}
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded px-3 py-1.5 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary">
            关闭
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
          <div className="mb-4 rounded border border-app-border/80 bg-app-surface-muted/90">
            <div className="border-b border-app-border/80 px-3 py-2 text-xs font-medium text-app-secondary">完整内容</div>
            <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap px-3 py-3 font-mono text-xs leading-6 text-app-primary">{fullPrompt || "未配置系统提示词"}</pre>
          </div>
          <div className="space-y-2">
            <div className="text-xs font-medium text-app-muted">片段明细</div>
            {resolvedSegments.length === 0 && <div className={themeClassNames.resource.emptyText}>未配置</div>}
            {resolvedSegments.map((segment) => (
              <section key={segment.index} className={cn("rounded border bg-app-surface-muted/90 p-3", segment.missing ? "border-app-warning-border" : "border-app-border/80")}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="min-w-0 truncate font-mono text-xs text-app-secondary">#{segment.index + 1} {segment.label}</div>
                  {segment.missing && <span className={cn("shrink-0", themeClassNames.badge.warning)}>模板未找到</span>}
                </div>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5 text-app-muted">{segment.content || "空内容"}</pre>
              </section>
            ))}
          </div>
        </div>
      </aside>
    </div>,
    document.body,
  )
}

function resolveSystemPrompt(segments: PromptDraft[], snippets: PromptSnippet[]) {
  const snippetsByName = new Map(snippets.map((snippet) => [snippet.name, snippet]))
  const resolvedSegments: ResolvedSegment[] = segments.map((segment, index) => {
    if (segment.kind === "template") {
      const snippet = snippetsByName.get(segment.template_id)
      return {
        index,
        kind: segment.kind,
        label: `模板 ${segment.template_id || "未选择"}`,
        content: snippet?.text ?? "",
        missing: Boolean(segment.template_id && !snippet),
      }
    }
    return {
      index,
      kind: segment.kind,
      label: "文本",
      content: segment.text,
      missing: false,
    }
  })
  return {
    resolvedSegments,
    fullPrompt: resolvedSegments.map((segment) => segment.content).filter((content) => content.trim()).join("\n\n"),
  }
}
