import assert from "node:assert/strict"
import path from "node:path"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

let viteServer
let queueModule
let outboxModule

before(async () => {
  viteServer = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  })
  queueModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/chatBubblePersistenceQueue.ts")
  outboxModule = await viteServer.ssrLoadModule("/src/features/chat/runtime/chatBubblePersistenceOutbox.ts")
})

after(async () => {
  await viteServer?.close()
})

test("latest-wins keeps one in-flight request and only the newest pending snapshot", async (t) => {
  const queue = queueModule.createChatBubblePersistenceQueue({
    timeoutMs: 1_000,
    retryLimit: 0,
    retryDelayMs: 1,
  })
  t.after(() => queue.clearAll())

  const calls = []
  let activeRequests = 0
  let maxActiveRequests = 0
  let releaseFirst
  const firstGate = new Promise((resolve) => { releaseFirst = resolve })

  queue.enqueueLatest({
    id: "snapshot-1",
    key: "bubble-1",
    sceneId: "scene-1",
    label: "first snapshot",
    delayMs: 0,
    force: true,
    run: async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      calls.push("first:start")
      await firstGate
      calls.push("first:end")
      activeRequests -= 1
    },
  })

  await waitFor(() => calls.includes("first:start"))

  queue.enqueueLatest({
    id: "snapshot-2",
    key: "bubble-1",
    sceneId: "scene-1",
    label: "superseded snapshot",
    delayMs: 1,
    run: async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      calls.push("second")
      activeRequests -= 1
    },
  })
  queue.enqueueLatest({
    id: "snapshot-3",
    key: "bubble-1",
    sceneId: "scene-1",
    label: "latest snapshot",
    delayMs: 1,
    run: async () => {
      activeRequests += 1
      maxActiveRequests = Math.max(maxActiveRequests, activeRequests)
      calls.push("third")
      activeRequests -= 1
    },
  })

  releaseFirst()
  await waitFor(() => calls.includes("third"))

  assert.deepEqual(calls, ["first:start", "first:end", "third"])
  assert.equal(maxActiveRequests, 1)
})

test("latest-wins retries the same active snapshot instead of turning retry into a no-op", async (t) => {
  const queue = queueModule.createChatBubblePersistenceQueue({
    timeoutMs: 1_000,
    retryLimit: 1,
    retryDelayMs: 1,
  })
  t.after(() => queue.clearAll())

  let attempts = 0
  queue.enqueueLatest({
    id: "retry-snapshot",
    key: "bubble-retry",
    sceneId: "scene-retry",
    label: "retry snapshot",
    delayMs: 0,
    force: true,
    run: async () => {
      attempts += 1
      if (attempts === 1) throw new Error("transient failure")
    },
  })

  await waitFor(() => attempts === 2)
  assert.equal(attempts, 2)
})

test("force flush replaces a delayed content snapshot with the terminal snapshot", async (t) => {
  const queue = queueModule.createChatBubblePersistenceQueue({
    timeoutMs: 1_000,
    retryLimit: 0,
    retryDelayMs: 1,
  })
  t.after(() => queue.clearAll())

  const calls = []
  queue.enqueueLatest({
    id: "delta-snapshot",
    key: "bubble-2",
    sceneId: "scene-2",
    label: "content delta",
    delayMs: 1_000,
    run: async () => { calls.push("delta") },
  })
  queue.enqueueLatest({
    id: "terminal-snapshot",
    key: "bubble-2",
    sceneId: "scene-2",
    label: "terminal state",
    delayMs: 0,
    force: true,
    run: async () => { calls.push("terminal") },
  })

  await waitFor(() => calls.includes("terminal"))
  await sleep(20)
  assert.deepEqual(calls, ["terminal"])
})

test("content delta snapshots defer durable outbox writes to one cadence flush", async (t) => {
  const storage = installLocalStorage(t)
  const queue = queueModule.createChatBubblePersistenceQueue({
    timeoutMs: 1_000,
    retryLimit: 0,
    retryDelayMs: 1,
  })
  t.after(() => queue.clearAll())

  let sequence = 0
  const enqueueContentDelta = (text) => {
    sequence += 1
    const snapshotSequence = sequence
    queue.enqueueLatest({
      id: `content-delta-${snapshotSequence}`,
      key: "bubble-cadence",
      sceneId: "scene-cadence",
      label: "content delta",
      delayMs: 40,
      run: async () => {
        outboxModule.saveChatBubblePersistenceSnapshot(
          "scene-cadence",
          "content delta",
          executionBubble("bubble-cadence", snapshotSequence, text),
          "2026-01-01T00:00:00.000Z",
        )
      },
    })
  }

  enqueueContentDelta("A")
  enqueueContentDelta("AB")
  enqueueContentDelta("ABC")
  assert.equal(storage.setItemCalls, 0)
  await waitFor(() => storage.setItemCalls === 1)
  await sleep(60)

  assert.equal(storage.setItemCalls, 1)
  assert.deepEqual(
    outboxModule.listChatBubblePersistenceSnapshots("scene-cadence").map((entry) => entry.body.text),
    ["ABC"],
  )
})

