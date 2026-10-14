import { create } from "zustand"

export type WorkspaceSummary = {
  name: string
  path: string
}

type WorkspaceUiStore = {
  currentWorkspace: WorkspaceSummary | null
  selectedPath: string | null
  setCurrentWorkspace: (workspace: WorkspaceSummary) => void
  setSelectedPath: (path: string | null) => void
  resetWorkspace: () => void
}

// 当前工作目录是 Chat 页面的 Tab 级业务上下文：同一浏览器可以用多个标签页分别打开不同工作目录。
// 这里必须使用 sessionStorage，避免 localStorage 把某个标签页最后选择的工作目录变成所有新标签页的全局默认项目。
const TAB_WORKSPACE_STORAGE_KEY = "spread-ai.chat.workspace"

// 旧版本曾使用同名 localStorage 保存全局工作目录；新版本启动时清理它，避免历史全局状态继续影响新标签页。
const LEGACY_GLOBAL_WORKSPACE_STORAGE_KEY = TAB_WORKSPACE_STORAGE_KEY

const initialWorkspace = readStoredWorkspace()

export const useWorkspaceUiStore = create<WorkspaceUiStore>((set) => ({
  currentWorkspace: initialWorkspace,
  selectedPath: initialWorkspace?.path ?? null,
  setCurrentWorkspace: (workspace) => {
    writeStoredWorkspace(workspace)
    set({ currentWorkspace: workspace, selectedPath: workspace.path })
  },
  setSelectedPath: (path) => set({ selectedPath: path }),
  resetWorkspace: () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(TAB_WORKSPACE_STORAGE_KEY)
      window.localStorage.removeItem(LEGACY_GLOBAL_WORKSPACE_STORAGE_KEY)
    }
    set({ currentWorkspace: null, selectedPath: null })
  },
}))

function readStoredWorkspace(): WorkspaceSummary | null {
  if (typeof window === "undefined") return null
  clearLegacyGlobalWorkspace()
  try {
    const raw = window.sessionStorage.getItem(TAB_WORKSPACE_STORAGE_KEY)
    if (!raw) return null
    const value = JSON.parse(raw) as Partial<WorkspaceSummary>
    if (typeof value.name !== "string" || typeof value.path !== "string") return null
    return { name: value.name, path: value.path }
  } catch {
    return null
  }
}

function writeStoredWorkspace(workspace: WorkspaceSummary) {
  if (typeof window === "undefined") return
  window.sessionStorage.setItem(TAB_WORKSPACE_STORAGE_KEY, JSON.stringify(workspace))
}

function clearLegacyGlobalWorkspace() {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(LEGACY_GLOBAL_WORKSPACE_STORAGE_KEY)
  } catch {
    // 浏览器隐私策略可能禁用 localStorage；清理失败时保持当前 Tab 会话状态不受影响。
  }
}