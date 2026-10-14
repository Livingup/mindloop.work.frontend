import { HttpError, requestJson } from "@/shared/api/httpClient"
import { isRuntimeAuthInvalidError } from "@/shared/api/runtimeAuthInvalidation"

export type LineRange = {
  start_line: number
  end_line: number
}

export type RawPromptEntry = string | { prompt: string; timestamp?: string }

export type MissionItem = {
  mission_id: string
  task_id: string
  scene_id?: string | null
  agent_instance_id: string
  title: string
  raw_prompts?: RawPromptEntry[] | null
  refined_requirement?: string | null
  status: "pending" | "in_progress" | "completed" | "abandoned"
  outcome_summary?: string | null
  pruned_at?: string | null
  sort_order?: number
  created_at?: string
}

export type WorkspaceContextItem = {
  context_id: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  source_type: "file" | "directory" | "web_search" | "url_context" | "terminal" | "other"
  description?: string | null
  path?: string | null
  line_ranges?: LineRange[] | null
  directory_structure?: string | null
  search_content?: string | null
  core_result_content?: string | null
  reference_links?: string[] | null
  url_list?: string[] | null
  core_content?: string | null
  command_id?: string | null
  important_content?: string | null
  content?: string | null
  created_at?: string
}

export type SolutionItem = {
  solution_id?: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  solution_content: string
  solution_status: "active" | "superseded"
  created_at?: string
}

export type DecisionItem = {
  decision_id: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  decision_content: string
  rationale: string
  alternatives?: string | null
  impact?: string | null
  decision_status: "active" | "superseded"
  superseded_reason?: string | null
  created_at?: string
}

export type TodoItem = {
  todo_id: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  priority: number
  todo_content: string
  status: "未开始" | "执行中" | "已完成"
  created_at?: string
}

export type ProgressItem = {
  progress_id?: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  completed_summary: string
  current_work: string
  current_blockers?: string | null
  recent_validation?: string | null
  next_step: string
  handoff_notes?: string | null
  created_at?: string
}

export type DiscoveryItem = {
  discovery_id: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  discovery_content: string
  impact: string
  source_type?: string | null
  source_path?: string | null
  line_ranges?: LineRange[] | null
  command_id?: string | null
  reference_url?: string | null
  created_at?: string
}

export type IssueItem = {
  issue_id: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  issue_content: string
  impact: string
  status: "open" | "in_progress" | "blocked" | "resolved" | "wont_fix"
  next_action?: string | null
  closure_condition?: string | null
  resolution?: string | null
  source_type?: string | null
  command_id?: string | null
  created_at?: string
}

export type ArtifactEditBlock = {
  feature_desc?: string | null
  search_lines?: string[]
  replace_lines?: string[]
  start_line?: number | null
  end_line?: number | null
  deleted_lines?: number | null
  inserted_lines?: number | null
}

export type ArtifactItem = {
  artifact_id: string
  task_id: string
  mission_id?: string | null
  agent_instance_id: string
  type: "file_create" | "file_modify" | "file_delete" | "file_move" | "other"
  file_path?: string | null
  edits?: ArtifactEditBlock[] | null
  content_lines?: string[] | null
  source_path?: string | null
  target_path?: string | null
  content?: string | null
  created_at?: string
}

export type ValidationItem = {
  validation_id: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  target_type: "requirement" | "todo" | "artifact" | "external_state" | "other"
  target_record_id?: string | null
  validation_method: "automated_test" | "build" | "static_check" | "manual_check" | "user_acceptance"
  validation_scope: string
  conclusion: "passed" | "failed" | "partial" | "not_completed"
  uncovered_scope?: string | null
  validation_content: string
  source_type: string
  command_id?: string | null
  source_path?: string | null
  line_ranges?: LineRange[] | null
  created_at?: string
}

export type ExternalStateItem = {
  external_state_id: string
  task_id: string
  mission_id: string
  agent_instance_id: string
  target_type: "environment" | "service" | "database" | "external_api" | "process" | "other"
  target_identifier: string
  change_content: string
  current_state: string
  reversibility: "reversible" | "irreversible" | "unknown"
  rollback_info?: string | null
  command_id?: string | null
  created_at?: string
}

