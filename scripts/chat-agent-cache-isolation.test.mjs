import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { after, before, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const chatPageSource = readFileSync(path.join(projectRoot, "src/features/chat/components/ChatPage.tsx"), "utf8")

let viteServer
let storeModule
let projectionModule
let runtimeConfigModule
let messageListHydrationModule
let runtimeApiModule
let rehydrationModule

before(async () => {
  viteServer = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  })
  storeModule = await viteServer.ssrLoadModule("/src/features/chat/model/chatStore.ts")
  projectionModule = await viteServer.ssrLoadModule("/src/features/chat/model/agentUiProjection.ts")
  runtimeConfigModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/runtimeConfig.ts")
  messageListHydrationModule = await viteServer.ssrLoadModule("/src/features/chat/model/messageListHydration.ts")
  runtimeApiModule = await viteServer.ssrLoadModule("/src/features/chat/api/agentRuntimeApi.ts")
  rehydrationModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/agentScopedChatBubbleRehydration.ts")
})

beforeEach(() => {
  storeModule.useChatStore.getState().clearAllScenes()
})

after(async () => {
  await viteServer?.close()
})

test("terminal and ChatBubble REST clients require and route explicit Agent owner", async (t) => {
  const originalFetch = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input)
    calls.push({ url, method: init.method ?? "GET" })
    const body = url.includes("/chat-bubbles")
      ? { messages: [], limit: 100, before_sort_order: null }
      : url.includes("/output")
        ? {
            terminal_id: "shared-terminal",
            command_id: null,
            status: "idle",
            text: "",
            chunks_returned: 0,
            truncated: false,
            start_chunk_index: null,
            end_chunk_index: null,
            next_chunk_index: null,
            has_more: false,
          }
        : url.endsWith("/terminals?workspace_path=D%3A%2Fworkspace&agent_instance_id=agent-child")
          ? []
          : {}
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }
  t.after(() => { globalThis.fetch = originalFetch })

  await runtimeApiModule.listSceneTerminals("scene-owner-api", "D:/workspace", "agent-child")
  await runtimeApiModule.readSceneTerminalOutput("scene-owner-api", "shared-terminal", {
    workspace_path: "D:/workspace",
    agent_instance_id: "agent-child",
    mode: "tail",
  })
  await runtimeApiModule.deleteSceneTerminal("scene-owner-api", "shared-terminal", "D:/workspace", "agent-child")
  await runtimeApiModule.listSceneChatBubbles("scene-owner-api", {
    limit: 100,
    agent_instance_id: "agent-child",
  })

  assert.equal(calls.length, 4)
  for (const call of calls) {
    const url = new URL(call.url, "http://runtime.local")
    assert.equal(url.searchParams.get("agent_instance_id"), "agent-child")
  }
  assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "DELETE", "GET"])
  assert.throws(
    () => runtimeApiModule.listSceneTerminals("scene-owner-api", "D:/workspace", "  "),
    /agent_instance_id is required/,
  )
  assert.throws(
    () => runtimeApiModule.listSceneChatBubbles("scene-owner-api", { limit: 100, agent_instance_id: "" }),
    /agent_instance_id is required/,
  )
  assert.equal(calls.length, 4, "blank owner must be rejected before any REST request")
})

test("MessageList separates all recovery states from authoritative ready-empty", () => {
  const ready = messageListHydrationModule.messageListHydrationPresentation("ready")
  const hydrating = messageListHydrationModule.messageListHydrationPresentation("hydrating")
  const needsHydration = messageListHydrationModule.messageListHydrationPresentation("needs_hydration")
  const failed = messageListHydrationModule.messageListHydrationPresentation("failed")

  assert.equal(ready.isReadyEmpty, true)
  assert.equal(ready.title, "Send your first message")
  assert.equal(hydrating.isReadyEmpty, false)
  assert.equal(hydrating.title, "正在恢复历史记录")
  assert.equal(needsHydration.isReadyEmpty, false)
  assert.equal(needsHydration.title, "等待恢复历史记录")
  assert.equal(failed.isReadyEmpty, false)
  assert.equal(failed.isFailure, true)
  assert.equal(failed.title, "历史记录恢复失败")
  assert.deepEqual(
    new Set([hydrating.state, needsHydration.state, failed.state]),
    new Set(["hydrating", "needs_hydration", "failed"]),
  )
})

function agentInstance(instanceId, definitionId) {
  return {
    instance_id: instanceId,
    agent_definition_id: definitionId,
    status: "running",
    released: false,
    pending_user_message_count: 0,
    pending_user_messages: [],
  }
}

