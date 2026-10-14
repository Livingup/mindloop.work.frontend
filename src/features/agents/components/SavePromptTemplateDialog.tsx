import { useEffect, useState } from "react"
import { createPortal } from "react-dom"

import { cn, themeClassNames } from "@/shared/theme/classes"

type SavePromptTemplateDialogProps = {
  text: string
  initialName: string
  initialCategory: string
  existingTemplateNames: string[]
  saving: boolean
  error: string
  onClose: () => void
  onSubmit: (name: string, category: string) => void
}

export function SavePromptTemplateDialog({
  text,
  initialName,
  initialCategory,
  existingTemplateNames,
  saving,
  error,
  onClose,
  onSubmit,
}: SavePromptTemplateDialogProps) {
  const [name, setName] = useState(initialName)
  const [category, setCategory] = useState(initialCategory)
  const [localError, setLocalError] = useState("")

  useEffect(() => {
    setName(initialName)
    setCategory(initialCategory)
    setLocalError("")
  }, [initialName, initialCategory])

  function handleSubmit() {
    const trimmedName = name.trim()
    const trimmedCategory = category.trim()
    if (!trimmedName) {
      setLocalError("模板名称不能为空")
      return
    }
    if (!trimmedCategory) {
      setLocalError("分组不能为空")
      return
    }
    if (existingTemplateNames.includes(trimmedName)) {
      setLocalError("模板名称已存在")
      return
    }
    setLocalError("")
    onSubmit(trimmedName, trimmedCategory)
  }

  return createPortal(
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center px-4 py-6", themeClassNames.layout.modalOverlay)} role="dialog" aria-modal="true" aria-labelledby="save-template-dialog-title">
      <div className="w-full max-w-xl rounded-xl border border-app-border/80 bg-app-surface p-5 shadow-2xl shadow-app-overlay/12">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 id="save-template-dialog-title" className="text-base font-semibold text-app-primary">保存为提示词模板</h3>
            <div className="mt-1 text-xs text-app-muted">填写模板名称和分组，保存后当前文本片段会替换为模板引用。</div>
          </div>
          <button type="button" onClick={onClose} disabled={saving} className="rounded px-2 py-1 text-xs text-app-muted hover:bg-app-selected hover:text-app-primary disabled:opacity-50">
            关闭
          </button>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_10rem]">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-app-muted">模板名称</span>
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="唯一描述名" className={inputClassName("font-mono")} autoFocus />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-app-muted">分组</span>
            <input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="agent" className={inputClassName()} />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="mb-1 block text-xs font-medium text-app-muted">文本预览</span>
          <textarea value={text} readOnly rows={8} className={textareaClassName("resize-none font-mono text-xs leading-relaxed text-app-secondary")} />
        </label>
        {(localError || error) && <div className={cn("mt-3", themeClassNames.state.dangerAlert)}>{localError || error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded px-3 py-1.5 text-xs text-app-secondary hover:bg-app-selected hover:text-app-primary disabled:opacity-50">
            取消
          </button>
          <button type="button" onClick={handleSubmit} disabled={saving} className={themeClassNames.button.primaryCompact}>
            {saving ? "保存中" : "保存并替换"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function inputClassName(extra = "") {
  return cn("w-full px-3 py-1.5 text-sm", themeClassNames.form.input, extra)
}

function textareaClassName(extra = "") {
  return cn("w-full resize-y px-3 py-2 text-sm leading-relaxed", themeClassNames.form.textarea, extra)
}
