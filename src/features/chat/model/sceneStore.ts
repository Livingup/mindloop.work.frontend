import { create } from "zustand"

import type { Project } from "@/features/chat/api/sceneApi"

/**
 * 项目（Scene 模块的 Project）UI 状态。
 *
 * 项目身份由 workspace_path 定位，但后端响应 DTO 不再回传 workspace_path，
 * 因此前端同时持有 `currentProject` 与 `currentWorkspacePath` 两个字段：
 * - `currentProject`：来自 openOrCreateProject 响应（不含 workspace_path）。
 * - `currentWorkspacePath`：来自调用该接口时前端已知的 workspace_path（workspaceStore）。
 *
 * 本仓库不缓存 Scene 列表（由 react-query 管理），也不缓存当前活动场景
 * （由 chatStore.activeSceneId 管理），仅存放当前打开的项目元信息与 workspace_path。
 */
type SceneUiStore = {
  currentProject: Project | null
  currentWorkspacePath: string | null
  setCurrentProject: (project: Project | null, workspacePath: string | null) => void
  resetProject: () => void
}

export const useSceneUiStore = create<SceneUiStore>((set) => ({
  currentProject: null,
  currentWorkspacePath: null,
  setCurrentProject: (project, workspacePath) =>
    set({
      currentProject: project,
      currentWorkspacePath: project ? workspacePath : null,
    }),
  resetProject: () => set({ currentProject: null, currentWorkspacePath: null }),
}))
