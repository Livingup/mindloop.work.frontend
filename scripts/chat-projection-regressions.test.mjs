import assert from "node:assert/strict"
import path from "node:path"
import { after, before, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const FIXTURE_AGENT_INSTANCE_ID = "agent-projection-fixture"

let viteServer
let storeModule
let projectionModule
let panelUiStoreModule
let executionProcessModule

before(async () => {
  viteServer = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  })
  storeModule = await viteServer.ssrLoadModule("/src/features/chat/model/chatStore.ts")
  projectionModule = await viteServer.ssrLoadModule("/src/features/chat/model/agentUiProjection.ts")
  panelUiStoreModule = await viteServer.ssrLoadModule("/src/features/chat/model/chatPanelUiStore.ts")
  executionProcessModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/executionProcess.ts")
})

beforeEach(() => {
  storeModule.useChatStore.getState().clearAllScenes()
  panelUiStoreModule.useChatPanelUiStore.setState({ conversationScrollStates: {} })
})

after(async () => {
  await viteServer?.close()
})

test("optimistic user keeps one stable identity and visual slot through local hydrate, ACK, reconnect, and scroll state writes", () => {
  const sceneId = "scene-order"
  const agentInstanceId = FIXTURE_AGENT_INSTANCE_ID
  const clientMessageId = "client-21-19"
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, "Ordering regression")
  store.getState().setRootAgentInstanceId(sceneId, agentInstanceId)

  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [chatBubble({
      id: "durable-before",
      sortOrder: 10,
      seq: 3400,
      createdAt: "2026-07-14T20:00:00.000Z",
      text: "before",
    })],
  }], { mode: "baseline" })

  store.getState().appendUserMessage(sceneId, agentInstanceId, "21:19 user", clientMessageId)
  const optimisticProjection = conversationProjection(sceneId)
  const optimisticIdentity = projectionModule.conversationProjectionMessageIdentity(
    optimisticProjection.visibleMessages.find((message) => message.clientMessageId === clientMessageId),
  )
  assert.deepEqual(optimisticProjection.visibleMessages.map((message) => message.id), [
    "durable-before",
    `user-${clientMessageId}`,
  ])

  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [chatBubble({
      id: "accepted-user-event",
      role: "user",
      status: "accepted",
      sortOrder: 0,
      seq: 3500,
      createdAt: "2026-07-14T21:19:38.000Z",
      text: "21:19 user",
      clientMessageId,
      backendMessageId: "backend-user-21-19",
      bubbleKind: "user_message",
    })],
  }])

  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [chatBubble({
      id: "later-result",
      sortOrder: 0,
      seq: 3600,
      createdAt: "2026-07-14T23:56:33.000Z",
      text: "later local result",
    })],
  }])
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [chatBubble({
      id: "later-result",
      sortOrder: 20,
      seq: 3600,
      createdAt: "2026-07-14T23:56:33.000Z",
      text: "later durable result",
    })],
  }])

  const afterAck = conversationProjection(sceneId)
  assert.deepEqual(afterAck.visibleMessages.map((message) => message.id), [
    "durable-before",
    "accepted-user-event",
    "later-result",
  ])
  assert.equal(afterAck.visibleMessages.filter((message) => message.clientMessageId === clientMessageId).length, 1)
  assert.equal(
    projectionModule.conversationProjectionMessageIdentity(
      afterAck.visibleMessages.find((message) => message.clientMessageId === clientMessageId),
    ),
    optimisticIdentity,
  )

  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [
      chatBubble({ id: "later-result", sortOrder: 20, seq: 3600, createdAt: "2026-07-14T23:56:33.000Z", text: "later durable result" }),
      chatBubble({ id: "durable-before", sortOrder: 10, seq: 3400, createdAt: "2026-07-14T20:00:00.000Z", text: "before" }),
      chatBubble({
        id: "accepted-user-event",
        role: "user",
        status: "accepted",
        sortOrder: 15,
        seq: 3500,
        createdAt: "2026-07-14T21:19:38.000Z",
        text: "21:19 user",
        clientMessageId,
        backendMessageId: "backend-user-21-19",
        bubbleKind: "user_message",
      }),
    ],
  }], { mode: "baseline" })

  const afterReconnect = conversationProjection(sceneId)
  const beforeScrollIdentitySequence = afterReconnect.visibleMessages.map(projectionModule.conversationProjectionMessageIdentity)
  assert.deepEqual(afterReconnect.visibleMessages.map((message) => message.id), [
    "durable-before",
    "accepted-user-event",
    "later-result",
  ])

  panelUiStoreModule.useChatPanelUiStore.getState().patchConversationScrollState(afterReconnect.scopeId, {
    isAtBottom: false,
    topMessageIdentity: optimisticIdentity,
  })
  panelUiStoreModule.useChatPanelUiStore.getState().patchConversationScrollState(afterReconnect.scopeId, {
    isAtBottom: true,
  })
  assert.deepEqual(
    conversationProjection(sceneId).visibleMessages.map(projectionModule.conversationProjectionMessageIdentity),
    beforeScrollIdentitySequence,
  )
})

