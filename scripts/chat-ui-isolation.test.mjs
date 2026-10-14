import assert from "node:assert/strict"
import path from "node:path"
import { after, before, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const FIXTURE_SCENE_ID = "scene-ui-isolation-test"
const FIXTURE_ROOT_AGENT_ID = "root-agent-1"
const FIXTURE_CHILD_AGENT_ID = "child-agent-2"

let viteServer
let storeModule
let conversationStoreModule
let timelineStoreModule
let coordinatorModule
let routerModule
let scopeModule
let projectionModule
let messageListModule
let messageContentModule

before(async () => {
  viteServer = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  })
  storeModule = await viteServer.ssrLoadModule("/src/features/chat/model/chatStore.ts")
  conversationStoreModule = await viteServer.ssrLoadModule("/src/features/chat/model/conversationUiStore.ts")
  timelineStoreModule = await viteServer.ssrLoadModule("/src/features/chat/model/timelineUiStore.ts")
  coordinatorModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/chatEventCoordinator.ts")
  routerModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/chatEventRouter.ts")
  scopeModule = await viteServer.ssrLoadModule("/src/features/chat/model/chatAgentScope.ts")
  projectionModule = await viteServer.ssrLoadModule("/src/features/chat/hooks/useAgentUiProjection.ts")
  messageListModule = await viteServer.ssrLoadModule("/src/features/chat/components/MessageList.tsx")
  messageContentModule = await viteServer.ssrLoadModule("/src/features/chat/components/MessageContent.tsx")
})

beforeEach(() => {
  storeModule.useChatStore.getState().clearAllScenes()
  conversationStoreModule.useConversationUiStore.getState().clearAll()
  timelineStoreModule.useTimelineUiStore.getState().clearAll()
  coordinatorModule.chatEventCoordinator.clearAll()
})

after(async () => {
  await viteServer?.close()
})

function setupScene(sceneId = FIXTURE_SCENE_ID, rootAgentId = FIXTURE_ROOT_AGENT_ID) {
  const store = storeModule.useChatStore.getState()
  store.openScene(sceneId, "Isolation Test Scene")
  store.setRootAgentInstanceId(sceneId, rootAgentId)
  store.setAgentInstance(sceneId, {
    instance_id: rootAgentId,
    agent_definition_id: "Software-Engineering",
    status: "running",
    released: false,
    pending_user_message_count: 0,
    pending_user_messages: [],
  })
}

function makeExecutionBubble(bubbleId, iterationId, text, status = "running", seq = 100) {
  return {
    bubble_id: bubbleId,
    scene_id: FIXTURE_SCENE_ID,
    agent_instance_id: FIXTURE_ROOT_AGENT_ID,
    task_id: "task-1",
    conversation_id: "conv-1",
    role: "agent",
    status: "completed",
    text,
    text_format: "plain_text",
    channel: "tool",
    client_message_id: null,
    backend_message_id: `msg-${seq}`,
    pending_message_id: null,
    interaction_options: [],
    interaction_state: "none",
    selected_option_id: null,
    sort_order: seq,
    created_at: new Date(1700000000000 + seq * 1000).toISOString(),
    updated_at: new Date(1700000000000 + seq * 1000).toISOString(),
    metadata: {
      bubble_kind: "execution_process",
      process_status: status,
      communication_seq: seq,
      iterations: [{
        id: iterationId,
        index: 1,
        llm: {
          status: status === "running" ? "thinking" : "completed",
          request_id: "req-1",
          duration_ms: 150,
        },
        tools: [{
          id: "tool-call-1",
          tool_call_id: "tool-call-1",
          tool_name: "search_code",
          status: status === "running" ? "running" : "completed",
          duration_ms: 100,
        }],
      }],
    },
  }
}

function makeTaskBoundaryBubble(bubbleId, seq = 200, status = "completed") {
  return {
    bubble_id: bubbleId,
    scene_id: FIXTURE_SCENE_ID,
    agent_instance_id: FIXTURE_ROOT_AGENT_ID,
    task_id: "task-1",
    conversation_id: "conv-1",
    role: "agent",
    status,
    text: status === "failed" ? "任务失败" : "任务完成",
    text_format: "plain_text",
    channel: "web",
    client_message_id: null,
    backend_message_id: `msg-${seq}`,
    pending_message_id: null,
    interaction_options: [],
    interaction_state: "none",
    selected_option_id: null,
    sort_order: seq,
    created_at: new Date(1700000000000 + seq * 1000).toISOString(),
    updated_at: new Date(1700000000000 + seq * 1000).toISOString(),
    metadata: {
      bubble_kind: "task_boundary",
      task_status: status,
      completed_at: new Date(1700000000000 + seq * 1000).toISOString(),
      label: status === "failed" ? "任务失败" : "任务完成",
      communication_seq: seq,
    },
  }
}

test("Reactivity Isolation: 100 execution deltas do NOT trigger conversation store subscription", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)

  // 1. 先进行初始 baseline 水合建立会话
  const coordinator = coordinatorModule.chatEventCoordinator
  const gen = coordinator.beginHydration(scopeId)
  coordinator.dispatchBaselineHydration(FIXTURE_SCENE_ID, [{
    agentInstanceId: FIXTURE_ROOT_AGENT_ID,
    bubbles: [{
      bubble_id: "user-init-bubble",
      scene_id: FIXTURE_SCENE_ID,
      agent_instance_id: FIXTURE_ROOT_AGENT_ID,
      task_id: null,
      conversation_id: null,
      role: "user",
      status: "completed",
      text: "Initial user question",
      text_format: "plain_text",
      channel: "web",
      client_message_id: null,
      backend_message_id: "msg-1",
      pending_message_id: null,
      interaction_options: [],
      interaction_state: "none",
      selected_option_id: null,
      sort_order: 1,
      created_at: "2026-07-20T10:00:00.000Z",
      updated_at: "2026-07-20T10:00:00.000Z",
      metadata: {},
    }],
  }], gen, FIXTURE_ROOT_AGENT_ID)

  const initialConversationScope = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  assert.ok(initialConversationScope)
  assert.equal(initialConversationScope.visibleMessages.length, 1)

  // 2. 设立订阅监听计数器（模拟 React selector / hook 侦听）
  let conversationNotifyCount = 0
  const unsubscribe = conversationStoreModule.useConversationUiStore.subscribe((state) => {
    // 监听 conversationScope 引用变动
    if (state.scopes[scopeId] !== initialConversationScope) {
      conversationNotifyCount++
    }
  })

  // 3. 高频灌入 100 次 execution_process 增量气泡
  for (let i = 1; i <= 100; i++) {
    const execBubble = makeExecutionBubble("exec-bubble-1", "iter-1", `Streaming delta ${i}`, "running", 10 + i)
    coordinator.dispatchIncrementalBubbles(FIXTURE_SCENE_ID, [{
      agentInstanceId: FIXTURE_ROOT_AGENT_ID,
      bubbles: [execBubble],
    }], FIXTURE_ROOT_AGENT_ID)
  }

  unsubscribe()

  // 4. 断言：左侧会话 Store 引用绝对未变，触发次数严格为 0
  assert.equal(conversationNotifyCount, 0, "conversation store must not be notified by execution deltas")
  assert.equal(
    conversationStoreModule.useConversationUiStore.getState().scopes[scopeId],
    initialConversationScope,
    "conversation scope reference must remain exactly identical",
  )

  // 5. 验证右侧时间线 Store 正确增量更新
  const timelineScope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.ok(timelineScope)
  assert.equal(timelineScope.allBlocks.length, 1)
  assert.equal(timelineScope.allBlocks[0].kind, "execution")
})

test("Reactivity Isolation: 20 conversation messages do NOT trigger timeline store subscription", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)

  const coordinator = coordinatorModule.chatEventCoordinator
  const gen = coordinator.beginHydration(scopeId)

  // 1. 初始化包含执行过程的时间线
  coordinator.dispatchBaselineHydration(FIXTURE_SCENE_ID, [{
    agentInstanceId: FIXTURE_ROOT_AGENT_ID,
    bubbles: [makeExecutionBubble("exec-init", "iter-1", "Executed tool", "completed", 5)],
  }], gen, FIXTURE_ROOT_AGENT_ID)

  const initialTimelineScope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.ok(initialTimelineScope)
  assert.equal(initialTimelineScope.allBlocks.length, 1)

  // 2. 设立时间线订阅监听计数器
  let timelineNotifyCount = 0
  const unsubscribe = timelineStoreModule.useTimelineUiStore.subscribe((state) => {
    if (state.scopes[scopeId] !== initialTimelineScope) {
      timelineNotifyCount++
    }
  })

  // 3. 连续发送 20 条普通对话消息
  for (let i = 1; i <= 20; i++) {
    coordinator.dispatchOptimisticUserMessage(
      FIXTURE_SCENE_ID,
      FIXTURE_ROOT_AGENT_ID,
      `User message ${i}`,
      `client-msg-${i}`,
      FIXTURE_ROOT_AGENT_ID,
    )
  }

  unsubscribe()

  // 4. 断言：右侧时间线 Store 引用未变，触发次数严格为 0
  assert.equal(timelineNotifyCount, 0, "timeline store must not be notified by user conversation messages")
  assert.equal(
    timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId],
    initialTimelineScope,
    "timeline scope reference must remain exactly identical",
  )

  // 5. 验证左侧会话 Store 正确接收 20 条消息
  const conversationScope = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  assert.ok(conversationScope)
  assert.equal(conversationScope.visibleMessages.length, 20)
})

