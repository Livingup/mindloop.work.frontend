import assert from "node:assert/strict"
import path from "node:path"
import { after, before, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const FIXTURE_AGENT_INSTANCE_ID = "agent-execution-fixture"

let viteServer
let executionModule
let monitorModule
let projectionModule
let storeModule

before(async () => {
  viteServer = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  })
  executionModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/executionProcess.ts")
  monitorModule = await viteServer.ssrLoadModule("/src/features/chat/components/ExecutionMonitorPanel.tsx")
  projectionModule = await viteServer.ssrLoadModule("/src/features/chat/model/agentUiProjection.ts")
  storeModule = await viteServer.ssrLoadModule("/src/features/chat/model/chatStore.ts")
})

beforeEach(() => {
  storeModule.useChatStore.getState().clearAllScenes()
})

after(async () => {
  await viteServer?.close()
})

test("one llm_call_id remains one Execution across retries and owns multiple tools", () => {
  let metadata = executionModule.normalizeExecutionProcessMetadata({})
  const events = [
    llmEvent("llm.request.started", 1, "call-1", "request-1", { retry_index: 0, attempt_count: 1 }),
    llmEvent("llm.request.failed", 2, "call-1", "request-1", {
      retry_index: 0,
      attempt_count: 1,
      will_retry: true,
      error_type: "Timeout",
      error_message: "retry me",
    }),
    llmEvent("llm.request.started", 3, "call-1", "request-2", { retry_index: 1, attempt_count: 2 }),
    llmEvent("llm.response.started", 4, "call-1", "request-2"),
    llmEvent("llm.tool_call.started", 5, "call-1", "request-2", { tool_call_id: "tool-a", tool_name: "search" }),
    llmEvent("llm.tool_call.completed", 6, "call-1", "request-2", { tool_call_id: "tool-a", tool_name: "search", arguments: "{\"q\":\"x\"}" }),
    llmEvent("llm.tool_call.started", 7, "call-1", "request-2", { tool_call_id: "tool-b", tool_name: "image" }),
    llmEvent("llm.tool_call.completed", 8, "call-1", "request-2", { tool_call_id: "tool-b", tool_name: "image", arguments: "{}" }),
    toolEvent("tool.call.started", 9, "tool-a", { tool_name: "search" }),
    toolEvent("tool.call.completed", 10, "tool-a", { tool_name: "search", success: true, execution_status: "completed", loop_decision: "continue" }),
    toolEvent("tool.call.started", 11, "tool-b", { tool_name: "image" }),
    toolEvent("tool.call.completed", 12, "tool-b", { tool_name: "image", success: true, execution_status: "completed", loop_decision: "continue" }),
    llmEvent("llm.response.completed", 13, "call-1", "request-2", {
      attempt_count: 2,
      assistant_part_count: 2,
      thinking_part_count: 0,
      tool_use_part_count: 2,
    }),
  ]
  for (const event of events) metadata = executionModule.reduceExecutionProcessMetadata(metadata, event)

  assert.equal(metadata.iterations.length, 1)
  assert.equal(metadata.iterations[0].llm.id, "llm-call-1")
  assert.equal(metadata.iterations[0].llm.llm_request_id, "request-2")
  assert.equal(metadata.iterations[0].llm.retry_index, 1)
  assert.equal(metadata.iterations[0].llm.error_message, undefined)
  assert.deepEqual(metadata.iterations[0].tools.map((tool) => tool.tool_call_id), ["tool-a", "tool-b"])
  assert.equal(executionModule.executionProcessStatus(metadata), "completed")

  const cancelled = executionModule.reduceExecutionProcessMetadata(
    metadata,
    toolEvent("tool.call.cancelled", 14, "tool-b", { tool_name: "image", reason: "cancelled" }),
  )
  assert.equal(executionModule.executionProcessStatus(cancelled), "failed")
})