export type CommandItem = {
  command_id: string
  task_id: string
  agent_instance_id: string
  command_line: string
  created_at?: string
}

export type AgentRelationshipItem = {
  relationship_id: string
  task_id: string
  mission_id?: string | null
  agent_instance_id: string
  target_agent_type: "child" | "parent"
  target_agent_instance_id: string
  delegation_content?: string | null
  fork_message_id?: string | null
  status: "unreleased" | "released"
  created_at?: string
}

export type AgentMessageItem = {
  message_id: string
  task_id: string
  mission_id?: string | null
  agent_instance_id: string
  target_agent_instance_id: string
  target_agent_type: "child" | "parent"
  message_type: "send" | "receive"
  message: string
  created_at?: string
}

export type RemoteAgentMessageItem = {
  remote_message_id: string
  task_id: string
  mission_id?: string | null
  agent_instance_id: string
  remote_agent_instance_id: string
  message_type: "send" | "receive"
  message: string
  created_at?: string
}

export type TaskNoteWatermark = {
  /** @deprecated 固定为 0 */
  covered_until_seq: number
  covered_until_message_id: string | null
  note_version: number
  updated_at: string | null
  agent_instance_id?: string
  task_id?: string
  inherited_processed?: boolean
}

export type TaskNoteUnbound = {
  artifacts: ArtifactItem[]
  agent_relationships: AgentRelationshipItem[]
  agent_messages: AgentMessageItem[]
  remote_agent_messages: RemoteAgentMessageItem[]
}

export type TaskNoteSnapshotData = {
  task_id: string
  agent_instance_id: string
  missions: MissionItem[]
  workspace_context: WorkspaceContextItem[]
  solutions?: SolutionItem[]
  /** @deprecated 兼容字段 */
  solution?: SolutionItem | null
  decisions: DecisionItem[]
  todos: TodoItem[]
  progresses?: ProgressItem[]
  /** @deprecated 兼容字段 */
  progress?: ProgressItem | null
  discoveries: DiscoveryItem[]
  issues: IssueItem[]
  artifacts: ArtifactItem[]
  validations: ValidationItem[]
  external_states: ExternalStateItem[]
  commands: CommandItem[]
  agent_relationships: AgentRelationshipItem[]
  agent_messages: AgentMessageItem[]
  remote_agent_messages: RemoteAgentMessageItem[]
}

export type TaskNoteResponse = {
  task_id: string
  agent_instance_id: string
  /** @deprecated */
  mission_id?: string | null
  watermark?: TaskNoteWatermark
  observing?: boolean
  unbound?: TaskNoteUnbound
  snapshot: TaskNoteSnapshotData
  markdown: string
}

export const taskNoteKeys = {
  all: ["task-note"] as const,
  detail: (taskId?: string | null, agentInstanceId?: string | null) =>
    ["task-note", taskId ?? null, agentInstanceId ?? null] as const,
}

function normalizeArtifactItem(raw: any): ArtifactItem {
  let edits = raw.edits
  if (typeof edits === "string") {
    try {
      edits = JSON.parse(edits)
    } catch {
      edits = null
    }
  }
  if (!Array.isArray(edits)) {
    edits = null
  }

  let type = raw.type
  if (type === "create") type = "file_create"
  else if (type === "modify") type = "file_modify"
  else if (type === "delete") type = "file_delete"
  else if (type === "move") type = "file_move"

  return {
    ...raw,
    type,
    edits,
  }
}

