import assert from "node:assert/strict"
import path from "node:path"
import { after, before, beforeEach, test } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

let viteServer
let storeModule
let projectionModule

before(async () => {
  viteServer = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  })
  storeModule = await viteServer.ssrLoadModule("/src/features/chat/model/chatStore.ts")
  projectionModule = await viteServer.ssrLoadModule("/src/features/chat/model/agentUiProjection.ts")
})

beforeEach(() => {
  storeModule.useChatStore.getState().clearAllScenes()
})

after(async () => {
  await viteServer?.close()
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

test("agent A visible identity and runtime state stay stable when agent B receives new messages", () => {
  const sceneId = "scene-multi-agent"
  const rootAgentId = "agent-se"
  const childAgentId = "agent-dev"
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, "Multi agent isolation")
  store.getState().setRootAgentInstanceId(sceneId, rootAgentId)
  store.getState().setSceneAgentInventory(
    sceneId,
    [agentInstance(rootAgentId, "Software-Engineering"), agentInstance(childAgentId, "Development")],
    [],
    rootAgentId,
    rootAgentId,
  )

  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: rootAgentId,
    bubbles: [chatBubble({
      id: "se-msg-1",
      sortOrder: 10,
      seq: 10,
      createdAt: "2026-07-17T01:00:00.000Z",
      text: "SE history",
      agentInstanceId: rootAgentId,
    })],
  }], { mode: "baseline" })

  const before = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    rootAgentId,
  )
  const beforeScopeState = store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${rootAgentId}`]

  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: childAgentId,
    bubbles: [chatBubble({
      id: "dev-msg-1",
      sortOrder: 11,
      seq: 11,
      createdAt: "2026-07-17T01:00:01.000Z",
      text: "Dev new message",
      agentInstanceId: childAgentId,
    })],
  }])

  const after = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    rootAgentId,
  )
  const afterScopeState = store.getState().scenes[sceneId].agentRuntimeStates[`${sceneId}:${rootAgentId}`]

  assert.equal(after.visibleIdentityKey, before.visibleIdentityKey)
  assert.deepEqual(
    after.visibleMessages.map((message) => message.id),
    before.visibleMessages.map((message) => message.id),
  )
  assert.equal(afterScopeState, beforeScopeState)
  assert.ok(!after.visibleMessages.some((message) => message.id === "dev-msg-1"))

  const childProjection = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    childAgentId,
  )
  assert.ok(childProjection.visibleMessages.some((message) => message.id === "dev-msg-1"))
})

test("agent A visible identity changes only when A itself gets a new visible message", () => {
  const sceneId = "scene-multi-agent-self"
  const rootAgentId = "agent-se-2"
  const childAgentId = "agent-dev-2"
  const store = storeModule.useChatStore
  store.getState().openScene(sceneId, "Multi agent self update")
  store.getState().setRootAgentInstanceId(sceneId, rootAgentId)
  store.getState().setSceneAgentInventory(
    sceneId,
    [agentInstance(rootAgentId, "Software-Engineering"), agentInstance(childAgentId, "Development")],
    [],
    rootAgentId,
    rootAgentId,
  )

  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: rootAgentId,
    bubbles: [chatBubble({
      id: "se-base",
      sortOrder: 1,
      seq: 1,
      createdAt: "2026-07-17T02:00:00.000Z",
      text: "base",
      agentInstanceId: rootAgentId,
    })],
  }], { mode: "baseline" })

  const before = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    rootAgentId,
  )

  store.getState().hydrateSceneFromAgentBubbles(sceneId, [{
    agentInstanceId: rootAgentId,
    bubbles: [chatBubble({
      id: "se-new",
      sortOrder: 2,
      seq: 2,
      createdAt: "2026-07-17T02:00:01.000Z",
      text: "new for SE",
      agentInstanceId: rootAgentId,
    })],
  }])

  const after = projectionModule.buildAgentConversationProjection(
    store.getState().scenes[sceneId],
    sceneId,
    rootAgentId,
  )
  assert.notEqual(after.visibleIdentityKey, before.visibleIdentityKey)
  assert.ok(after.visibleMessages.some((message) => message.id === "se-new"))
})