test("llm.call.failed keeps the canonical same-call Execution identity", () => {
  let metadata = executionModule.normalizeExecutionProcessMetadata({})
  metadata = executionModule.reduceExecutionProcessMetadata(
    metadata,
    llmEvent("llm.request.started", 1, "call-failed", "request-failed"),
  )
  metadata = executionModule.reduceExecutionProcessMetadata(
    metadata,
    llmEvent("llm.response.started", 2, "call-failed", "request-failed"),
  )
  metadata = executionModule.reduceExecutionProcessMetadata(
    metadata,
    llmEvent("llm.call.failed", 3, "call-failed", "request-failed", {
      error_message: "all attempts failed",
      duration_ms: 42,
    }),
  )

  assert.equal(metadata.iterations.length, 1)
  assert.equal(metadata.iterations[0].llm.id, "llm-call-failed")
  assert.equal(metadata.iterations[0].llm.status, "failed")
  assert.equal(metadata.iterations[0].llm.error_message, "all attempts failed")
  assert.equal(executionModule.executionProcessStatus(metadata), "failed")
})

test("new llm calls never reuse an arbitrary open Execution and tool events require exact tool ownership", () => {
  let metadata = executionModule.normalizeExecutionProcessMetadata({})
  metadata = executionModule.reduceExecutionProcessMetadata(
    metadata,
    llmEvent("llm.request.started", 1, "call-old", "request-old"),
  )
  metadata.execution_round = 4
  const message = executionMessage("execution-old", metadata)

  assert.equal(
    executionModule.findExecutionProcessMessageForEvent(
      [message],
      llmEvent("llm.request.started", 2, "call-new", "request-new"),
    ),
    null,
  )
  assert.equal(
    executionModule.findExecutionProcessMessageForEvent(
      [message],
      toolEvent("tool.call.started", 3, "missing-tool", { tool_name: "missing" }),
    ),
    null,
  )

  metadata = executionModule.reduceExecutionProcessMetadata(
    metadata,
    llmEvent("llm.tool_call.started", 4, "call-old", "request-old", { tool_call_id: "owned-tool", tool_name: "search" }),
  )
  const ownedMessage = executionMessage("execution-old", metadata)
  assert.equal(
    executionModule.findExecutionProcessMessageForEvent(
      [ownedMessage],
      toolEvent("tool.call.started", 5, "owned-tool", { tool_name: "search" }),
    )?.id,
    "execution-old",
  )
})

test("Execution rounds increment by adjacent timeline block, ignore non-timeline messages, reset after task boundary, and split legacy iterations", () => {
  const firstMetadata = legacyExecutionMetadata([
    legacyIteration("call-a", "request-a"),
    legacyIteration("call-b", "request-b"),
  ])
  const secondMetadata = legacyExecutionMetadata([legacyIteration("call-c", "request-c")])
  const fourthMetadata = legacyExecutionMetadata([legacyIteration("call-d", "request-d")])
  const messages = [
    executionMessage("legacy-many", firstMetadata),
    plainMessage("interaction", "agent", { interaction_state: "pending" }),
    executionMessage("execution-c", secondMetadata),
    taskBoundaryMessage("boundary"),
    plainMessage("pause", "agent", { bubble_kind: "context_compression" }),
    executionMessage("execution-d", fourthMetadata),
  ]

  assert.equal(executionModule.nextExecutionRound(
    executionMessage("legacy-many-recovered", { ...firstMetadata, execution_round: 1, execution_round_end: 2 }),
  ), 3)
  assert.equal(executionModule.nextExecutionRound(taskBoundaryMessage("completed-boundary")), 1)
  assert.equal(executionModule.nextExecutionRound(taskBoundaryMessage("failed-boundary", "failed")), 1)
  const retainedRound = executionModule.reduceExecutionProcessMetadata(
    { ...secondMetadata, execution_round: 7 },
    llmEvent("llm.response.completed", 30, "call-c", "request-c", {
      attempt_count: 1,
      assistant_part_count: 1,
      thinking_part_count: 0,
      tool_use_part_count: 0,
    }),
  )
  assert.equal(retainedRound.execution_round, 7)

  const blocks = monitorModule.buildExecutionMonitorBlocks(messages)
  assert.deepEqual(blocks.map((block) => block.kind), [
    "execution",
    "execution",
    "execution",
    "task_boundary",
    "execution",
  ])
  assert.deepEqual(
    blocks.filter((block) => block.kind === "execution").map((block) => block.round),
    [1, 2, 3, 1],
  )
  assert.equal(blocks.filter((block) => block.kind === "execution").every((block) => block.iteration), true)
})