function chatBubble({ id, sortOrder, seq, createdAt, text, agentInstanceId }) {
  return {
    bubble_id: id,
    scene_id: "fixture-scene",
    agent_instance_id: agentInstanceId,
    task_id: null,
    conversation_id: null,
    role: "agent",
    status: "completed",
    text,
    text_format: "markdown",
    channel: "web",
    client_message_id: null,
    backend_message_id: null,
    pending_message_id: null,
    interaction_options: [],
    interaction_state: "none",
    selected_option_id: null,
    sort_order: sortOrder,
    created_at: createdAt,
    updated_at: createdAt,
    metadata: {
      bubble_kind: "agent_result",
      communication_message_id: `event-${seq}`,
      communication_seq: seq,
    },
  }
}

function agentEvent({ id, seq, type, agentInstanceId, payload = {} }) {
  return {
    message_id: id,
    stream_id: "stream-1",
    seq,
    type,
    correlation_id: null,
    causation_id: null,
    parent_message_id: null,
    payload,
    metadata: agentInstanceId ? { agent_instance_id: agentInstanceId } : {},
    created_at: new Date().toISOString(),
    schema_version: "1",
  }
}

function openMultiAgentScene(sceneId, rootAgentId, childAgentIds) {
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, sceneId)
  store.getState().setRootAgentInstanceId(sceneId, rootAgentId)
  store.getState().setSceneAgentInventory(
    sceneId,
    [
      agentInstance(rootAgentId, "Software-Engineering"),
      ...childAgentIds.map((id, index) => agentInstance(id, `Child-${index}`)),
    ],
    [],
    rootAgentId,
    rootAgentId,
  )
  return store
}

function hydrateAgentBubbles(store, sceneId, agentInstanceId, count, startSortOrder) {
  const bubbles = Array.from({ length: count }, (_, index) => chatBubble({
    id: `${agentInstanceId}-msg-${index + 1}`,
    sortOrder: startSortOrder + index,
    seq: startSortOrder + index,
    createdAt: new Date(Date.UTC(2026, 6, 17, 1, 0, index)).toISOString(),
    text: `${agentInstanceId} #${index + 1}`,
    agentInstanceId,
  }))
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId,
    bubbles,
  }], { mode: "baseline" })
}

test("scene switch to warm must not wipe root agent messages while later agents remain", () => {
  const sceneA = "scene-a-root-preserve"
  const sceneB = "scene-b-background"
  const rootAgentId = "agent-se-root"
  const childAgentIds = ["agent-dev-1", "agent-ops-1", "agent-dev-2", "agent-req-1", "agent-dev-3"]
  const store = openMultiAgentScene(sceneA, rootAgentId, childAgentIds)

  // root first, then children — reproduces the old flatten order where root sits at the head.
  hydrateAgentBubbles(store, sceneA, rootAgentId, 12, 1)
  let sort = 100
  for (const childId of childAgentIds) {
    hydrateAgentBubbles(store, sceneA, childId, 30, sort)
    sort += 30
  }

  const beforeRoot = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneA],
    sceneA,
    rootAgentId,
  )
  assert.equal(beforeRoot.visibleMessages.length, 12)

  // Open another scene so scene A becomes warm and runs cache normalization.
  store.getState().openScene(sceneB, "Other scene")
  assert.notEqual(store.getState().activeSceneId, sceneA)

  const afterRoot = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneA],
    sceneA,
    rootAgentId,
  )
  assert.equal(
    afterRoot.visibleMessages.length,
    12,
    "root agent messages must survive warm scene cache normalization",
  )
  assert.equal(afterRoot.visibleIdentityKey, beforeRoot.visibleIdentityKey)

  for (const childId of childAgentIds) {
    const childProjection = projectionModule.buildAgentConversationProjection(
      store.getState().scenes[sceneA],
      sceneA,
      childId,
    )
    assert.equal(childProjection.visibleMessages.length, 30)
  }

  // Switch back: still no wipe.
  store.getState().setActiveScene(sceneA)
  const backRoot = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneA],
    sceneA,
    rootAgentId,
  )
  assert.equal(backRoot.visibleMessages.length, 12)
})

test("hot/warm limits apply per agent, not as a shared scene-wide quota", () => {
  const sceneId = "scene-per-agent-quota"
  const rootAgentId = "agent-root-quota"
  const heavyChildId = "agent-heavy-child"
  const store = openMultiAgentScene(sceneId, rootAgentId, [heavyChildId])

  const warmLimit = runtimeConfigModule.MAX_WARM_MESSAGES
  const hotLimit = runtimeConfigModule.MAX_HOT_MESSAGES

  hydrateAgentBubbles(store, sceneId, rootAgentId, 20, 1)
  // Child alone exceeds warm, and together with root exceeds old scene-global warm=100.
  hydrateAgentBubbles(store, sceneId, heavyChildId, warmLimit + 40, 1000)

  // Force warm normalization via another active scene.
  store.getState().openScene("scene-other-quota", "other")

  const rootProjection = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    rootAgentId,
  )
  const childProjection = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    heavyChildId,
  )

  assert.equal(rootProjection.visibleMessages.length, 20, "root must not be trimmed by child traffic")
  assert.equal(
    childProjection.visibleMessages.length,
    warmLimit,
    "only the overflowing agent is trimmed to its own warm limit",
  )

  // Active/hot path also trims only the overflowing agent.
  store.getState().setActiveScene(sceneId)
  hydrateAgentBubbles(store, sceneId, heavyChildId, hotLimit + 10, 5000)
  store.getState().applySceneCachePolicy()

  const rootHot = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    rootAgentId,
  )
  const childHot = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    heavyChildId,
  )
  assert.equal(rootHot.visibleMessages.length, 20)
  assert.ok(childHot.visibleMessages.length <= hotLimit)
})