test("Dual-Consumer: task_boundary correctly projects into both stores and resets execution round", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const coordinator = coordinatorModule.chatEventCoordinator

  // 1. 先进行一次 execution
  coordinator.dispatchIncrementalBubbles(FIXTURE_SCENE_ID, [{
    agentInstanceId: FIXTURE_ROOT_AGENT_ID,
    bubbles: [makeExecutionBubble("exec-round-1", "iter-1", "Round 1 tool", "completed", 10)],
  }], FIXTURE_ROOT_AGENT_ID)

  let timelineScope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.equal(timelineScope.allBlocks.length, 1)
  assert.equal(timelineScope.allBlocks[0].round, 1)

  // 2. 派发 task_boundary 双消费气泡
  const boundaryBubble = makeTaskBoundaryBubble("task-bound-1", 20, "completed")
  coordinator.dispatchIncrementalBubbles(FIXTURE_SCENE_ID, [{
    agentInstanceId: FIXTURE_ROOT_AGENT_ID,
    bubbles: [boundaryBubble],
  }], FIXTURE_ROOT_AGENT_ID)

  // 3. 校验左侧会话 Store 包含该边界
  const conversationScope = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  assert.ok(conversationScope)
  assert.ok(conversationScope.visibleMessages.some((m) => m.id === "task-bound-1"))

  // 4. 校验右侧时间线 Store 包含该边界 Block
  timelineScope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.equal(timelineScope.allBlocks.length, 2)
  assert.equal(timelineScope.allBlocks[1].kind, "task_boundary")

  // 5. 再次写入新的 execution，执行轮次必须重置并重新从 1 开始
  coordinator.dispatchIncrementalBubbles(FIXTURE_SCENE_ID, [{
    agentInstanceId: FIXTURE_ROOT_AGENT_ID,
    bubbles: [makeExecutionBubble("exec-round-2", "iter-2", "Round after boundary", "completed", 30)],
  }], FIXTURE_ROOT_AGENT_ID)

  timelineScope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.equal(timelineScope.allBlocks.length, 3)
  assert.equal(timelineScope.allBlocks[2].round, 1, "execution round must reset to 1 after task boundary")
})

test("Three-tier Watermark & Hydration Race: Stale hydration response is rejected and live events are drained", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const coordinator = coordinatorModule.chatEventCoordinator

  // 1. 发起第 1 代水合
  const gen1 = coordinator.beginHydration(scopeId)
  assert.equal(coordinator.isScopeHydrating(scopeId), true)

  // 2. 水合期间到来 live 事件 (seq 15)，此时由于屏障，进入该 scope 的缓冲区
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
    seq: 15,
    type: "agent.task.started",
    message_id: "evt-15",
    stream_id: "stream-1",
    created_at: "2026-07-20T12:00:00.000Z",
    payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
  }], FIXTURE_ROOT_AGENT_ID)

  // 3. 用户切换或重发，发起第 2 代水合（作废第 1 代）
  const gen2 = coordinator.beginHydration(scopeId)
  assert.notEqual(gen1, gen2)

  // 4. 迟到的第 1 代 REST 响应返回，必须被 Coordinator 拒绝
  const staleAccepted = coordinator.dispatchBaselineHydration(FIXTURE_SCENE_ID, [{
    agentInstanceId: FIXTURE_ROOT_AGENT_ID,
    bubbles: [{
      bubble_id: "stale-bubble",
      scene_id: FIXTURE_SCENE_ID,
      agent_instance_id: FIXTURE_ROOT_AGENT_ID,
      task_id: null,
      conversation_id: null,
      role: "agent",
      status: "completed",
      text: "Stale data",
      text_format: "plain_text",
      channel: "web",
      client_message_id: null,
      backend_message_id: "stale-msg",
      pending_message_id: null,
      interaction_options: [],
      interaction_state: "none",
      selected_option_id: null,
      sort_order: 1,
      created_at: "2026-07-20T09:00:00.000Z",
      updated_at: "2026-07-20T09:00:00.000Z",
      metadata: {},
    }],
  }], gen1, FIXTURE_ROOT_AGENT_ID)

  assert.equal(staleAccepted, false, "stale generation hydration must be rejected")
  assert.equal(conversationStoreModule.useConversationUiStore.getState().scopes[scopeId], undefined)

  // 5. 第 2 代正确响应到达并提交
  const freshAccepted = coordinator.dispatchBaselineHydration(FIXTURE_SCENE_ID, [{
    agentInstanceId: FIXTURE_ROOT_AGENT_ID,
    bubbles: [{
      bubble_id: "fresh-bubble",
      scene_id: FIXTURE_SCENE_ID,
      agent_instance_id: FIXTURE_ROOT_AGENT_ID,
      task_id: null,
      conversation_id: null,
      role: "agent",
      status: "completed",
      text: "Fresh data",
      text_format: "plain_text",
      channel: "web",
      client_message_id: null,
      backend_message_id: "fresh-msg",
      pending_message_id: null,
      interaction_options: [],
      interaction_state: "none",
      selected_option_id: null,
      sort_order: 10,
      created_at: "2026-07-20T10:00:00.000Z",
      updated_at: "2026-07-20T10:00:00.000Z",
      metadata: {},
    }],
  }], gen2, FIXTURE_ROOT_AGENT_ID)

  assert.equal(freshAccepted, true, "fresh generation hydration must be accepted")
  assert.equal(coordinator.isScopeHydrating(scopeId), false)
  const conversationScope = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  assert.ok(conversationScope)
  assert.equal(conversationScope.visibleMessages[0].id, "fresh-bubble")

  // P0 核心断言：水合期间缓冲的 live 事件 (seq 15) 在 baseline 完成后必须被成功 drain 落地，绝不能被 transport receivedCursor 误丢弃
  assert.equal(coordinator.getSceneAppliedCursor(FIXTURE_SCENE_ID), 15, "coordinator sceneAppliedCursor must advance to 15 after draining")
  const canonicalScene = storeModule.useChatStore.getState().scenes[FIXTURE_SCENE_ID]
  assert.ok(canonicalScene)
  assert.equal(canonicalScene.lastSeq, 15, "canonical chatStore lastSeq must advance to 15")
  const watermark = coordinator.getScopeWatermark(scopeId)
  assert.equal(watermark.lastAppliedSceneSeq, 15, "scope projection watermark must advance to 15")
})

