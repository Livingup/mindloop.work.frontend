import { useQuery } from "@tanstack/react-query"
import { Check, Copy } from "lucide-react"
import { useMemo, useState } from "react"

import {
  listPromptBuiltinVariables,
  type PromptBuiltinVariable,
} from "@/features/studio/studioApi"
import { Badge } from "@/shared/components/Badge"
import {
  ResourceManagementLayout,
  StatusText,
  countBy,
  filterOptionsFromCounts,
  matchesQuery,
} from "@/shared/components/ResourceManagement"

const CATEGORY_MAP: Record<string, { label: string; tone: "slate" | "blue" | "green" | "amber" | "red" | "purple" }> = {
  identity: { label: "身份标识", tone: "blue" },
  environment: { label: "运行环境", tone: "purple" },
  tools: { label: "本地工具", tone: "green" },
  learning_files: { label: "专属文件", tone: "amber" },
  mcp: { label: "MCP服务", tone: "blue" },
  subagent: { label: "子Agent", tone: "purple" },
  lifecycle: { label: "生命周期", tone: "red" },
}

export function PromptVariablesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["prompt-builtin-variables"],
    queryFn: listPromptBuiltinVariables,
  })

  const variables = data ?? []
  const [search, setSearch] = useState("")
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [copiedPlaceholder, setCopiedPlaceholder] = useState<string | null>(null)

  const handleCopy = async (placeholder: string) => {
    try {
      await navigator.clipboard.writeText(placeholder)
      setCopiedPlaceholder(placeholder)
      setTimeout(() => {
        setCopiedPlaceholder((current) => (current === placeholder ? null : current))
      }, 2000)
    } catch {
      // ignore clipboard error
    }
  }

  const categoryOptions = useMemo(() => {
    const rawCounts = countBy(variables, (item) => item.category || "other")
    const options = filterOptionsFromCounts(rawCounts, variables.length)
    return options.map((opt) => ({
      ...opt,
      label: CATEGORY_MAP[opt.value]?.label || opt.label,
    }))
  }, [variables])

  const filtered = useMemo(() => {
    return variables.filter((v) => {
      const category = v.category || "other"
      if (activeCategory && category !== activeCategory) return false
      const categoryLabel = CATEGORY_MAP[category]?.label || category
      return matchesQuery([v.placeholder, v.name, v.description, v.value_logic, category, categoryLabel], search)
    })
  }, [activeCategory, search, variables])

  return (
    <ResourceManagementLayout
      count={variables.length}
      searchValue={search}
      onSearchChange={setSearch}
      searchPlaceholder="搜索占位符 / 变量名称 / 含义说明 / 取值逻辑..."
      primaryFilters={categoryOptions}
      activePrimary={activeCategory}
      onPrimaryChange={setActiveCategory}
    >
      <StatusText isLoading={isLoading} error={error} empty={!isLoading && !error && filtered.length === 0} />

      {!isLoading && !error && filtered.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-app-border/80 bg-app-surface/70 shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-xs">
              <thead className="border-b border-app-border/80 bg-app-surface/90 text-app-muted">
                <tr>
                  <th className="w-[15rem] min-w-[14rem] px-4 py-3 font-medium">占位符 (Placeholder)</th>
                  <th className="w-[12rem] min-w-[10rem] px-4 py-3 font-medium">变量名称</th>
                  <th className="w-[7rem] min-w-[6rem] px-4 py-3 font-medium">所属分类</th>
                  <th className="min-w-[16rem] px-4 py-3 font-medium">含义说明</th>
                  <th className="min-w-[18rem] px-4 py-3 font-medium">取值逻辑说明</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-app-border/60 text-app-secondary">
                {filtered.map((item) => {
                  const isCopied = copiedPlaceholder === item.placeholder
                  const catMeta = CATEGORY_MAP[item.category] || { label: item.category, tone: "slate" as const }
                  return (
                    <tr key={item.placeholder} className="transition hover:bg-app-surface/90">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <code className="rounded border border-app-border/80 bg-app-surface px-2 py-1 font-mono text-[11px] font-medium text-blue-600 dark:text-blue-400">
                            {item.placeholder}
                          </code>
                          <button
                            type="button"
                            onClick={() => void handleCopy(item.placeholder)}
                            title={isCopied ? "已复制到剪贴板" : "复制占位符"}
                            className="inline-flex h-6 w-6 items-center justify-center rounded text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary"
                          >
                            {isCopied ? <Check size={13} className="text-emerald-600 dark:text-emerald-400" /> : <Copy size={13} />}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-medium text-app-primary">
                        {item.name}
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={catMeta.tone}>{catMeta.label}</Badge>
                      </td>
                      <td className="px-4 py-3 leading-relaxed text-app-secondary">
                        {item.description}
                      </td>
                      <td className="px-4 py-3">
                        <div className="rounded border border-app-border/60 bg-app-bg/80 p-2 text-[11px] leading-relaxed text-app-muted">
                          {item.value_logic}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </ResourceManagementLayout>
  )
}
