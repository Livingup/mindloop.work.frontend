import type {
  AgentMessageItem,
  AgentRelationshipItem,
  ArtifactItem,
  DecisionItem,
  DiscoveryItem,
  ExternalStateItem,
  IssueItem,
  MissionItem,
  ProgressItem,
  RemoteAgentMessageItem,
  SolutionItem,
  TaskNoteErrorKind,
  TaskNoteResponse,
  TodoItem,
  ValidationItem,
  WorkspaceContextItem,
} from "@/features/chat/api/taskNoteApi"
import { type FileChangeEntry, foldArtifacts } from "@/features/chat/model/taskNoteArtifacts"

export type TaskNoteView = {
  missions: MissionItem[]
  solutions: SolutionItem[]
  progresses: ProgressItem[]
  decisions: DecisionItem[]
  todos: TodoItem[]
  workspaceContexts: WorkspaceContextItem[]
  discoveries: DiscoveryItem[]
  issues: IssueItem[]
  fileChanges: FileChangeEntry[]
  otherArtifacts: ArtifactItem[]
  validations: ValidationItem[]
  externalStates: ExternalStateItem[]
  relationships: AgentRelationshipItem[]
  agentMessages: AgentMessageItem[]
  remoteMessages: RemoteAgentMessageItem[]
  missionTitleById: Record<string, string>
  commandLineById: Record<string, string>
  observing: boolean
  noteVersion: number
  updatedAtText: string | null
}

export type TaskNoteErrorView = {
  title: string
  detail: string
  retryable: boolean
}

export function isMissionPruned(m: MissionItem): boolean {
  return Boolean(m.pruned_at)
}

export function progressHasContent(p: ProgressItem | null | undefined): boolean {
  if (!p) return false
  return Boolean(
    p.current_work ||
      p.completed_summary ||
      p.current_blockers ||
      p.recent_validation ||
      p.next_step ||
      p.handoff_notes,
  )
}

export function formatTaskNoteTime(value?: string | null): string | null {
  if (!value) return null
  const parsed = Date.parse(value)
  if (Number.isNaN(parsed)) return null
  return new Date(parsed).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

export function taskNoteErrorView(kind: TaskNoteErrorKind, message: string): TaskNoteErrorView {
  switch (kind) {
    case "storage_unavailable":
      return {
        title: "Task Note 存储暂不可用",
        detail: message || "存储服务暂时无法访问，请稍后重试。",
        retryable: true,
      }
    case "agent_not_found":
      return {
        title: "Agent 实例不存在",
        detail: "该实例可能已被释放，无法读取工作手记。",
        retryable: false,
      }
    default:
      return {
        title: "无法加载 Task Note",
        detail: message || "请求失败",
        retryable: true,
      }
  }
}

function deduplicateById<T>(items: T[], getId: (item: T) => string | undefined): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const item of items) {
    const id = getId(item)
    if (!id || !seen.has(id)) {
      if (id) seen.add(id)
      result.push(item)
    }
  }
  return result
}

