import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState, type DragEvent } from "react"

import { createPromptSnippet, type PromptSnippet } from "@/features/studio/studioApi"
import { SavePromptTemplateDialog } from "@/features/agents/components/SavePromptTemplateDialog"
import { DarkSelect } from "@/shared/components/DarkSelect"
import { cn, themeClassNames } from "@/shared/theme/classes"

export type PromptDraft = {
  kind: "text" | "template"
  text: string
  template_id: string
}

type SaveTemplateTarget = {
  index: number
  text: string
  name: string
  category: string
}

export function PromptSegmentsEditor({ value, snippets, onChange }: { value: PromptDraft[]; snippets: PromptSnippet[]; onChange: (value: PromptDraft[]) => void }) {
  const qc = useQueryClient()
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [collapsedIndexes, setCollapsedIndexes] = useState<Set<number>>(() => new Set())
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const [saveTarget, setSaveTarget] = useState<SaveTemplateTarget | null>(null)

  const createTemplateMut = useMutation({ mutationFn: createPromptSnippet })

  function update(index: number, next: PromptDraft) {
    onChange(value.map((item, itemIndex) => (itemIndex === index ? next : item)))
  }

  function remove(index: number) {
    onChange(value.filter((_, itemIndex) => itemIndex !== index))
    setCollapsedIndexes((current) => {
      const next = new Set<number>()
      current.forEach((itemIndex) => {
        if (itemIndex < index) next.add(itemIndex)
        if (itemIndex > index) next.add(itemIndex - 1)
      })
      return next
    })
  }

  function moveSegment(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return
    const next = [...value]
    const [segment] = next.splice(fromIndex, 1)
    next.splice(toIndex, 0, segment)
    onChange(next)
    setCollapsedIndexes((current) => {
      const nextCollapsed = new Set<number>()
      const movedCollapsed = current.has(fromIndex)
      current.forEach((itemIndex) => {
        if (itemIndex === fromIndex) return
        if (fromIndex < toIndex && itemIndex > fromIndex && itemIndex <= toIndex) {
          nextCollapsed.add(itemIndex - 1)
          return
        }
        if (fromIndex > toIndex && itemIndex >= toIndex && itemIndex < fromIndex) {
          nextCollapsed.add(itemIndex + 1)
          return
        }
        nextCollapsed.add(itemIndex)
      })
      if (movedCollapsed) nextCollapsed.add(toIndex)
      return nextCollapsed
    })
  }

  function toggleCollapsed(index: number) {
    setCollapsedIndexes((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  function openSaveTemplateDialog(index: number, text: string) {
    const trimmedText = text.trim()
    if (!trimmedText) return
    createTemplateMut.reset()
    setSaveTarget({
      index,
      text: trimmedText,
      name: suggestTemplateName(trimmedText, snippets),
      category: "agent",
    })
  }

  async function saveTextAsTemplate(name: string, category: string) {
    if (!saveTarget) return
    setSavingIndex(saveTarget.index)
    try {
      const snippet = await createTemplateMut.mutateAsync({ name, text: saveTarget.text, category })
      await qc.invalidateQueries({ queryKey: ["prompts"] })
      update(saveTarget.index, { kind: "template", text: "", template_id: snippet.name })
      setCollapsedIndexes((current) => {
        const next = new Set(current)
        next.delete(saveTarget.index)
        return next
      })
      setSaveTarget(null)
    } finally {
      setSavingIndex(null)
    }
  }

  function handleDragStart(event: DragEvent, index: number) {
    setDraggedIndex(index)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", String(index))
  }

  function handleDrop(event: DragEvent, index: number) {
    event.preventDefault()
    const sourceIndex = draggedIndex ?? Number(event.dataTransfer.getData("text/plain"))
    if (Number.isInteger(sourceIndex)) moveSegment(sourceIndex, index)
    setDraggedIndex(null)
    setDragOverIndex(null)
  }

  const existingTemplateNames = snippets.map((snippet) => snippet.name)
  const saveError = createTemplateMut.error instanceof Error ? createTemplateMut.error.message : ""

  return (
    <>
      <div className="space-y-3">
        {value.length === 0 && <EmptyText />}
        {value.map((segment, index) => (
          <div
            key={index}
            draggable
            onDragStart={(event) => handleDragStart(event, index)}
            onDragEnd={() => {
              setDraggedIndex(null)
              setDragOverIndex(null)
            }}
            onDragOver={(event) => {
              event.preventDefault()
              event.dataTransfer.dropEffect = "move"
              setDragOverIndex(index)
            }}
            onDragLeave={() => setDragOverIndex((current) => (current === index ? null : current))}
            onDrop={(event) => handleDrop(event, index)}
            className={[
              "cursor-grab rounded border bg-app-surface-muted/90 p-3 transition active:cursor-grabbing",
              dragOverIndex === index && draggedIndex !== index ? "border-app-accent-muted/50" : "border-app-border/80",
            ].join(" ")}
          >
            {segment.kind === "template" ? (
              <div className="flex gap-2">
                <DarkSelect
                  value={segment.template_id}
                  onChange={(template_id) => update(index, { ...segment, template_id })}
                  options={[{ value: "", label: "选择提示词模板" }, ...snippets.map((snippet) => ({ value: snippet.name, label: snippet.name }))]}
                  placeholder="选择提示词模板"
                  containerClassName="min-w-0 flex-1"
                  mono
                />
                <button type="button" onClick={() => remove(index)} className={cn("shrink-0", themeClassNames.button.dangerInline)}>
                  删除
                </button>
              </div>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => toggleCollapsed(index)} className="rounded bg-app-surface/70 px-2 py-1 text-xs text-app-secondary hover:bg-app-selected">
                      {collapsedIndexes.has(index) ? "展开" : "折叠"}
                    </button>
                    <button
                      type="button"
                      disabled={savingIndex === index || !segment.text.trim()}
                      onClick={() => openSaveTemplateDialog(index, segment.text)}
                      className="rounded bg-app-surface/70 px-2 py-1 text-xs text-app-secondary hover:bg-app-selected disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {savingIndex === index ? "保存中" : "保存为模板"}
                    </button>
                  </div>
                  <button type="button" onClick={() => remove(index)} className={themeClassNames.button.dangerInline}>
                    删除
                  </button>
                </div>
                {collapsedIndexes.has(index) ? (
                  <div className="line-clamp-2 rounded border border-app-border/80 bg-app-surface/80 px-3 py-2 font-mono text-xs leading-relaxed text-app-muted">{segment.text || "空文本"}</div>
                ) : (
                  <textarea value={segment.text} onChange={(event) => update(index, { ...segment, text: event.target.value })} rows={6} placeholder="系统提示词文本" className={textareaClassName("font-mono text-xs leading-relaxed")} />
                )}
              </>
            )}
          </div>
        ))}
        <div className="flex gap-2">
          <button type="button" onClick={() => onChange([...value, { kind: "text", text: "", template_id: "" }])} className="rounded bg-app-surface/70 px-2.5 py-1 text-xs text-app-secondary hover:bg-app-selected">
            添加文本
          </button>
          <button type="button" onClick={() => onChange([...value, { kind: "template", text: "", template_id: "" }])} className="rounded bg-app-surface/70 px-2.5 py-1 text-xs text-app-secondary hover:bg-app-selected">
            添加模板引用
          </button>
        </div>
      </div>
      {saveTarget && (
        <SavePromptTemplateDialog
          text={saveTarget.text}
          initialName={saveTarget.name}
          initialCategory={saveTarget.category}
          existingTemplateNames={existingTemplateNames}
          saving={createTemplateMut.isPending}
          error={saveError}
          onClose={() => setSaveTarget(null)}
          onSubmit={saveTextAsTemplate}
        />
      )}
    </>
  )
}

function EmptyText() {
  return <div className={themeClassNames.resource.emptyText}>未配置</div>
}

function suggestTemplateName(text: string, snippets: PromptSnippet[]) {
  const base = text.slice(0, 24).replace(/\s+/g, "-") || "agent-prompt"
  const existingNames = new Set(snippets.map((snippet) => snippet.name))
  if (!existingNames.has(base)) return base
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base}-${index}`
    if (!existingNames.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

function inputClassName(extra = "") {
  return cn("w-full px-3 py-1.5 text-sm", themeClassNames.form.input, extra)
}

function textareaClassName(extra = "") {
  return cn("w-full resize-y px-3 py-2 text-sm leading-relaxed", themeClassNames.form.textarea, extra)
}