test("terminal snapshot is durable immediately and recoverable before forced dispatch ACK", async (t) => {
  const storage = installLocalStorage(t)
  const queue = queueModule.createChatBubblePersistenceQueue({
    timeoutMs: 1_000,
    retryLimit: 0,
    retryDelayMs: 1,
  })
  t.after(() => queue.clearAll())

  const calls = []
  queue.enqueueLatest({
    id: "delayed-content-delta",
    key: "bubble-terminal",
    sceneId: "scene-terminal",
    label: "content delta",
    delayMs: 1_000,
    run: async () => {
      calls.push("delta")
      outboxModule.saveChatBubblePersistenceSnapshot(
        "scene-terminal",
        "content delta",
        executionBubble("bubble-terminal", 40, "partial"),
        "2026-01-01T00:00:00.000Z",
      )
    },
  })

  const terminal = outboxModule.saveChatBubblePersistenceSnapshot(
    "scene-terminal",
    "terminal state",
    executionBubble("bubble-terminal", 41, "complete"),
    "2026-01-01T00:00:01.000Z",
  )
  assert.equal(storage.setItemCalls, 1)

  queue.enqueueLatest({
    id: `outbox:${terminal.snapshotId}`,
    key: terminal.bubbleId,
    sceneId: terminal.sceneId,
    label: terminal.label,
    delayMs: 0,
    force: true,
    run: async () => { calls.push("terminal") },
  })
  await waitFor(() => calls.includes("terminal"))
  await sleep(30)

  assert.deepEqual(calls, ["terminal"])
  assert.equal(storage.setItemCalls, 1)
  const restored = []
  outboxModule.replayChatBubblePersistenceSnapshots("scene-terminal", (entry) => restored.push(entry))
  assert.deepEqual(restored.map((entry) => entry.snapshotId), [terminal.snapshotId])
  assert.deepEqual(restored.map((entry) => entry.body.text), ["complete"])
})

test("outbox keeps only the latest bubble snapshot and an old ACK cannot remove it", (t) => {
  const storage = installLocalStorage(t)
  const first = outboxModule.saveChatBubblePersistenceSnapshot(
    "scene-3",
    "first",
    executionBubble("bubble-3", 10, "partial"),
    "2026-01-01T00:00:00.000Z",
  )
  const latest = outboxModule.saveChatBubblePersistenceSnapshot(
    "scene-3",
    "latest",
    executionBubble("bubble-3", 11, "complete"),
    "2026-01-01T00:00:01.000Z",
  )

  assert.equal(storage.values.size, 1)
  assert.deepEqual(outboxModule.listChatBubblePersistenceSnapshots("scene-3").map((entry) => entry.snapshotId), [latest.snapshotId])

  outboxModule.acknowledgeChatBubblePersistenceSnapshot(first.snapshotId)
  assert.deepEqual(outboxModule.listChatBubblePersistenceSnapshots("scene-3").map((entry) => entry.snapshotId), [latest.snapshotId])

  outboxModule.acknowledgeChatBubblePersistenceSnapshot(latest.snapshotId)
  assert.deepEqual(outboxModule.listChatBubblePersistenceSnapshots("scene-3"), [])
})

test("outbox rejects an ownerless projection snapshot instead of falling back to root", (t) => {
  const storage = installLocalStorage(t)
  const ownerless = executionBubble("ownerless-bubble", 29, "ownerless")
  delete ownerless.agent_instance_id

  assert.throws(
    () => outboxModule.saveChatBubblePersistenceSnapshot(
      "scene-ownerless",
      "ownerless live projection",
      ownerless,
      "2026-01-01T00:00:00.000Z",
    ),
    /requires agent_instance_id/,
  )
  assert.equal(storage.setItemCalls, 0)
  assert.deepEqual(outboxModule.listChatBubblePersistenceSnapshots("scene-ownerless"), [])
})

