import { AlertCircle, Loader2 } from "lucide-react"
import type { ReactNode } from "react"

import { HttpError } from "@/shared/api/httpClient"
import { Panel, PanelHeader } from "@/shared/components/Panel"

export function ResourceCard<TItem>({
  title,
  items,
  isLoading,
  error,
  emptyText,
  renderItem,
  getItemKey,
}: {
  title: string
  items: TItem[] | undefined
  isLoading: boolean
  error: unknown
  emptyText: string
  renderItem: (item: TItem) => ReactNode
  getItemKey: (item: TItem) => string
}) {
  const count = items?.length ?? 0

  return (
    <Panel className="flex min-h-[18rem] flex-col overflow-hidden">
      <PanelHeader
        title={title}
        action={<span className="text-xs text-app-muted">{error ? "error" : isLoading ? "loading" : count}</span>}
      />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-app-muted">
            <Loader2 size={18} className="animate-spin" />
            加载中
          </div>
        ) : error ? (
          <ErrorState error={error} />
        ) : count === 0 ? (
          <div className="rounded-2xl border border-dashed border-app-border p-4 text-sm leading-6 text-app-muted">{emptyText}</div>
        ) : (
          <div className="space-y-3">{items?.map((item) => <div key={getItemKey(item)}>{renderItem(item)}</div>)}</div>
        )}
      </div>
    </Panel>
  )
}

function ErrorState({ error }: { error: unknown }) {
  const message = error instanceof HttpError ? `${error.status} ${error.message}` : error instanceof Error ? error.message : "请求失败"

  return (
    <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-700">
      <div className="mb-2 flex items-center gap-2 font-medium">
        <AlertCircle size={16} />
        加载失败
      </div>
      <div className="break-words text-red-700/80">{message}</div>
    </div>
  )
}