test("interaction stays active without a visible successor and ignores timeline, ACK, refresh, and queued messages", () => {
  const sceneId = "interaction-active"
  const agentInstanceId = `${sceneId}-agent`
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, "Interaction active")
  store.getState().setRootAgentInstanceId(sceneId, agentInstanceId)
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId,
    bubbles: [forAgent(interactionBubble("interaction-1", 10), agentInstanceId)],
  }])
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId,
    bubbles: [forAgent(executionBubbleDto("execution-hidden", 11), agentInstanceId)],
  }])
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId,
    bubbles: [forAgent(taskBoundaryBubbleDto("timeline-boundary", 12), agentInstanceId)],
  }])
  store.getState().enqueueUserMessage(sceneId, {
    id: "pending-user",
    pendingMessageId: "pending-user",
    clientMessageId: "queued-client",
    text: "queued reply",
    createdAt: "2026-01-01T00:00:13.000Z",
    status: "queued",
    agentInstanceId,
  }, { interactionMessageId: "interaction-1" })
  store.getState().markQueuedUserMessageFailed(sceneId, agentInstanceId, "queued-client", "failed")
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId,
    bubbles: [forAgent(interactionBubble("interaction-1", 14, "answered"), agentInstanceId)],
  }])

  const scene = store.getState().scenes[sceneId]
  const runtimeState = storeModule.resolveAgentRuntimeState(scene, null)
  const conversation = projectionModule.buildAgentConversationProjection(scene, sceneId, null)
  assert.deepEqual(conversation.visibleMessages.map((message) => message.id), ["interaction-1", "timeline-boundary"])
  assert.equal(conversation.visibleMessages.some((message) => message.id === "execution-hidden"), false)
  assert.equal(interactionResolution(sceneId, "interaction-1"), "active")
  assert.equal(runtimeState.pendingInteraction?.eventId, "interaction-1")
  assert.equal(Object.hasOwn(scene, "pendingInteraction"), false)
  assert.equal(scene.runStatus, "paused")
})

test("left conversation keeps completed and failed task boundaries while excluding execution blocks", () => {
  const sceneId = "left-task-boundaries"
  const agentInstanceId = `${sceneId}-agent`
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, sceneId)
  store.getState().setRootAgentInstanceId(sceneId, agentInstanceId)
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId,
    bubbles: [
      forAgent(ordinaryBubble("before-boundaries", 1, "agent"), agentInstanceId),
      forAgent(executionBubbleDto("timeline-only", 2), agentInstanceId),
      forAgent(taskBoundaryBubbleDto("completed-boundary", 3), agentInstanceId),
      forAgent(taskBoundaryBubbleDto("failed-boundary", 4, "failed", "release validation failed"), agentInstanceId),
    ],
  }], { mode: "baseline" })

  const initialProjection = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId], sceneId, null,
  )
  assert.deepEqual(initialProjection.visibleMessages.map((message) => message.id), [
    "before-boundaries",
    "completed-boundary",
    "failed-boundary",
  ])
  assert.equal(initialProjection.visibleMessages.some((message) => message.id === "timeline-only"), false)
  assert.equal(
    initialProjection.visibleMessages.find((message) => message.id === "failed-boundary")?.content.metadata?.failure_message,
    "release validation failed",
  )
  const initialIdentities = initialProjection.visibleMessages.map(projectionModule.conversationProjectionMessageIdentity)

  // A durable hydration after the local snapshot must merge the same terminal boundary
  // into its original visual slot rather than duplicate it.
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId,
    bubbles: [forAgent(taskBoundaryBubbleDto("completed-boundary", 3), agentInstanceId)],
  }], { mode: "incremental" })
  const recoveredProjection = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId], sceneId, null,
  )
  assert.deepEqual(recoveredProjection.visibleMessages.map(projectionModule.conversationProjectionMessageIdentity), initialIdentities)
  assert.equal(recoveredProjection.visibleMessages.filter((message) => message.id === "completed-boundary").length, 1)
})