test("Per-Scope Quota & Pinning: Pending interaction and running executions are pinned and never evicted", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)

  // 1. 会话测试：测试 Pending Interaction Pinning
  const convStore = conversationStoreModule.useConversationUiStore.getState()
  const messages = []
  // 放入一个带有 pending 交互的消息在头部
  messages.push({
    id: "pinned-interaction-msg",
    role: "agent",
    createdAt: "2026-07-20T00:00:00.000Z",
    status: "completed",
    content: { text: "Please select an option", text_format: "plain_text", channel: "web" },
    interactionOptions: [{ id: "opt-1", label: "Option 1" }],
    interactionState: "pending",
  })
  // 放入 250 条普通消息（超出 Hot 200 配额）
  for (let i = 1; i <= 250; i++) {
    messages.push({
      id: `normal-msg-${i}`,
      role: "agent",
      createdAt: new Date(1700000000000 + i * 1000).toISOString(),
      status: "completed",
      content: { text: `Message content ${i}`, text_format: "plain_text", channel: "web" },
    })
  }

  convStore.hydrateScope(scopeId, FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, messages, [], null, "hot")
  const convScope = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  assert.ok(convScope)
  // 必须保留 pinned 消息
  assert.ok(
    convScope.messages.some((m) => m.id === "pinned-interaction-msg"),
    "pending interaction message must be pinned even when quota is exceeded",
  )

  // 2. 时间线测试：测试 Running Execution Pinning
  const timelineStore = timelineStoreModule.useTimelineUiStore.getState()
  const blocks = []
  // 放入一个正在运行中的 block 在头部
  blocks.push({
    kind: "execution",
    messageId: "running-block",
    sourceMessageId: "source-1",
    createdAt: "2026-07-20T00:00:00.000Z",
    round: 1,
    iteration: {
      id: "iter-running",
      index: 1,
      llm: { status: "thinking", request_id: "req-1" },
      tools: [],
    },
  })
  // 放入 60 个已完成的 blocks（超出 Hot 50 配额）
  for (let i = 1; i <= 60; i++) {
    blocks.push({
      kind: "execution",
      messageId: `completed-block-${i}`,
      sourceMessageId: `source-${i}`,
      createdAt: new Date(1700000000000 + i * 1000).toISOString(),
      round: i + 1,
      iteration: {
        id: `iter-${i}`,
        index: 1,
        llm: { status: "completed", request_id: `req-${i}` },
        tools: [],
      },
    })
  }

  timelineStore.hydrateBlocks(scopeId, FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, blocks, "hot")
  const timeScope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.ok(timeScope)
  assert.ok(
    timeScope.allBlocks.some((b) => b.messageId === "running-block"),
    "running execution block must be pinned even when quota is exceeded",
  )
})

test("P0-1: Empty projection objects are frozen, stable, and completely decouple timeline from messages", () => {
  const { EMPTY_CONVERSATION_PROJECTION, EMPTY_TIMELINE_PROJECTION } = projectionModule
  assert.ok(Object.isFrozen(EMPTY_CONVERSATION_PROJECTION))
  assert.ok(Object.isFrozen(EMPTY_TIMELINE_PROJECTION))
  assert.equal(EMPTY_CONVERSATION_PROJECTION.messages.length, 0)
  assert.equal(EMPTY_TIMELINE_PROJECTION.blocks.length, 0)
  assert.equal(EMPTY_TIMELINE_PROJECTION.allBlocks.length, 0)
  // 确保时间线 projection 不再具有 messages 字段（消除泄漏与订阅回退）
  assert.equal("messages" in EMPTY_TIMELINE_PROJECTION, false, "timeline projection must not contain messages")
})

test("P1-1: TimelineStore amortized O(1) in-place incremental updates and fast blockIndex lookup", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const store = timelineStoreModule.useTimelineUiStore.getState()

  // 初始写入一个包含 1 个 tool 的 iteration
  store.upsertExecutionIterations(
    scopeId,
    FIXTURE_SCENE_ID,
    FIXTURE_ROOT_AGENT_ID,
    "exec-fast-1",
    "2026-07-20T10:00:00.000Z",
    [{
      id: "iter-1",
      index: 1,
      llm: { status: "thinking", request_id: "req-1" },
      tools: [{
        id: "tool-1",
        tool_call_id: "tool-1",
        tool_name: "test_tool",
        status: "running",
      }],
    }],
    1,
    "hot",
  )

  let scope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.ok(scope)
  assert.equal(scope.blockIndexByMessageId.get("exec-fast-1:iter-1"), 0)
  assert.equal(scope.totalToolCallCount, 1)

  // 连续进行 300 次原位高频流式增量更新，验证 O(1) 性能与工具计数差量维护
  const start = performance.now()
  for (let i = 1; i <= 300; i++) {
    timelineStoreModule.useTimelineUiStore.getState().upsertExecutionIterations(
      scopeId,
      FIXTURE_SCENE_ID,
      FIXTURE_ROOT_AGENT_ID,
      "exec-fast-1",
      "2026-07-20T10:00:00.000Z",
      [{
        id: "iter-1",
        index: 1,
        llm: { status: "completed", request_id: "req-1", content: `Delta text ${i}` },
        tools: [{
          id: "tool-1",
          tool_call_id: "tool-1",
          tool_name: "test_tool",
          status: i === 300 ? "completed" : "running",
        }],
      }],
      1,
      "hot",
    )
  }
  const duration = performance.now() - start
  assert.ok(duration < 250, `300 incremental updates should be fast (took ${duration.toFixed(2)}ms)`)

  scope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.equal(scope.allBlocks.length, 1)
  assert.equal(scope.blockIndexByMessageId.get("exec-fast-1:iter-1"), 0)
  assert.equal(scope.totalToolCallCount, 1)
  assert.equal(scope.allBlocks[0].iteration.llm.content, "Delta text 300")
})

test("P0-3 & P1-5: Coordinator single authoritative production path & bubble persistence sink", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const coordinator = coordinatorModule.chatEventCoordinator

  const sinkCalls = []
  coordinator.setBubblePersistenceSink((sceneId, body, createdAt, label, messageId) => {
    sinkCalls.push({ sceneId, body, createdAt, label, messageId })
  })

  try {
    // 1. 发送 llm.request.started 启动执行过程
    coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
      seq: 101,
      type: "llm.request.started",
      message_id: "msg-llm-1",
      stream_id: "stream-1",
      created_at: "2026-07-20T11:00:00.000Z",
      payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, llm_request_id: "req-1" },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    }], FIXTURE_ROOT_AGENT_ID)

    // 2. 发送 llm.content.delta 流式事件
    coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
      seq: 102,
      type: "llm.content.delta",
      message_id: "msg-delta-1",
      stream_id: "stream-1",
      created_at: "2026-07-20T11:00:01.000Z",
      payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, llm_request_id: "req-1", delta: "Hello world" },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    }], FIXTURE_ROOT_AGENT_ID)

    // 校验：TimelineStore 收到 execution block
    const timelineScope = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
    assert.ok(timelineScope)
    assert.equal(timelineScope.allBlocks.length, 1)
    assert.equal(timelineScope.allBlocks[0].kind, "execution")

    // 校验：ConversationStore 没收到任何执行过程消息（完全隔离）
    const convScope = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
    assert.equal(convScope?.visibleMessages?.length ?? 0, 0)

    // 校验：bubblePersistenceSink 被触发，且 delta 事件标签正确
    assert.ok(sinkCalls.length >= 2)
    const deltaCall = sinkCalls.find((c) => c.label === "execution process delta")
    assert.ok(deltaCall, "must have dispatched execution process delta to persistence sink")
    assert.equal(deltaCall.sceneId, FIXTURE_SCENE_ID)
    assert.equal(deltaCall.body.role, "agent")

    // 3. 发送 agent.task.completed 任务终态边界事件
    coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
      seq: 103,
      type: "agent.task.completed",
      message_id: "msg-task-end",
      stream_id: "stream-1",
      created_at: "2026-07-20T11:00:05.000Z",
      payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    }], FIXTURE_ROOT_AGENT_ID)

    // 校验：Task boundary 触发 sink 标签为 "task boundary bubble"
    const boundaryCall = sinkCalls.find((c) => c.label === "task boundary bubble")
    assert.ok(boundaryCall, "must have dispatched task boundary bubble to persistence sink")

    // 校验：ConversationStore 现在接收到了任务终态消息，而此前并未接收任何纯执行事件
    const convScopeAfter = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
    assert.ok(convScopeAfter)
    assert.equal(convScopeAfter.visibleMessages.length, 1)
    assert.equal(convScopeAfter.visibleMessages[0].role, "agent")
  } finally {
    coordinator.setBubblePersistenceSink(null)
  }
})

test("P1-2: Transport Generation streamId isolation rejects mismatched stream events", () => {
  setupScene()
  const coordinator = coordinatorModule.chatEventCoordinator
  coordinator.setSceneTransportGeneration(FIXTURE_SCENE_ID, { streamId: "valid-stream-100" })

  // 1. 发送 streamId 不匹配的陈旧流事件
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
    seq: 1,
    type: "agent.task.started",
    message_id: "evt-stale-stream",
    stream_id: "old-stream-99",
    created_at: "2026-07-20T12:00:00.000Z",
    payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
  }], FIXTURE_ROOT_AGENT_ID)

  // 校验：被丢弃，transport received cursor 未推进，chatStore lastSeq 为 0
  assert.equal(coordinator.getSceneTransportReceivedCursor(FIXTURE_SCENE_ID), 0)
  assert.equal(storeModule.useChatStore.getState().scenes[FIXTURE_SCENE_ID]?.lastSeq ?? 0, 0)

  // 2. 发送 streamId 匹配的当前流事件
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
    seq: 1,
    type: "agent.task.started",
    message_id: "evt-valid-stream",
    stream_id: "valid-stream-100",
    created_at: "2026-07-20T12:00:01.000Z",
    payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
  }], FIXTURE_ROOT_AGENT_ID)

  // 校验：被接受，received cursor 与 applied cursor 均推进至 1
  assert.equal(coordinator.getSceneTransportReceivedCursor(FIXTURE_SCENE_ID), 1)
  assert.equal(coordinator.getSceneAppliedCursor(FIXTURE_SCENE_ID), 1)
  assert.equal(storeModule.useChatStore.getState().scenes[FIXTURE_SCENE_ID]?.lastSeq ?? 0, 1)
})