test("cold eviction marks completed idle agent needs_hydration; running agent stays warm", () => {
  const sceneId = "scene-cold-evict"
  const rootAgentId = "agent-root-cold"
  const childAgentId = "agent-child-cold"
  const store = openMultiAgentScene(sceneId, rootAgentId, [childAgentId])

  hydrateAgentBubbles(store, sceneId, rootAgentId, 5, 1)
  hydrateAgentBubbles(store, sceneId, childAgentId, 5, 100)

  // completed + 久未查看 → 可 cold；running 仍应 warm pin。
  store.setState((state) => {
    const existing = state.scenes[sceneId]
    const now = Date.now()
    const agentRuntimeStates = { ...existing.agentRuntimeStates }
    const rootScope = `${sceneId}:${rootAgentId}`
    const childScope = `${sceneId}:${childAgentId}`
    agentRuntimeStates[rootScope] = {
      ...agentRuntimeStates[rootScope],
      lastViewedAt: now - runtimeConfigModule.COLD_AFTER_INACTIVE_MS - 1,
    }
    agentRuntimeStates[childScope] = {
      ...agentRuntimeStates[childScope],
      lastViewedAt: now - runtimeConfigModule.COLD_AFTER_INACTIVE_MS - 1,
    }
    return {
      scenes: {
        ...state.scenes,
        [sceneId]: {
          ...existing,
          cacheTier: "cold",
          lastActivatedAt: now - runtimeConfigModule.COLD_AFTER_INACTIVE_MS - 1,
          agentInstances: {
            ...existing.agentInstances,
            [rootAgentId]: { ...existing.agentInstances[rootAgentId], status: "completed" },
            // child remains running → should stay warm
          },
          agentRuntimeStates,
        },
      },
      activeSceneId: null,
    }
  })
  store.getState().applySceneCachePolicy()

  const scene = store.getState().scenes[sceneId]
  const rootState = scene.agentRuntimeStates[`${sceneId}:${rootAgentId}`]
  const childState = scene.agentRuntimeStates[`${sceneId}:${childAgentId}`]
  assert.equal(rootState.retainedMessageCount, 0)
  assert.equal(rootState.hydrationState, "needs_hydration")
  assert.ok(rootState.messageCount >= 5)
  assert.equal(childState.retainedMessageCount, 5, "running agent must not be cold-evicted")
  assert.notEqual(childState.hydrationState, "needs_hydration")

  // Scene is control-plane only; Agent-owned bodies must not exist as flat compatibility fields.
  for (const field of [
    "messages",
    "queuedUserMessages",
    "terminalSessions",
    "pendingInteraction",
    "messageCount",
    "retainedMessageCount",
  ]) {
    assert.equal(Object.hasOwn(scene, field), false, `Scene must not expose flat ${field}`)
  }
})

test("selected Agent changes drive targeted UI-cache hydration without rebuilding Scene SSE", () => {
  assert.match(
    chatPageSource,
    /rehydrateAgentsNeedingChatBubbles\(activeSceneId, activeAgentInstanceId\)/,
  )
  assert.match(
    chatPageSource,
    /\}, \[activeAgentInstanceId, activeSceneId, sceneCacheStateKeys\]\)/,
  )
  const wrapperStart = chatPageSource.indexOf("async function rehydrateAgentsNeedingChatBubbles(")
  const wrapperEnd = chatPageSource.indexOf("const activateScene", wrapperStart)
  assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart)
  const wrapperSource = chatPageSource.slice(wrapperStart, wrapperEnd)
  assert.match(wrapperSource, /rehydrateAgentChatBubbles\(sceneId, agentInstanceId/)
  assert.doesNotMatch(wrapperSource, /attachSceneMutation|restoreSceneCommunication/)
})