test("older communication snapshot cannot overwrite a newer hydrated bubble", () => {
  const sceneId = "scene-stale"
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, "Stale ACK")
  store.getState().setRootAgentInstanceId(sceneId, FIXTURE_AGENT_INSTANCE_ID)
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [chatBubble({ id: "same-bubble", sortOrder: 0, seq: 500, text: "new snapshot" })],
  }])
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [chatBubble({ id: "same-bubble", sortOrder: 99, seq: 400, text: "stale ACK" })],
  }])

  const message = conversationProjection(sceneId).visibleMessages[0]
  assert.equal(message.content.text, "new snapshot")
  assert.equal(message.content.metadata.communication_seq, 500)
  assert.equal(message.content.metadata.chat_bubble_sort_order, 99)
})

test("context compression locator ignores unrelated tail bubbles and resolves the exact job", () => {
  const target = chatMessageFromBubble(chatBubble({
    id: "context-compression-job-a",
    seq: 100,
    text: "compression",
    bubbleKind: "context_compression",
    metadata: {
      compression: {
        id: "context-compression-job-a",
        job_id: "job-a",
        status: "running",
        stage: "workers",
        label: "上下文压缩中...",
        workers: [],
        communication_message_id: "event-100",
        communication_seq: 100,
      },
    },
  }))
  const unrelatedTail = chatMessageFromBubble(chatBubble({ id: "later-bubble", seq: 101, text: "later" }))
  const found = executionProcessModule.findContextCompressionMessageByJob(
    [target, unrelatedTail],
    "job-a",
    null,
  )
  assert.equal(found?.id, target.id)
})

