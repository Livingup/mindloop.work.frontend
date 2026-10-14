import { useMutation, useQuery } from "@tanstack/react-query"
import { X } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"
import { useNavigate } from "react-router-dom"

import {
  attachScene,
  completeCurrentSceneTask,
  createSceneChatBubble,
  deleteSceneTerminal,
  detachScene,
  detachSceneBeacon,
  getLacpClientStatus,
  healthCheck,
  interruptAgentInstance,
  listSceneChatBubbles,
  listSceneTerminals,
  patchSceneChatBubble,
  readSceneTerminalOutput,
  removeAgentInstancePendingUserMessage,
  sendAgentInstanceMessage,
  switchAgentInstanceLlmPolicy,
  type AgentParentChildRelationResponse,
  type AgentRuntimeInstance,
  type ChatBubbleMessageDto,
  type CreateChatBubbleMessageRequest,
  type SceneTerminal,
} from "@/features/chat/api/agentRuntimeApi"
import { attachmentToRequest, type UserMessageAttachment } from "@/features/chat/api/fileResourceApi"
import { listCommunicationMessages } from "@/features/chat/api/communicationApi"
import type { AgentEvent } from "@/features/chat/model/agentEvents"
import { taskNoteKeys } from "@/features/chat/api/taskNoteApi"
import type { InteractionSelection, QueuedUserMessage, TerminalSession } from "@/features/chat/model/chatTypes"
import { loadWorkspaceTree, type WorkspaceTreeResponse } from "@/features/chat/api/workspacesApi"
import { listRecentWorkspaces, openOrCreateProject, type Scene } from "@/features/chat/api/sceneApi"
import { readMemoryDraftGuardSnapshot } from "@/features/memory/memoryDraftGuard"
import { AgentStatusBadge } from "@/features/chat/components/AgentStatusBadge"
import { AgentInteractionSoundToggle } from "@/features/chat/components/AgentInteractionSoundToggle"
import {
  ProjectLoadingPlaceholder,
  SceneAttachPlaceholder,
  WorkspacePicker,
} from "@/features/chat/components/ChatPlaceholders"
import { CommunicationStatusOverlay } from "@/features/chat/components/CommunicationStatusOverlay"
import { Composer } from "@/features/chat/components/Composer"
import { ConversationPane } from "@/features/chat/components/ConversationPane"
import { ExecutionMonitorPanel } from "@/features/chat/components/ExecutionMonitorPanel"
import { LacpInstanceRegistrationToggle } from "@/features/chat/components/LacpInstanceRegistrationToggle"
import { LacpStatusOverlay } from "@/features/chat/components/LacpStatusOverlay"
import { MessageList } from "@/features/chat/components/MessageList"
import { TimelinePane } from "@/features/chat/components/TimelinePane"
import { RuntimePolicySwitcher } from "@/features/chat/components/RuntimePolicySwitcher"
import { chatAgentRuntimeScopeId } from "@/features/chat/model/chatAgentScope"
import { chatEventCoordinator } from "@/features/chat/runtime/chatEventCoordinator"
import { chatTimelineDebug } from "@/features/chat/runtime/chatTimelineDebug"
import { queryClient } from "@/shared/api/queryClient"
import { SceneSelector, type SceneFallbackLlm } from "@/features/chat/components/SceneSelector"
import { SceneTabsBar, type SceneTabViewModel } from "@/features/chat/components/SceneTabsBar"
import { TerminalPanelContainer } from "@/features/chat/components/TerminalPanelContainer"
import { TokenMeterContainer } from "@/features/chat/components/TokenMeterContainer"
import { WorkspaceTree, type WorkspaceNode, type WorkspaceTreeStatus } from "@/features/chat/components/WorkspaceTree"
import {
  getAgentRuntimeState,
  markAgentScopesHydrating,
  markAgentScopesHydrationFailed,
  useChatStore,
  type AgentScopedChatBubbleHydration,
  type SceneRestoreReason,
  type SceneSlice,
} from "@/features/chat/model/chatStore"
import { useSceneUiStore } from "@/features/chat/model/sceneStore"
import { useWorkspaceUiStore } from "@/features/chat/model/workspaceStore"
import {
  claimScene,
  releaseScene,
  subscribeOccupiedKeys,
} from "@/features/chat/sceneClaimRegistry"
import { useChatBubblePersistence } from "@/features/chat/hooks/useChatBubblePersistence"
import {
  acknowledgeChatBubblePersistenceSnapshot,
  replayChatBubblePersistenceSnapshots,
  saveChatBubblePersistenceSnapshot,
  type ChatBubblePersistenceOutboxEntry,
} from "@/features/chat/runtime/chatBubblePersistenceOutbox"
import { rehydrateAgentChatBubbles } from "@/features/chat/runtime/agentScopedChatBubbleRehydration"
import { useSceneCommunication } from "@/features/chat/hooks/useSceneCommunication"
import {
  getCommunicationView,
  hasRecentSseActivity,
  hasUsableSseTransport,
  IDLE_COMMUNICATION_HEALTH_STATE,
  shouldRecoverStaleHeartbeat,
  type CommunicationHealthState,
} from "@/features/chat/runtime/communicationHealth"
import { useAgentInteractionSoundNotifications } from "@/features/chat/runtime/agentInteractionSound"
import {
  CHAT_BUBBLE_CONTENT_DELTA_PERSIST_DELAY_MS,
  CHAT_DEBUG_STORAGE_KEY,
  DEFAULT_TERMINAL_PANEL_WIDTH_PX,
  DEFAULT_WORKSPACE_PANEL_WIDTH_PX,
  HEARTBEAT_STALE_WATCHDOG_INTERVAL_MS,
  LATEST_COMMUNICATION_CURSOR_EVENT_LIMIT,
  LATEST_TERMINAL_OUTPUT_CHAR_LIMIT,
  LATEST_TERMINAL_OUTPUT_LINE_LIMIT,
  MAX_TERMINAL_PANEL_WIDTH_PX,
  MAX_WORKSPACE_PANEL_WIDTH_PX,
  MIN_CHAT_PANEL_WIDTH_PX,
  MIN_TERMINAL_PANEL_WIDTH_PX,
  MIN_WORKSPACE_PANEL_WIDTH_PX,
  SCENE_CACHE_POLICY_INTERVAL_MS,
  SCENE_ATTACH_HYDRATE_REQUEST_TIMEOUT_MS,
  SPLIT_SEPARATOR_WIDTH_PX,
} from "@/features/chat/runtime/runtimeConfig"
import { listLlmExecutionPolicies, type LlmExecutionPolicy } from "@/features/settings/settingsApi"
import { listAgents, type AgentDefinition } from "@/features/studio/studioApi"
import { usePageLifecycleState } from "@/shared/hooks/usePageLifecycleState"
import { useAppConfirm, useAppNotification } from "@/shared/interaction/AppInteractionProvider"
import { useIsMobileRuntimeLayout } from "@/shared/hooks/useRuntimeLayoutMode"
import { HttpError } from "@/shared/api/httpClient"
import { detectRuntimeClientKind, getOrCreateRuntimeDeviceId } from "@/shared/api/runtimeAccess"
import { createClientId } from "@/shared/utils/clientId"
import { usePanelVisibilityStore } from "@/shared/layout/panelVisibilityStore"
import { useShallow } from "zustand/react/shallow"

const EMPTY_WORKSPACE_NODES: WorkspaceNode[] = []
const WORKSPACE_TREE_INITIAL_MAX_DEPTH = 2
const WORKSPACE_TREE_LAZY_MAX_DEPTH = 2
const WORKSPACE_TREE_MAX_ENTRIES_PER_DIRECTORY = 80

type AgentScopedChatBubbleLoadResult =
  | {
      status: "fulfilled"
      agentInstanceId: string
      bubbles: ChatBubbleMessageDto[]
    }
  | {
      status: "rejected"
      agentInstanceId: string
      error: unknown
    }

type ActiveSceneSummary = {
  taskId: string | null
  agentInstance: AgentRuntimeInstance | null
  agentInstancesById: Record<string, AgentRuntimeInstance>
  agentInstanceOrder: string[]
  rootAgentInstanceId: string | null
  selectedAgentInstanceId: string | null
  parentChildRelations: AgentParentChildRelationResponse[]
  runStatus: SceneSlice["runStatus"]
  streamId: string | null
  activeAgentTerminalCount: number
}

const EMPTY_AGENT_INSTANCES_BY_ID: Record<string, AgentRuntimeInstance> = {}
const EMPTY_AGENT_INSTANCE_ORDER: string[] = []
const EMPTY_PARENT_CHILD_RELATIONS: AgentParentChildRelationResponse[] = []
const EMPTY_ACTIVE_SCENE_SUMMARY: ActiveSceneSummary = {
  taskId: null,
  agentInstance: null,
  agentInstancesById: EMPTY_AGENT_INSTANCES_BY_ID,
  agentInstanceOrder: EMPTY_AGENT_INSTANCE_ORDER,
  rootAgentInstanceId: null,
  selectedAgentInstanceId: null,
  parentChildRelations: EMPTY_PARENT_CHILD_RELATIONS,
  runStatus: "created",
  streamId: null,
  activeAgentTerminalCount: 0,
}

function isChatDebugEnabled(): boolean {
  if (typeof window === "undefined") return false
  const value = window.localStorage.getItem(CHAT_DEBUG_STORAGE_KEY)
  if (value === "0" || value === "false" || value === "no") return false
  if (value === "1" || value === "true" || value === "yes") return true
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)
}

function chatDebug(label: string, payload?: unknown) {
  if (!isChatDebugEnabled()) return
  if (payload === undefined) {
    console.debug(`[chat] ${label}`)
    return
  }
  console.debug(`[chat] ${label}`, payload)
}

function isBackendStartupConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLocaleLowerCase()
  const hasConnectionRefused = message.includes("err_connection_refused") || message.includes("econnrefused")
  if (error instanceof HttpError) {
    return error.status === 502 && hasConnectionRefused
  }
  return hasConnectionRefused
}

function shouldRetryRecentWorkspacesQuery(failureCount: number, error: unknown): boolean {
  return failureCount < 30 && isBackendStartupConnectionError(error)
}

function mergeWorkspaceTreeDirectoryChildren(
  nodes: WorkspaceNode[],
  directoryPath: string,
  children: WorkspaceNode[],
): { nodes: WorkspaceNode[]; updated: boolean } {
  let updated = false
  const nextNodes = nodes.map((node) => {
    if (node.type === "folder" && node.path === directoryPath) {
      updated = true
      return { ...node, children, children_loaded: true }
    }
    if (node.type !== "folder" || !node.children?.length) return node
    const result = mergeWorkspaceTreeDirectoryChildren(node.children, directoryPath, children)
    if (!result.updated) return node
    updated = true
    return { ...node, children: result.nodes }
  })
  return updated ? { nodes: nextNodes, updated: true } : { nodes, updated: false }
}

function mergeWorkspaceDirectoryChildren(
  workspace: WorkspaceTreeResponse,
  directoryPath: string,
  children: WorkspaceNode[],
): WorkspaceTreeResponse {
  if (workspace.path === directoryPath) return { ...workspace, children }
  const result = mergeWorkspaceTreeDirectoryChildren(workspace.children, directoryPath, children)
  return result.updated ? { ...workspace, children: result.nodes } : workspace
}

function hasActiveSseTransport(state: CommunicationHealthState): boolean {
  return hasUsableSseTransport(state) || hasRecentSseActivity(state)
}

function preserveSseStatusForActiveTransport(
  state: CommunicationHealthState,
  fallback: CommunicationHealthState["sseStatus"],
): CommunicationHealthState["sseStatus"] {
  return hasActiveSseTransport(state) ? "connected" : fallback
}

function payloadValue(payload: unknown, key: string): unknown {
  if (!payload || typeof payload !== "object") return undefined
  return (payload as Record<string, unknown>)[key]
}

function summarizeAgentEvents(events: AgentEvent[]) {
  const typeCounts: Record<string, number> = {}
  for (const event of events) {
    typeCounts[event.type] = (typeCounts[event.type] ?? 0) + 1
  }
  return {
    count: events.length,
    firstSeq: events[0]?.seq ?? 0,
    lastSeq: events[events.length - 1]?.seq ?? 0,
    typeCounts,
    recentToolEvents: events
      .filter((event) => event.type.startsWith("tool.call"))
      .slice(-20)
      .map((event) => ({
        seq: event.seq,
        type: event.type,
        toolCallId: payloadValue(event.payload, "tool_call_id"),
        toolName: payloadValue(event.payload, "tool_name"),
      })),
  }
}

function summarizeSceneRuntime(scene: SceneSlice | undefined) {
  if (!scene) return null
  return {
    cacheTier: scene.cacheTier,
    isDirty: scene.isDirty,
    isRestoring: scene.isRestoring,
    lastSeq: scene.lastSeq,
    agentInventorySize: scene.agentInstanceOrder.length,
    selectedAgentInstanceId: scene.selectedAgentInstanceId,
    runStatus: scene.runStatus,
  }
}

function backendControlPlaneErrorMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error || "")
  return detail
    ? `后端控制面无响应或健康检查失败：${detail}`
    : "后端控制面无响应或健康检查失败。"
}

function desktopPathOperationErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === "string" && error.trim()) return error.trim()
  return fallbackMessage
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function textFormatValue(value: unknown, fallback: ChatBubbleMessageDto["text_format"]): ChatBubbleMessageDto["text_format"] {
  return value === "html" || value === "markdown" || value === "json" || value === "diff" || value === "plain_text"
    ? value
    : fallback
}

type PendingOperationCounts = Record<string, number>
type MobileChatPanel = "chat" | "workspace" | "monitor" | "terminal"

function incrementPendingOperationCount(counts: PendingOperationCounts, key: string): PendingOperationCounts {
  return { ...counts, [key]: (counts[key] ?? 0) + 1 }
}

function decrementPendingOperationCount(counts: PendingOperationCounts, key: string): PendingOperationCounts {
  const currentCount = counts[key] ?? 0
  if (currentCount <= 1) {
    const next = { ...counts }
    delete next[key]
    return next
  }
  return { ...counts, [key]: currentCount - 1 }
}

function agentDefinitionDisplayName(definitions: AgentDefinition[], agentDefinitionId: string): string {
  const definition = definitions.find((agent) => agent.agent_id === agentDefinitionId)
  return definition?.name?.trim() || agentDefinitionId
}

function shortInstanceId(instanceId: string): string {
  return instanceId.length > 8 ? instanceId.slice(0, 8) : instanceId
}

function parentAgentInstanceIdOf(
  relations: AgentParentChildRelationResponse[],
  childInstanceId: string,
  rootAgentInstanceId: string | null,
  ): string | null {
  if (childInstanceId === rootAgentInstanceId) return null
  const relation = relations.find((candidate) => candidate.child_instance_id === childInstanceId)
  return relation?.parent_instance_id ?? null
}

function selectedAgentStatus(instance: AgentRuntimeInstance | null): string {
  return instance?.status ?? "created"
}

function isReleasedAgentStatus(status: string): boolean {
  return status === "released" || status === "completed" || status === "failed" || status === "cancelled"
}

function isReleasedChildRelation(
  relations: AgentParentChildRelationResponse[],
  childInstanceId: string | null | undefined,
  ): boolean {
  if (!childInstanceId) return false
  return relations.some((relation) => relation.child_instance_id === childInstanceId && relation.released)
}

function effectiveAgentPanelStatus(
  instance: AgentRuntimeInstance | null,
  rootAgentInstanceId: string | null,
  relations: AgentParentChildRelationResponse[] = [],
): string {
  const status = selectedAgentStatus(instance)
  if (!instance || instance.instance_id === rootAgentInstanceId) return status
  if (isReleasedChildRelation(relations, instance.instance_id)) return isReleasedAgentStatus(status) ? status : "released"
  return status
}