test("queued explicit selection stays active until acceptance then finalizes as selected", () => {
  const sceneId = "interaction-queued-accepted"
  const agentInstanceId = `${sceneId}-agent`
  hydrateConversation(sceneId, [interactionBubble("interaction-queued-accepted", 1)])
  const store = storeModule.useChatStore
  store.getState().enqueueUserMessage(sceneId, {
    id: "pending-option",
    pendingMessageId: "pending-option",
    clientMessageId: "queued-option-client",
    text: "Option A",
    createdAt: "2026-01-01T00:00:02.000Z",
    status: "queued",
    agentInstanceId,
  }, { interactionMessageId: "interaction-queued-accepted", optionId: "option-a" })
  assert.equal(interactionResolution(sceneId, "interaction-queued-accepted"), "active")
  store.getState().appendEvent(sceneId, {
    stream_id: "stream",
    seq: 3,
    message_id: "accepted-option-message",
    correlation_id: "queued-option-client",
    type: "user.message.accepted",
    created_at: "2026-01-01T00:00:03.000Z",
    metadata: { agent_instance_id: agentInstanceId },
    payload: {
      pending_message_id: "pending-option",
      client_message_id: "queued-option-client",
      user_message_id: "accepted-option",
      text: "Option A",
      channel: "web",
      metadata: {},
    },
  })
  assert.equal(interactionResolution(sceneId, "interaction-queued-accepted"), "selected")
  assert.equal(storeModule.resolveAgentRuntimeState(store.getState().scenes[sceneId], agentInstanceId).queuedUserMessages.length, 0)
  store.getState().appendEvent(sceneId, {
    stream_id: "stream",
    seq: 4,
    message_id: "accepted-option-message-replay",
    correlation_id: "queued-option-client",
    type: "user.message.accepted",
    created_at: "2026-01-01T00:00:04.000Z",
    metadata: { agent_instance_id: agentInstanceId },
    payload: {
      pending_message_id: "pending-option",
      client_message_id: "queued-option-client",
      user_message_id: "accepted-option",
      text: "Option A",
      channel: "web",
      metadata: {},
    },
  })
  const replayScene = store.getState().scenes[sceneId]
  const replayAgentState = storeModule.resolveAgentRuntimeState(replayScene, agentInstanceId)
  assert.equal(interactionResolution(sceneId, "interaction-queued-accepted"), "selected")
  assert.equal(replayAgentState.messages.filter((message) => message.role === "user").length, 1)
  const acceptedUser = replayAgentState.messages.find((message) => message.role === "user")
  assert.equal(acceptedUser.content.metadata.interaction_message_id, "interaction-queued-accepted")
  assert.equal(acceptedUser.content.metadata.interaction_option_id, "option-a")
  const refreshedSceneId = "interaction-queued-refreshed"
  hydrateConversation(refreshedSceneId, [
    interactionBubble("interaction-queued-accepted", 1),
    baseBubble("accepted-refreshed", 2, "user", {
      interaction_message_id: "interaction-queued-accepted",
      interaction_option_id: "option-a",
    }),
  ])
  const refreshedScene = store.getState().scenes[refreshedSceneId]
  const refreshedProjection = projectionModule.buildAgentConversationProjection(
    refreshedScene, refreshedSceneId, null,
  )
  const refreshedIdentity = projectionModule.conversationProjectionMessageIdentity(refreshedProjection.allVisibleMessages[0])
  assert.equal(refreshedProjection.interactionResolutionByIdentity[refreshedIdentity], "selected")
  assert.equal(refreshedProjection.interactionSelectedOptionIdByIdentity[refreshedIdentity], "option-a")
})