test("six queued workers remain six through activity, terminal events, and stale replay", () => {
  const jobId = "job-workers"
  let metadata = executionProcessModule.buildInitialContextCompressionBubbleMetadata(
    compressionEvent("context_compression.started", 100, jobId),
  )
  const workers = [
    ["RequirementConstraintWorker", "requirements_constraints"],
    ["ProgressPlanWorker", "progress_plan"],
    ["CodeArchitectureWorker", "code_architecture"],
    ["ObservationEvidenceWorker", "observations_evidence"],
    ["DecisionRationaleWorker", "decisions_rationale"],
    ["TodoRiskWorker", "todos_risks"],
  ]
  let oneWorkerMetadata = null
  workers.forEach(([name, outputSection], index) => {
    metadata = executionProcessModule.reduceContextCompressionBubbleMetadata(
      metadata,
      compressionEvent("context_compression.worker.queued", 101 + index, jobId, {
        worker_id: name,
        id: name,
        name,
        title: outputSection,
        role: "section_worker",
        output_section: outputSection,
        reason: "waiting_for_concurrent_start",
      }),
    )
    if (index === 0) oneWorkerMetadata = metadata
  })
  assert.equal(metadata.compression.workers.length, 6)
  const beforeActivity = new Map(metadata.compression.workers.map((worker) => [worker.id, worker]))

  metadata = executionProcessModule.reduceContextCompressionBubbleMetadata(
    metadata,
    compressionEvent("context_compression.worker.activity", 120, jobId, {
      worker_id: "CodeArchitectureWorker",
      id: "CodeArchitectureWorker",
      name: "CodeArchitectureWorker",
      role: "section_worker",
      output_section: "code_architecture",
      activity: { kind: "thinking", text: "模型已响应，正在分析" },
    }),
  )
  assert.equal(metadata.compression.workers.length, 6)
  assert.equal(
    metadata.compression.workers.find((worker) => worker.id === "RequirementConstraintWorker").communication_seq,
    beforeActivity.get("RequirementConstraintWorker").communication_seq,
  )

  metadata = executionProcessModule.reduceContextCompressionBubbleMetadata(
    metadata,
    compressionEvent("context_compression.completed", 130, jobId),
  )
  assert.equal(metadata.compression.status, "completed")
  assert.equal(metadata.compression.workers.length, 6)

  metadata = executionProcessModule.reduceContextCompressionBubbleMetadata(
    metadata,
    compressionEvent("context_compression.worker.activity", 110, jobId, {
      worker_id: "CodeArchitectureWorker",
      id: "CodeArchitectureWorker",
      name: "CodeArchitectureWorker",
      role: "section_worker",
      output_section: "code_architecture",
      activity: { kind: "stale", text: "stale activity" },
    }),
  )
  const codeWorker = metadata.compression.workers.find((worker) => worker.id === "CodeArchitectureWorker")
  assert.equal(metadata.compression.workers.length, 6)
  assert.equal(codeWorker.communication_seq, 120)
  assert.equal(codeWorker.activity?.text, "模型已响应，正在分析")

  const sceneId = "scene-context-workers"
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, "Context worker ACK")
  store.getState().setRootAgentInstanceId(sceneId, FIXTURE_AGENT_INSTANCE_ID)
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [chatBubble({
      id: `context-compression-${jobId}`,
      status: "completed",
      sortOrder: 40,
      seq: 130,
      text: "terminal six-worker snapshot",
      bubbleKind: "context_compression",
      metadata,
    })],
  }])
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: FIXTURE_AGENT_INSTANCE_ID,
    bubbles: [chatBubble({
      id: `context-compression-${jobId}`,
      status: "streaming",
      sortOrder: 40,
      seq: 101,
      text: "stale one-worker ACK",
      bubbleKind: "context_compression",
      metadata: oneWorkerMetadata,
    })],
  }])
  const storedCompression = executionProcessModule.parseContextCompressionBubble(
    conversationProjection(sceneId).visibleMessages[0].content.metadata,
  )
  assert.equal(storedCompression.workers.length, 6)
  assert.equal(storedCompression.status, "completed")
  assert.equal(storedCompression.jobId, jobId)
  assert.notEqual(storedCompression.jobId, storedCompression.archiveJobId ?? "")
})

function conversationProjection(sceneId) {
  const scene = storeModule.useChatStore.getState().scenes[sceneId]
  return projectionModule.buildAgentConversationProjection(scene, sceneId, null)
}

function chatBubble({
  id,
  role = "agent",
  status = "completed",
  sortOrder = 0,
  seq = 1,
  createdAt = "2026-07-14T00:00:00.000Z",
  text,
  clientMessageId = null,
  backendMessageId = null,
  bubbleKind = "agent_result",
  agentInstanceId = FIXTURE_AGENT_INSTANCE_ID,
  metadata = {},
}) {
  return {
    bubble_id: id,
    scene_id: "fixture-scene",
    agent_instance_id: agentInstanceId,
    task_id: null,
    conversation_id: null,
    role,
    status,
    text,
    text_format: role === "user" ? "plain_text" : "markdown",
    channel: "web",
    client_message_id: clientMessageId,
    backend_message_id: backendMessageId,
    pending_message_id: null,
    interaction_options: [],
    interaction_state: "none",
    selected_option_id: null,
    sort_order: sortOrder,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: {
      bubble_kind: bubbleKind,
      communication_message_id: `event-${seq}`,
      communication_seq: seq,
      ...metadata,
    },
  }
}

function chatMessageFromBubble(bubble) {
  return {
    id: bubble.bubble_id,
    role: bubble.role,
    createdAt: bubble.created_at,
    status: bubble.status,
    content: {
      text: bubble.text,
      text_format: bubble.text_format,
      channel: bubble.channel,
      metadata: { ...bubble.metadata, chat_bubble_sort_order: bubble.sort_order },
    },
    clientMessageId: bubble.client_message_id ?? undefined,
    backendMessageId: bubble.backend_message_id ?? null,
    agentInstanceId: bubble.agent_instance_id ?? undefined,
  }
}

function compressionEvent(type, seq, jobId, worker) {
  return {
    stream_id: "stream-context",
    seq,
    message_id: `compression-event-${seq}`,
    correlation_id: jobId,
    type,
    created_at: `2026-07-14T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    metadata: { job_id: jobId },
    payload: {
      payload_version: "1.0",
      job_id: jobId,
      compression_index: 2,
      ...(worker ? { worker } : {}),
    },
  }
}