test("P1-3: Scope watermark rejects duplicate or lower seq events at projection entry", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const coordinator = coordinatorModule.chatEventCoordinator

  // 1. 发送 seq=50 事件并成功投影
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
    seq: 50,
    type: "agent.task.started",
    message_id: "evt-seq-50",
    stream_id: "stream-1",
    created_at: "2026-07-20T12:00:00.000Z",
    payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
  }], FIXTURE_ROOT_AGENT_ID)

  const wm1 = coordinator.getScopeWatermark(scopeId)
  assert.equal(wm1.lastAppliedSceneSeq, 50)

  // 2. 模拟 replay 重发相同 seq=50 或更低 seq=45
  let sinkCalled = false
  coordinator.setBubblePersistenceSink(() => {
    sinkCalled = true
  })
  try {
    coordinator.dispatchReplayEvents(FIXTURE_SCENE_ID, [{
      seq: 45,
      type: "agent.task.completed",
      message_id: "evt-seq-45",
      stream_id: "stream-1",
      created_at: "2026-07-20T11:59:00.000Z",
      payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    }], FIXTURE_ROOT_AGENT_ID)

    assert.equal(sinkCalled, false, "duplicate or lower seq event must not trigger projection or sink")
  } finally {
    coordinator.setBubblePersistenceSink(null)
  }
})

test("P1-4: TimelineStore blockIndexByMessageId maintains strict Map immutability and fast capacity eviction", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const timelineStore = timelineStoreModule.useTimelineUiStore

  // 1. 插入第 1 个 block
  timelineStore.getState().upsertExecutionIterations(
    scopeId,
    FIXTURE_SCENE_ID,
    FIXTURE_ROOT_AGENT_ID,
    "exec-imm-1",
    "2026-07-20T10:00:00.000Z",
    [{
      id: "iter-1",
      index: 1,
      llm: { status: "completed", request_id: "req-1" },
      tools: [],
    }],
    1,
    "hot",
  )

  const scopeAfterFirst = timelineStore.getState().scopes[scopeId]
  const mapV1 = scopeAfterFirst.blockIndexByMessageId
  assert.ok(mapV1 instanceof Map)
  assert.equal(mapV1.size, 1)
  assert.equal(mapV1.get("exec-imm-1:iter-1"), 0)

  // 2. 插入第 2 个 block
  timelineStore.getState().upsertExecutionIterations(
    scopeId,
    FIXTURE_SCENE_ID,
    FIXTURE_ROOT_AGENT_ID,
    "exec-imm-2",
    "2026-07-20T10:00:01.000Z",
    [{
      id: "iter-1",
      index: 1,
      llm: { status: "completed", request_id: "req-2" },
      tools: [],
    }],
    2,
    "hot",
  )

  const scopeAfterSecond = timelineStore.getState().scopes[scopeId]
  const mapV2 = scopeAfterSecond.blockIndexByMessageId
  assert.ok(mapV2 instanceof Map)
  assert.equal(mapV2.size, 2)
  // 严格不可变性断言：旧 Map 引用不能被原地修改！
  assert.notEqual(mapV1, mapV2, "new block insertion must allocate a new Map reference")
  assert.equal(mapV1.size, 1, "previous Map reference must not be mutated or cleared")
  assert.equal(mapV1.has("exec-imm-2:iter-1"), false, "previous Map must not contain new keys")

  // 3. 超过配额淘汰测试：插入超出 hot 配额（50）的 blocks，测试快速淘汰最旧非 running block
  for (let i = 3; i <= 52; i++) {
    timelineStore.getState().upsertExecutionIterations(
      scopeId,
      FIXTURE_SCENE_ID,
      FIXTURE_ROOT_AGENT_ID,
      `exec-imm-${i}`,
      new Date(1700000000000 + i * 1000).toISOString(),
      [{
        id: "iter-1",
        index: 1,
        llm: { status: "completed", request_id: `req-${i}` },
        tools: [],
      }],
      i,
      "hot",
    )
  }

  const scopeAfterEviction = timelineStore.getState().scopes[scopeId]
  // hot 配额为 50，可见窗口为 MAX_EXECUTION_MONITOR_BLOCKS (20)
  assert.equal(scopeAfterEviction.allBlocks.length, 50, "allBlocks should be capped at quota (50)")
  assert.equal(scopeAfterEviction.blocks.length, 20, "visible blocks array should be capped at MAX_EXECUTION_MONITOR_BLOCKS (20)")
  assert.equal(scopeAfterEviction.hiddenBlockCount, 30, "hiddenBlockCount should be allBlocks.length - 20 = 30")
  assert.equal(scopeAfterEviction.blockIndexByMessageId.size, 50, "index map should also be capped at 50")
  // 最旧的 exec-imm-1 应该已经被淘汰
  assert.equal(scopeAfterEviction.blockIndexByMessageId.has("exec-imm-1:iter-1"), false, "oldest block must be evicted")
  // 最新加入的 exec-imm-52 必须存在且 index 正确
  assert.equal(scopeAfterEviction.blockIndexByMessageId.get("exec-imm-52:iter-1"), 49)
})

test("P1-5: Component isolation: ConversationPane & TimelinePane pure props boundaries", async () => {
  const conversationPaneModule = await viteServer.ssrLoadModule("/src/features/chat/components/ConversationPane.tsx")
  const timelinePaneModule = await viteServer.ssrLoadModule("/src/features/chat/components/TimelinePane.tsx")

  assert.ok(conversationPaneModule.ConversationPane, "ConversationPane must be exported")
  assert.ok(timelinePaneModule.TimelinePane, "TimelinePane must be exported")
  // 验证两者皆使用 React.memo 进行纯属性隔离
  assert.equal(typeof conversationPaneModule.ConversationPane, "object")
  assert.equal(typeof timelinePaneModule.TimelinePane, "object")
})

test("P0-Multi-Scope: Multi-Agent Scope Hydration Race does NOT drop earlier hydrating events", () => {
  setupScene()
  const agentA = "agent-instance-a"
  const agentB = "agent-instance-b"
  const scopeA = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, agentA, FIXTURE_ROOT_AGENT_ID)
  const scopeB = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, agentB, FIXTURE_ROOT_AGENT_ID)
  const coordinator = coordinatorModule.chatEventCoordinator

  // 1. Agent A 进入水合状态
  const genA = coordinator.beginHydration(scopeA)
  assert.equal(coordinator.isScopeHydrating(scopeA), true)
  assert.equal(coordinator.isScopeHydrating(scopeB), false)

  // 2. 依次到来事件：seq 1 属于 Agent A（应缓冲），seq 2 属于就绪的 Agent B（应因前面有水合中的未应用事件而暂缓，不可直接跃进）
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
    seq: 1,
    type: "agent.task.started",
    message_id: "evt-a-1",
    stream_id: "stream-1",
    created_at: "2026-07-20T12:00:00.000Z",
    payload: { agent_instance_id: agentA },
    metadata: { agent_instance_id: agentA },
  }], FIXTURE_ROOT_AGENT_ID)

  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
    seq: 2,
    type: "agent.task.started",
    message_id: "evt-b-2",
    stream_id: "stream-1",
    created_at: "2026-07-20T12:00:01.000Z",
    payload: { agent_instance_id: agentB },
    metadata: { agent_instance_id: agentB },
  }], FIXTURE_ROOT_AGENT_ID)

  // 关键断言：sceneAppliedCursor 不能被 Agent B 的 seq 2 提前推进至 2，否则 Agent A 的 seq 1 将被永远误丢弃！
  assert.equal(coordinator.getSceneAppliedCursor(FIXTURE_SCENE_ID), 0, "sceneAppliedCursor must NOT skip ahead of hydrating Scope A event")

  // 3. Agent A 基线水合返回并提交
  const baselineAccepted = coordinator.dispatchBaselineHydration(FIXTURE_SCENE_ID, [{
    agentInstanceId: agentA,
    bubbles: [{
      bubble_id: "bubble-a-base",
      scene_id: FIXTURE_SCENE_ID,
      agent_instance_id: agentA,
      task_id: null,
      conversation_id: null,
      role: "agent",
      status: "completed",
      text: "Agent A Baseline",
      text_format: "plain_text",
      channel: "web",
      client_message_id: null,
      backend_message_id: "msg-a-0",
      pending_message_id: null,
      interaction_options: [],
      interaction_state: "none",
      selected_option_id: null,
      sort_order: 0,
      created_at: "2026-07-20T11:00:00.000Z",
      updated_at: "2026-07-20T11:00:00.000Z",
      metadata: {},
    }],
  }], genA, FIXTURE_ROOT_AGENT_ID)
  assert.equal(baselineAccepted, true)

  // 4. 水合完成后排空，seq 1 与 seq 2 均按序成功落地！
  assert.equal(coordinator.getSceneAppliedCursor(FIXTURE_SCENE_ID), 2, "both events must be applied in order up to seq 2")
  const watermarkA = coordinator.getScopeWatermark(scopeA)
  const watermarkB = coordinator.getScopeWatermark(scopeB)
  assert.equal(watermarkA.lastAppliedSceneSeq, 1, "Agent A watermark must advance to 1")
  assert.equal(watermarkB.lastAppliedSceneSeq, 2, "Agent B watermark must advance to 2")
})