test("reopening a multi-Agent Scene hydrates only clicked cold children and keeps stale responses in their owner scope", async () => {
  const sceneId = "scene-reopen-targeted-child-hydration"
  const rootAgentId = "agent-reopen-root"
  const requirementsChildId = "agent-reopen-requirements"
  const operationsChildId = "agent-reopen-operations"
  const store = openMultiAgentScene(sceneId, rootAgentId, [requirementsChildId, operationsChildId])

  hydrateAgentBubbles(store, sceneId, rootAgentId, 2, 1)
  hydrateAgentBubbles(store, sceneId, requirementsChildId, 2, 100)
  hydrateAgentBubbles(store, sceneId, operationsChildId, 2, 200)
  store.setState((state) => {
    const scene = state.scenes[sceneId]
    const requirementsScopeId = `${sceneId}:${requirementsChildId}`
    const operationsScopeId = `${sceneId}:${operationsChildId}`
    return {
      scenes: {
        ...state.scenes,
        [sceneId]: {
          ...scene,
          agentInstances: {
            ...scene.agentInstances,
            [requirementsChildId]: { ...scene.agentInstances[requirementsChildId], status: "completed" },
            [operationsChildId]: { ...scene.agentInstances[operationsChildId], status: "completed" },
          },
          agentRuntimeStates: {
            ...scene.agentRuntimeStates,
            [requirementsScopeId]: { ...scene.agentRuntimeStates[requirementsScopeId], lastViewedAt: 0 },
            [operationsScopeId]: { ...scene.agentRuntimeStates[operationsScopeId], lastViewedAt: 0 },
          },
        },
      },
    }
  })
  store.getState().applySceneCachePolicy()

  const reopenedScene = store.getState().scenes[sceneId]
  for (const childAgentId of [requirementsChildId, operationsChildId]) {
    const childState = reopenedScene.agentRuntimeStates[`${sceneId}:${childAgentId}`]
    assert.equal(childState.uiCacheTier, "cold")
    assert.equal(childState.retainedMessageCount, 0)
    assert.equal(childState.hydrationState, "needs_hydration")
  }

  const createDeferred = () => {
    let resolve
    let reject
    const promise = new Promise((resolvePromise, rejectPromise) => {
      resolve = resolvePromise
      reject = rejectPromise
    })
    return { promise, resolve, reject }
  }
  const requirementsDeferred = createDeferred()
  const operationsDeferred = createDeferred()
  const deferredByAgent = {
    [requirementsChildId]: requirementsDeferred,
    [operationsChildId]: operationsDeferred,
  }
  const listCalls = []
  const dependencies = {
    getScene: (targetSceneId) => store.getState().scenes[targetSceneId],
    listChatBubbles: async (targetSceneId, targetAgentInstanceId) => {
      listCalls.push({ sceneId: targetSceneId, agentInstanceId: targetAgentInstanceId })
      return deferredByAgent[targetAgentInstanceId].promise
    },
    markHydrating: storeModule.markAgentScopesHydrating,
    beginHydration: () => 1,
    hydrate: (targetSceneId, batches, options) => {
      store.getState().hydrateSceneFromAgentBubbles(targetSceneId, batches, options)
      return true
    },
    cancelHydration: () => {},
    markFailed: storeModule.markAgentScopesHydrationFailed,
  }

  assert.equal(
    await rehydrationModule.rehydrateAgentChatBubbles(sceneId, rootAgentId, dependencies),
    "skipped",
  )
  assert.equal(listCalls.length, 0, "ready root must not trigger a history request")

  store.getState().selectAgentInstance(sceneId, requirementsChildId)
  const requirementsRequest = rehydrationModule.rehydrateAgentChatBubbles(
    sceneId,
    requirementsChildId,
    dependencies,
  )
  assert.deepEqual(listCalls.map((call) => call.agentInstanceId), [requirementsChildId])
  assert.equal(
    store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${requirementsChildId}`].hydrationState,
    "hydrating",
  )
  assert.equal(
    await rehydrationModule.rehydrateAgentChatBubbles(sceneId, requirementsChildId, dependencies),
    "skipped",
    "an in-flight target must not be requested twice",
  )
  assert.deepEqual(listCalls.map((call) => call.agentInstanceId), [requirementsChildId])

  store.getState().selectAgentInstance(sceneId, operationsChildId)
  const operationsRequest = rehydrationModule.rehydrateAgentChatBubbles(
    sceneId,
    operationsChildId,
    dependencies,
  )
  assert.deepEqual(
    listCalls.map((call) => call.agentInstanceId),
    [requirementsChildId, operationsChildId],
    "the second child must not be requested until it is explicitly selected",
  )

  const childHistory = (agentInstanceId, label, baseSortOrder) => {
    const conversation = chatBubble({
      id: `${label}-conversation`,
      sortOrder: baseSortOrder,
      seq: baseSortOrder,
      createdAt: new Date().toISOString(),
      text: `${label} restored conversation`,
      agentInstanceId,
    })
    const execution = {
      ...chatBubble({
        id: `${label}-execution`,
        sortOrder: baseSortOrder + 1,
        seq: baseSortOrder + 1,
        createdAt: new Date().toISOString(),
        text: `${label} restored execution`,
        agentInstanceId,
      }),
      metadata: { bubble_kind: "execution_process", execution_round: 1, iterations: [] },
    }
    return [conversation, execution]
  }
  const requirementsHistory = childHistory(requirementsChildId, "requirements", 300)
  const operationsHistory = childHistory(operationsChildId, "operations", 400)

  operationsDeferred.resolve({ messages: operationsHistory })
  assert.equal(await operationsRequest, "hydrated")
  let currentScene = store.getState().scenes[sceneId]
  const operationsConversation = projectionModule.buildAgentConversationProjection(
    currentScene,
    sceneId,
    operationsChildId,
  )
  const operationsTimeline = projectionModule.buildAgentTimelineProjection(
    currentScene,
    sceneId,
    operationsChildId,
  )
  assert.ok(operationsConversation.visibleMessages.some((message) => message.id === "operations-conversation"))
  assert.ok(operationsTimeline.messages.some((message) => message.id === "operations-execution"))
  assert.equal(
    await rehydrationModule.rehydrateAgentChatBubbles(sceneId, operationsChildId, dependencies),
    "skipped",
    "an already restored child must not be requested again",
  )

  requirementsDeferred.resolve({ messages: requirementsHistory })
  assert.equal(await requirementsRequest, "hydrated")
  currentScene = store.getState().scenes[sceneId]
  assert.equal(currentScene.selectedAgentInstanceId, operationsChildId)
  const requirementsMessages = projectionModule.buildAgentTimelineProjection(
    currentScene,
    sceneId,
    requirementsChildId,
  ).messages
  const operationsMessages = projectionModule.buildAgentTimelineProjection(
    currentScene,
    sceneId,
    operationsChildId,
  ).messages
  assert.ok(requirementsMessages.some((message) => message.id === "requirements-execution"))
  assert.ok(!requirementsMessages.some((message) => message.id === "operations-execution"))
  assert.ok(operationsMessages.some((message) => message.id === "operations-execution"))
  assert.ok(!operationsMessages.some((message) => message.id === "requirements-execution"))

  store.getState().selectAgentInstance(sceneId, requirementsChildId)
  assert.equal(
    await rehydrationModule.rehydrateAgentChatBubbles(sceneId, requirementsChildId, dependencies),
    "skipped",
    "returning to an already restored child must not repeat hydration",
  )
  assert.deepEqual(listCalls.map((call) => call.agentInstanceId), [requirementsChildId, operationsChildId])
})

test("targeted ChatBubble failure preserves retained data and only authoritative empty success becomes ready + 0", async () => {
  const sceneId = "scene-targeted-hydration-failure"
  const rootAgentId = "agent-failure-root"
  const childAgentId = "agent-failure-child"
  const store = openMultiAgentScene(sceneId, rootAgentId, [childAgentId])
  hydrateAgentBubbles(store, sceneId, childAgentId, 2, 10)
  store.getState().selectAgentInstance(sceneId, childAgentId)
  store.setState((state) => {
    const scene = state.scenes[sceneId]
    const scopeId = `${sceneId}:${childAgentId}`
    return {
      scenes: {
        ...state.scenes,
        [sceneId]: {
          ...scene,
          agentRuntimeStates: {
            ...scene.agentRuntimeStates,
            [scopeId]: { ...scene.agentRuntimeStates[scopeId], hydrationState: "failed" },
          },
        },
      },
    }
  })
  const beforeIds = store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${childAgentId}`].messages.map((message) => message.id)
  const baseDependencies = {
    getScene: (targetSceneId) => store.getState().scenes[targetSceneId],
    markHydrating: storeModule.markAgentScopesHydrating,
    beginHydration: () => 1,
    hydrate: (targetSceneId, batches, options) => {
      store.getState().hydrateSceneFromAgentBubbles(targetSceneId, batches, options)
      return true
    },
    cancelHydration: () => {},
    markFailed: storeModule.markAgentScopesHydrationFailed,
  }

  assert.equal(
    await rehydrationModule.rehydrateAgentChatBubbles(sceneId, childAgentId, {
      ...baseDependencies,
      listChatBubbles: async () => { throw new Error("history unavailable") },
    }),
    "failed",
  )
  let childState = store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${childAgentId}`]
  assert.equal(childState.hydrationState, "failed")
  assert.deepEqual(childState.messages.map((message) => message.id), beforeIds)

  assert.equal(
    await rehydrationModule.rehydrateAgentChatBubbles(sceneId, childAgentId, {
      ...baseDependencies,
      listChatBubbles: async () => ({ messages: [] }),
    }),
    "hydrated",
  )
  childState = store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${childAgentId}`]
  assert.equal(childState.hydrationState, "ready")
  assert.equal(childState.retainedMessageCount, 0)
  assert.equal(childState.messageCount, 0)
})

