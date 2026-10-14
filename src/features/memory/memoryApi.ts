import { requestJson } from "@/shared/api/httpClient"

export type WorkspaceMemoryEntry = {
  key: string
  agent_id: string
  relative_path: string
  size_bytes: number
  modified_at: number
  content_sha256: string
  summary: string
}

export type WorkspaceMemoryListResponse = {
  workspace_path: string
  memory_root_exists: boolean
  entries: WorkspaceMemoryEntry[]
}

export type WorkspaceMemoryReadResponse = WorkspaceMemoryEntry & {
  content: string
}

export type WorkspaceMemorySaveResponse = WorkspaceMemoryEntry & {
  status: string
}

export function listWorkspaceMemory(workspacePath: string) {
  return requestJson<WorkspaceMemoryListResponse>("/api/workspaces/memory/list", {
    method: "POST",
    body: { workspace_path: workspacePath },
  })
}

export function readWorkspaceMemory(workspacePath: string, agentId: string) {
  return requestJson<WorkspaceMemoryReadResponse>("/api/workspaces/memory/read", {
    method: "POST",
    body: { workspace_path: workspacePath, agent_id: agentId },
  })
}

export function saveWorkspaceMemory(body: {
  workspacePath: string
  agentId: string
  content: string
  expectedSha256: string
}) {
  return requestJson<WorkspaceMemorySaveResponse>("/api/workspaces/memory/save", {
    method: "POST",
    body: {
      workspace_path: body.workspacePath,
      agent_id: body.agentId,
      content: body.content,
      expected_sha256: body.expectedSha256,
    },
  })
}