test("selected Agent projections isolate interaction successors and Execution rounds", () => {
  const sceneId = "agent-scope-isolation"
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, sceneId)
  store.getState().setSceneAgentInventory(
    sceneId,
    [agentInstance("agent-a"), agentInstance("agent-b")],
    [],
    "agent-a",
    "agent-a",
  )
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [
    { agentInstanceId: "agent-a", bubbles: [
      forAgent(interactionBubble("interaction-a", 1), "agent-a"),
      forAgent(executionBubbleDto("execution-a", 2), "agent-a"),
      forAgent(taskBoundaryBubbleDto("boundary-a", 3), "agent-a"),
    ] },
    { agentInstanceId: "agent-b", bubbles: [
      forAgent(interactionBubble("interaction-b", 1), "agent-b"),
      forAgent(ordinaryBubble("user-b", 2, "user"), "agent-b"),
      forAgent(executionBubbleDto("execution-b-1", 3), "agent-b"),
      forAgent(executionBubbleDto("execution-b-2", 4), "agent-b"),
      forAgent(taskBoundaryBubbleDto("boundary-b", 5), "agent-b"),
    ] },
  ], { mode: "baseline" })
  const scene = store.getState().scenes[sceneId]
  const projectionA = projectionModule.buildAgentConversationProjection(
    scene, sceneId, "agent-a",
  )
  const projectionB = projectionModule.buildAgentConversationProjection(
    scene, sceneId, "agent-b",
  )
  assert.deepEqual(projectionA.visibleMessages.map((message) => message.id), ["interaction-a", "boundary-a"])
  assert.deepEqual(projectionB.visibleMessages.map((message) => message.id), ["interaction-b", "user-b", "boundary-b"])
  assert.equal(projectionA.interactionResolutionByIdentity[
    projectionModule.conversationProjectionMessageIdentity(projectionA.allVisibleMessages[0])
  ], "active")
  assert.equal(projectionB.interactionResolutionByIdentity[
    projectionModule.conversationProjectionMessageIdentity(projectionB.allVisibleMessages[0])
  ], "custom_reply")
  const timelineA = projectionModule.buildAgentTimelineProjection(scene, sceneId, "agent-a")
  const timelineB = projectionModule.buildAgentTimelineProjection(scene, sceneId, "agent-b")
  assert.deepEqual(monitorModule.buildExecutionMonitorBlocks(timelineA.messages).filter((block) => block.kind === "execution").map((block) => block.round), [1])
  assert.deepEqual(monitorModule.buildExecutionMonitorBlocks(timelineB.messages).filter((block) => block.kind === "execution").map((block) => block.round), [1, 2])
  const agentARuntimeState = storeModule.resolveAgentRuntimeState(scene, "agent-a")
  const agentBRuntimeState = storeModule.resolveAgentRuntimeState(scene, "agent-b")
  assert.equal(agentARuntimeState.latestTimelineMessage.id, "boundary-a")
  assert.equal(agentBRuntimeState.latestTimelineMessage.id, "boundary-b")
  assert.equal(executionModule.nextExecutionRound(agentARuntimeState.latestTimelineMessage), 1)
  assert.equal(executionModule.nextExecutionRound(agentBRuntimeState.latestTimelineMessage), 1)
  assert.equal(agentARuntimeState.pendingInteraction?.eventId, "interaction-a")
  assert.equal(storeModule.resolveAgentRuntimeState(scene, "agent-b").pendingInteraction, null)
  assert.equal(Object.hasOwn(scene, "pendingInteraction"), false)
  assert.equal(scene.runStatus, "paused")

  store.getState().selectAgentInstance(sceneId, "agent-b")
  const selectedBScene = store.getState().scenes[sceneId]
  assert.equal(Object.hasOwn(selectedBScene, "pendingInteraction"), false)
  assert.equal(selectedBScene.runStatus, "running")

  store.getState().selectAgentInstance(sceneId, "agent-a")
  const reselectedAScene = store.getState().scenes[sceneId]
  assert.equal(Object.hasOwn(reselectedAScene, "pendingInteraction"), false)
  assert.equal(storeModule.resolveAgentRuntimeState(reselectedAScene, "agent-a").pendingInteraction?.eventId, "interaction-a")
  assert.equal(reselectedAScene.runStatus, "paused")
})