test("append and accept live events write agent ledger only; missing owner is dropped", () => {
  const sceneId = "scene-owner-routing"
  const rootAgentId = "agent-root-owner"
  const childAgentId = "agent-child-owner"
  const store = openMultiAgentScene(sceneId, rootAgentId, [childAgentId])

  storeModule.markAgentScopesHydrating(sceneId, [rootAgentId])
  const ownerlessHistory = chatBubble({
    id: "ownerless-history",
    sortOrder: 1,
    seq: 1,
    createdAt: new Date().toISOString(),
    text: "must be dropped",
    agentInstanceId: rootAgentId,
  })
  delete ownerlessHistory.agent_instance_id
  const mismatchedHistory = chatBubble({
    id: "mismatched-history",
    sortOrder: 2,
    seq: 2,
    createdAt: new Date().toISOString(),
    text: "must be dropped too",
    agentInstanceId: childAgentId,
  })
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: rootAgentId,
    bubbles: [ownerlessHistory],
  }], { mode: "baseline" })
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: null,
    bubbles: [chatBubble({
      id: "ownerless-batch",
      sortOrder: 3,
      seq: 3,
      createdAt: new Date().toISOString(),
      text: "must also be dropped",
      agentInstanceId: rootAgentId,
    })],
  }], { mode: "baseline" })
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: rootAgentId,
    bubbles: [mismatchedHistory],
  }], { mode: "baseline" })
  const afterInvalidHistory = store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${rootAgentId}`]
  assert.equal(afterInvalidHistory.messages.length, 0)
  assert.equal(
    afterInvalidHistory.hydrationState,
    "hydrating",
    "invalid non-empty history must not masquerade as authoritative ready + empty",
  )
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: rootAgentId,
    bubbles: [],
  }], { mode: "baseline" })
  const afterAuthoritativeEmpty = store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${rootAgentId}`]
  assert.equal(afterAuthoritativeEmpty.messages.length, 0)
  assert.equal(afterAuthoritativeEmpty.hydrationState, "ready")

  // Send to root, switch to child before the asynchronous ACK, then accept with the original owner.
  store.getState().appendUserMessage(sceneId, rootAgentId, "hello root", "client-root-1")
  store.getState().selectAgentInstance(sceneId, childAgentId)
  store.getState().appendUserMessage(sceneId, childAgentId, "hello child", "client-child-1")
  store.getState().appendEvents(sceneId, [agentEvent({
    id: "evt-root-accepted-after-switch",
    seq: 1,
    type: "user.message.accepted",
    agentInstanceId: rootAgentId,
    payload: {
      client_message_id: "client-root-1",
      user_message_id: "backend-root-1",
      text: "hello root",
      channel: "web",
      metadata: {},
    },
  })])

  const scene = store.getState().scenes[sceneId]
  assert.equal(Object.hasOwn(scene, "messages"), false, "Scene must not expose flat messages")
  const rootState = scene.agentRuntimeStates[`${sceneId}:${rootAgentId}`]
  const childState = scene.agentRuntimeStates[`${sceneId}:${childAgentId}`]
  const rootMsgs = rootState.messages
  const childMsgs = childState.messages
  assert.equal(scene.selectedAgentInstanceId, childAgentId)
  assert.equal(rootState.uiCacheTier, "warm")
  assert.equal(childState.uiCacheTier, "hot")
  assert.equal(rootMsgs.filter((m) => m.clientMessageId === "client-root-1").length, 1)
  assert.equal(rootMsgs.find((m) => m.clientMessageId === "client-root-1")?.status, "accepted")
  assert.ok(childMsgs.some((m) => m.clientMessageId === "client-child-1"))
  assert.ok(!childMsgs.some((m) => m.clientMessageId === "client-root-1"))
  assert.ok(!rootMsgs.some((m) => m.clientMessageId === "client-child-1"))

  // live event without owner must not pollute root.
  const missingOwnerEvent = agentEvent({
    id: "evt-no-owner",
    seq: 2,
    type: "terminal.created",
    payload: { terminal_id: "term-x", cwd: "/", shell: "pwsh" },
  })
  assert.equal(storeModule.liveEventRequiresAgentOwner(missingOwnerEvent), true)
  assert.equal(storeModule.liveEventAgentInstanceId(missingOwnerEvent), null)
  store.getState().appendEvents(sceneId, [missingOwnerEvent])
  const after = store.getState().scenes[sceneId]
  assert.equal(Object.hasOwn(after, "terminalSessions"), false)
  assert.equal(after.agentRuntimeStates[`${sceneId}:${rootAgentId}`].terminalSessions.length, 0)
  assert.equal(after.agentRuntimeStates[`${sceneId}:${childAgentId}`].terminalSessions.length, 0)

  for (const type of [
    "agent.lifecycle.message",
    "agent.interaction.requested",
    "agent.task.completed",
    "llm.content.delta",
    "tool.call.completed",
    "context_compression.completed",
  ]) {
    assert.equal(storeModule.liveEventRequiresAgentOwner({ type }), true, `${type} must require owner`)
  }
  const beforeRunStatus = after.runStatus
  const beforeRootMessageCount = after.agentRuntimeStates[`${sceneId}:${rootAgentId}`].messages.length
  store.getState().appendEvents(sceneId, [agentEvent({
    id: "evt-lifecycle-no-owner",
    seq: 3,
    type: "agent.lifecycle.message",
  })])
  const afterOwnerlessBubbleEvent = store.getState().scenes[sceneId]
  assert.equal(Object.hasOwn(afterOwnerlessBubbleEvent, "messages"), false)
  assert.equal(
    afterOwnerlessBubbleEvent.agentRuntimeStates[`${sceneId}:${rootAgentId}`].messages.length,
    beforeRootMessageCount,
    "ownerless non-terminal live event must not create a root Agent bubble",
  )
  store.getState().appendEvents(sceneId, [agentEvent({
    id: "evt-task-no-owner",
    seq: 4,
    type: "agent.task.completed",
  })])
  assert.equal(store.getState().scenes[sceneId].runStatus, beforeRunStatus)
})