function isReleasedChildAgentPanel(
  instance: AgentRuntimeInstance | null,
  rootAgentInstanceId: string | null,
  relations: AgentParentChildRelationResponse[] = [],
): boolean {
  if (!instance || instance.instance_id === rootAgentInstanceId) return false
  return isReleasedChildRelation(relations, instance.instance_id)
    || isReleasedAgentStatus(effectiveAgentPanelStatus(instance, rootAgentInstanceId, relations))
}

function localChatBubbleFromRequest(sceneId: string, body: CreateChatBubbleMessageRequest, createdAt: string): ChatBubbleMessageDto {
  const agentInstanceId = chatBubbleRequestAgentInstanceId(body)
  if (!agentInstanceId) throw new Error("ChatBubble snapshot requires agent_instance_id")
  return {
    bubble_id: body.bubble_id ?? createClientId("chat-bubble"),
    scene_id: sceneId,
    agent_instance_id: agentInstanceId,
    task_id: body.task_id ?? null,
    conversation_id: body.conversation_id ?? null,
    role: body.role,
    status: body.status ?? "completed",
    text: body.text,
    text_format: body.text_format ?? (body.role === "user" ? "plain_text" : "markdown"),
    channel: body.channel ?? "web",
    client_message_id: body.client_message_id ?? null,
    backend_message_id: body.backend_message_id ?? null,
    pending_message_id: body.pending_message_id ?? null,
    interaction_options: body.interaction_options ?? [],
    interaction_state: body.interaction_state ?? "none",
    selected_option_id: body.selected_option_id ?? null,
    sort_order: body.sort_order ?? 0,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: body.metadata ?? {},
  }
}

function chatBubbleCommunicationSeq(bubble: ChatBubbleMessageDto): number {
  return numberValue(bubble.metadata?.communication_seq) ?? 0
}

function isExecutionProcessBubbleSnapshot(body: CreateChatBubbleMessageRequest): boolean {
  return body.metadata?.bubble_kind === "execution_process"
}

function chatBubbleRequestAgentInstanceId(body: CreateChatBubbleMessageRequest): string | null {
  return textValue(body.agent_instance_id) ?? textValue(body.metadata?.agent_instance_id)
}

function shouldHydratePersistedBubble(
  sceneId: string,
  bubble: ChatBubbleMessageDto,
): boolean {
  const agentInstanceId = textValue(bubble.agent_instance_id)
  if (!agentInstanceId) return false
  const current = getAgentRuntimeState(sceneId, agentInstanceId)?.messages.find((message) => message.id === bubble.bubble_id)
  if (!current) return true
  const localSeq = numberValue(current.content.metadata?.communication_seq) ?? 0
  return chatBubbleCommunicationSeq(bubble) >= localSeq
}

