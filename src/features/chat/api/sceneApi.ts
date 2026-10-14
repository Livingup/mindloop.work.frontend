import { requestJson } from "@/shared/api/httpClient"

/**
 * 项目响应 DTO。项目身份由 workspace_path 定位（<workspace>/.spread-ai/project.json），
 * 因此服务端不再把 workspace_path 回传——调用方在请求里已知。前端需要同时持有 workspace_path
 * 时应在自身状态中保存调用时传入的 workspace_path。
 */
export type Project = {
  project_id: string
  name: string
  created_at: string
  last_opened_at: string
  metadata: Record<string, unknown>
}

/** 最近打开的 workspace 索引，按最近使用倒序。仅用于前端"最近项目"列表。 */
export type RecentWorkspace = {
  workspace_path: string
  project_id: string
  project_name: string
  last_opened_at: string
}

export type Scene = {
  scene_id: string
  project_id: string
  name: string
  description: string
  status: string
  bound_agent_definition_id: string
  created_at: string
  last_active_at: string
  bound_root_conversation_id: string | null
  metadata: Record<string, unknown>
}

export type OpenOrCreateProjectBody = {
  workspace_path: string
  name?: string | null
}

export type UpdateProjectBody = {
  workspace_path: string
  name?: string | null
  metadata?: Record<string, unknown> | null
}

export type CreateSceneBody = {
  workspace_path: string
  project_id: string
  name: string
  bound_agent_definition_id: string
  description?: string
  metadata?: Record<string, unknown> | null
}

export type UpdateSceneBody = { workspace_path: string } & Partial<{
  name: string
  description: string
  status: string
  metadata: Record<string, unknown> | null
}>

// ── Project ────────────────────────────────────────────────────

/** 打开或创建项目（幂等）。后端负责写入 manifest 与刷新 recent 索引。 */
export function openOrCreateProject(body: OpenOrCreateProjectBody) {
  return requestJson<Project>("/api/scene/projects/open-or-create", { method: "POST", body })
}

/** 最近打开的 workspace 列表（用于欢迎页"最近项目"）。 */
export function listRecentWorkspaces() {
  return requestJson<RecentWorkspace[]>("/api/scene/projects/recent")
}

/** 按 workspace_path 读取项目 manifest。 */
export function getProjectByWorkspacePath(workspacePath: string) {
  const qs = `?workspace_path=${encodeURIComponent(workspacePath)}`
  return requestJson<Project>(`/api/scene/projects/by-workspace${qs}`)
}

export function updateProject(body: UpdateProjectBody) {
  return requestJson<Project>("/api/scene/projects", { method: "PATCH", body })
}

export function touchProjectOpened(workspacePath: string) {
  const qs = `?workspace_path=${encodeURIComponent(workspacePath)}`
  return requestJson<Project>(`/api/scene/projects/touch${qs}`, { method: "POST" })
}

/** 从 recent 索引中移除（不删除 manifest 与 scenes.db）。 */
export function forgetWorkspace(workspacePath: string) {
  const qs = `?workspace_path=${encodeURIComponent(workspacePath)}`
  return requestJson<void>(`/api/scene/projects/recent${qs}`, { method: "DELETE" })
}

export function listScenesByProject(workspacePath: string, projectId: string) {
  const qs =
    `?workspace_path=${encodeURIComponent(workspacePath)}` +
    `&project_id=${encodeURIComponent(projectId)}`
  return requestJson<Scene[]>(`/api/scene/projects/scenes${qs}`)
}

// ── Scene ──────────────────────────────────────────────────────

export function createScene(body: CreateSceneBody) {
  return requestJson<Scene>("/api/scene/scenes", { method: "POST", body })
}

export function getScene(workspacePath: string, sceneId: string) {
  const qs = `?workspace_path=${encodeURIComponent(workspacePath)}`
  return requestJson<Scene>(`/api/scene/scenes/${encodeURIComponent(sceneId)}${qs}`)
}

export function updateScene(sceneId: string, body: UpdateSceneBody) {
  return requestJson<Scene>(`/api/scene/scenes/${encodeURIComponent(sceneId)}`, { method: "PATCH", body })
}

export function touchScene(workspacePath: string, sceneId: string) {
  const qs = `?workspace_path=${encodeURIComponent(workspacePath)}`
  return requestJson<Scene>(`/api/scene/scenes/${encodeURIComponent(sceneId)}/touch${qs}`, { method: "POST" })
}

export function deleteScene(workspacePath: string, sceneId: string) {
  const qs = `?workspace_path=${encodeURIComponent(workspacePath)}`
  return requestJson<void>(`/api/scene/scenes/${encodeURIComponent(sceneId)}${qs}`, { method: "DELETE" })
}