test("runtime activity updates only Agent runtime timestamp and never user or Scene LRU", () => {
  const sceneId = "scene-runtime-lru"
  const rootAgentId = "agent-runtime-root"
  const store = openMultiAgentScene(sceneId, rootAgentId, [])
  store.setState((state) => {
    const scene = state.scenes[sceneId]
    const scopeId = `${sceneId}:${rootAgentId}`
    return {
      scenes: {
        ...state.scenes,
        [sceneId]: {
          ...scene,
          lastActivatedAt: 1_000,
          agentRuntimeStates: {
            ...scene.agentRuntimeStates,
            [scopeId]: {
              ...scene.agentRuntimeStates[scopeId],
              lastViewedAt: 2_000,
              lastRuntimeActivityAt: 1,
            },
          },
        },
      },
    }
  })
  store.getState().appendEvents(sceneId, [agentEvent({
    id: "evt-runtime-owned",
    seq: 1,
    type: "terminal.created",
    agentInstanceId: rootAgentId,
    payload: { terminal_id: "term-runtime", cwd: "/", shell: "pwsh" },
  })])
  const scene = store.getState().scenes[sceneId]
  const rootState = scene.agentRuntimeStates[`${sceneId}:${rootAgentId}`]
  assert.equal(scene.lastActivatedAt, 1_000)
  assert.equal(rootState.lastViewedAt, 2_000)
  assert.ok(rootState.lastRuntimeActivityAt > 1)

  const unseenBackgroundAgentId = "agent-runtime-unseen"
  store.getState().appendEvents(sceneId, [agentEvent({
    id: "evt-runtime-unseen",
    seq: 2,
    type: "terminal.created",
    agentInstanceId: unseenBackgroundAgentId,
    payload: { terminal_id: "term-runtime-unseen", cwd: "/", shell: "pwsh" },
  })])
  const afterUnseenRuntime = store.getState().scenes[sceneId]
  const unseenState = afterUnseenRuntime.agentRuntimeStates[`${sceneId}:${unseenBackgroundAgentId}`]
  assert.equal(afterUnseenRuntime.lastActivatedAt, 1_000)
  assert.equal(unseenState.lastViewedAt, 0, "background ledger creation must not fabricate user-view recency")
  assert.ok(unseenState.lastRuntimeActivityAt > 0)
})