export function ChatPage() {
  const navigate = useNavigate()
  const confirm = useAppConfirm()
  const { notify } = useAppNotification()
  const currentWorkspace = useWorkspaceUiStore((state) => state.currentWorkspace)
  const selectedPath = useWorkspaceUiStore((state) => state.selectedPath)
  const setCurrentWorkspace = useWorkspaceUiStore((state) => state.setCurrentWorkspace)
  const setSelectedPath = useWorkspaceUiStore((state) => state.setSelectedPath)
  const currentProject = useSceneUiStore((state) => state.currentProject)
  const currentWorkspacePath = useSceneUiStore((state) => state.currentWorkspacePath)
  const setCurrentProject = useSceneUiStore((state) => state.setCurrentProject)
  const resetProject = useSceneUiStore((state) => state.resetProject)
  const [workspacePathInput, setWorkspacePathInput] = useState(currentWorkspace?.path ?? "")
  const [workspace, setWorkspace] = useState<WorkspaceTreeResponse | null>(null)
  const [loadingDirectoryPaths, setLoadingDirectoryPaths] = useState<Set<string>>(() => new Set())
  const [directoryLoadErrors, setDirectoryLoadErrors] = useState<Record<string, string | undefined>>({})
  const autoLoadedWorkspacePathRef = useRef<string | null>(null)
  const workspaceSwitchConfirmationPathRef = useRef<string | null>(null)
  const workspaceOpenInFlightPathRef = useRef<string | null>(null)
  const workspaceSystemOpenInFlightPathRef = useRef<string | null>(null)
  const workspaceRevealPromptPathRef = useRef<string | null>(null)
  const composerTextAreaRef = useRef<HTMLTextAreaElement | null>(null)
  const claimedSceneKeysRef = useRef<Set<string>>(new Set())
  const attachSceneInFlightRef = useRef<Map<string, symbol>>(new Map())
  const chatBubblePersistence = useChatBubblePersistence()
  const lifecycleState = usePageLifecycleState()
  const isMobileLayout = useIsMobileRuntimeLayout()
  const desktopBridge = typeof window === "undefined" ? undefined : window.spreadDesktop
  const canOpenWorkspacePathWithSystem = !isMobileLayout
    && desktopBridge?.isElectron === true
    && typeof desktopBridge.openSystemPath === "function"
  const [mobileSendDiagnostic, setMobileSendDiagnostic] = useState<string | null>(null)
  const mobileSendDiagnosticTimerRef = useRef<number | null>(null)
  const recordMobileChatDebugLog = useCallback((label: string, payload?: unknown) => {
    chatDebug(label, payload)
  }, [])
  const showMobileSendDiagnostic = useCallback((message: string | null) => {
    if (mobileSendDiagnosticTimerRef.current !== null) {
      window.clearTimeout(mobileSendDiagnosticTimerRef.current)
      mobileSendDiagnosticTimerRef.current = null
    }
    if (message) {
      recordMobileChatDebugLog("mobile.diagnostic", { message })
    }
    setMobileSendDiagnostic(message)
    if (message) {
      mobileSendDiagnosticTimerRef.current = window.setTimeout(() => {
        setMobileSendDiagnostic(null)
        mobileSendDiagnosticTimerRef.current = null
      }, 4800)
    }
  }, [recordMobileChatDebugLog])
  useEffect(() => {
    return () => {
      if (mobileSendDiagnosticTimerRef.current !== null) {
        window.clearTimeout(mobileSendDiagnosticTimerRef.current)
        mobileSendDiagnosticTimerRef.current = null
      }
    }
  }, [])

  useAgentInteractionSoundNotifications()
  const lifecycleStateRef = useRef(lifecycleState)
  // restoreSceneCommunication 在文件下方声明，通过稳定 ref 供通信 manager 调用。
  const restoreSceneCommunicationRef = useRef<(sceneId: string, reason: Exclude<SceneRestoreReason, null>) => void>(() => undefined)
  // chatStore actions (per-scene)
  const openSceneInChatStore = useChatStore((state) => state.openScene)
  const closeSceneInChatStore = useChatStore((state) => state.closeScene)
  const setActiveScene = useChatStore((state) => state.setActiveScene)
  const applySceneCachePolicy = useChatStore((state) => state.applySceneCachePolicy)
  const markSceneDirty = useChatStore((state) => state.markSceneDirty)
  const markSceneRestoring = useChatStore((state) => state.markSceneRestoring)
  const setAgentInstance = useChatStore((state) => state.setAgentInstance)
  const setSceneAgentInventory = useChatStore((state) => state.setSceneAgentInventory)
  const selectAgentInstance = useChatStore((state) => state.selectAgentInstance)
  const closeAgentInstancePanel = useChatStore((state) => state.closeAgentInstancePanel)
  const setStreamId = useChatStore((state) => state.setStreamId)
  const enqueueUserMessage = useChatStore((state) => state.enqueueUserMessage)
  const markQueuedUserMessageFailed = useChatStore((state) => state.markQueuedUserMessageFailed)
  const removeQueuedUserMessage = useChatStore((state) => state.removeQueuedUserMessage)
  const hydrateTerminalSessions = useChatStore((state) => state.hydrateTerminalSessions)
  const restoreQueuedUserMessages = useChatStore((state) => state.restoreQueuedUserMessages)
  const clearAllScenes = useChatStore((state) => state.clearAllScenes)
  // chatStore selectors (active slice + opened scenes)
  const activeSceneId = useChatStore((state) => state.activeSceneId)
  const activeSceneSummary = useChatStore(useShallow((state): ActiveSceneSummary => {
    const slice = state.activeSceneId ? state.scenes[state.activeSceneId] ?? null : null
    if (!slice) return EMPTY_ACTIVE_SCENE_SUMMARY
    const activeAgentInstanceId = slice.selectedAgentInstanceId ?? slice.agentInstance?.instance_id ?? slice.rootAgentInstanceId
    const activeAgentTerminalCount = activeAgentInstanceId
      ? getAgentRuntimeState(slice.sceneId, activeAgentInstanceId)?.terminalSessions.length ?? 0
      : 0
    return {
      taskId: slice.taskId,
      agentInstance: slice.agentInstance,
      agentInstancesById: slice.agentInstances,
      agentInstanceOrder: slice.agentInstanceOrder,
      rootAgentInstanceId: slice.rootAgentInstanceId,
      selectedAgentInstanceId: slice.selectedAgentInstanceId,
      parentChildRelations: slice.parentChildRelations,
      runStatus: slice.runStatus,
      streamId: slice.streamId,
      activeAgentTerminalCount,
    }
  }))
  const openedSceneIds = useChatStore(useShallow((state) => Object.keys(state.scenes)))
  const openedSceneTabKeys = useChatStore(useShallow((state) =>
    Object.values(state.scenes).map((slice) => JSON.stringify([
      slice.sceneId,
      slice.sceneName,
      slice.runStatus,
      Object.values(slice.agentRuntimeStates ?? {}).some((state) => Boolean(state.pendingInteraction)),
      slice.selectedAgentInstanceId,
      slice.agentInstanceOrder.join(","),
    ])),
  ))
  const sceneCacheStateKeys = useChatStore(useShallow((state) =>
    Object.values(state.scenes).map((slice) => JSON.stringify([
      slice.sceneId,
      slice.cacheTier,
      slice.isDirty,
      slice.isRestoring,
    ])),
  ))
  const openedSceneTabs = useMemo<SceneTabViewModel[]>(
    () => openedSceneTabKeys.map((key) => {
      const [sceneId, sceneName, runStatus, hasPendingInteraction] = JSON.parse(key) as [
        string,
        string,
        string,
        boolean,
        string | null,
        string,
      ]
      return { sceneId, sceneName, runStatus, hasPendingInteraction }
    }),
    [openedSceneTabKeys],
  )
  const agentInstance = activeSceneSummary.agentInstance
  const sceneAgentInstances = useMemo(
    () => activeSceneSummary.agentInstanceOrder.flatMap((instanceId) => {
      const instance = activeSceneSummary.agentInstancesById[instanceId]
      return instance ? [instance] : []
    }),
    [activeSceneSummary.agentInstanceOrder, activeSceneSummary.agentInstancesById],
  )
  const rootAgentInstanceId = activeSceneSummary.rootAgentInstanceId
  const selectedAgentInstanceId = activeSceneSummary.selectedAgentInstanceId
  const parentChildRelations = activeSceneSummary.parentChildRelations
  const streamId = activeSceneSummary.streamId
  const workspaceSplitContainerRef = useRef<HTMLDivElement | null>(null)
  const splitDragCleanupRef = useRef<(() => void) | null>(null)
  const [workspacePanelWidth, setWorkspacePanelWidth] = useState(DEFAULT_WORKSPACE_PANEL_WIDTH_PX)
  const [terminalPanelWidth, setTerminalPanelWidth] = useState(DEFAULT_TERMINAL_PANEL_WIDTH_PX)
  const [mobilePanel, setMobilePanel] = useState<MobileChatPanel>("chat")
  const [communicationHealthStates, setCommunicationHealthStates] = useState<Record<string, CommunicationHealthState>>({})
  const [sceneTabsPortalElement, setSceneTabsPortalElement] = useState<HTMLElement | null>(null)
  const [sendPendingCountsByAgentInstanceId, setSendPendingCountsByAgentInstanceId] = useState<PendingOperationCounts>({})
  const [interruptPendingCountsByAgentInstanceId, setInterruptPendingCountsByAgentInstanceId] = useState<PendingOperationCounts>({})
  const [taskCompletionPendingSceneId, setTaskCompletionPendingSceneId] = useState<string | null>(null)
  const taskCompletionInFlightSceneIdRef = useRef<string | null>(null)
  const activeAgentInstanceId = selectedAgentInstanceId ?? agentInstance?.instance_id ?? null
  const isRootAgentPanel = Boolean(activeAgentInstanceId && activeAgentInstanceId === rootAgentInstanceId)
  const isActiveAgentSendPending = activeAgentInstanceId ? (sendPendingCountsByAgentInstanceId[activeAgentInstanceId] ?? 0) > 0 : false
  const isActiveAgentInterruptPending = activeAgentInstanceId ? (interruptPendingCountsByAgentInstanceId[activeAgentInstanceId] ?? 0) > 0 : false
  const isTaskCompletionPending = Boolean(activeSceneId && taskCompletionPendingSceneId === activeSceneId)
  const communicationHealthStatesRef = useRef(communicationHealthStates)
  // header 上的 toggle 控制用户偏好；终端面板还要求当前选中 Agent 至少有一个可见终端会话才会真的渲染。
  const workspacePanelVisible = usePanelVisibilityStore((state) => state.workspacePanelVisible)
  const terminalPanelVisible = usePanelVisibilityStore((state) => state.terminalPanelVisible)
  const showWorkspacePanel = !isMobileLayout && workspacePanelVisible
  const executionMonitorSceneId = activeSceneId
  const terminalPanelSceneId = activeSceneId && terminalPanelVisible && activeSceneSummary.activeAgentTerminalCount > 0 ? activeSceneId : null
  const showTerminalPanel = !isMobileLayout && terminalPanelSceneId !== null
  const activeCommunicationHealthState = activeSceneId
    ? communicationHealthStates[activeSceneId] ?? IDLE_COMMUNICATION_HEALTH_STATE
    : null
  const activeCommunicationView = useMemo(
    () => activeCommunicationHealthState ? getCommunicationView(activeCommunicationHealthState) : null,
    [activeCommunicationHealthState],
  )

  useEffect(() => {
    if (!isMobileLayout) return
    if (mobilePanel === "workspace" && !workspace) setMobilePanel("chat")
    if (mobilePanel === "monitor" && !executionMonitorSceneId) setMobilePanel("chat")
    if (mobilePanel === "terminal" && !terminalPanelSceneId) setMobilePanel("chat")
  }, [executionMonitorSceneId, isMobileLayout, mobilePanel, terminalPanelSceneId, workspace])

  const updateCommunicationHealthState = useCallback((
    sceneId: string,
    updater: (current: CommunicationHealthState) => CommunicationHealthState,
  ) => {
    setCommunicationHealthStates((currentStates) => {
      const current = currentStates[sceneId] ?? IDLE_COMMUNICATION_HEALTH_STATE
      const next = updater(current)
      if (next === current) return currentStates
      return { ...currentStates, [sceneId]: next }
    })
  }, [])

  const removeCommunicationHealthState = useCallback((sceneId: string) => {
    setCommunicationHealthStates((currentStates) => {
      if (!currentStates[sceneId]) return currentStates
      const { [sceneId]: _removed, ...rest } = currentStates
      return rest
    })
  }, [])

  const markBackendUnhealthy = useCallback((sceneId: string, error: unknown) => {
    const message = backendControlPlaneErrorMessage(error)
    updateCommunicationHealthState(sceneId, (current) => ({
      ...current,
      backendStatus: "unhealthy",
      lastErrorAt: new Date().toISOString(),
      errorMessage: message,
    }))
    return message
  }, [updateCommunicationHealthState])

  const ensureBackendHealthy = useCallback(async (sceneId: string) => {
    try {
      await healthCheck()
      updateCommunicationHealthState(sceneId, (current) => ({
        ...current,
        backendStatus: "ok",
        errorMessage: current.backendStatus === "unhealthy" ? undefined : current.errorMessage,
      }))
    } catch (error) {
      throw new Error(markBackendUnhealthy(sceneId, error))
    }
  }, [markBackendUnhealthy, updateCommunicationHealthState])

  // 通信运行时（SSE + heartbeat + gap replay + re-attach）由 useSceneCommunication 抽取的 manager 统一管理。
  // 该 hook 提供稳定的 manager 引用；unmount 时自动释放所有 SseClient / setInterval / setTimeout / buffer / cursor / workspace 映射。
  // requestReattach 通过 ref 延迟绑定，事件投影与持久化统一由 Coordinator 接入。
  const sceneCommunication = useSceneCommunication({
    appendEvents: (sceneId, events) => {
      const rootAgentId = useChatStore.getState().scenes[sceneId]?.rootAgentInstanceId ?? null
      chatEventCoordinator.dispatchLiveEvents(sceneId, events, rootAgentId)
    },
    requestReattach: (sceneId, reason) => restoreSceneCommunicationRef.current(sceneId, reason),
    updateCommunicationHealth: (sceneId, updater) => updateCommunicationHealthState(sceneId, updater),
    getCommunicationHealth: (sceneId) =>
      communicationHealthStatesRef.current[sceneId] ?? IDLE_COMMUNICATION_HEALTH_STATE,
    markSceneDirty: (sceneId, dirty) => markSceneDirty(sceneId, dirty),
    getSceneStreamId: (sceneId) => useChatStore.getState().scenes[sceneId]?.streamId ?? null,
    isSceneAlive: (sceneId) => Boolean(useChatStore.getState().scenes[sceneId]),
    isLifecycleBackground: () => lifecycleStateRef.current.isBackground,
    fetchCommunicationGap: (streamId, options) => listCommunicationMessages(streamId, options),
    detectStaleScene: (state, nowMs) => shouldRecoverStaleHeartbeat(state, nowMs),
    chatDebug: (label, payload) => chatDebug(label, payload),
    onGenerationReset: (sceneId, generation) => {
      chatEventCoordinator.resetSceneTransportGeneration(sceneId, {
        bootId: generation.bootId ?? undefined,
      })
      useChatStore.getState().resetSceneTransportState(sceneId)
    },
  })

  const detachScenePresence = useCallback(
    (sceneId: string, options: { transport?: "fetch" | "beacon" } = {}) => {
      const workspacePath = sceneCommunication.getSceneWorkspace(sceneId) ?? currentWorkspacePath
      if (!workspacePath) return
      const clientSessionId = sceneCommunication.getClientSessionId(sceneId)
      if (options.transport === "beacon") {
        detachSceneBeacon(sceneId, workspacePath, clientSessionId)
        return
      }
      void detachScene(sceneId, {
        workspace_path: workspacePath,
        client_session_id: clientSessionId,
      }).catch((error) => {
        console.warn("[chat] detach scene presence failed:", { sceneId, clientSessionId, error })
      })
    },
    [currentWorkspacePath, sceneCommunication],
  )

  // 同浏览器多 Tab 重复打开同 scene 的非阻塞提示。仅在 SceneSelector 上点击被占用 scene 时设置。
  const [sceneOccupiedError, setSceneOccupiedError] = useState<string | null>(null)
  // 当前被其他 Tab 感知为已打开的 claim key 集合（全部 workspace）。由 sceneClaimRegistry 订阅推送。
  const [occupiedClaimKeys, setOccupiedClaimKeys] = useState<Set<string>>(() => new Set())
  // 推导出"在当前 workspace 下被其他 Tab 打开的 scene_id 集合"，供 SceneSelector 展示 presence 提示。
  const occupiedSceneIds = useMemo<Set<string>>(() => {
    if (!currentWorkspacePath) return new Set()
    const prefix = `${currentWorkspacePath}::`
    const result = new Set<string>()
    for (const key of occupiedClaimKeys) {
      if (key.startsWith(prefix)) result.add(key.slice(prefix.length))
    }
    return result
  }, [occupiedClaimKeys, currentWorkspacePath])

  const agentsQuery = useQuery({ queryKey: ["chat", "agents"], queryFn: listAgents })
  const policiesQuery = useQuery({ queryKey: ["chat", "llm-execution-policies"], queryFn: listLlmExecutionPolicies })
  const { refetch: refetchAgents } = agentsQuery
  const { refetch: refetchPolicies } = policiesQuery
  const availableAgents = useMemo(
    () => (agentsQuery.data ?? []).filter((agent) => !agent.disabled && !agent.builtin_background_agent),
    [agentsQuery.data],
  )
  const availablePolicies = useMemo(
    () => (policiesQuery.data ?? []).filter((policy) => policy.enabled && (policy.candidates ?? []).some((candidate) => candidate.enabled)),
    [policiesQuery.data],
  )
  const refetchChatConfigOptions = useCallback(() => {
    void refetchAgents()
    void refetchPolicies()
  }, [refetchAgents, refetchPolicies])
  const lacpStatusQuery = useQuery({
    queryKey: ["chat", "lacp-status"],
    queryFn: getLacpClientStatus,
    refetchInterval: 3000,
  })
  const recentWorkspacesQuery = useQuery({
    queryKey: ["chat", "recent-workspaces"],
    queryFn: listRecentWorkspaces,
    enabled: !workspace,
    retry: shouldRetryRecentWorkspacesQuery,
    retryDelay: 1000,
  })

  const workspaceMutation = useMutation({
    mutationFn: ({ directoryPath }: { directoryPath: string; mode: "open" | "refresh" }) =>
      loadWorkspaceTree({
        directory_path: directoryPath,
        max_depth: WORKSPACE_TREE_INITIAL_MAX_DEPTH,
        max_entries_per_directory: WORKSPACE_TREE_MAX_ENTRIES_PER_DIRECTORY,
      }),
    onSuccess: (data, variables) => {
      if (variables.mode === "open") {
        // workspace 切换 → 当前客户端离开所有已打开场景，先主动 detach presence，再关闭本地 SSE/心跳资源。
        for (const sceneId of openedSceneIds) detachScenePresence(sceneId)
        sceneCommunication.closeAllEventClients()
        sceneCommunication.stopAllHeartbeats()
        sceneCommunication.clearAllPendingEvents()
        chatBubblePersistence.clearAll()
        sceneCommunication.clearAllRecoveryRetries()
        sceneCommunication.clearAllHeartbeatQuickRetries()
        sceneCommunication.clearAllSceneWorkspaces()
        sceneCommunication.unmarkAllReattaching()
        sceneCommunication.clearAllCursors()
        setCommunicationHealthStates({})
        clearAllScenes()
      }
      setWorkspace(data)
      setLoadingDirectoryPaths(new Set())
      setDirectoryLoadErrors({})
      setWorkspacePathInput(data.path)
      setCurrentWorkspace({ name: data.name, path: data.path })
      if (variables.mode === "open") resetProject()
    },
    onSettled: (_data, _error, variables) => {
      if (variables.mode === "open" && workspaceOpenInFlightPathRef.current === variables.directoryPath) {
        workspaceOpenInFlightPathRef.current = null
      }
    },
  })

  const workspaceDirectoryMutation = useMutation({
    mutationFn: ({ directoryPath }: { directoryPath: string }) =>
      loadWorkspaceTree({
        directory_path: directoryPath,
        max_depth: WORKSPACE_TREE_LAZY_MAX_DEPTH,
        max_entries_per_directory: WORKSPACE_TREE_MAX_ENTRIES_PER_DIRECTORY,
      }),
    onMutate: (variables) => {
      setLoadingDirectoryPaths((current) => new Set(current).add(variables.directoryPath))
      setDirectoryLoadErrors((current) => {
        if (!current[variables.directoryPath]) return current
        const next = { ...current }
        delete next[variables.directoryPath]
        return next
      })
    },
    onSuccess: (data, variables) => {
      setWorkspace((current) => current
        ? mergeWorkspaceDirectoryChildren(current, variables.directoryPath, data.children)
        : current)
    },
    onError: (error, variables) => {
      const message = error instanceof Error ? error.message : "目录加载失败。"
      setDirectoryLoadErrors((current) => ({ ...current, [variables.directoryPath]: message }))
    },
    onSettled: (_data, _error, variables) => {
      setLoadingDirectoryPaths((current) => {
        const next = new Set(current)
        next.delete(variables.directoryPath)
        return next
      })
    },
  })

  const projectMutation = useMutation({
    mutationFn: (workspaceArgs: { workspace_path: string; name: string }) =>
      openOrCreateProject({ workspace_path: workspaceArgs.workspace_path, name: workspaceArgs.name }),
    onSuccess: (project, variables) => setCurrentProject(project, variables.workspace_path),
  })

  // workspace 加载成功后自动 open-or-create-project，保证 P1 后端 scene_id 透传链路可用。
  useEffect(() => {
    if (!workspace) return
    if (currentWorkspacePath === workspace.path) return
    if (projectMutation.isPending) return
    projectMutation.mutate({ workspace_path: workspace.path, name: workspace.name })
  }, [workspace, currentWorkspacePath])

  /**
   * 进入 scene 的统一入口：自动恢复活跃 root instance，并从 Chat Bubble 持久化表恢复前端消息气泡。
   * Communication Event Log 只用于 SSE 实时续写、审计和调试，不再作为历史气泡列表的数据源。
   */
  const attachSceneMutation = useMutation({
    mutationFn: async (args: {
      sceneId: string
      workspacePath: string
      fallbackLlm: SceneFallbackLlm | null
      restoreReason?: SceneRestoreReason
      attachClaim: symbol
    }) => {
      chatTimelineDebug("attach.start", { sceneId: args.sceneId, restoreReason: args.restoreReason ?? null })
      await ensureBackendHealthy(args.sceneId)
      const response = await attachScene(args.sceneId, {
        workspace_path: args.workspacePath,
        llm_policy_group_id: args.fallbackLlm?.llm_policy_group_id ?? null,
        client_session_id: sceneCommunication.getClientSessionId(args.sceneId),
        device_id: getOrCreateRuntimeDeviceId(),
        client_kind: detectRuntimeClientKind(),
      })
      // 补水请求（历史气泡 / 最近通信游标 / 终端会话）改为 Promise.allSettled 并行化：
      // 任何一个失败 / 超时都不再阻塞其他补水路径，也不会让 mutation 永远 pending。
      // 这是为了避免出现"attach 已成功，但补水链路里某个 HTTP 卡住 → onSuccess 永不执行 →
      // connectEventStream / startHeartbeat 永不调用 → restoreStatus 永远停在 reattaching"
      // 这种"必须重启程序才好"的状态机不收敛问题。
      // requestJson 已自带默认 60s 兜底超时，挂起的调用会被自动 reject。
      const attachedAgentInstances = response.agent_instances?.length
        ? response.agent_instances
        : [response.root_agent_instance]
      const rootAgentInstanceId = response.root_agent_instance.instance_id
      const attachedAgentInstanceIds = Array.from(new Set([
        rootAgentInstanceId,
        ...attachedAgentInstances.map((instance) => instance.instance_id),
      ].map((value) => value.trim()).filter(Boolean)))
      setSceneAgentInventory(
        args.sceneId,
        attachedAgentInstances,
        response.parent_child_relations ?? [],
        rootAgentInstanceId,
      )
      markAgentScopesHydrating(args.sceneId, attachedAgentInstanceIds)
      const hydrationGenerations: Record<string, number> = {}
      for (const agentInstanceId of attachedAgentInstanceIds) {
        const scopeId = chatAgentRuntimeScopeId(args.sceneId, agentInstanceId, rootAgentInstanceId)
        hydrationGenerations[agentInstanceId] = chatEventCoordinator.beginHydration(scopeId)
      }
      chatTimelineDebug("attach.response", { sceneId: args.sceneId, streamId: response.communication_stream_id, agentCount: attachedAgentInstanceIds.length })
      const [bubbleBatchesResult, latestEventsResult, terminalSessionsResult] = await Promise.allSettled([
        loadAgentScopedChatBubbleBatches(args.sceneId, attachedAgentInstances, rootAgentInstanceId, SCENE_ATTACH_HYDRATE_REQUEST_TIMEOUT_MS),
        listCommunicationMessages(response.communication_stream_id, {
          limit: LATEST_COMMUNICATION_CURSOR_EVENT_LIMIT,
          latest: true,
        }, { timeoutMs: SCENE_ATTACH_HYDRATE_REQUEST_TIMEOUT_MS }),
        loadSceneTerminalSessions(
          args.sceneId,
          args.workspacePath,
          attachedAgentInstanceIds,
          SCENE_ATTACH_HYDRATE_REQUEST_TIMEOUT_MS,
        ),
      ])

      const chatBubbleLoads: AgentScopedChatBubbleLoadResult[] = bubbleBatchesResult.status === "fulfilled"
        ? bubbleBatchesResult.value
        : attachedAgentInstanceIds.map((agentInstanceId) => ({
            status: "rejected" as const,
            agentInstanceId,
            error: bubbleBatchesResult.reason,
          }))
      if (bubbleBatchesResult.status === "rejected") {
        console.warn("[chat] hydrate chat bubbles failed:", bubbleBatchesResult.reason)
      }

      let latestSeq = 0
      if (latestEventsResult.status === "fulfilled") {
        const latestEvents = latestEventsResult.value
        latestSeq = latestEvents[latestEvents.length - 1]?.seq ?? 0
        chatDebug("attach latest communication cursor", {
          sceneId: args.sceneId,
          streamId: response.communication_stream_id,
          restoreReason: args.restoreReason ?? null,
          ...summarizeAgentEvents(latestEvents),
        })
      } else {
        console.warn("[chat] load communication seq cursor failed:", latestEventsResult.reason)
      }

      const terminalSessions: TerminalSession[] =
        terminalSessionsResult.status === "fulfilled" ? terminalSessionsResult.value : []
      if (terminalSessionsResult.status === "rejected") {
        console.warn("[chat] hydrate terminal output failed:", terminalSessionsResult.reason)
      }

      return { sceneId: args.sceneId, response, attachedAgentInstances, chatBubbleLoads, hydrationGenerations, latestSeq, terminalSessions }
    },
    onMutate: (args) => {
      const isReattach = sceneCommunication.isReattaching(args.sceneId)
      const isRestoring = isReattach || Boolean(args.restoreReason)
      if (args.restoreReason || isReattach) {
        markSceneRestoring(args.sceneId, true, args.restoreReason ?? "heartbeat_expired")
      }
      // 重连开始：清理 heartbeat error 快重试定时器（如果还有）。
      sceneCommunication.clearHeartbeatQuickRetry(args.sceneId)
      // 用户手动 retry / sse_gap / cold 是新一轮恢复链路，重置 re-attach 退避计数；
      // heartbeat_expired 的后台自动恢复链路需要保留累计 attempt 让退避逐步增大。
      if (args.restoreReason && args.restoreReason !== "heartbeat_expired") {
        sceneCommunication.resetReattachAttempt(args.sceneId)
      }
      updateCommunicationHealthState(args.sceneId, (current) => ({
        ...current,
        // 恢复 attach 期间不主动关闭仍可用的现有 SSE；UI 层也不把它降级成已断开。
        sseStatus: preserveSseStatusForActiveTransport(current, "connecting"),
        backendStatus: "unknown",
        restoreStatus: isRestoring ? "reattaching" : "idle",
        // 重连开始则重置连续错误计数，避免累计旧值干扰后续判定。
        consecutiveHeartbeatErrors: 0,
        errorMessage: undefined,
      }))
    },
    onSuccess: ({ sceneId, response, attachedAgentInstances, chatBubbleLoads, hydrationGenerations, latestSeq, terminalSessions }) => {
      sceneCommunication.clearRecoveryRetry(sceneId)
      sceneCommunication.clearHeartbeatQuickRetry(sceneId)
      // 重连成功：清空退避计数，后续如果又遇到 expired 从第 1 阶重新调度。
      sceneCommunication.resetReattachAttempt(sceneId)
      markSceneDirty(sceneId, false)
      markSceneRestoring(sceneId, false)
      const now = new Date().toISOString()
      updateCommunicationHealthState(sceneId, (current) => ({
        ...current,
        sseStatus: preserveSseStatusForActiveTransport(current, "connecting"),
        backendStatus: "ok",
        heartbeatStatus: current.heartbeatStatus === "expired" || current.heartbeatStatus === "error" ? "idle" : current.heartbeatStatus,
        restoreStatus: "idle",
        // attach 成功不等于 heartbeat 成功；setting attachedAt 给 stale watchdog 做 fallback，
        // 首次 heartbeat 成功后才写 lastHeartbeatAt（recordHeartbeatResult 管）。
        attachedAt: now,
        consecutiveHeartbeatErrors: 0,
        errorMessage: undefined,
      }))
      setSceneAgentInventory(
        sceneId,
        attachedAgentInstances,
        response.parent_child_relations ?? [],
        response.root_agent_instance.instance_id,
      )
      setStreamId(sceneId, response.communication_stream_id)
      chatEventCoordinator.setSceneTransportGeneration(sceneId, { streamId: response.communication_stream_id })
      const fulfilledChatBubbleBatches = chatBubbleLoads.flatMap((result) => (
        result.status === "fulfilled"
          ? [{ agentInstanceId: result.agentInstanceId, bubbles: result.bubbles } satisfies AgentScopedChatBubbleHydration]
          : []
      ))
      if (fulfilledChatBubbleBatches.length > 0) {
        for (const batch of fulfilledChatBubbleBatches) {
          const scopeId = chatAgentRuntimeScopeId(sceneId, batch.agentInstanceId, response.root_agent_instance.instance_id)
          const gen = hydrationGenerations[batch.agentInstanceId]
          const applied = typeof gen === "number" && chatEventCoordinator.dispatchBaselineHydration(
            sceneId,
            [batch],
            gen,
            response.root_agent_instance.instance_id,
            "hot",
            { maxSeq: latestSeq },
          )
          if (!applied && typeof gen === "number") chatEventCoordinator.cancelHydration(scopeId, gen)
        }
      }
      const failedAgentInstanceIds = chatBubbleLoads.flatMap((result) => (
        result.status === "rejected" ? [result.agentInstanceId] : []
      ))
      if (failedAgentInstanceIds.length > 0) {
        markAgentScopesHydrationFailed(sceneId, failedAgentInstanceIds)
        for (const failedAgentInstanceId of failedAgentInstanceIds) {
          const scopeId = chatAgentRuntimeScopeId(sceneId, failedAgentInstanceId, response.root_agent_instance.instance_id)
          chatEventCoordinator.cancelHydration(scopeId, hydrationGenerations[failedAgentInstanceId])
        }
        for (const failed of chatBubbleLoads) {
          if (failed.status === "rejected") {
            console.warn("[chat] Agent ChatBubble hydration failed:", failed.agentInstanceId, failed.error)
          }
        }
      }
      restoreChatBubblePersistenceOutbox(sceneId)
      sceneCommunication.mergeCursor(sceneId, latestSeq)
      const hydratedSeq = sceneCommunication.getCursor(sceneId)
      chatTimelineDebug("attach.hydration_results", { sceneId, streamId: response.communication_stream_id, bubbleScopeCount: fulfilledChatBubbleBatches.length, failedScopeCount: failedAgentInstanceIds.length, latestSeq, hydratedSeq })
      chatDebug("attach hydrated chat bubbles", {
        sceneId,
        streamId: response.communication_stream_id,
        latestSeq,
        hydratedSeq,
        chatBubbles: fulfilledChatBubbleBatches.reduce((total, batch) => total + batch.bubbles.length, 0),
        chatBubbleScopes: fulfilledChatBubbleBatches.length,
        failedChatBubbleScopes: failedAgentInstanceIds.length,
        scene: summarizeSceneRuntime(useChatStore.getState().scenes[sceneId]),
      })
      hydrateTerminalSessions(sceneId, terminalSessions)
      for (const restoredInstance of attachedAgentInstances) {
        restoreQueuedUserMessages(
          sceneId,
          restoredInstance.pending_user_messages ?? [],
          restoredInstance.instance_id,
        )
        chatEventCoordinator.syncConversationControls(sceneId, restoredInstance.instance_id, rootAgentInstanceId)
      }
      chatTimelineDebug("attach.connect_sse", { sceneId, streamId: response.communication_stream_id, afterSeq: sceneCommunication.getCursor(sceneId) })
      sceneCommunication.connectEventStream(sceneId, response.event_stream_url)
      // 启动心跳定时器，维持后端按 client_session_id 区分的 scene presence 活跃。
      sceneCommunication.startHeartbeat(sceneId, currentWorkspacePath ?? null, response.client_session_id ?? null)
    },
    onError: (error, variables) => {
      chatEventCoordinator.cancelSceneHydrations(variables.sceneId)
      const errorMessage = error instanceof Error ? error.message : "前后端通信连接失败"
      const backendUnhealthy = errorMessage.startsWith("后端控制面无响应")
      const restoreAttempt = Boolean(variables.restoreReason)
      const fatalRestoreError = /(?:\b(?:401|403|404|410|426)\b|not found|not_found|unauthorized|forbidden|permission|权限|不存在|已关闭|protocol|协议)/i.test(errorMessage)
      markSceneRestoring(variables.sceneId, false)
      // scene 存活期间，恢复 attach 的健康检查超时、临时后端无响应、普通网络/代理错误都视为瞬时故障，
      // 继续交给 supervisor 后台退避恢复；只有缺 scene/stream、权限、协议不兼容等致命错误才进入 failed。
      const shouldAutoRetry = restoreAttempt && !fatalRestoreError
      updateCommunicationHealthState(variables.sceneId, (current) => ({
        ...current,
        backendStatus: backendUnhealthy ? "unhealthy" : current.backendStatus,
        sseStatus: shouldAutoRetry
          ? preserveSseStatusForActiveTransport(current, "reconnecting")
          : preserveSseStatusForActiveTransport(
            current,
            backendUnhealthy || current.backendStatus === "unhealthy" ? current.sseStatus : "error",
          ),
        // 自动恢复路径保留 heartbeat 状态作为诊断事实；致命/初始 attach 失败才折叠为明确 error。
        heartbeatStatus: shouldAutoRetry
          ? current.heartbeatStatus
          : current.heartbeatStatus === "expired" || current.heartbeatStatus === "ok"
            ? "error"
            : current.heartbeatStatus,
        restoreStatus: shouldAutoRetry
          ? "reattaching"
          : current.restoreStatus === "reattaching" ? "failed" : current.restoreStatus,
        lastErrorAt: new Date().toISOString(),
        errorMessage: shouldAutoRetry
          ? `${errorMessage}，正在后台自动重试。`
          : errorMessage,
      }))
      if (shouldAutoRetry) {
        sceneCommunication.scheduleRecoveryRetry(variables.sceneId)
      }
    },
    onSettled: (_data, _error, variables) => {
      if (attachSceneInFlightRef.current.get(variables.sceneId) !== variables.attachClaim) return
      attachSceneInFlightRef.current.delete(variables.sceneId)
      sceneCommunication.unmarkReattaching(variables.sceneId)
    },
  })

  const mutateAttachScene = (
    args: Omit<Parameters<typeof attachSceneMutation.mutate>[0], "attachClaim">,
  ): boolean => {
    if (attachSceneInFlightRef.current.has(args.sceneId)) return false
    const claim = Symbol(args.sceneId)
    attachSceneInFlightRef.current.set(args.sceneId, claim)
    attachSceneMutation.mutate({ ...args, attachClaim: claim })
    return true
  }

  function enqueueInteractionAnsweredPatch(
    sceneId: string,
    agentInstanceId: string,
    interactionSelection: InteractionSelection,
  ) {
    chatBubblePersistence.enqueue({
      id: `patch-selection:${agentInstanceId}:${interactionSelection.interactionMessageId}:${interactionSelection.optionId ?? "free-text"}`,
      sceneId,
      label: "interaction selection",
      run: (signal) => patchSceneChatBubble(
        sceneId,
        interactionSelection.interactionMessageId,
        {
          interaction_state: "answered",
          ...(interactionSelection.optionId ? { selected_option_id: interactionSelection.optionId } : {}),
        },
        { signal },
      ).then((bubble) => hydratePersistedBubbleAck(sceneId, bubble, agentInstanceId)),
    })
  }

  const sendMessageMutation = useMutation({
    mutationFn: (args: { sceneId: string; instanceId: string; streamId: string | null; message: string; attachments: UserMessageAttachment[]; clientMessageId: string; interactionSelection?: InteractionSelection }) => {
      recordMobileChatDebugLog("send.api.start", {
        sceneId: args.sceneId,
        instanceId: args.instanceId,
        streamId: args.streamId,
        messageLength: args.message.length,
        attachmentCount: args.attachments.length,
        clientMessageId: args.clientMessageId,
        hasInteractionSelection: Boolean(args.interactionSelection),
      })
      return sendAgentInstanceMessage(args.instanceId, {
        user_message: args.message,
        attachments: args.attachments.map(attachmentToRequest),
        client_message_id: args.clientMessageId,
        communication_stream_id: args.streamId,
        render_options: {
          channel: "web",
          preferred_text_format: "html",
          supported_text_formats: ["html", "markdown", "plain_text", "json"],
        },
      })
    },
    onMutate: (variables) => {
      recordMobileChatDebugLog("send.mutation.start", {
        sceneId: variables.sceneId,
        instanceId: variables.instanceId,
        streamId: variables.streamId,
        messageLength: variables.message.length,
        attachmentCount: variables.attachments.length,
        clientMessageId: variables.clientMessageId,
      })
      showMobileSendDiagnostic("正在发送消息…")
      setSendPendingCountsByAgentInstanceId((current) => incrementPendingOperationCount(current, variables.instanceId))
    },
    onSettled: (_data, _error, variables) => {
      setSendPendingCountsByAgentInstanceId((current) => decrementPendingOperationCount(current, variables.instanceId))
    },
    onSuccess: (data, variables) => {
      recordMobileChatDebugLog("send.mutation.success", {
        sceneId: variables.sceneId,
        instanceId: variables.instanceId,
        streamId: data.communication_stream_id,
        clientMessageId: data.client_message_id ?? variables.clientMessageId,
        queuedForLater: Boolean(data.queued_for_later),
        pendingMessageId: data.pending_message_id ?? null,
      })
      showMobileSendDiagnostic(data.queued_for_later ? "消息已进入待发送队列。" : "消息已提交。")
      if (data.root_agent_instance) {
        setAgentInstance(variables.sceneId, data.root_agent_instance, { syncRunStatus: false })
      }
      setStreamId(variables.sceneId, data.communication_stream_id)
      chatEventCoordinator.setSceneTransportGeneration(variables.sceneId, { streamId: data.communication_stream_id })
      if (data.queued_for_later) {
        const queuedMessage: QueuedUserMessage = {
          id: data.pending_message_id,
          pendingMessageId: data.pending_message_id,
          clientMessageId: data.client_message_id ?? variables.clientMessageId,
          text: variables.message,
          attachments: variables.attachments,
          createdAt: new Date().toISOString(),
          status: "queued",
          agentInstanceId: data.agent_instance_id ?? variables.instanceId,
          interactionSelection: variables.interactionSelection,
        }
        enqueueUserMessage(variables.sceneId, queuedMessage, variables.interactionSelection)
        chatEventCoordinator.syncConversationControls(variables.sceneId, queuedMessage.agentInstanceId!, rootAgentInstanceId)
        return
      }
      if (variables.interactionSelection) {
        enqueueInteractionAnsweredPatch(variables.sceneId, variables.instanceId, variables.interactionSelection)
      }
      chatEventCoordinator.dispatchOptimisticUserMessage(
        variables.sceneId,
        variables.instanceId,
        variables.message,
        data.client_message_id ?? variables.clientMessageId,
        rootAgentInstanceId,
        variables.attachments,
        variables.interactionSelection,
      )
    },
    onError: (error, variables) => {
      const errorMessage = error instanceof Error ? error.message : "Send failed."
      recordMobileChatDebugLog("send.mutation.error", {
        sceneId: variables.sceneId,
        instanceId: variables.instanceId,
        streamId: variables.streamId,
        clientMessageId: variables.clientMessageId,
        messageLength: variables.message.length,
        attachmentCount: variables.attachments.length,
        errorMessage,
      })
      showMobileSendDiagnostic(`发送失败：${errorMessage}`)
      markQueuedUserMessageFailed(variables.sceneId, variables.instanceId, variables.clientMessageId, errorMessage)
      chatEventCoordinator.syncConversationControls(variables.sceneId, variables.instanceId, rootAgentInstanceId)
    },
  })

  const recallQueuedMessageMutation = useMutation({
    mutationFn: (args: { sceneId: string; instanceId: string; pendingMessageId: string }) =>
      removeAgentInstancePendingUserMessage(args.instanceId, args.pendingMessageId),
    onSuccess: (data, variables) => {
      setAgentInstance(variables.sceneId, data.agent_instance, { syncRunStatus: false })
      removeQueuedUserMessage(variables.sceneId, variables.instanceId, variables.pendingMessageId)
      chatEventCoordinator.syncConversationControls(variables.sceneId, variables.instanceId, rootAgentInstanceId)
    },
    onError: (error, variables) => {
      chatEventCoordinator.dispatchAssistantMessage(
        variables.sceneId,
        variables.instanceId,
        error instanceof Error ? error.message : "Recall queued message failed.",
        activeSceneSummary?.rootAgentInstanceId ?? null,
      )
    },
  })
  const switchPolicyMutation = useMutation({
    mutationFn: (args: { sceneId: string; instanceId: string; llmPolicyGroupId: string }) =>
      switchAgentInstanceLlmPolicy(args.instanceId, { llm_policy_group_id: args.llmPolicyGroupId }),
    onSuccess: (instance, variables) => setAgentInstance(variables.sceneId, instance),
    onError: (error, variables) => {
      chatEventCoordinator.dispatchAssistantMessage(
        variables.sceneId,
        variables.instanceId,
        error instanceof Error ? error.message : "Switch execution policy failed.",
        activeSceneSummary?.rootAgentInstanceId ?? null,
      )
    },
  })

  const interruptMutation = useMutation({
    mutationFn: (args: { sceneId: string; instanceId: string }) =>
      interruptAgentInstance(args.instanceId, { reason: "user_requested" }),
    onMutate: (variables) => {
      setInterruptPendingCountsByAgentInstanceId((current) => incrementPendingOperationCount(current, variables.instanceId))
    },
    onSettled: (_data, _error, variables) => {
      setInterruptPendingCountsByAgentInstanceId((current) => decrementPendingOperationCount(current, variables.instanceId))
    },
    onError: (error, variables) => {
      chatEventCoordinator.dispatchAssistantMessage(
        variables.sceneId,
        variables.instanceId,
        error instanceof Error ? error.message : "Interrupt failed.",
        activeSceneSummary?.rootAgentInstanceId ?? null,
      )
    },
  })
  const completeCurrentTaskMutation = useMutation({
    mutationFn: (args: { sceneId: string; workspacePath: string }) =>
      completeCurrentSceneTask(args.sceneId, args.workspacePath),
    onMutate: (variables) => {
      setTaskCompletionPendingSceneId(variables.sceneId)
    },
    onSettled: (_data, _error, variables) => {
      setTaskCompletionPendingSceneId((current) => current === variables.sceneId ? null : current)
      if (taskCompletionInFlightSceneIdRef.current === variables.sceneId) {
        taskCompletionInFlightSceneIdRef.current = null
      }
    },
    onSuccess: (result) => {
      if (result.outcome !== "completed") {
        notify({
          title: "结束任务会话",
          message: result.message,
          tone: "warning",
        })
      } else {
        queryClient.removeQueries({ queryKey: taskNoteKeys.all })
      }
    },
    onError: (error) => {
      notify({
        title: "结束任务会话失败",
        message: error instanceof Error ? error.message : "结束任务会话失败。",
        tone: "error",
      })
    },
  })

  const requestCompleteCurrentTask = async () => {
    if (
      !activeSceneId
      || !currentWorkspacePath
      || !isRootAgentPanel
      || isTaskCompletionPending
      || completeCurrentTaskMutation.isPending
      || taskCompletionInFlightSceneIdRef.current !== null
    ) return
    const targetSceneId = activeSceneId
    const targetWorkspacePath = currentWorkspacePath
    taskCompletionInFlightSceneIdRef.current = targetSceneId
    const releaseConfirmationClaim = () => {
      if (taskCompletionInFlightSceneIdRef.current === targetSceneId) {
        taskCompletionInFlightSceneIdRef.current = null
      }
    }
    const confirmed = await confirm({
      title: "结束当前 Task 会话",
      description: "当前 Task、终端和子 Agent 将结束并清理；Scene 和主 Agent 会继续保留。",
      confirmLabel: "结束任务会话",
      cancelLabel: "取消",
      tone: "danger",
      focusFallback: () => composerTextAreaRef.current,
      preferFocusFallback: true,
    })
    if (!confirmed) {
      releaseConfirmationClaim()
      return
    }
    const latestWorkspacePath = useSceneUiStore.getState().currentWorkspacePath
    const latestScene = useChatStore.getState().scenes[targetSceneId]
    const latestSelectedAgentInstanceId = latestScene
      ? latestScene.selectedAgentInstanceId ?? latestScene.agentInstance?.instance_id ?? latestScene.rootAgentInstanceId
      : null
    if (
      latestWorkspacePath !== targetWorkspacePath
      || useChatStore.getState().activeSceneId !== targetSceneId
      || !latestScene
      || latestSelectedAgentInstanceId !== latestScene.rootAgentInstanceId
    ) {
      releaseConfirmationClaim()
      notify({
        title: "未结束任务会话",
        message: "确认期间当前工作区、Scene 或 Agent 面板已变化，请在目标根 Agent 面板重新操作。",
        tone: "warning",
      })
      return
    }
    completeCurrentTaskMutation.mutate({
      sceneId: targetSceneId,
      workspacePath: targetWorkspacePath,
    })
  }

  const workspaceTreeStatus: WorkspaceTreeStatus = workspace
    ? "ready"
    : workspaceMutation.isPending
      ? "loading"
      : workspaceMutation.isError
        ? "error"
        : "empty"

  const retryActiveCommunication = () => {
    if (!activeSceneId) return
    const wsPath = sceneCommunication.getSceneWorkspace(activeSceneId) ?? currentWorkspacePath
    if (!wsPath) return
    sceneCommunication.clearRecoveryRetry(activeSceneId)
    updateCommunicationHealthState(activeSceneId, (current) => ({
      ...current,
      sseStatus: preserveSseStatusForActiveTransport(current, "connecting"),
      restoreStatus: "reattaching",
      errorMessage: undefined,
    }))
    mutateAttachScene({ sceneId: activeSceneId, workspacePath: wsPath, fallbackLlm: null, restoreReason: "manual" })
  }

  const restoreSceneCommunication = (sceneId: string, reason: Exclude<SceneRestoreReason, null>) => {
    if (!sceneCommunication.markReattaching(sceneId)) return
    const scene = useChatStore.getState().scenes[sceneId]
    if (!scene?.agentInstance) {
      sceneCommunication.unmarkReattaching(sceneId)
      return
    }
    const wsPath = sceneCommunication.getSceneWorkspace(sceneId) ?? currentWorkspacePath
    if (!wsPath) {
      sceneCommunication.unmarkReattaching(sceneId)
      return
    }
    sceneCommunication.clearRecoveryRetry(sceneId)
    // 重新绑定期间关闭旧 SSE，避免 generation reset 到新 attach 成功之间继续接收陈旧事件。
    sceneCommunication.closeEventClient(sceneId)
    // 通信链路不可信（心跳过期/SSE gap）→ 标脏 scene，避免 re-attach 中途失败时
    // UI 仍认为它是 clean。manual（用户主动 retry）和 cold（首次唤起）不标脏。
    if (reason === "heartbeat_expired" || reason === "sse_gap") {
      markSceneDirty(sceneId, true)
    }
    markSceneRestoring(sceneId, true, reason)
    updateCommunicationHealthState(sceneId, (current) => ({
      ...current,
      sseStatus: preserveSseStatusForActiveTransport(current, "connecting"),
      restoreStatus: "reattaching",
      errorMessage: undefined,
    }))
    if (!mutateAttachScene({ sceneId, workspacePath: wsPath, fallbackLlm: null, restoreReason: reason })) {
      sceneCommunication.unmarkReattaching(sceneId)
    }
  }

  async function rehydrateAgentsNeedingChatBubbles(
    sceneId: string,
    agentInstanceId: string | null | undefined,
  ) {
    await rehydrateAgentChatBubbles(sceneId, agentInstanceId, {
      getScene: (targetSceneId) => useChatStore.getState().scenes[targetSceneId],
      listChatBubbles: (targetSceneId, targetAgentInstanceId) => listSceneChatBubbles(targetSceneId, {
        limit: 100,
        agent_instance_id: targetAgentInstanceId,
      }),
      markHydrating: markAgentScopesHydrating,
      beginHydration: (targetSceneId, targetAgentInstanceId) => {
        const targetScene = useChatStore.getState().scenes[targetSceneId]
        const scopeId = chatAgentRuntimeScopeId(targetSceneId, targetAgentInstanceId, targetScene?.rootAgentInstanceId ?? null)
        return chatEventCoordinator.beginHydration(scopeId)
      },
      hydrate: (targetSceneId, batches, options, requestGeneration) => {
        const targetScene = useChatStore.getState().scenes[targetSceneId]
        return chatEventCoordinator.dispatchBaselineHydration(
          targetSceneId,
          batches,
          requestGeneration,
          targetScene?.rootAgentInstanceId ?? null,
          "hot",
        )
      },
      cancelHydration: (targetSceneId, targetAgentInstanceId, requestGeneration) => {
        const targetScene = useChatStore.getState().scenes[targetSceneId]
        const scopeId = chatAgentRuntimeScopeId(targetSceneId, targetAgentInstanceId, targetScene?.rootAgentInstanceId ?? null)
        chatEventCoordinator.cancelHydration(scopeId, requestGeneration)
      },
      markFailed: markAgentScopesHydrationFailed,
      onError: (targetSceneId, targetAgentInstanceId, error) => {
        console.warn(
          "[chat] agent-scoped ChatBubble rehydrate failed:",
          targetSceneId,
          targetAgentInstanceId,
          error,
        )
      },
    })
  }

  const activateScene = (sceneId: string | null) => {
    if (!sceneId) {
      setActiveScene(null)
      navigate("/chat")
      return
    }
    const scene = useChatStore.getState().scenes[sceneId]
    const shouldResync = Boolean(scene?.isDirty)
    const shouldRestore = Boolean(
      scene?.agentInstance &&
      (
        !sceneCommunication.hasEventClient(sceneId) ||
        !sceneCommunication.hasHeartbeat(sceneId)
      ),
    )
    const targetAgentInstanceId = scene?.selectedAgentInstanceId
      ?? scene?.agentInstance?.instance_id
      ?? scene?.rootAgentInstanceId
      ?? null
    setActiveScene(sceneId)
    navigate("/chat")
    if (shouldRestore) {
      restoreSceneCommunication(sceneId, "manual")
    } else if (shouldResync) {
      restoreSceneCommunication(sceneId, "sse_gap")
    } else {
      // Scene SSE 仍健康时，只检查当前选中 Agent 的 UI cache eviction 并定向补水。
      void rehydrateAgentsNeedingChatBubbles(sceneId, targetAgentInstanceId)
    }
  }

  const handleSceneSelected = (scene: Scene, fallbackLlm: SceneFallbackLlm | null) => {
    if (!currentWorkspacePath) return
    const claimKey = `${currentWorkspacePath}::${scene.scene_id}`
    if (openedSceneIds.includes(scene.scene_id) || claimedSceneKeysRef.current.has(claimKey)) {
      setSceneOccupiedError(null)
      activateScene(scene.scene_id)
      return
    }
    if (occupiedSceneIds.has(scene.scene_id)) {
      setSceneOccupiedError(`场景"${scene.name}"已在另一个标签页打开；当前窗口会作为新的客户端加入，不会关闭或接管原标签页。`)
    } else {
      setSceneOccupiedError(null)
    }
    claimScene(claimKey)
    claimedSceneKeysRef.current.add(claimKey)
    openSceneInChatStore(scene.scene_id, scene.name)
    mutateAttachScene({
      sceneId: scene.scene_id,
      workspacePath: currentWorkspacePath,
      fallbackLlm,
    })
  }

  const handleCloseTab = (sceneId: string) => {
    const claimWorkspacePath = sceneCommunication.getSceneWorkspace(sceneId) ?? currentWorkspacePath
    if (claimWorkspacePath) {
      const claimKey = `${claimWorkspacePath}::${sceneId}`
      releaseScene(claimKey)
      claimedSceneKeysRef.current.delete(claimKey)
    }
    detachScenePresence(sceneId)
    sceneCommunication.closeEventClient(sceneId)
    sceneCommunication.stopHeartbeat(sceneId)
    sceneCommunication.clearPendingEvents(sceneId)
    chatBubblePersistence.clearScene(sceneId)
    sceneCommunication.clearRecoveryRetry(sceneId)
    sceneCommunication.clearHeartbeatQuickRetry(sceneId)
    sceneCommunication.deleteSceneWorkspace(sceneId)
    sceneCommunication.unmarkReattaching(sceneId)
    sceneCommunication.clearCursor(sceneId)
    removeCommunicationHealthState(sceneId)
    chatEventCoordinator.clearScene(sceneId)
    closeSceneInChatStore(sceneId)
  }

  const activeSceneIdRef = useRef(activeSceneId)
  activeSceneIdRef.current = activeSceneId
  const agentInstanceRef = useRef(agentInstance)
  agentInstanceRef.current = agentInstance
  const streamIdRef = useRef(streamId)
  streamIdRef.current = streamId

  const recallQueuedUserMessage = useCallback((message: QueuedUserMessage) => {
    const sceneId = activeSceneIdRef.current
    if (!sceneId) return
    const instanceId = message.agentInstanceId
    if (!instanceId) return
    recallQueuedMessageMutation.mutate({
      sceneId,
      instanceId,
      pendingMessageId: message.pendingMessageId,
    })
  }, [recallQueuedMessageMutation])

  const submitUserMessage = useCallback((
    message: string,
    attachmentsOrSelection?: UserMessageAttachment[] | InteractionSelection,
    maybeSelection?: InteractionSelection,
  ) => {
    const activeSceneId = activeSceneIdRef.current
    const agentInstance = agentInstanceRef.current
    const streamId = streamIdRef.current
    const trimmed = message.trim()
    const attachments = Array.isArray(attachmentsOrSelection) ? attachmentsOrSelection : []
    let interactionSelection = Array.isArray(attachmentsOrSelection) ? maybeSelection : attachmentsOrSelection
    recordMobileChatDebugLog("send.submitUserMessage.attempt", {
      activeSceneId: activeSceneId ?? null,
      agentInstanceId: agentInstance?.instance_id ?? null,
      streamId,
      messageLength: trimmed.length,
      attachmentCount: attachments.length,
      hasInteractionSelection: Boolean(interactionSelection),
    })
    if (!trimmed && attachments.length === 0) {
      const reason = "没有可发送内容：请输入消息，或先选择图片 / PDF 附件。"
      recordMobileChatDebugLog("send.submitUserMessage.blocked", { reason, activeSceneId: activeSceneId ?? null, agentInstanceId: agentInstance?.instance_id ?? null })
      showMobileSendDiagnostic(reason)
      return
    }
    if (!activeSceneId || !agentInstance) {
      const reason = !activeSceneId ? "当前没有可发送的会话。" : "当前会话尚未绑定 Agent 实例。"
      recordMobileChatDebugLog("send.submitUserMessage.blocked", { reason, activeSceneId: activeSceneId ?? null, agentInstanceId: agentInstance?.instance_id ?? null })
      showMobileSendDiagnostic(reason)
      return
    }
    if (!interactionSelection) {
      const pendingInteraction = getAgentRuntimeState(activeSceneId, agentInstance.instance_id)?.pendingInteraction
      if (pendingInteraction) {
        interactionSelection = { interactionMessageId: pendingInteraction.eventId }
      }
    }
    const clientMessageId = createClientId("client-msg")
    recordMobileChatDebugLog("send.submitUserMessage.mutate", {
      sceneId: activeSceneId,
      instanceId: agentInstance.instance_id,
      streamId,
      messageLength: trimmed.length,
      attachmentCount: attachments.length,
      clientMessageId,
      hasInteractionSelection: Boolean(interactionSelection),
    })
    sendMessageMutation.mutate({
      sceneId: activeSceneId,
      instanceId: agentInstance.instance_id,
      streamId,
      message: trimmed,
      attachments,
      clientMessageId,
      interactionSelection,
    })
  }, [sendMessageMutation])


  const openWorkspace = async (directoryPath: string) => {
    const path = directoryPath.trim()
    if (!path || workspaceMutation.isPending || workspaceOpenInFlightPathRef.current !== null) return
    const sourceWorkspacePath = currentWorkspacePath
    if (path !== sourceWorkspacePath) {
      if (workspaceSwitchConfirmationPathRef.current !== null) return
      const guard = readMemoryDraftGuardSnapshot()
      if (guard.dirty) {
        workspaceSwitchConfirmationPathRef.current = path
        try {
          const confirmed = await confirm({
            title: "切换项目工作区",
            description: guard.confirmLeaveMessage,
            confirmLabel: "放弃修改并切换",
            cancelLabel: "留在当前项目",
            tone: "warning",
          })
          if (!confirmed) return
        } finally {
          if (workspaceSwitchConfirmationPathRef.current === path) {
            workspaceSwitchConfirmationPathRef.current = null
          }
        }
      }
      const latestWorkspacePath = useSceneUiStore.getState().currentWorkspacePath
      if (latestWorkspacePath === path) return
      if (latestWorkspacePath !== sourceWorkspacePath) {
        notify({
          title: "未切换项目工作区",
          message: "确认期间当前项目已经变化，请重新选择目标工作区。",
          tone: "warning",
        })
        return
      }
    }
    if (workspaceMutation.isPending || workspaceOpenInFlightPathRef.current !== null) return
    autoLoadedWorkspacePathRef.current = path
    workspaceOpenInFlightPathRef.current = path
    workspaceMutation.mutate({ directoryPath: path, mode: "open" })
  }

  const refreshWorkspaceTree = (directoryPath: string | null | undefined) => {
    const path = directoryPath?.trim()
    if (!path) return
    workspaceMutation.mutate({ directoryPath: path, mode: "refresh" })
  }

  const loadWorkspaceDirectory = (node: WorkspaceNode) => {
    if (node.type !== "folder" || node.children_loaded !== false) return
    const path = node.path.trim()
    if (!path || loadingDirectoryPaths.has(path)) return
    workspaceDirectoryMutation.mutate({ directoryPath: path })
  }

  const openWorkspaceNodeWithSystem = async (node: WorkspaceNode) => {
    const bridge = typeof window === "undefined" ? undefined : window.spreadDesktop
    if (bridge?.isElectron !== true || typeof bridge.openSystemPath !== "function") return
    const targetPath = node.path
    if (!targetPath || workspaceSystemOpenInFlightPathRef.current !== null) return
    const workspacePathAtRequest = useWorkspaceUiStore.getState().currentWorkspace?.path ?? null
    workspaceSystemOpenInFlightPathRef.current = targetPath
    let openResult: SpreadDesktopPathOperationResult
    try {
      openResult = await bridge.openSystemPath(targetPath)
    } catch (error) {
      openResult = {
        ok: false,
        error: desktopPathOperationErrorMessage(error, "调用操作系统打开路径时发生错误。"),
      }
    } finally {
      if (workspaceSystemOpenInFlightPathRef.current === targetPath) {
        workspaceSystemOpenInFlightPathRef.current = null
      }
    }
    if (openResult?.ok === true) return
    const openError = desktopPathOperationErrorMessage(openResult?.error, "操作系统未能打开该路径。")
    if (typeof bridge.revealSystemPath !== "function" || workspaceRevealPromptPathRef.current !== null) {
      notify({
        title: `无法使用系统打开 ${node.name}`,
        message: `${targetPath}\n${openError}`,
        tone: "error",
      })
      return
    }

    workspaceRevealPromptPathRef.current = targetPath
    let shouldReveal = false
    try {
      shouldReveal = await confirm({
        title: `无法使用系统打开 ${node.name}`,
        description: `${targetPath}\n\n${openError}\n\n是否改为在系统文件管理器中显示该路径？`,
        confirmLabel: "在文件管理器中显示",
        cancelLabel: "关闭",
        tone: "warning",
      })
    } finally {
      if (workspaceRevealPromptPathRef.current === targetPath) {
        workspaceRevealPromptPathRef.current = null
      }
    }
    if (!shouldReveal) return

    const latestWorkspacePath = useWorkspaceUiStore.getState().currentWorkspace?.path ?? null
    if (latestWorkspacePath !== workspacePathAtRequest) {
      notify({
        title: "未在文件管理器中显示",
        message: "确认期间当前项目工作区已经变化，请在新的工作区中重新操作。",
        tone: "warning",
      })
      return
    }
    const latestBridge = typeof window === "undefined" ? undefined : window.spreadDesktop
    if (latestBridge?.isElectron !== true || typeof latestBridge.revealSystemPath !== "function") {
      notify({
        title: "无法在文件管理器中显示",
        message: "桌面系统能力当前不可用。",
        tone: "error",
      })
      return
    }
    let revealResult: SpreadDesktopPathOperationResult
    try {
      revealResult = await latestBridge.revealSystemPath(targetPath)
    } catch (error) {
      revealResult = {
        ok: false,
        error: desktopPathOperationErrorMessage(error, "调用系统文件管理器时发生错误。"),
      }
    }
    if (revealResult?.ok !== true) {
      notify({
        title: "无法在文件管理器中显示",
        message: `${targetPath}\n${desktopPathOperationErrorMessage(revealResult?.error, "操作系统未能定位该路径。")}`,
        tone: "error",
      })
    }
  }

  // P1-6 抽取：recordHeartbeatResult / sendSceneHeartbeat / handleHeartbeatExpired / useEffect heartbeatExpiredHandlerRef
  // 已全部下沉至 sceneCommunication manager（详见 hooks/useSceneCommunication.ts 与 runtime/sceneCommunication.ts）。
  // requestReattach 回调走 restoreSceneCommunicationRef.current，同 heartbeat_expired 路径语义一致。

  useEffect(() => {
    communicationHealthStatesRef.current = communicationHealthStates
  }, [communicationHealthStates])

  // P1-6 抽取：startHeartbeat / stopHeartbeat / stopAllHeartbeats / retry 函数 / quick retry 函数
  // / pending events 三件套 / buffer / drain / handleCommunicationEvent / replayCommunicationGap
  // 已全部下沉至 sceneCommunication manager（详见 runtime/sceneCommunication.ts）。
  // 调用方转为 sceneCommunication.startHeartbeat / scheduleRecoveryRetry / clearAllPendingEvents 等对应接口。

  function hydratePersistedBubbleAck(
    sceneId: string,
    bubble: ChatBubbleMessageDto,
    expectedAgentInstanceId: string | null,
  ) {
    const agentInstanceId = textValue(bubble.agent_instance_id)
    if (!agentInstanceId) {
      console.warn("[chat] drop persisted bubble ACK: missing agent owner", sceneId, bubble.bubble_id)
      return
    }
    if (expectedAgentInstanceId && expectedAgentInstanceId !== agentInstanceId) {
      console.warn("[chat] drop persisted bubble ACK: owner mismatch", {
        sceneId,
        bubbleId: bubble.bubble_id,
        expectedAgentInstanceId,
        actualAgentInstanceId: agentInstanceId,
      })
      return
    }
    if (!shouldHydratePersistedBubble(sceneId, bubble)) return
    chatEventCoordinator.dispatchIncrementalBubbles(sceneId, [{
      agentInstanceId,
      bubbles: [bubble],
    }], rootAgentInstanceId)
  }

  function hydrateLocalChatBubbleSnapshot(
    sceneId: string,
    body: CreateChatBubbleMessageRequest,
    createdAt: string,
  ) {
    const agentInstanceId = chatBubbleRequestAgentInstanceId(body)
    if (!agentInstanceId) {
      console.warn("[chat] drop local bubble snapshot: missing agent owner", sceneId, body.bubble_id)
      return
    }
    const localBubble = localChatBubbleFromRequest(sceneId, { ...body, agent_instance_id: agentInstanceId }, createdAt)
    if (!shouldHydratePersistedBubble(sceneId, localBubble)) return
    chatEventCoordinator.dispatchIncrementalBubbles(sceneId, [{
      agentInstanceId,
      bubbles: [localBubble],
    }], rootAgentInstanceId)
  }

  function persistChatBubblePersistenceSnapshot(
    entry: ChatBubblePersistenceOutboxEntry,
    signal: AbortSignal,
  ) {
    return createSceneChatBubble(entry.sceneId, entry.body, { signal })
      .then((bubble) => {
        hydratePersistedBubbleAck(entry.sceneId, bubble, chatBubbleRequestAgentInstanceId(entry.body))
        acknowledgeChatBubblePersistenceSnapshot(entry.snapshotId)
      })
  }

  function enqueueChatBubblePersistenceSnapshot(
    entry: ChatBubblePersistenceOutboxEntry,
    options: { force?: boolean } = {},
  ) {
    const agentScopeKey = chatBubbleRequestAgentInstanceId(entry.body)
    if (!agentScopeKey) {
      console.warn("[chat] drop persistence outbox entry: missing agent owner", entry.sceneId, entry.bubbleId)
      return
    }
    const run = (signal: AbortSignal) => persistChatBubblePersistenceSnapshot(entry, signal)
    if (isExecutionProcessBubbleSnapshot(entry.body)) {
      chatBubblePersistence.enqueueLatest({
        id: `outbox:${entry.snapshotId}`,
        key: `${entry.sceneId}:${agentScopeKey}:${entry.bubbleId}`,
        sceneId: entry.sceneId,
        label: entry.label,
        run,
        delayMs: options.force ? 0 : CHAT_BUBBLE_CONTENT_DELTA_PERSIST_DELAY_MS,
        force: options.force,
      })
      return
    }
    chatBubblePersistence.enqueue({
      id: `outbox:${entry.snapshotId}`,
      sceneId: entry.sceneId,
      label: entry.label,
      run,
    })
  }

  function enqueueContentDeltaChatBubblePersistenceSnapshot(
    sceneId: string,
    label: string,
    body: CreateChatBubbleMessageRequest,
    createdAt: string,
    eventMessageId: string,
  ) {
    const bubbleId = body.bubble_id
    if (!bubbleId) {
      throw new Error("Chat Bubble persistence outbox requires bubble_id")
    }
    // Keep the latest complete projection only in the queue until its 120ms cadence fires.
    // This avoids parsing/stringifying the complete accumulated content on every token delta.
    const agentScopeKey = chatBubbleRequestAgentInstanceId(body)
    if (!agentScopeKey) {
      console.warn("[chat] drop content-delta persistence: missing agent owner", sceneId, bubbleId)
      return
    }
    chatBubblePersistence.enqueueLatest({
      id: `content-delta:${agentScopeKey}:${eventMessageId}`,
      key: `${sceneId}:${agentScopeKey}:${bubbleId}`,
      sceneId,
      label,
      delayMs: CHAT_BUBBLE_CONTENT_DELTA_PERSIST_DELAY_MS,
      run: (signal) => {
        const entry = saveChatBubblePersistenceSnapshot(sceneId, label, body, createdAt)
        return persistChatBubblePersistenceSnapshot(entry, signal)
      },
    })
  }

  function restoreChatBubblePersistenceOutbox(sceneId: string) {
    replayChatBubblePersistenceSnapshots(sceneId, (entry) => {
      hydrateLocalChatBubbleSnapshot(sceneId, entry.body, entry.createdAt)
      enqueueChatBubblePersistenceSnapshot(entry, { force: true })
    })
  }

  const clampTerminalPanelWidth = useCallback((value: number) => {
    const container = workspaceSplitContainerRef.current
    // 左侧 workspace 面板被用户隐藏时，原本属于它的列宽 + separator 不再占用容器空间，
    // 终端面板的可用最大宽度需要相应放宽，避免 clamp 把终端宽度压到不必要的小值。
    const workspaceReservedWidth = showWorkspacePanel
      ? workspacePanelWidth + SPLIT_SEPARATOR_WIDTH_PX
      : 0
    const maxByContainer = container
      ? container.getBoundingClientRect().width
        - workspaceReservedWidth
        - SPLIT_SEPARATOR_WIDTH_PX
        - MIN_CHAT_PANEL_WIDTH_PX
      : MAX_TERMINAL_PANEL_WIDTH_PX
    const maxWidth = Math.max(MIN_TERMINAL_PANEL_WIDTH_PX, Math.min(MAX_TERMINAL_PANEL_WIDTH_PX, maxByContainer))
    return clamp(value, MIN_TERMINAL_PANEL_WIDTH_PX, maxWidth)
  }, [showWorkspacePanel, workspacePanelWidth])

  const handleTerminalSplitDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = workspaceSplitContainerRef.current
    if (!container) return
    event.preventDefault()
    splitDragCleanupRef.current?.()

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    const updateWidth = (clientX: number) => {
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      setTerminalPanelWidth(clampTerminalPanelWidth(rect.right - clientX - SPLIT_SEPARATOR_WIDTH_PX / 2))
    }

    const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX)
    const cleanup = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", cleanup)
      window.removeEventListener("pointercancel", cleanup)
      splitDragCleanupRef.current = null
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    updateWidth(event.clientX)
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", cleanup)
    window.addEventListener("pointercancel", cleanup)
    splitDragCleanupRef.current = cleanup
  }, [clampTerminalPanelWidth])

  const clampWorkspacePanelWidth = useCallback((value: number) => {
    const container = workspaceSplitContainerRef.current
    const mainReservedWidth = showTerminalPanel
      ? MIN_CHAT_PANEL_WIDTH_PX + SPLIT_SEPARATOR_WIDTH_PX + terminalPanelWidth
      : MIN_CHAT_PANEL_WIDTH_PX
    const maxByContainer = container
      ? container.getBoundingClientRect().width - SPLIT_SEPARATOR_WIDTH_PX - mainReservedWidth
      : MAX_WORKSPACE_PANEL_WIDTH_PX
    const maxWidth = Math.max(MIN_WORKSPACE_PANEL_WIDTH_PX, Math.min(MAX_WORKSPACE_PANEL_WIDTH_PX, maxByContainer))
    return clamp(value, MIN_WORKSPACE_PANEL_WIDTH_PX, maxWidth)
  }, [showTerminalPanel, terminalPanelWidth])

  // 拼装当前栅格列模板：左侧目录树和右侧终端各自独立控制；工具流水固定在中间对话面板内部右侧。
  const gridTemplateColumns = useMemo(() => {
    if (isMobileLayout) return "minmax(0,1fr)"

    const segments: string[] = []
    if (showWorkspacePanel) {
      segments.push(`${workspacePanelWidth}px`, `${SPLIT_SEPARATOR_WIDTH_PX}px`)
    }
    segments.push(`minmax(${MIN_CHAT_PANEL_WIDTH_PX}px,1fr)`)
    if (showTerminalPanel) {
      segments.push(`${SPLIT_SEPARATOR_WIDTH_PX}px`, `${terminalPanelWidth}px`)
    }
    return segments.join(" ")
  }, [isMobileLayout, showWorkspacePanel, showTerminalPanel, workspacePanelWidth, terminalPanelWidth])

  const handleWorkspaceSplitDragStart = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const container = workspaceSplitContainerRef.current
    if (!container) return
    event.preventDefault()
    splitDragCleanupRef.current?.()

    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect

    const updateWidth = (clientX: number) => {
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      setWorkspacePanelWidth(clampWorkspacePanelWidth(clientX - rect.left))
    }

    const handlePointerMove = (moveEvent: PointerEvent) => updateWidth(moveEvent.clientX)
    const cleanup = () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
      window.removeEventListener("pointermove", handlePointerMove)
      window.removeEventListener("pointerup", cleanup)
      window.removeEventListener("pointercancel", cleanup)
      splitDragCleanupRef.current = null
    }

    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    updateWidth(event.clientX)
    window.addEventListener("pointermove", handlePointerMove)
    window.addEventListener("pointerup", cleanup)
    window.addEventListener("pointercancel", cleanup)
    splitDragCleanupRef.current = cleanup
  }, [clampWorkspacePanelWidth])

  useEffect(() => {
    if (!currentWorkspace?.path) return
    setWorkspacePathInput(currentWorkspace.path)
    if (workspace?.path === currentWorkspace.path) return
    if (autoLoadedWorkspacePathRef.current === currentWorkspace.path) return
    void openWorkspace(currentWorkspace.path)
  }, [currentWorkspace?.path, currentWorkspacePath, workspace?.path])

  // 把本 Tab 已打开的所有 scene 注册到占用清单；关闭 Tab / workspace 切换时自动释放。
  // 占用状态由 sceneClaimRegistry 模块同步到其他浏览器 Tab。
  useEffect(() => {
    const nextClaimKeys = new Set<string>()
    if (currentWorkspacePath) {
      for (const sceneId of openedSceneIds) {
        nextClaimKeys.add(`${currentWorkspacePath}::${sceneId}`)
      }
    }

    for (const claimKey of nextClaimKeys) {
      if (!claimedSceneKeysRef.current.has(claimKey)) {
        claimScene(claimKey)
        claimedSceneKeysRef.current.add(claimKey)
      }
    }

    for (const claimKey of Array.from(claimedSceneKeysRef.current)) {
      if (!nextClaimKeys.has(claimKey)) {
        releaseScene(claimKey)
        claimedSceneKeysRef.current.delete(claimKey)
      }
    }
  }, [currentWorkspacePath, openedSceneIds])

  // 订阅占用集合变化（storage 事件 + 存活验证），驱动 SceneSelector 实时置灰。
  useEffect(() => subscribeOccupiedKeys(setOccupiedClaimKeys), [])

  // visibilitychange：Tab 切回前台时立即补发心跳，及早检测 session 是否过期。
  // 浏览器对后台 Tab 的 setInterval 可能从 30s 节流到 ~1 次/分钟，切回时需要立即探活。
  useEffect(() => {
    lifecycleStateRef.current = lifecycleState
  }, [lifecycleState])

  useEffect(() => {
    setSceneTabsPortalElement(document.getElementById("chat-scene-tabs-header-slot"))
  }, [isMobileLayout])

  useEffect(() => {
    applySceneCachePolicy()
    const intervalId = setInterval(() => applySceneCachePolicy(), SCENE_CACHE_POLICY_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [applySceneCachePolicy])

  // sceneCommunication manager 创建时捕获的是 ref.current 访问，每次都能取到最新闭包。
  useEffect(() => {
    restoreSceneCommunicationRef.current = restoreSceneCommunication
  })

  // 统一连接 Coordinator 权威气泡持久化 sink 至持久化 Outbox
  useEffect(() => {
    chatEventCoordinator.setBubblePersistenceSink((sceneId, body, createdAt, label, messageId) => {
      if (label === "execution process delta") {
        enqueueContentDeltaChatBubblePersistenceSnapshot(
          sceneId,
          label,
          body,
          createdAt,
          messageId,
        )
        return
      }
      const snapshot = saveChatBubblePersistenceSnapshot(
        sceneId,
        label,
        body,
        createdAt,
      )
      enqueueChatBubblePersistenceSnapshot(snapshot, { force: true })
    })
    return () => {
      chatEventCoordinator.setBubblePersistenceSink(null)
    }
  }, [])

  useEffect(() => {
    if (!activeSceneId || !activeAgentInstanceId) return
    const scene = useChatStore.getState().scenes[activeSceneId]
    if (!scene?.agentInstance || scene.isRestoring) return
    const healthState = communicationHealthStatesRef.current[activeSceneId]
    if (healthState?.restoreStatus === "failed") return
    const missingCommunication = !sceneCommunication.hasEventClient(activeSceneId) || !sceneCommunication.hasHeartbeat(activeSceneId)
    if (scene.isDirty && !missingCommunication) {
      restoreSceneCommunication(activeSceneId, "sse_gap")
      return
    }
    if (missingCommunication) {
      restoreSceneCommunication(activeSceneId, "manual")
      return
    }
    // 通信健康不等于所选 Agent 的 UI 历史仍在内存：cache eviction 后只补当前 Agent。
    void rehydrateAgentsNeedingChatBubbles(activeSceneId, activeAgentInstanceId)
  }, [activeAgentInstanceId, activeSceneId, sceneCacheStateKeys])

  useEffect(() => {
    if (!lifecycleState.isVisible) return
    // 强制立即补发心跳：跳过 HEARTBEAT_MIN_INTERVAL_MS 节流。Tab 切回前台后浏览器才让
    // setInterval 节拍恢复正常，但 setInterval 不会立即触发；不强制就要等下一个节拍。
    sceneCommunication.forceAllHeartbeats({ force: true })
  }, [lifecycleState.foregroundVersion, lifecycleState.isVisible, sceneCommunication])

  // D: 网络从离线恢复的瞬间立即 force heartbeat。
  // 场景：用户笔记本休眠唤醒、Wi-Fi 切换、路由器重启之后，SSE 可能已被加进 retry 退避队列，
  // setInterval 也会被节流。online 事件让恢复路径颈上主动探测，不等下一个 setInterval 节拍。
  useEffect(() => {
    if (typeof window === "undefined") return
    const handleOnline = () => {
      console.info("[chat] navigator online → force heartbeat for all scenes")
      sceneCommunication.forceAllHeartbeats({ force: true })
    }
    window.addEventListener("online", handleOnline)
    return () => window.removeEventListener("online", handleOnline)
  }, [sceneCommunication])

  useEffect(() => {
    const detectStaleHeartbeats = () => sceneCommunication.detectStaleAndRecover()
    detectStaleHeartbeats()
    const intervalId = setInterval(detectStaleHeartbeats, HEARTBEAT_STALE_WATCHDOG_INTERVAL_MS)
    return () => clearInterval(intervalId)
  }, [sceneCommunication])

  // ChatPage unmount cleanup：先用 beacon 释放当前客户端 scene presence；sceneCommunication manager 自身在
  // useSceneCommunication 内部 unmount 时会清理 SseClient / setInterval / setTimeout / buffer / cursor / workspace / reattaching set。
  // 这里只额外清 ChatPage 自己持有的资源：chat bubble 持久化队列、claim registry、split drag 监听器。
  useEffect(() => () => {
    for (const sceneId of Object.keys(useChatStore.getState().scenes)) {
      detachScenePresence(sceneId, { transport: "beacon" })
    }
    chatBubblePersistence.clearAll()
    for (const claimKey of claimedSceneKeysRef.current) releaseScene(claimKey)
    claimedSceneKeysRef.current.clear()
    splitDragCleanupRef.current?.()
  }, [])

  return (
    <>
    {sceneTabsPortalElement && currentProject ? createPortal(
      <SceneTabsBar
        openedScenes={openedSceneTabs}
        activeSceneId={activeSceneId}
        onSelectTab={activateScene}
        onCloseTab={handleCloseTab}
        onNewScene={() => activateScene(null)}
      />,
      sceneTabsPortalElement,
    ) : null}
    <div
      ref={workspaceSplitContainerRef}
      className="grid h-full min-h-0 min-w-0 bg-[#f6f8fb]"
      style={{ gridTemplateColumns }}
    >
      {showWorkspacePanel ? (
        <>
          <WorkspaceTree
            workspaceName={workspace?.name ?? currentWorkspace?.name ?? null}
            workspacePath={workspace?.path ?? currentWorkspace?.path ?? null}
            nodes={workspace?.children ?? EMPTY_WORKSPACE_NODES}
            status={workspaceTreeStatus}
            selectedPath={selectedPath}
            error={workspaceMutation.error instanceof Error ? workspaceMutation.error.message : null}
            isRefreshing={workspaceMutation.isPending && Boolean(workspace)}
            loadingDirectoryPaths={loadingDirectoryPaths}
            directoryLoadErrors={directoryLoadErrors}
            onRefresh={() => refreshWorkspaceTree(workspace?.path ?? currentWorkspace?.path ?? null)}
            onSelectNode={(node) => setSelectedPath(node.path)}
            onLoadDirectory={loadWorkspaceDirectory}
            onOpenNode={canOpenWorkspacePathWithSystem ? openWorkspaceNodeWithSystem : undefined}
          />

          <div
            role="separator"
            aria-label="调整文件树和主工作区宽度"
            aria-orientation="vertical"
            aria-valuemin={MIN_WORKSPACE_PANEL_WIDTH_PX}
            aria-valuemax={MAX_WORKSPACE_PANEL_WIDTH_PX}
            aria-valuenow={Math.round(workspacePanelWidth)}
            tabIndex={0}
            title="拖动调整文件树和主工作区宽度，双击恢复默认宽度"
            onDoubleClick={() => setWorkspacePanelWidth(DEFAULT_WORKSPACE_PANEL_WIDTH_PX)}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return
              event.preventDefault()
              if (event.key === "ArrowLeft") setWorkspacePanelWidth((value) => clampWorkspacePanelWidth(value - 16))
              if (event.key === "ArrowRight") setWorkspacePanelWidth((value) => clampWorkspacePanelWidth(value + 16))
              if (event.key === "Home") setWorkspacePanelWidth(clampWorkspacePanelWidth(MIN_WORKSPACE_PANEL_WIDTH_PX))
              if (event.key === "End") setWorkspacePanelWidth(clampWorkspacePanelWidth(MAX_WORKSPACE_PANEL_WIDTH_PX))
              if (event.key === "Enter") setWorkspacePanelWidth(clampWorkspacePanelWidth(DEFAULT_WORKSPACE_PANEL_WIDTH_PX))
            }}
            onPointerDown={handleWorkspaceSplitDragStart}
            className="group relative z-20 flex w-2 cursor-col-resize items-stretch justify-center bg-slate-200/70 transition-colors hover:bg-slate-300/80 focus:outline-none focus:ring-2 focus:ring-[#4f6f96]/35"
          >
            <div className="my-2 w-px rounded-full bg-slate-400/45 transition-colors group-hover:bg-slate-500/70" />
          </div>
        </>
      ) : null}

      <section
        className={[
          "flex min-h-0 min-w-0 flex-col bg-[#f8fafc] text-slate-900",
          isMobileLayout ? "" : "border-r border-slate-200/80",
        ].filter(Boolean).join(" ")}
      >
        {activeSceneId && agentInstance ? (
          <header className={[
            "flex shrink-0 items-stretch border-b border-slate-200/80 bg-white/45 backdrop-blur",
            isMobileLayout ? "mobile-horizontal-scrollbar-hidden min-h-12 gap-1 overflow-x-auto px-2 py-1" : "min-h-11 px-4 py-1",
          ].join(" ")}>
            <div
              role="tablist"
              aria-label="当前场景 Agent 实例"
              className={isMobileLayout ? "mobile-horizontal-scrollbar-hidden flex min-w-0 flex-1 items-stretch gap-3 overflow-x-auto" : "flex min-w-0 flex-1 items-stretch gap-6 overflow-x-auto"}
            >
              {(sceneAgentInstances.length > 0 ? sceneAgentInstances : [agentInstance]).map((candidate) => {
                const isSelected = candidate.instance_id === agentInstance.instance_id
                const displayName = agentDefinitionDisplayName(availableAgents, candidate.agent_definition_id)
                const isRootAgent = candidate.instance_id === rootAgentInstanceId
                const candidateStatus = effectiveAgentPanelStatus(candidate, rootAgentInstanceId, parentChildRelations)
                const isReleasedChildAgent = isReleasedChildAgentPanel(candidate, rootAgentInstanceId, parentChildRelations)
                const parentInstanceId = parentAgentInstanceIdOf(parentChildRelations, candidate.instance_id, rootAgentInstanceId)
                const title = [
                  displayName,
                  `定义 ${candidate.agent_definition_id}`,
                  `实例 ${shortInstanceId(candidate.instance_id)} (${candidate.instance_id})`,
                  isRootAgent ? "根 Agent" : parentInstanceId ? `父 Agent ${shortInstanceId(parentInstanceId)} (${parentInstanceId})` : "子 Agent",
                  `状态 ${candidateStatus}`,
                ].join("\n")
                if (!isSelected) {
                  return (
                    <div
                      key={candidate.instance_id}
                      role="tab"
                      aria-selected="false"
                      title={title}
                      className={isMobileLayout
                        ? "inline-flex h-10 max-w-40 shrink-0 items-center gap-1 px-1.5 text-sm font-medium text-app-muted transition hover:text-app-primary"
                        : "inline-flex h-9 max-w-44 shrink-0 items-center gap-1 px-1 text-sm font-medium text-app-muted transition hover:text-app-primary"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => selectAgentInstance(activeSceneId, candidate.instance_id)}
                        className="min-w-0 truncate rounded-sm px-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/30"
                      >
                        {displayName}
                      </button>
                      <AgentStatusBadge status={candidateStatus} hasInstance />
                      {isReleasedChildAgent ? (
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation()
                            closeAgentInstancePanel(activeSceneId, candidate.instance_id)
                          }}
                          className="inline-flex size-5 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                          title="关闭已释放的子 Agent 面板"
                          aria-label="关闭已释放的子 Agent 面板"
                        >
                          <X size={12} />
                        </button>
                      ) : null}
                    </div>
                  )
                }
                return (
                  <div
                    key={candidate.instance_id}
                    role="tab"
                    aria-selected="true"
                    title={title}
                    className={[
                      "inline-flex max-w-full shrink-0 items-center gap-2 text-xs",
                      isMobileLayout ? "h-10 min-w-[13rem] pr-2" : "h-9 min-w-[18rem] pr-2",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      onClick={() => selectAgentInstance(activeSceneId, candidate.instance_id)}
                      className="relative ml-1.5 flex min-w-0 items-center gap-1.5 rounded-sm text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent/30"
                    >
                      <svg aria-hidden="true" viewBox="0 0 8 8" className="absolute -left-1.5 -top-1.5 size-2 overflow-visible text-blue-500">
                        <path d="M7 1 A6 6 0 0 0 1 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      <span className="min-w-0 truncate text-sm font-semibold text-app-primary">{displayName}</span>
                      <span className="shrink-0 text-[11px] font-medium text-app-accent">
                        {isRootAgent ? "root" : "child"}
                      </span>
                    </button>
                    <AgentStatusBadge status={candidateStatus} hasInstance />
                    {isReleasedChildAgent ? (
                      <button
                        type="button"
                        onClick={() => closeAgentInstancePanel(activeSceneId, candidate.instance_id)}
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
                        title="关闭已释放的子 Agent 面板"
                        aria-label="关闭已释放的子 Agent 面板"
                      >
                        <X size={13} />
                      </button>
                    ) : (
                      <>
                        <LacpInstanceRegistrationToggle instanceId={candidate.instance_id} />
                        <TokenMeterContainer sceneId={activeSceneId} agentInstanceId={candidate.instance_id} />
                        <RuntimePolicySwitcher
                      agent={availableAgents.find((agent) => agent.agent_id === candidate.agent_definition_id) ?? null}
                      instance={candidate}
                      policies={availablePolicies}
                      isSwitching={switchPolicyMutation.isPending}
                      error={switchPolicyMutation.error instanceof Error ? switchPolicyMutation.error.message : null}
                      onBeforeOpen={refetchChatConfigOptions}
                      onSwitch={(policyGroupId) =>
                        switchPolicyMutation.mutate({
                          sceneId: activeSceneId!,
                          instanceId: candidate.instance_id,
                          llmPolicyGroupId: policyGroupId,
                        })
                      }
                        />
                      </>
                    )}
                  </div>
                )
              })}
            </div>
          </header>
        ) : null}

        <div className={isMobileLayout ? "relative flex min-h-0 flex-1 flex-col bg-white" : "relative flex min-h-0 flex-1 flex-col px-4 py-3"}>
          {!workspace ? (
            <WorkspacePicker
              value={workspacePathInput}
              onChange={setWorkspacePathInput}
              isLoading={workspaceMutation.isPending}
              error={workspaceMutation.error instanceof Error ? workspaceMutation.error.message : null}
              onOpen={() => openWorkspace(workspacePathInput)}
              recentWorkspaces={recentWorkspacesQuery.data ?? []}
              isRecentLoading={recentWorkspacesQuery.isFetching}
              recentError={recentWorkspacesQuery.error instanceof Error ? recentWorkspacesQuery.error.message : null}
              onSelectRecent={openWorkspace}
            />
          ) : !currentProject || !currentWorkspacePath ? (
            <ProjectLoadingPlaceholder
              workspacePath={workspace.path}
              isLoading={projectMutation.isPending}
              error={projectMutation.error instanceof Error ? projectMutation.error.message : null}
              onRetry={() => projectMutation.mutate({ workspace_path: workspace.path, name: workspace.name })}
            />
          ) : !activeSceneId ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3">
              {sceneOccupiedError ? (
                <div className="flex items-start gap-2 rounded-xl border border-amber-200/80 bg-amber-50/85 px-3 py-2 text-sm text-amber-900 shadow-[0_8px_22px_rgba(180,83,9,0.06)]">
                  <span className="mt-0.5 inline-block size-1.5 shrink-0 rounded-full bg-amber-500/80" />
                  <span className="min-w-0">{sceneOccupiedError}</span>
                  <button
                    type="button"
                    onClick={() => setSceneOccupiedError(null)}
                    className="ml-auto rounded p-0.5 text-amber-700 hover:bg-amber-100"
                    title="关闭提示"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}
              <SceneSelector
                project={currentProject}
                workspacePath={currentWorkspacePath}
                isCreatingAgent={attachSceneMutation.isPending}
                occupiedSceneIds={occupiedSceneIds}
                onSelect={handleSceneSelected}
              />
            </div>
          ) : !agentInstance ? (
            <SceneAttachPlaceholder
              sceneId={activeSceneId}
              isAttaching={attachSceneMutation.isPending}
              error={attachSceneMutation.error instanceof Error ? attachSceneMutation.error.message : null}
              onRetry={() =>
                mutateAttachScene({
                  sceneId: activeSceneId,
                  workspacePath: currentWorkspacePath,
                  fallbackLlm: null,
                })
              }
            />
          ) : isMobileLayout ? (
            <div className="relative flex h-full min-h-0 flex-col">
              <div className="mobile-horizontal-scrollbar-hidden flex shrink-0 gap-4 overflow-x-auto border-b border-slate-200/80 bg-white px-4 py-2 text-sm">
                <button
                  type="button"
                  onClick={() => setMobilePanel("chat")}
                  className={[
                    "inline-flex h-9 shrink-0 items-center rounded-lg px-4 font-semibold transition",
                    mobilePanel === "chat" ? "bg-app-accent text-white shadow-sm" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
                  ].join(" ")}
                >
                  聊天
                </button>
                {workspace ? (
                  <button
                    type="button"
                    onClick={() => setMobilePanel("workspace")}
                    className={[
                      "inline-flex h-9 shrink-0 items-center rounded-lg px-4 font-semibold transition",
                      mobilePanel === "workspace" ? "bg-app-accent text-white shadow-sm" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
                    ].join(" ")}
                  >
                    工作区
                  </button>
                ) : null}
                {executionMonitorSceneId ? (
                  <button
                    type="button"
                    onClick={() => setMobilePanel("monitor")}
                    className={[
                      "inline-flex h-9 shrink-0 items-center rounded-lg px-4 font-semibold transition",
                      mobilePanel === "monitor" ? "bg-app-accent text-white shadow-sm" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
                    ].join(" ")}
                  >
                    执行
                  </button>
                ) : null}
                {terminalPanelSceneId ? (
                  <button
                    type="button"
                    onClick={() => setMobilePanel("terminal")}
                    className={[
                      "inline-flex h-9 shrink-0 items-center rounded-lg px-4 font-semibold transition",
                      mobilePanel === "terminal" ? "bg-app-accent text-white shadow-sm" : "text-slate-700 hover:bg-slate-100 hover:text-slate-950",
                    ].join(" ")}
                  >
                    终端
                  </button>
                ) : null}
              </div>
              {mobileSendDiagnostic ? (
                <div className="shrink-0 border-b border-amber-200/80 bg-amber-50/90 px-3 py-2 text-xs text-amber-900" role="status">
                  {mobileSendDiagnostic}
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-hidden">
                {mobilePanel === "chat" ? (
                  <div className="relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-white">
                    <div
                      className="pointer-events-none absolute left-3 top-4 z-20 flex flex-col gap-3"
                      aria-label="聊天状态控制"
                    >
                      <CommunicationStatusOverlay
                        view={activeCommunicationView}
                        onRetry={retryActiveCommunication}
                        presentation="rail"
                      />
                      <LacpStatusOverlay status={lacpStatusQuery.data} presentation="rail" />
                      <AgentInteractionSoundToggle agentInstanceId={agentInstance.instance_id} presentation="rail" />
                    </div>
                    <ConversationPane
                      sceneId={activeSceneId}
                      agentInstanceId={agentInstance.instance_id}
                      onSubmitUserMessage={submitUserMessage}
                      onRecallQueuedUserMessage={recallQueuedUserMessage}
                      submitDisabled={isActiveAgentSendPending || isReleasedChildAgentPanel(agentInstance, rootAgentInstanceId, parentChildRelations)}
                      presentation="mobile"
                    />
                  </div>
                ) : mobilePanel === "workspace" && workspace ? (
                  <div className="h-full min-h-0 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
                    <WorkspaceTree
                      workspaceName={workspace?.name ?? currentWorkspace?.name ?? null}
                      workspacePath={workspace?.path ?? currentWorkspace?.path ?? null}
                      nodes={workspace?.children ?? EMPTY_WORKSPACE_NODES}
                      status={workspaceTreeStatus}
                      selectedPath={selectedPath}
                      error={workspaceMutation.error instanceof Error ? workspaceMutation.error.message : null}
                      isRefreshing={workspaceMutation.isPending && Boolean(workspace)}
                      loadingDirectoryPaths={loadingDirectoryPaths}
                      directoryLoadErrors={directoryLoadErrors}
                      onRefresh={() => refreshWorkspaceTree(workspace?.path ?? currentWorkspace?.path ?? null)}
                      onSelectNode={(node) => setSelectedPath(node.path)}
                      onLoadDirectory={loadWorkspaceDirectory}
                    />
                  </div>
                ) : mobilePanel === "monitor" && executionMonitorSceneId ? (
                  <div className="h-full min-h-0 overflow-hidden rounded-2xl border border-app-border/80 bg-app-bg shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
                    <ExecutionMonitorPanel sceneId={executionMonitorSceneId} agentInstanceId={agentInstance.instance_id} hasTerminalPanel={false} presentation="full" />
                  </div>
                ) : mobilePanel === "terminal" && terminalPanelSceneId ? (
                  <div className="h-full min-h-0 overflow-hidden rounded-2xl border border-app-border/80 bg-app-bg shadow-[0_10px_28px_rgba(15,23,42,0.06)]">
                    <TerminalPanelContainer sceneId={terminalPanelSceneId} workspacePath={currentWorkspacePath} agentInstanceId={agentInstance.instance_id} />
                  </div>
                ) : null}
              </div>
              {mobilePanel === "chat" ? (
                <Composer
                  sceneId={activeSceneId}
                  agentInstanceId={agentInstance.instance_id}
                  disabled={isActiveAgentSendPending || isReleasedChildAgentPanel(agentInstance, rootAgentInstanceId, parentChildRelations)}
                  placeholder={isReleasedChildAgentPanel(agentInstance, rootAgentInstanceId, parentChildRelations) ? "该子 Agent 已结束，不能继续输入。" : `Send to ${agentInstance.agent_definition_id}, instance ${agentInstance.instance_id}`}
                  isRunning={effectiveAgentPanelStatus(agentInstance, rootAgentInstanceId, parentChildRelations) === "running" && !isReleasedChildAgentPanel(agentInstance, rootAgentInstanceId, parentChildRelations)}
                  isInterrupting={isActiveAgentInterruptPending}
                  isCompletingTask={isTaskCompletionPending}
                  textAreaElementRef={composerTextAreaRef}
                  presentation="mobile"
                  onInterrupt={() =>
                    interruptMutation.mutate({
                      sceneId: activeSceneId,
                      instanceId: agentInstance.instance_id,
                    })
                  }
                  onCompleteTask={isRootAgentPanel ? requestCompleteCurrentTask : undefined}
                  onSubmit={submitUserMessage}
                  onDebug={recordMobileChatDebugLog}
                  onDiagnostic={showMobileSendDiagnostic}
                />
              ) : null}
            </div>
          ) : (
            <>
              <CommunicationStatusOverlay
                view={activeCommunicationView}
                onRetry={retryActiveCommunication}
              />
              <LacpStatusOverlay status={lacpStatusQuery.data} />
              <AgentInteractionSoundToggle agentInstanceId={agentInstance.instance_id} />
              <div className="flex min-h-0 flex-1 overflow-hidden gap-3">
                <ConversationPane
                  sceneId={activeSceneId}
                  agentInstanceId={agentInstance.instance_id}
                  onSubmitUserMessage={submitUserMessage}
                  onRecallQueuedUserMessage={recallQueuedUserMessage}
                  submitDisabled={isActiveAgentSendPending || isReleasedChildAgentPanel(agentInstance, rootAgentInstanceId, parentChildRelations)}
                />
                {executionMonitorSceneId ? (
                  <TimelinePane
                    sceneId={executionMonitorSceneId}
                    taskId={agentInstance.task_id ?? activeSceneSummary.taskId ?? null}
                    agentInstanceId={agentInstance.instance_id}
                    agentDefinitionId={agentInstance.agent_definition_id}
                    hasTerminalPanel={false}
                  />
                ) : null}
              </div>
              <Composer
                sceneId={activeSceneId}
                agentInstanceId={agentInstance.instance_id}
                disabled={isActiveAgentSendPending || isReleasedChildAgentPanel(agentInstance, rootAgentInstanceId, parentChildRelations)}
                placeholder={isReleasedChildAgentPanel(agentInstance, rootAgentInstanceId, parentChildRelations) ? "该子 Agent 已结束，不能继续输入。" : `Send to ${agentInstance.agent_definition_id}, instance ${agentInstance.instance_id}`}
                isRunning={effectiveAgentPanelStatus(agentInstance, rootAgentInstanceId, parentChildRelations) === "running" && !isReleasedChildAgentPanel(agentInstance, rootAgentInstanceId, parentChildRelations)}
                isInterrupting={isActiveAgentInterruptPending}
                isCompletingTask={isTaskCompletionPending}
                textAreaElementRef={composerTextAreaRef}
                onInterrupt={() =>
                  interruptMutation.mutate({
                    sceneId: activeSceneId,
                    instanceId: agentInstance.instance_id,
                  })
                }
                onCompleteTask={isRootAgentPanel ? requestCompleteCurrentTask : undefined}
                onSubmit={submitUserMessage}
                onDebug={chatDebug}
              />
            </>
          )}
        </div>
      </section>

      {showTerminalPanel ? (
        <>
          <div
            role="separator"
            aria-label="调整对话区和右侧终端宽度"
            aria-orientation="vertical"
            aria-valuemin={MIN_TERMINAL_PANEL_WIDTH_PX}
            aria-valuemax={MAX_TERMINAL_PANEL_WIDTH_PX}
            aria-valuenow={Math.round(terminalPanelWidth)}
            tabIndex={0}
            title="拖动调整对话区和右侧终端宽度，双击恢复默认宽度"
            onDoubleClick={() => setTerminalPanelWidth(clampTerminalPanelWidth(DEFAULT_TERMINAL_PANEL_WIDTH_PX))}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "Home", "End", "Enter"].includes(event.key)) return
              event.preventDefault()
              if (event.key === "ArrowLeft") setTerminalPanelWidth((value) => clampTerminalPanelWidth(value + 16))
              if (event.key === "ArrowRight") setTerminalPanelWidth((value) => clampTerminalPanelWidth(value - 16))
              if (event.key === "Home") setTerminalPanelWidth(clampTerminalPanelWidth(MAX_TERMINAL_PANEL_WIDTH_PX))
              if (event.key === "End") setTerminalPanelWidth(clampTerminalPanelWidth(MIN_TERMINAL_PANEL_WIDTH_PX))
              if (event.key === "Enter") setTerminalPanelWidth(clampTerminalPanelWidth(DEFAULT_TERMINAL_PANEL_WIDTH_PX))
            }}
            onPointerDown={handleTerminalSplitDragStart}
            className="group relative z-10 flex w-2 cursor-col-resize items-stretch justify-center bg-slate-200/70 transition-colors hover:bg-slate-300/80 focus:outline-none focus:ring-2 focus:ring-[#4f6f96]/35"
          >
            <div className="my-2 w-px rounded-full bg-slate-400/45 transition-colors group-hover:bg-slate-500/70" />
          </div>

          <div className="flex min-h-0 min-w-0 flex-col border-l border-app-border/80 bg-app-bg">
            <TerminalPanelContainer sceneId={terminalPanelSceneId} workspacePath={currentWorkspacePath} agentInstanceId={agentInstance?.instance_id ?? null} />
          </div>
        </>
      ) : null}
    </div>
    </>
  )
}

