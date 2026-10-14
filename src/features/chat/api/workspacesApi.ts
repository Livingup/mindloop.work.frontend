import { requestJson } from "@/shared/api/httpClient"
import type { WorkspaceNode } from "@/features/chat/components/WorkspaceTree"

export type WorkspaceTreeRequest = {
  directory_path: string
  max_depth?: number
  max_entries_per_directory?: number
}

export type WorkspaceTreeResponse = {
  name: string
  path: string
  children: WorkspaceNode[]
}

export type WorkspaceGitStatusRequest = {
  workspace_path: string
}

export type WorkspaceGitRepositoryStatus = {
  repository_path: string
  relative_path: string
  branch: string | null
  dirty: boolean
  display_text: string | null
  reason: string | null
}

export type WorkspaceGitStatusResponse = {
  workspace_path: string
  repositories: WorkspaceGitRepositoryStatus[]
  is_git_repository_root: boolean
  branch: string | null
  dirty: boolean
  display_text: string | null
  reason: string | null
  scan_truncated: boolean
}

export function loadWorkspaceTree(body: WorkspaceTreeRequest) {
  return requestJson<WorkspaceTreeResponse>("/api/workspaces/tree", {
    method: "POST",
    body,
  })
}

export function loadWorkspaceGitStatus(body: WorkspaceGitStatusRequest) {
  return requestJson<WorkspaceGitStatusResponse>("/api/workspaces/git-status", {
    method: "POST",
    body,
  })
}
