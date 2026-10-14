import { useEffect } from "react"

import { useWorkspaceUiStore } from "@/features/chat/model/workspaceStore"

const DEFAULT_DOCUMENT_TITLE = "Spread AI"

/**
 * 把当前窗口/Tab 的 document.title 同步为已打开 workspace 的根目录名。
 * - 每个 Electron 窗口与浏览器 Tab 各自持有 sessionStorage 级 workspace，因此多窗口标题互不覆盖。
 * - 未打开项目时回退产品名 Spread AI。
 * - Electron 任务栏/Alt-Tab 标题跟随 document.title，无需主进程 IPC。
 */
export function useDocumentTitleFromWorkspace() {
  const workspaceName = useWorkspaceUiStore((state) => state.currentWorkspace?.name ?? null)

  useEffect(() => {
    const nextTitle = workspaceName?.trim() || DEFAULT_DOCUMENT_TITLE
    if (document.title !== nextTitle) {
      document.title = nextTitle
    }
  }, [workspaceName])
}