async function loadAgentScopedChatBubbleBatches(
  sceneId: string,
  agentInstances: AgentRuntimeInstance[],
  rootAgentInstanceId: string,
  timeoutMs?: number,
): Promise<AgentScopedChatBubbleLoadResult[]> {
  const uniqueAgentInstanceIds = Array.from(new Set([
    rootAgentInstanceId,
    ...agentInstances.map((instance) => instance.instance_id),
  ].map((value) => value.trim()).filter(Boolean)))
  const settled = await Promise.allSettled(uniqueAgentInstanceIds.map(async (agentInstanceId) => {
    const result = await listSceneChatBubbles(
      sceneId,
      { limit: 100, agent_instance_id: agentInstanceId },
      { timeoutMs },
    )
    const invalidBubble = result.messages.find(
      (bubble) => textValue(bubble.agent_instance_id) !== agentInstanceId,
    )
    if (invalidBubble) {
      throw new Error(
        `ChatBubble owner contract violation: bubble=${invalidBubble.bubble_id} expected=${agentInstanceId} actual=${textValue(invalidBubble.agent_instance_id) ?? "missing"}`,
      )
    }
    return result.messages
  }))
  return settled.map((result, index): AgentScopedChatBubbleLoadResult => (
    result.status === "fulfilled"
      ? {
          status: "fulfilled",
          agentInstanceId: uniqueAgentInstanceIds[index],
          bubbles: result.value,
        }
      : {
          status: "rejected",
          agentInstanceId: uniqueAgentInstanceIds[index],
          error: result.reason,
        }
  ))
}