test("global Agent UI budget selects individual warm scopes instead of warming an entire Scene", () => {
  const sceneId = "scene-agent-global-budget"
  const rootAgentId = "agent-budget-root"
  const warmBudget = runtimeConfigModule.WARM_AGENT_SCOPE_COUNT
  const childAgentIds = Array.from({ length: warmBudget + 2 }, (_, index) => `agent-budget-child-${index}`)
  const store = openMultiAgentScene(sceneId, rootAgentId, childAgentIds)
  hydrateAgentBubbles(store, sceneId, rootAgentId, 1, 1)
  childAgentIds.forEach((agentInstanceId, index) => hydrateAgentBubbles(store, sceneId, agentInstanceId, 1, 100 + index))
  store.setState((state) => {
    const scene = state.scenes[sceneId]
    const now = Date.now()
    const agentInstances = Object.fromEntries(
      Object.entries(scene.agentInstances).map(([agentInstanceId, instance]) => [
        agentInstanceId,
        { ...instance, status: "completed" },
      ]),
    )
    const agentRuntimeStates = Object.fromEntries(
      Object.entries(scene.agentRuntimeStates).map(([scopeId, runtimeState], index) => [
        scopeId,
        { ...runtimeState, lastViewedAt: now - index },
      ]),
    )
    return {
      scenes: {
        ...state.scenes,
        [sceneId]: { ...scene, agentInstances, agentRuntimeStates },
      },
    }
  })
  store.getState().applySceneCachePolicy()
  const scene = store.getState().scenes[sceneId]
  const rootState = scene.agentRuntimeStates[`${sceneId}:${rootAgentId}`]
  const childStates = childAgentIds.map((agentInstanceId) => scene.agentRuntimeStates[`${sceneId}:${agentInstanceId}`])
  assert.equal(rootState.uiCacheTier, "hot")
  assert.equal(childStates.filter((state) => state.uiCacheTier === "warm").length, warmBudget)
  assert.equal(childStates.filter((state) => state.uiCacheTier === "cold").length, 2)
  assert.equal(childStates.filter((state) => state.retainedMessageCount === 0).length, 2)
})