test("runtime timeline cursor preserves rounds across stale ACK and resets on incremental task boundaries", () => {
  const sceneId = "timeline-cursor-stale-ack"
  const agentInstanceId = `${sceneId}-agent`
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, sceneId)
  store.getState().setRootAgentInstanceId(sceneId, agentInstanceId)
  const currentExecution = forAgent(baseBubble("execution-current", 10, "agent", {
    ...legacyExecutionMetadata([legacyIteration("cursor", "cursor-request")]),
    execution_round: 7,
    execution_round_end: 7,
  }), agentInstanceId)
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{ agentInstanceId, bubbles: [currentExecution] }], { mode: "baseline" })
  const staleExecution = forAgent(baseBubble("execution-current", 5, "agent", {
    ...legacyExecutionMetadata([legacyIteration("cursor", "cursor-request")]),
    execution_round: 2,
    execution_round_end: 2,
  }), agentInstanceId)
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{ agentInstanceId, bubbles: [staleExecution] }], { mode: "incremental" })
  let runtimeState = storeModule.resolveAgentRuntimeState(store.getState().scenes[sceneId], null)
  assert.equal(runtimeState.latestTimelineMessage.content.metadata.execution_round, 7)
  assert.equal(executionModule.nextExecutionRound(runtimeState.latestTimelineMessage), 8)
  const failedBoundary = forAgent(baseBubble("failed-incremental-boundary", 11, "agent", {
    bubble_kind: "task_boundary",
    boundary_kind: "task_terminal",
    task_status: "failed",
    label: "任务失败",
    completed_at: "2026-01-01T00:00:11.000Z",
  }), agentInstanceId)
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{ agentInstanceId, bubbles: [failedBoundary] }], { mode: "incremental" })
  runtimeState = storeModule.resolveAgentRuntimeState(store.getState().scenes[sceneId], null)
  assert.equal(runtimeState.latestTimelineMessage.id, "failed-incremental-boundary")
  assert.equal(executionModule.nextExecutionRound(runtimeState.latestTimelineMessage), 1)
})

test("interaction successor semantics distinguish custom user reply, non-user supersession, and explicit selection", () => {
  const customScene = "interaction-custom"
  hydrateConversation(customScene, [
    interactionBubble("interaction-custom", 1),
    taskBoundaryBubbleDto("custom-boundary", 2),
    ordinaryBubble("user-reply", 3, "user"),
  ])
  assert.equal(interactionResolution(customScene, "interaction-custom"), "custom_reply")
  assert.equal(storeModule.resolveAgentRuntimeState(
    storeModule.useChatStore.getState().scenes[customScene], null,
  ).pendingInteraction, null)

  const supersededScene = "interaction-superseded"
  hydrateConversation(supersededScene, [
    interactionBubble("interaction-superseded", 1),
    taskBoundaryBubbleDto("superseded-boundary", 2),
    ordinaryBubble("agent-next", 3, "agent"),
  ])
  assert.equal(interactionResolution(supersededScene, "interaction-superseded"), "superseded")
  const supersededState = storeModule.useChatStore.getState().scenes[supersededScene]
  assert.equal(storeModule.resolveAgentRuntimeState(supersededState, null).pendingInteraction, null)
  assert.equal(Object.hasOwn(supersededState, "pendingInteraction"), false)
  assert.notEqual(supersededState.runStatus, "paused")

  const selectedScene = "interaction-selected"
  hydrateConversation(selectedScene, [interactionBubble("interaction-selected", 1)])
  storeModule.useChatStore.getState().appendUserMessage(
    selectedScene,
    `${selectedScene}-agent`,
    "Option A",
    "selected-client",
    { interactionMessageId: "interaction-selected", optionId: "option-a" },
  )
  assert.equal(interactionResolution(selectedScene, "interaction-selected"), "selected")
  assert.equal(storeModule.resolveAgentRuntimeState(
    storeModule.useChatStore.getState().scenes[selectedScene], null,
  ).pendingInteraction, null)
})

function interactionResolution(sceneId, interactionMessageId) {
  const scene = storeModule.useChatStore.getState().scenes[sceneId]
  const projection = projectionModule.buildAgentConversationProjection(
    scene,
    sceneId,
    null,
  )
  return projection.interactionResolutionByIdentity[
    projectionModule.conversationProjectionMessageIdentity(
      projection.allVisibleMessages.find((message) => message.id === interactionMessageId),
    )
  ]
}

function hydrateConversation(sceneId, bubbles) {
  const store = storeModule.useChatStore
  const agentInstanceId = `${sceneId}-agent`
  store.getState().openScene(sceneId, sceneId)
  store.getState().setRootAgentInstanceId(sceneId, agentInstanceId)
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId,
    bubbles: bubbles.map((bubble) => forAgent(bubble, agentInstanceId)),
  }], { mode: "baseline" })
}