export function normalizeTaskNoteResponse(raw: TaskNoteResponse): TaskNoteResponse {
  const rawSnapshot = raw?.snapshot ?? ({} as any)
  const rawArtifacts = Array.isArray(rawSnapshot.artifacts) ? rawSnapshot.artifacts : []
  const normalizedArtifacts = rawArtifacts.map(normalizeArtifactItem)

  const rawUnbound = raw?.unbound ?? ({} as any)
  const rawUnboundArtifacts = Array.isArray(rawUnbound.artifacts) ? rawUnbound.artifacts : []
  const normalizedUnboundArtifacts = rawUnboundArtifacts.map(normalizeArtifactItem)

  const unbound: TaskNoteUnbound = {
    artifacts: normalizedUnboundArtifacts,
    agent_relationships: Array.isArray(rawUnbound.agent_relationships) ? rawUnbound.agent_relationships : [],
    agent_messages: Array.isArray(rawUnbound.agent_messages) ? rawUnbound.agent_messages : [],
    remote_agent_messages: Array.isArray(rawUnbound.remote_agent_messages) ? rawUnbound.remote_agent_messages : [],
  }

  const watermark: TaskNoteWatermark = raw?.watermark
    ? {
        covered_until_seq: raw.watermark.covered_until_seq ?? 0,
        covered_until_message_id: raw.watermark.covered_until_message_id ?? null,
        note_version: raw.watermark.note_version ?? 0,
        updated_at: raw.watermark.updated_at ?? null,
      }
    : {
        covered_until_seq: 0,
        covered_until_message_id: null,
        note_version: 0,
        updated_at: null,
      }

  const observing = typeof raw?.observing === "boolean" ? raw.observing : false

  const snapshot: TaskNoteSnapshotData = {
    task_id: rawSnapshot.task_id ?? raw?.task_id ?? "",
    agent_instance_id: rawSnapshot.agent_instance_id ?? raw?.agent_instance_id ?? "",
    missions: Array.isArray(rawSnapshot.missions) ? rawSnapshot.missions : [],
    workspace_context: Array.isArray(rawSnapshot.workspace_context) ? rawSnapshot.workspace_context : [],
    solutions: Array.isArray(rawSnapshot.solutions) ? rawSnapshot.solutions : undefined,
    solution: rawSnapshot.solution ?? null,
    decisions: Array.isArray(rawSnapshot.decisions) ? rawSnapshot.decisions : [],
    todos: Array.isArray(rawSnapshot.todos) ? rawSnapshot.todos : [],
    progresses: Array.isArray(rawSnapshot.progresses) ? rawSnapshot.progresses : undefined,
    progress: rawSnapshot.progress ?? null,
    discoveries: Array.isArray(rawSnapshot.discoveries) ? rawSnapshot.discoveries : [],
    issues: Array.isArray(rawSnapshot.issues) ? rawSnapshot.issues : [],
    artifacts: normalizedArtifacts,
    validations: Array.isArray(rawSnapshot.validations) ? rawSnapshot.validations : [],
    external_states: Array.isArray(rawSnapshot.external_states) ? rawSnapshot.external_states : [],
    commands: Array.isArray(rawSnapshot.commands) ? rawSnapshot.commands : [],
    agent_relationships: Array.isArray(rawSnapshot.agent_relationships) ? rawSnapshot.agent_relationships : [],
    agent_messages: Array.isArray(rawSnapshot.agent_messages) ? rawSnapshot.agent_messages : [],
    remote_agent_messages: Array.isArray(rawSnapshot.remote_agent_messages) ? rawSnapshot.remote_agent_messages : [],
  }

  return {
    ...raw,
    watermark,
    observing,
    unbound,
    snapshot,
  }
}

export async function fetchTaskNoteSnapshot(
  taskId: string,
  agentInstanceId: string,
): Promise<TaskNoteResponse> {
  const raw = await requestJson<TaskNoteResponse>(
    `/api/agent-runtime/tasks/${encodeURIComponent(taskId)}/agents/${encodeURIComponent(agentInstanceId)}/note`,
  )
  return normalizeTaskNoteResponse(raw)
}

export type TaskNoteErrorKind = "storage_unavailable" | "agent_not_found" | "other"

export function classifyTaskNoteError(error: unknown): TaskNoteErrorKind {
  if (error instanceof HttpError) {
    if (error.status === 503) return "storage_unavailable"
    if (error.status === 404) return "agent_not_found"
  }
  return "other"
}

export function shouldRetryTaskNoteQuery(failureCount: number, error: unknown): boolean {
  if (isRuntimeAuthInvalidError(error)) return false
  if (classifyTaskNoteError(error) === "agent_not_found") return false
  return failureCount < 1
}