test("outbox latest-wins identity is isolated by Agent scope when bubble IDs collide", (t) => {
  installLocalStorage(t)
  const rootFirst = outboxModule.saveChatBubblePersistenceSnapshot(
    "scene-collision",
    "root partial",
    executionBubble("shared-bubble", 30, "root partial", "agent-root"),
    "2026-01-01T00:00:00.000Z",
  )
  const child = outboxModule.saveChatBubblePersistenceSnapshot(
    "scene-collision",
    "child complete",
    executionBubble("shared-bubble", 31, "child complete", "agent-child"),
    "2026-01-01T00:00:01.000Z",
  )
  const rootLatest = outboxModule.saveChatBubblePersistenceSnapshot(
    "scene-collision",
    "root complete",
    executionBubble("shared-bubble", 32, "root complete", "agent-root"),
    "2026-01-01T00:00:02.000Z",
  )

  const snapshots = outboxModule.listChatBubblePersistenceSnapshots("scene-collision")
  assert.equal(snapshots.length, 2)
  assert.deepEqual(
    Object.fromEntries(snapshots.map((entry) => [entry.body.agent_instance_id, entry.body.text])),
    { "agent-child": "child complete", "agent-root": "root complete" },
  )
  assert.equal(snapshots.some((entry) => entry.snapshotId === rootFirst.snapshotId), false)
  assert.equal(snapshots.some((entry) => entry.snapshotId === child.snapshotId), true)
  assert.equal(snapshots.some((entry) => entry.snapshotId === rootLatest.snapshotId), true)

  outboxModule.acknowledgeChatBubblePersistenceSnapshot(child.snapshotId)
  assert.deepEqual(
    outboxModule.listChatBubblePersistenceSnapshots("scene-collision").map((entry) => entry.snapshotId),
    [rootLatest.snapshotId],
  )
})

test("repeated attach replay reuses the same bubble ID and does not duplicate an in-flight snapshot", async (t) => {
  installLocalStorage(t)
  const queue = queueModule.createChatBubblePersistenceQueue({
    timeoutMs: 1_000,
    retryLimit: 0,
    retryDelayMs: 1,
  })
  t.after(() => queue.clearAll())

  const saved = outboxModule.saveChatBubblePersistenceSnapshot(
    "scene-4",
    "pending execution bubble",
    executionBubble("bubble-4", 20, "complete"),
    "2026-01-01T00:00:02.000Z",
  )
  const persistedBubbleIds = []
  let resolveDurableAck
  const durableAck = new Promise((resolve) => { resolveDurableAck = resolve })
  const replay = () => outboxModule.replayChatBubblePersistenceSnapshots("scene-4", (entry) => {
    queue.enqueueLatest({
      id: `outbox:${entry.snapshotId}`,
      key: `${entry.sceneId}:${entry.body.agent_instance_id}:${entry.bubbleId}`,
      sceneId: entry.sceneId,
      label: entry.label,
      delayMs: 0,
      force: true,
      run: async () => {
        persistedBubbleIds.push(entry.body.bubble_id)
        await sleep(10)
        outboxModule.acknowledgeChatBubblePersistenceSnapshot(entry.snapshotId)
        resolveDurableAck()
      },
    })
  })

  replay()
  replay()
  await durableAck
  assert.deepEqual(outboxModule.listChatBubblePersistenceSnapshots("scene-4"), [])
  replay()
  await sleep(20)

  assert.equal(saved.bubbleId, "bubble-4")
  assert.deepEqual(persistedBubbleIds, ["bubble-4"])
})

function executionBubble(bubbleId, communicationSeq, text, agentInstanceId = "agent-root") {
  return {
    bubble_id: bubbleId,
    agent_instance_id: agentInstanceId,
    role: "agent",
    status: text === "complete" ? "completed" : "streaming",
    text,
    text_format: "plain_text",
    channel: "tool",
    metadata: {
      bubble_kind: "execution_process",
      communication_seq: communicationSeq,
    },
  }
}

function installLocalStorage(t) {
  const values = new Map()
  let setItemCalls = 0
  const localStorage = {
    get length() { return values.size },
    clear() { values.clear() },
    getItem(key) { return values.has(key) ? values.get(key) : null },
    key(index) { return Array.from(values.keys())[index] ?? null },
    removeItem(key) { values.delete(key) },
    setItem(key, value) {
      setItemCalls += 1
      values.set(key, String(value))
    },
  }
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage },
  })
  t.after(() => { delete globalThis.window })
  return {
    values,
    get setItemCalls() { return setItemCalls },
  }
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for persistence queue state")
    await sleep(5)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