function llmEvent(type, seq, llmCallId, llmRequestId, extra = {}) {
  return {
    stream_id: "stream",
    seq,
    message_id: `message-${seq}`,
    correlation_id: llmCallId,
    type,
    created_at: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    metadata: {},
    payload: {
      llm_call_id: llmCallId,
      llm_request_id: llmRequestId,
      provider_id: "provider",
      binding_id: "binding",
      model_alias: "model",
      api_format: "openai",
      candidate_index: 0,
      api_key_index: 0,
      retry_index: 0,
      attempt_count: 1,
      ...extra,
    },
  }
}

function toolEvent(type, seq, toolCallId, extra = {}) {
  return {
    stream_id: "stream",
    seq,
    message_id: `message-${seq}`,
    correlation_id: toolCallId,
    type,
    created_at: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    metadata: {},
    payload: { tool_call_id: toolCallId, ...extra },
  }
}

function legacyIteration(llmCallId, requestId) {
  return {
    id: `legacy-${llmCallId}`,
    index: 99,
    llm: {
      id: `llm-${llmCallId}`,
      status: "completed",
      label: "响应结束",
      llm_call_id: llmCallId,
      llm_request_id: requestId,
      response_started: true,
      communication_message_id: `message-${llmCallId}`,
      communication_seq: 1,
    },
    tools: [],
  }
}

function legacyExecutionMetadata(iterations) {
  return {
    bubble_kind: "execution_process",
    process_status: "completed",
    iterations,
  }
}

function executionMessage(id, metadata) {
  return plainMessage(id, "agent", metadata)
}

function taskBoundaryMessage(id, status = "completed") {
  return plainMessage(id, "agent", {
    bubble_kind: "task_boundary",
    boundary_kind: "task_terminal",
    task_status: status,
    label: status === "failed" ? "任务失败" : "任务完成",
    completed_at: "2026-01-01T00:00:20.000Z",
    communication_message_id: id,
    communication_seq: 20,
  })
}

function plainMessage(id, role, metadata = {}) {
  return {
    id,
    role,
    createdAt: "2026-01-01T00:00:00.000Z",
    status: "completed",
    content: { text: id, text_format: "plain_text", channel: "web", metadata },
  }
}

function baseBubble(id, seq, role, metadata, interaction = {}) {
  return {
    bubble_id: id,
    scene_id: "scene",
    agent_instance_id: FIXTURE_AGENT_INSTANCE_ID,
    task_id: null,
    conversation_id: null,
    role,
    status: "completed",
    text: id,
    text_format: "plain_text",
    channel: "web",
    client_message_id: null,
    backend_message_id: id,
    pending_message_id: null,
    interaction_options: interaction.options ?? [],
    interaction_state: interaction.state ?? "none",
    selected_option_id: interaction.selectedOptionId ?? null,
    sort_order: seq,
    created_at: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    updated_at: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    metadata: { communication_message_id: id, communication_seq: seq, ...metadata },
  }
}

function agentInstance(instanceId) {
  return {
    instance_id: instanceId,
    task_id: "task",
    status: "running",
    pending_user_message_count: 0,
    pending_user_messages: [],
  }
}

function forAgent(bubble, agentInstanceId) {
  return { ...bubble, agent_instance_id: agentInstanceId }
}

function interactionBubble(id, seq, state = "pending") {
  return baseBubble(id, seq, "agent", {}, {
    state,
    options: [
      { id: "option-a", label: "Option A" },
      { id: "option-b", label: "Option B" },
    ],
  })
}

function ordinaryBubble(id, seq, role) {
  return baseBubble(id, seq, role, {})
}

function taskBoundaryBubbleDto(id, seq, status = "completed", failureMessage = null) {
  return baseBubble(id, seq, "agent", {
    bubble_kind: "task_boundary",
    boundary_kind: "task_terminal",
    task_status: status,
    label: status === "failed" ? "任务失败" : "任务完成",
    completed_at: `2026-01-01T00:00:${String(seq).padStart(2, "0")}.000Z`,
    ...(failureMessage ? { failure_message: failureMessage } : {}),
  })
}

function executionBubbleDto(id, seq) {
  return baseBubble(id, seq, "agent", {
    bubble_kind: "execution_process",
    process_status: "streaming",
    iterations: [legacyIteration("hidden", "hidden-request")],
  })
}