test("P1-6: resetSceneTransportGeneration and resetSceneTransportState cleanly reset cursors and state", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const coordinator = coordinatorModule.chatEventCoordinator
  const chatStore = storeModule.useChatStore.getState()

  // 推进水位
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
    seq: 100,
    type: "agent.task.started",
    message_id: "evt-reset-1",
    stream_id: "stream-old",
    created_at: "2026-07-20T12:00:00.000Z",
    payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
  }], FIXTURE_ROOT_AGENT_ID)

  assert.equal(coordinator.getSceneTransportReceivedCursor(FIXTURE_SCENE_ID), 100)
  assert.equal(coordinator.getSceneAppliedCursor(FIXTURE_SCENE_ID), 100)

  // 模拟进程重启 generation reset
  coordinator.resetSceneTransportGeneration(FIXTURE_SCENE_ID, { bootId: "new-boot-id" })
  chatStore.resetSceneTransportState(FIXTURE_SCENE_ID, "new-stream-id")

  assert.equal(coordinator.getSceneTransportReceivedCursor(FIXTURE_SCENE_ID), 0, "receivedCursor must reset to 0")
  assert.equal(coordinator.getSceneAppliedCursor(FIXTURE_SCENE_ID), 0, "appliedCursor must reset to 0")
  assert.equal(coordinator.getScopeWatermark(scopeId).lastAppliedSceneSeq, 0, "scope watermark must reset to 0")
  assert.equal(storeModule.useChatStore.getState().scenes[FIXTURE_SCENE_ID].lastSeq, 0, "chatStore lastSeq must reset to 0")
})


test("Frozen plan: queued dual-write keeps TimelineStore unchanged", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const timelineBefore = timelineStoreModule.useTimelineUiStore.getState()
  const queued = { id: "queued-1", pendingMessageId: "pending-1", clientMessageId: "client-1", text: "queued", createdAt: "2026-07-20T12:00:00.000Z", status: "queued", agentInstanceId: FIXTURE_ROOT_AGENT_ID }
  routerModule.chatEventRouter.routeQueuedUserMessage(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID, queued)
  const conversation = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  assert.equal(conversation.queuedUserMessages[0].pendingMessageId, "pending-1")
  assert.equal(timelineStoreModule.useTimelineUiStore.getState(), timelineBefore)
})

test("Frozen plan: interaction requested projects left message and pending state only", () => {
  setupScene()
  const coordinator = coordinatorModule.chatEventCoordinator
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{
    seq: 301, type: "agent.interaction.requested", message_id: "interaction-1", stream_id: "stream-1", created_at: "2026-07-20T12:00:00.000Z",
    payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, interaction_id: "ask-1", question: { text: "Choose", text_format: "plain_text" }, options: [{ id: "yes", label: "Yes" }], allow_free_text: false, requires_user_response: true, interaction_state: "pending", loop_control: { decision: "pause" } },
    metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
  }], FIXTURE_ROOT_AGENT_ID)
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const conversation = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  assert.ok(conversation.messages.some((message) => message.id === "interaction-1"))
  assert.equal(conversation.pendingInteraction.interaction_id, "ask-1")
  assert.equal(timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId], undefined)
})

test("Frozen plan: assistant payload without正文 does not fabricate Conversation message", () => {
  setupScene()
  const coordinator = coordinatorModule.chatEventCoordinator
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{ seq: 302, type: "agent.assistant.message.received", message_id: "assistant-no-body", stream_id: "stream-1", created_at: "2026-07-20T12:00:00.000Z", payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, part_count: 1, tool_use_count: 0 }, metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID } }], FIXTURE_ROOT_AGENT_ID)
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  assert.equal(conversationStoreModule.useConversationUiStore.getState().scopes[scopeId], undefined)
})

test("Frozen plan: lifecycle, interrupted and visible tool results are Conversation-only", () => {
  setupScene()
  const coordinator = coordinatorModule.chatEventCoordinator
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [
    { seq: 303, type: "agent.lifecycle.message", message_id: "life-1", stream_id: "stream-1", created_at: "2026-07-20T12:00:00.000Z", payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, frontend_message: { text: "Lifecycle", text_format: "plain_text", channel: "web" }, requires_user_response: false, interaction_state: "none", loop_control: { decision: "continue" } }, metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID } },
    { seq: 304, type: "agent.execution.interrupted", message_id: "interrupt-1", stream_id: "stream-1", created_at: "2026-07-20T12:00:01.000Z", payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, task_id: "task-1", error_type: "cancelled", error_message: "stop", resumable: false, retryable: false }, metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID } },
    { seq: 305, type: "tool.call.completed", message_id: "tool-result-1", stream_id: "stream-1", created_at: "2026-07-20T12:00:02.000Z", payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, tool_call_id: "tool-1", tool_name: "web_search", success: true, execution_status: "completed", loop_decision: "continue", result_preview: "<article>result</article>", ui_preview: { html_content: "<article>result</article>" } }, metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID } },
  ], FIXTURE_ROOT_AGENT_ID)
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const messages = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId].messages
  assert.ok(messages.some((message) => message.id === "life-1"))
  assert.ok(messages.some((message) => message.id === "interrupt-1"))
  assert.ok(messages.some((message) => message.id === "user-visible-tool-result-tool-1"))
  assert.equal(timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId], undefined)
})

test("Frozen plan: terminal event does not enter either chat UI store", () => {
  setupScene()
  const coordinator = coordinatorModule.chatEventCoordinator
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [{ seq: 306, type: "terminal.created", message_id: "terminal-1", stream_id: "stream-1", created_at: "2026-07-20T12:00:00.000Z", payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, terminal_id: "term-1", tool_call_id: "tool-1", command_line: "echo hi", cwd: ".", shell: "powershell" }, metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID } }], FIXTURE_ROOT_AGENT_ID)
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  assert.equal(conversationStoreModule.useConversationUiStore.getState().scopes[scopeId], undefined)
  assert.equal(timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId], undefined)
})