test("queue, interaction, and terminal IDs are isolated by explicit Agent owner", () => {
  const sceneId = "scene-owner-collision"
  const rootAgentId = "agent-collision-root"
  const childAgentId = "agent-collision-child"
  const store = openMultiAgentScene(sceneId, rootAgentId, [childAgentId])
  const queued = (agentInstanceId) => ({
    id: `queue-${agentInstanceId}`,
    pendingMessageId: "shared-pending",
    clientMessageId: "shared-client",
    text: "shared",
    createdAt: new Date().toISOString(),
    status: "queued",
    agentInstanceId,
  })
  store.getState().enqueueUserMessage(sceneId, queued(rootAgentId))
  store.getState().enqueueUserMessage(sceneId, queued(childAgentId))
  store.getState().markQueuedUserMessageFailed(sceneId, rootAgentId, "shared-client", "root failed")
  assert.equal(store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${rootAgentId}`].queuedUserMessages[0].status, "failed")
  assert.equal(store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${childAgentId}`].queuedUserMessages[0].status, "queued")
  store.getState().removeQueuedUserMessage(sceneId, rootAgentId, "shared-pending")
  assert.equal(store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${rootAgentId}`].queuedUserMessages.length, 0)
  assert.equal(store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${childAgentId}`].queuedUserMessages.length, 1)

  const interaction = (agentInstanceId, sortOrder) => ({
    ...chatBubble({
      id: "shared-interaction",
      sortOrder,
      seq: sortOrder,
      createdAt: new Date().toISOString(),
      text: "choose",
      agentInstanceId,
    }),
    interaction_options: [{ id: "yes", label: "Yes", description: null }],
    interaction_state: "pending",
  })
  store.getState().hydrateSceneFromAgentBubbles(sceneId, [
    { agentInstanceId: rootAgentId, bubbles: [interaction(rootAgentId, 1)] },
    { agentInstanceId: childAgentId, bubbles: [interaction(childAgentId, 2)] },
  ], { mode: "baseline" })
  store.getState().appendUserMessage(
    sceneId,
    rootAgentId,
    "Yes",
    "root-interaction-reply",
    { interactionMessageId: "shared-interaction", optionId: "yes" },
  )
  const interactionScene = store.getState().scenes[sceneId]
  assert.equal(
    interactionScene.agentRuntimeStates[`${sceneId}:${rootAgentId}`].messages.find((message) => message.id === "shared-interaction").interactionState,
    "answered",
  )
  assert.equal(
    interactionScene.agentRuntimeStates[`${sceneId}:${childAgentId}`].messages.find((message) => message.id === "shared-interaction").interactionState,
    "pending",
  )

  store.getState().appendEvents(sceneId, [
    agentEvent({
      id: "evt-terminal-root",
      seq: 1,
      type: "terminal.created",
      agentInstanceId: rootAgentId,
      payload: { terminal_id: "shared-terminal", cwd: "/", shell: "pwsh" },
    }),
    agentEvent({
      id: "evt-terminal-child",
      seq: 2,
      type: "terminal.created",
      agentInstanceId: childAgentId,
      payload: { terminal_id: "shared-terminal", cwd: "/", shell: "pwsh" },
    }),
    agentEvent({
      id: "evt-terminal-delete-root",
      seq: 3,
      type: "terminal.deleted",
      agentInstanceId: rootAgentId,
      payload: { terminal_id: "shared-terminal" },
    }),
  ])
  const terminalScene = store.getState().scenes[sceneId]
  assert.equal(terminalScene.agentRuntimeStates[`${sceneId}:${rootAgentId}`].terminalSessions.length, 0)
  assert.equal(terminalScene.agentRuntimeStates[`${sceneId}:${childAgentId}`].terminalSessions.length, 1)
})