export function buildTaskNoteView(response?: TaskNoteResponse | null): TaskNoteView {
  if (!response || !response.snapshot) {
    return {
      missions: [],
      solutions: [],
      progresses: [],
      decisions: [],
      todos: [],
      workspaceContexts: [],
      discoveries: [],
      issues: [],
      fileChanges: [],
      otherArtifacts: [],
      validations: [],
      externalStates: [],
      relationships: [],
      agentMessages: [],
      remoteMessages: [],
      missionTitleById: {},
      commandLineById: {},
      observing: false,
      noteVersion: 0,
      updatedAtText: null,
    }
  }

  const snapshot = response.snapshot
  const unbound = response.unbound
  const missions = snapshot.missions ?? []

  const missionTitleById: Record<string, string> = {}
  const missionIndexMap = new Map<string, number>()
  missions.forEach((m, idx) => {
    if (m.mission_id) {
      missionTitleById[m.mission_id] = m.title || ""
      missionIndexMap.set(m.mission_id, idx)
    }
  })

  const commandLineById: Record<string, string> = {}
  const commands = snapshot.commands ?? []
  commands.forEach((c) => {
    if (c.command_id) {
      commandLineById[c.command_id] = c.command_line || ""
    }
  })

  // solutions
  let rawSolutions: SolutionItem[] = []
  if (Array.isArray(snapshot.solutions)) {
    rawSolutions = snapshot.solutions
  } else if (snapshot.solution) {
    rawSolutions = [snapshot.solution]
  }
  const solutions = [...rawSolutions].sort((a, b) => {
    const idxA = a.mission_id ? (missionIndexMap.get(a.mission_id) ?? 9999) : 9999
    const idxB = b.mission_id ? (missionIndexMap.get(b.mission_id) ?? 9999) : 9999
    return idxA - idxB
  })

  // progresses
  let rawProgresses: ProgressItem[] = []
  if (Array.isArray(snapshot.progresses)) {
    rawProgresses = snapshot.progresses
  } else if (snapshot.progress) {
    rawProgresses = [snapshot.progress]
  }
  const progresses = rawProgresses
    .filter(progressHasContent)
    .sort((a, b) => {
      const idxA = a.mission_id ? (missionIndexMap.get(a.mission_id) ?? 9999) : 9999
      const idxB = b.mission_id ? (missionIndexMap.get(b.mission_id) ?? 9999) : 9999
      return idxA - idxB
    })

  // 合并 4 类自动记录 (snapshot + unbound) 并去重
  const rawArtifacts = [
    ...(snapshot.artifacts ?? []),
    ...(unbound?.artifacts ?? []),
  ]
  const dedupedArtifacts = deduplicateById(rawArtifacts, (a) => a.artifact_id)
  const { files: fileChanges, others: otherArtifacts } = foldArtifacts(dedupedArtifacts)

  const rawRelationships = [
    ...(snapshot.agent_relationships ?? []),
    ...(unbound?.agent_relationships ?? []),
  ]
  const relationships = deduplicateById(rawRelationships, (r) => r.relationship_id)

  const rawAgentMessages = [
    ...(snapshot.agent_messages ?? []),
    ...(unbound?.agent_messages ?? []),
  ]
  const agentMessages = deduplicateById(rawAgentMessages, (m) => m.message_id)

  const rawRemoteMessages = [
    ...(snapshot.remote_agent_messages ?? []),
    ...(unbound?.remote_agent_messages ?? []),
  ]
  const remoteMessages = deduplicateById(rawRemoteMessages, (m) => m.remote_message_id)

  return {
    missions,
    solutions,
    progresses,
    decisions: snapshot.decisions ?? [],
    todos: snapshot.todos ?? [],
    workspaceContexts: snapshot.workspace_context ?? [],
    discoveries: snapshot.discoveries ?? [],
    issues: snapshot.issues ?? [],
    fileChanges,
    otherArtifacts,
    validations: snapshot.validations ?? [],
    externalStates: snapshot.external_states ?? [],
    relationships,
    agentMessages,
    remoteMessages,
    missionTitleById,
    commandLineById,
    observing: Boolean(response.observing),
    noteVersion: response.watermark?.note_version ?? 0,
    updatedAtText: formatTaskNoteTime(response.watermark?.updated_at),
  }
}

export function hasTaskNoteContent(response?: TaskNoteResponse | null): boolean {
  if (!response) return false
  const view = buildTaskNoteView(response)

  const hasAnyArray =
    view.missions.length > 0 ||
    view.solutions.length > 0 ||
    view.progresses.length > 0 ||
    view.decisions.length > 0 ||
    view.todos.length > 0 ||
    view.workspaceContexts.length > 0 ||
    view.discoveries.length > 0 ||
    view.issues.length > 0 ||
    view.fileChanges.length > 0 ||
    view.otherArtifacts.length > 0 ||
    view.validations.length > 0 ||
    view.externalStates.length > 0 ||
    view.relationships.length > 0 ||
    view.agentMessages.length > 0 ||
    view.remoteMessages.length > 0

  if (hasAnyArray) return true

  return view.missions.some((m) => {
    const hasTitle = Boolean(m.title)
    const hasReq = Boolean(m.refined_requirement)
    const hasPrompts = Array.isArray(m.raw_prompts) && m.raw_prompts.length > 0
    return hasTitle || hasReq || hasPrompts
  })
}