test("Regression: historical conversation baseline hydration with old communication_seq does not poison stream watermark", () => {
  setupScene()
  const coordinator = coordinatorModule.chatEventCoordinator
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)

  // 1. 模拟重启：resetSceneTransportGeneration 将流状态置为初始态
  coordinator.resetSceneTransportGeneration(FIXTURE_SCENE_ID, { streamId: "stream-restarted-1" })

  // 2. 水合历史气泡：历史气泡中包含上一代会话累积的高位 communication_seq（如 264）
  const gen = coordinator.beginHydration(scopeId)
  coordinator.dispatchBaselineHydration(FIXTURE_SCENE_ID, [{
    agentInstanceId: FIXTURE_ROOT_AGENT_ID,
    bubbles: [{
      bubble_id: "historical-bubble-1",
      scene_id: FIXTURE_SCENE_ID,
      agent_instance_id: FIXTURE_ROOT_AGENT_ID,
      task_id: "historical-task-1",
      conversation_id: "historical-conv-1",
      role: "agent",
      status: "completed",
      text: "Historical response",
      text_format: "plain_text",
      channel: "web",
      client_message_id: null,
      backend_message_id: "msg-old-1",
      pending_message_id: null,
      interaction_options: [],
      interaction_state: "none",
      selected_option_id: null,
      sort_order: 48,
      created_at: "2026-07-20T10:00:00.000Z",
      updated_at: "2026-07-20T10:00:00.000Z",
      metadata: {
        communication_seq: 264,
      },
    }],
  }], gen, FIXTURE_ROOT_AGENT_ID, "hot", { maxSeq: 0 })

  // 核心断言 1：历史气泡的 264 绝不能将作用域流水位设为 264，它必须保持当前流的水位 0！
  const watermark = coordinator.getScopeWatermark(scopeId)
  assert.equal(watermark.lastAppliedSceneSeq, 0, "scope watermark must remain 0 from current stream cursor, not 264")
  assert.equal(watermark.lastSortOrder, 48, "sort order must still be tracked from bubbles")

  // 3. 重启后后端新一轮任务的流事件到达（seq 从 1 开始）
  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [
    {
      seq: 1,
      type: "llm.request.started",
      message_id: "llm-req-1",
      stream_id: "stream-restarted-1",
      created_at: "2026-07-20T10:05:00.000Z",
      payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, round: 2 },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    },
    {
      seq: 2,
      type: "agent.assistant.message.received",
      message_id: "asst-msg-new-1",
      stream_id: "stream-restarted-1",
      created_at: "2026-07-20T10:05:01.000Z",
      payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, text: "New answer after restart", frontend_message: { text: "New answer after restart", text_format: "markdown" } },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    },
  ], FIXTURE_ROOT_AGENT_ID)

  // 核心断言 2：右侧时间线与左侧会话均成功接收并投影新流的 seq 1 和 seq 2！
  assert.equal(coordinator.getScopeWatermark(scopeId).lastAppliedSceneSeq, 2, "watermark must advance to 2")
  const convState = conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  assert.ok(convState, "conversation scope must exist")
  assert.ok(convState.messages.some((m) => m.id === "asst-msg-new-1"), "left-side new assistant message must be displayed")
  const timelineState = timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]
  assert.ok(timelineState, "timeline scope must exist")
  assert.ok(timelineState.allBlocks.length > 0, "right-side timeline blocks must be updated with new execution")
})

test("Infinite prepend scroll: prependMessages expands visible messages, keeps stable sort order, and does not affect timelineStore", async () => {
  setupScene(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID)
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const getConvState = () => conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]
  const getTimeState = () => timelineStoreModule.useTimelineUiStore.getState().scopes[scopeId]

  // 1. 初始水合 100 条消息（sort_order 101 到 200）
  const initialMessages = Array.from({ length: 100 }, (_, i) => ({
    id: `msg-${101 + i}`,
    role: "agent",
    createdAt: new Date(1700000000000 + (101 + i) * 1000).toISOString(),
    status: "completed",
    content: {
      text: `Message ${101 + i}`,
      text_format: "plain_text",
      channel: "web",
      metadata: { chat_bubble_sort_order: 101 + i },
    },
  }))
  conversationStoreModule.useConversationUiStore.getState().hydrateScope(
    scopeId,
    FIXTURE_SCENE_ID,
    FIXTURE_ROOT_AGENT_ID,
    initialMessages,
    [],
    null,
    "hot",
  )

  let state = getConvState()
  assert.ok(state, "conversation scope must exist")
  assert.equal(state.messages.length, 100)
  assert.equal(state.visibleMessages.length, 100)
  assert.equal(state.hiddenConversationMessageCount, 0)
  assert.equal(state.hasMorePrevious, true)
  assert.equal(state.isLoadingPrevious, false)

  // 2. 向上加载 30 条更早的消息（sort_order 71 到 100）
  const olderMessages = Array.from({ length: 30 }, (_, i) => ({
    id: `msg-${71 + i}`,
    role: "agent",
    createdAt: new Date(1700000000000 + (71 + i) * 1000).toISOString(),
    status: "completed",
    content: {
      text: `Older Message ${71 + i}`,
      text_format: "plain_text",
      channel: "web",
      metadata: { chat_bubble_sort_order: 71 + i },
    },
  }))

  conversationStoreModule.useConversationUiStore.getState().setLoadingPrevious(scopeId, true)
  assert.equal(getConvState().isLoadingPrevious, true)

  conversationStoreModule.useConversationUiStore.getState().prependMessages(
    scopeId,
    FIXTURE_SCENE_ID,
    FIXTURE_ROOT_AGENT_ID,
    olderMessages,
    true,
    "hot",
  )
  state = getConvState()

  // 断言：总消息 130 条，全部可见（没有被 100 条硬切断），第一条为最早的消息
  assert.equal(state.messages.length, 130)
  assert.equal(state.visibleMessages.length, 130)
  assert.equal(state.hiddenConversationMessageCount, 0)
  assert.equal(state.isLoadingPrevious, false)
  assert.equal(state.hasMorePrevious, true)
  assert.equal(state.messages[0].id, "msg-71")
  assert.equal(state.messages[129].id, "msg-200")

  // 3. 再次加载更早的 10 条，且没有更多历史了（hasMore = false）
  const oldestMessages = Array.from({ length: 10 }, (_, i) => ({
    id: `msg-${61 + i}`,
    role: "agent",
    createdAt: new Date(1700000000000 + (61 + i) * 1000).toISOString(),
    status: "completed",
    content: {
      text: `Oldest Message ${61 + i}`,
      text_format: "plain_text",
      channel: "web",
      metadata: { chat_bubble_sort_order: 61 + i },
    },
  }))
  conversationStoreModule.useConversationUiStore.getState().prependMessages(
    scopeId,
    FIXTURE_SCENE_ID,
    FIXTURE_ROOT_AGENT_ID,
    oldestMessages,
    false,
    "hot",
  )
  state = getConvState()

  assert.equal(state.messages.length, 140)
  assert.equal(state.visibleMessages.length, 140)
  assert.equal(state.hasMorePrevious, false)
  assert.equal(state.messages[0].id, "msg-61")

  // 核心断言 4：右侧 Timeline 状态完全未受影响，保持独立隔离！
  const timelineState = getTimeState()
  assert.equal(timelineState, undefined, "timelineStore must remain untouched by conversation prepend")
})

test("Anchor rail: buildConversationItemScrollMapPositions correctly distributes user message positions from 0% to 100% across prepended messages", () => {
  const { buildConversationItemScrollMapPositions } = messageListModule

  // 模拟长会话：130 条消息（历史追加 30 条 + 原有 100 条）
  const itemCount = 130
  const viewportHeight = 800
  // 每条消息大约 100px 高度，sizeRanges 为 Virtuoso getState().ranges 的标准 0-based 结构
  const itemSizes = Array.from({ length: itemCount }, (_, i) => 100 + (i % 5) * 20)
  const sizeRanges = itemSizes.map((size, index) => ({
    startIndex: index,
    endIndex: index,
    size,
  }))
  // 加上尾部开区间 range（Virtuoso 标准格式）
  sizeRanges.push({ startIndex: itemCount, endIndex: Infinity, size: 100 })
  const totalListHeight = itemSizes.reduce((a, b) => a + b, 0) + 40 // 含 40px 头部

  const positions = buildConversationItemScrollMapPositions(
    itemCount,
    sizeRanges,
    totalListHeight,
    viewportHeight,
  )

  assert.equal(positions.length, 130)
  // 最顶部消息（第 0 条）应当位于最顶部 0%
  assert.equal(positions[0], 0)
  // 中间消息应当均匀落在中位（约 50%），绝不应该被挤压到 70% 以后！
  assert.ok(positions[65] >= 45 && positions[65] <= 55, `Mid position should be ~50%, got ${positions[65]}`)
  // 最底部消息应当位于 100%
  assert.equal(positions[129], 100)
})