async function loadSceneTerminalSessions(
  sceneId: string,
  workspacePath: string,
  agentInstanceIds: string[],
  timeoutMs?: number,
): Promise<TerminalSession[]> {
  const agentResults = await Promise.allSettled(agentInstanceIds.map(async (agentInstanceId) => {
    const terminals = await listSceneTerminals(sceneId, workspacePath, agentInstanceId, { timeoutMs })
    const sessions = await Promise.allSettled(terminals.map(
      (terminal) => loadTerminalSession(sceneId, workspacePath, terminal, agentInstanceId, timeoutMs),
    ))
    return sessions.flatMap((result, index) => {
      if (result.status === "fulfilled") return result.value ? [result.value] : []
      console.warn(
        "[chat] hydrate terminal output failed:",
        terminals[index]?.terminal_id,
        agentInstanceId,
        result.reason,
      )
      return []
    })
  }))
  return agentResults.flatMap((result, index) => {
    if (result.status === "fulfilled") return result.value
    console.warn("[chat] list Agent terminals failed:", agentInstanceIds[index], result.reason)
    return []
  })
}

async function loadTerminalSession(
  sceneId: string,
  workspacePath: string,
  terminal: SceneTerminal,
  agentInstanceId: string,
  timeoutMs?: number,
): Promise<TerminalSession | null> {
  const command = terminal.latest_command
  if (!command) return null

  const output = await readSceneTerminalOutput(sceneId, terminal.terminal_id, {
    workspace_path: workspacePath,
    agent_instance_id: agentInstanceId,
    command_id: command.command_id,
    mode: "tail",
    tail_lines: LATEST_TERMINAL_OUTPUT_LINE_LIMIT,
    limit_chars: LATEST_TERMINAL_OUTPUT_CHAR_LIMIT,
  }, { timeoutMs })

  return {
    id: command.command_id,
    terminalId: terminal.terminal_id,
    commandVisible: true,
    toolCallId: command.tool_call_id ?? command.command_id,
    commandLine: command.command_line,
    cwd: command.actual_cwd || terminal.cwd || workspacePath,
    shell: command.shell || terminal.shell,
    status: terminalSessionStatus(command.status, command.exit_code),
    output: output.text
      ? [{
          terminal_session_id: command.command_id,
          terminal_id: terminal.terminal_id,
          tool_call_id: command.tool_call_id ?? command.command_id,
          stream: "pty",
          chunk: output.text,
          chunk_index: output.start_chunk_index ?? 0,
          encoding: "utf-8",
        }]
      : [],
    exitCode: command.exit_code,
    agentInstanceId,
  }
}

function terminalSessionStatus(commandStatus: string, exitCode?: number | null): TerminalSession["status"] {
  if (commandStatus === "running" || commandStatus === "accepted") return "running"
  if (commandStatus === "completed" && exitCode === 0) return "completed"
  return "failed"
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}