test("Scroll stability: hot appendMessages preserves visible window head and monotonically increases visibleMessages.length past 100", () => {
  setupScene()
  const scopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const getConvState = () => conversationStoreModule.useConversationUiStore.getState().scopes[scopeId]

  // 1. 水合 150 条会话消息（sort_order 1 到 150），默认展示尾部 100 条（msg-51 到 msg-150），隐藏头部 50 条
  const initialMessages = Array.from({ length: 150 }, (_, i) => ({
    id: `msg-${1 + i}`,
    role: i % 2 === 0 ? "user" : "agent",
    createdAt: new Date(1700000000000 + (1 + i) * 1000).toISOString(),
    status: "completed",
    content: {
      text: `Message ${1 + i}`,
      text_format: "markdown",
      channel: "web",
      metadata: { chat_bubble_sort_order: 1 + i },
    },
  }))
  conversationStoreModule.useConversationUiStore.getState().hydrateScope(
    scopeId,
    FIXTURE_SCENE_ID,
    FIXTURE_ROOT_AGENT_ID,
    initialMessages,
    [],
    null,
    "hot",
  )

  let state = getConvState()
  assert.equal(state.visibleMessages.length, 100)
  assert.equal(state.hiddenConversationMessageCount, 50)
  assert.equal(state.visibleMessages[0].id, "msg-51")
  assert.equal(state.visibleMessages[99].id, "msg-150")

  // 2. 尾部实时追加普通正文 Markdown 气泡与 task_boundary 气泡（msg-151, msg-152）
  const appendedMessages = [
    {
      id: "msg-151",
      role: "agent",
      createdAt: new Date(1700000000000 + 151 * 1000).toISOString(),
      status: "completed",
      content: {
        text: "# 新增普通正文气泡\n\n多段 Markdown 内容",
        text_format: "markdown",
        channel: "web",
        metadata: { chat_bubble_sort_order: 151 },
      },
    },
    {
      id: "msg-152",
      role: "agent",
      createdAt: new Date(1700000000000 + 152 * 1000).toISOString(),
      status: "completed",
      content: {
        text: "任务完成",
        text_format: "plain_text",
        channel: "web",
        metadata: { bubble_kind: "task_boundary", chat_bubble_sort_order: 152 },
      },
    },
  ]
  conversationStoreModule.useConversationUiStore.getState().appendMessages(
    scopeId,
    FIXTURE_SCENE_ID,
    FIXTURE_ROOT_AGENT_ID,
    appendedMessages,
    "hot",
  )

  state = getConvState()
  // 核心断言：窗口首项绝不能被挤掉（仍为 msg-51），visibleMessages 长度单调递增为 102，隐藏数仍为 50
  assert.equal(state.visibleMessages.length, 102)
  assert.equal(state.hiddenConversationMessageCount, 50)
  assert.equal(state.visibleMessages[0].id, "msg-51")
  assert.equal(state.visibleMessages[100].id, "msg-151")
  assert.equal(state.visibleMessages[101].id, "msg-152")
})

test("Scroll stability: resolveNextConversationFirstItemIndex and shouldMaintainConversationBottomLock enforce stick-to-bottom and history reading lock", () => {
  const {
    resolveNextConversationFirstItemIndex,
    shouldMaintainConversationBottomLock,
  } = messageListModule

  const makeMsg = (id, sortOrder) => ({
    id,
    role: "agent",
    createdAt: new Date(1700000000000 + sortOrder * 1000).toISOString(),
    status: "completed",
    content: {
      text: `Msg ${id}`,
      text_format: "markdown",
      channel: "web",
      metadata: { chat_bubble_sort_order: sortOrder },
    },
  })

  const baseList = [makeMsg("m-10", 10), makeMsg("m-11", 11)]
  const tailAppendedList = [...baseList, makeMsg("m-12", 12)]
  const prependedList = [makeMsg("m-8", 8), makeMsg("m-9", 9), ...tailAppendedList]

  // 尾部追加消息时 firstItemIndex 保持不变
  assert.equal(
    resolveNextConversationFirstItemIndex(100_000, baseList, tailAppendedList, false),
    100_000,
  )
  // 顶部 prepend 2 条可渲染消息时，firstItemIndex 精确减 2
  assert.equal(
    resolveNextConversationFirstItemIndex(100_000, tailAppendedList, prependedList, false),
    99_998,
  )
  // 切换 scope 时重置为 100_000
  assert.equal(
    resolveNextConversationFirstItemIndex(99_998, prependedList, baseList, true),
    100_000,
  )

  // 场景 A：用户在最底部附近（wasLockedAtBottom = true），大高度 Markdown 气泡撑高导致 reportedAtBottom 瞬时变为 false，
  // 且无用户主动上滚输入 -> 保持贴底锁定并触发跟随到底部
  assert.deepEqual(
    shouldMaintainConversationBottomLock({
      wasLockedAtBottom: true,
      reportedAtBottom: false,
      hasRecentUserUpwardInput: false,
      isScopeRestoring: false,
    }),
    {
      nextLockedAtBottom: true,
      shouldFollowToBottom: true,
    },
  )

  // 场景 B：用户主动向上滚动浏览历史（hasRecentUserUpwardInput = true，reportedAtBottom = false） -> 立即解除贴底锁定，不强制拉回底部
  assert.deepEqual(
    shouldMaintainConversationBottomLock({
      wasLockedAtBottom: true,
      reportedAtBottom: false,
      hasRecentUserUpwardInput: true,
      isScopeRestoring: false,
    }),
    {
      nextLockedAtBottom: false,
      shouldFollowToBottom: false,
    },
  )

  // 场景 C：用户已在浏览历史消息（wasLockedAtBottom = false），新消息到来 -> 保持非贴底锁定，绝不强制滚动到底部
  assert.deepEqual(
    shouldMaintainConversationBottomLock({
      wasLockedAtBottom: false,
      reportedAtBottom: false,
      hasRecentUserUpwardInput: false,
      isScopeRestoring: false,
    }),
    {
      nextLockedAtBottom: false,
      shouldFollowToBottom: false,
    },
  )
})

test("generate_image request preview resolves local image_paths and mask_path to local-image content endpoint", async () => {
  const userVisibleModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/userVisibleToolResults.ts")
  const localPath = "G:\\project\\DDD_demo\\.ui-memory\\images\\live-core-flow.png"
  const maskPath = "G:\\project\\DDD_demo\\.ui-memory\\images\\mask.png"

  const preview = userVisibleModule.buildImageGenerationRequestPreview({
    prompt: "Redesign desktop board",
    image_urls: ["https://example.com/ref.png"],
    image_paths: [localPath],
    mask_path: maskPath,
  })
  assert.ok(preview)
  assert.equal(preview.resources.length, 3)
  assert.equal(preview.resources[0].field, "image_urls")
  assert.equal(preview.resources[0].displayUrl, "https://example.com/ref.png")
  assert.equal(preview.resources[1].field, "image_paths")
  assert.equal(preview.resources[1].value, localPath)
  assert.equal(
    preview.resources[1].displayUrl,
    `/api/file-resources/local-image/content?path=${encodeURIComponent(localPath)}`,
  )
  assert.equal(preview.resources[2].field, "mask_path")
  assert.equal(preview.resources[2].value, maskPath)
  assert.equal(
    preview.resources[2].displayUrl,
    `/api/file-resources/local-image/content?path=${encodeURIComponent(maskPath)}`,
  )

  // 验证历史已持久化气泡（storedResources 中 displayUrl 为 null）也能自动解析出 displayUrl
  const historicalParsed = userVisibleModule.parseUserVisibleToolResult({
    id: "user-visible-tool-result-img-1",
    role: "agent",
    createdAt: "2026-09-27T11:20:00.000Z",
    status: "completed",
    content: {
      text: "generate_image 图片生成结果",
      text_format: "plain_text",
      channel: "web",
      metadata: {
        bubble_kind: "user_visible_tool_result",
        result_kind: "image_generation",
        tool_call_id: "img-1",
        tool_name: "generate_image",
        title: "generate_image",
        ui_preview: {
          ui_kind: "image_generation",
          resources: [{ resource_id: "res-1", mime_type: "image/png" }],
        },
        image_request: {
          prompt: "Redesign desktop board",
          resources: [{
            field: "image_paths",
            label: "图片路径",
            value: localPath,
            displayUrl: null,
          }],
        },
      },
    },
  })
  assert.ok(historicalParsed)
  assert.equal(historicalParsed.imageRequestResources.length, 1)
  assert.equal(historicalParsed.imageRequestResources[0].value, localPath)
  assert.equal(
    historicalParsed.imageRequestResources[0].displayUrl,
    `/api/file-resources/local-image/content?path=${encodeURIComponent(localPath)}`,
  )
})

test("Regression: subagent creation and user.message.accepted without optimistic message does not block subsequent parent or subagent events", () => {
  setupScene()
  const coordinator = coordinatorModule.chatEventCoordinator
  const rootScopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, FIXTURE_ROOT_AGENT_ID, FIXTURE_ROOT_AGENT_ID)
  const childAgentId = "child-backend-design-1"
  const childScopeId = scopeModule.chatAgentRuntimeScopeId(FIXTURE_SCENE_ID, childAgentId, FIXTURE_ROOT_AGENT_ID)

  coordinator.dispatchLiveEvents(FIXTURE_SCENE_ID, [
    {
      seq: 312,
      type: "llm.request.started",
      message_id: "parent-llm-27",
      stream_id: "stream-1",
      created_at: "2026-07-20T11:59:59.000Z",
      payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, round: 27 },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    },
    {
      seq: 313,
      type: "tool.call.started",
      message_id: "parent-create-subagent-start",
      stream_id: "stream-1",
      created_at: "2026-07-20T12:00:00.000Z",
      payload: {
        agent_instance_id: FIXTURE_ROOT_AGENT_ID,
        round: 27,
        tool_call_id: "call_create_subagent",
        tool_name: "create_subagent",
        execution_status: "running",
      },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    },
    {
      seq: 314,
      type: "agent.subagent.created",
      message_id: "subagent-created-1",
      stream_id: "stream-1",
      created_at: "2026-07-20T12:00:01.000Z",
      payload: {
        relation_id: "rel-1",
        task_id: "task-1",
        parent_agent_instance_id: FIXTURE_ROOT_AGENT_ID,
        child_agent_instance_id: childAgentId,
        created_at: "2026-07-20T12:00:01.000Z",
        released: false,
        agent_instance: {
          instance_id: childAgentId,
          task_id: "task-1",
          thread_id: "thread-child-1",
          current_working_directory: ".",
          agent_definition_id: "backend-design",
          llm_policy_group_id: null,
          llm_provider_id: "p1",
          llm_model_binding_id: "m1",
          conversation_id: "conv-child-1",
          trace_id: "tr-1",
          status: "ready",
          pending_user_message_count: 0,
          pending_user_messages: [],
          created_at: "2026-07-20T12:00:01.000Z",
          updated_at: "2026-07-20T12:00:01.000Z",
        },
      },
      metadata: { agent_instance_id: childAgentId },
    },
    {
      seq: 318,
      type: "user.message.accepted",
      message_id: "child-initial-prompt-msg",
      stream_id: "stream-1",
      created_at: "2026-07-20T12:00:02.000Z",
      payload: {
        agent_instance_id: childAgentId,
        text: "Design the backend architecture",
        channel: "subagent",
        metadata: { source_type: "local_agent", transport: "subagent" },
      },
      metadata: { agent_instance_id: childAgentId, source_type: "local_agent", transport: "subagent" },
    },
    {
      seq: 325,
      type: "tool.call.completed",
      message_id: "parent-create-subagent-done",
      stream_id: "stream-1",
      created_at: "2026-07-20T12:00:03.000Z",
      payload: {
        agent_instance_id: FIXTURE_ROOT_AGENT_ID,
        round: 27,
        tool_call_id: "call_create_subagent",
        tool_name: "create_subagent",
        success: true,
        execution_status: "completed",
        loop_decision: "continue",
        result_preview: "Created subagent child-backend-design-1",
      },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    },
    {
      seq: 332,
      type: "agent.lifecycle.message",
      message_id: "parent-message-user-table",
      stream_id: "stream-1",
      created_at: "2026-07-20T12:00:04.000Z",
      payload: {
        agent_instance_id: FIXTURE_ROOT_AGENT_ID,
        lifecycle_action: "message_user",
        frontend_message: { text: "<table><tr><td>Subagent status</td></tr></table>", text_format: "html", channel: "web" },
        requires_user_response: false,
        interaction_state: "none",
        loop_control: { decision: "continue" },
      },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    },
    {
      seq: 335,
      type: "llm.request.started",
      message_id: "parent-llm-29",
      stream_id: "stream-1",
      created_at: "2026-07-20T12:00:04.500Z",
      payload: { agent_instance_id: FIXTURE_ROOT_AGENT_ID, round: 29 },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    },
    {
      seq: 336,
      type: "tool.call.started",
      message_id: "parent-pause-task-start",
      stream_id: "stream-1",
      created_at: "2026-07-20T12:00:05.000Z",
      payload: {
        agent_instance_id: FIXTURE_ROOT_AGENT_ID,
        round: 29,
        tool_call_id: "call_pause_task",
        tool_name: "pause_task",
        execution_status: "running",
      },
      metadata: { agent_instance_id: FIXTURE_ROOT_AGENT_ID },
    },
    {
      seq: 340,
      type: "llm.request.started",
      message_id: "child-llm-1",
      stream_id: "stream-1",
      created_at: "2026-07-20T12:00:06.000Z",
      payload: { agent_instance_id: childAgentId, round: 1 },
      metadata: { agent_instance_id: childAgentId },
    },
  ], FIXTURE_ROOT_AGENT_ID)

  assert.equal(coordinator.getScopeWatermark(childScopeId).lastAppliedSceneSeq, 340, "child watermark must advance through seq 340")
  assert.equal(coordinator.getScopeWatermark(rootScopeId).lastAppliedSceneSeq, 336, "root watermark must advance through seq 336")

  const childConv = conversationStoreModule.useConversationUiStore.getState().scopes[childScopeId]
  assert.ok(childConv, "child conversation scope must exist")
  const childAcceptedMsg = childConv.messages.find((m) => m.id === "child-initial-prompt-msg")
  assert.ok(childAcceptedMsg, "child accepted initial prompt must be projected")
  assert.equal(childAcceptedMsg.role, "local_agent")
  assert.equal(childAcceptedMsg.status, "accepted")

  const rootConv = conversationStoreModule.useConversationUiStore.getState().scopes[rootScopeId]
  assert.ok(rootConv, "root conversation scope must exist")
  assert.ok(rootConv.messages.some((m) => m.id === "parent-message-user-table"), "parent message_user table after subagent creation must be displayed")

  const rootTimeline = timelineStoreModule.useTimelineUiStore.getState().scopes[rootScopeId]
  assert.ok(rootTimeline, "root timeline scope must exist")
  const allRootTools = rootTimeline.allBlocks.flatMap((b) => b.iteration?.tools ?? [])
  const createSubagentTool = allRootTools.find((t) => t.toolCallId === "call_create_subagent")
  const pauseTaskTool = allRootTools.find((t) => t.toolCallId === "call_pause_task")
  assert.ok(createSubagentTool, "create_subagent tool must exist in root timeline")
  assert.equal(createSubagentTool.status, "completed", "create_subagent tool must be completed, not stuck running")
  assert.ok(pauseTaskTool, "subsequent pause_task tool call must be displayed in root timeline")

  const childTimeline = timelineStoreModule.useTimelineUiStore.getState().scopes[childScopeId]
  assert.ok(childTimeline, "child timeline scope must exist")
  assert.ok(childTimeline.allBlocks.length > 0, "child LLM timeline blocks must be projected")
})

test("MessageContent: transforms file:/// image paths into local-image content endpoint and resolves local file paths", () => {
  const { resolveLocalFilePath, resolveLocalImageSrc, transformHtmlDocumentImages } = messageContentModule

  // 1. file:/// 协议与 Windows 路径解析
  const sampleFileUri = "file:///G:/project/DDD_demo/.ui-memory/images/live-desktop-default.png"
  const resolvedPath = resolveLocalFilePath(sampleFileUri)
  assert.equal(resolvedPath, "G:\\project\\DDD_demo\\.ui-memory\\images\\live-desktop-default.png")

  // 2. 本地图片转换为代理 API
  const localImageSrc = resolveLocalImageSrc(sampleFileUri)
  assert.ok(localImageSrc, "localImageSrc should be resolved")
  assert.match(localImageSrc, /^\/api\/file-resources\/local-image\/content\?path=/)
  assert.ok(localImageSrc.includes("live-desktop-default.png"))

  // 3. Web URL 不被错误转换
  assert.equal(resolveLocalImageSrc("https://example.com/demo.png"), null)
  assert.equal(resolveLocalImageSrc("data:image/png;base64,xxxx"), null)

  // 4. HTML fragment 批量替换测试（完整模拟用户消息）
  const sampleHtml = '<p>设计稿：</p><figure><img src="file:///G:/project/DDD_demo/.ui-memory/images/live-desktop-default.png" alt="PC 默认态"><figcaption>说明</figcaption></figure>'
  const transformed = transformHtmlDocumentImages(sampleHtml)
  assert.ok(!transformed.includes("src=\"file:///"), "must not contain raw file:/// src")
  assert.ok(transformed.includes('src="/api/file-resources/local-image/content?path='), "must contain local-image content proxy endpoint")
  assert.ok(transformed.includes('alt="PC 默认态"'), "must preserve alt attribute")
  assert.ok(transformed.includes('<figcaption>说明</figcaption>'), "must preserve other tags")

  // 5. 本地非图片文件路径解析
  const nonImageUri = "file:///G:/project/DDD_demo/README.md"
  const resolvedNonImagePath = resolveLocalFilePath(nonImageUri)
  assert.equal(resolvedNonImagePath, "G:\\project\\DDD_demo\\README.md")
})


