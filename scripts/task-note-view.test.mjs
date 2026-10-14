import assert from "node:assert/strict"
import path from "node:path"
import { after, before, describe, it } from "node:test"
import { fileURLToPath } from "node:url"

import { createServer } from "vite"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")

let viteServer
let artifactsModule
let viewModelModule
let apiModule
let httpModule

before(async () => {
  viteServer = await createServer({
    root: projectRoot,
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  })
  artifactsModule = await viteServer.ssrLoadModule("/src/features/chat/model/taskNoteArtifacts.ts")
  viewModelModule = await viteServer.ssrLoadModule("/src/features/chat/model/taskNoteView.ts")
  apiModule = await viteServer.ssrLoadModule("/src/features/chat/api/taskNoteApi.ts")
  httpModule = await viteServer.ssrLoadModule("/src/shared/api/httpClient.ts")
})

after(async () => {
  await viteServer?.close()
})

describe("taskNoteArtifacts: foldArtifacts", () => {
  it("folds file modifications and aggregates lines added and removed", () => {
    const rawArtifacts = [
      {
        artifact_id: "art-1",
        type: "file_create",
        file_path: "src\\index.ts",
        content_lines: ["line1", "line2"],
        created_at: "2026-10-13T10:00:00Z",
      },
      {
        artifact_id: "art-2",
        type: "file_modify",
        file_path: "src/index.ts",
        edits: [
          { inserted_lines: 5, deleted_lines: 2, feature_desc: "update logic" },
        ],
        created_at: "2026-10-13T10:05:00Z",
      },
    ]

    const { files, others } = artifactsModule.foldArtifacts(rawArtifacts)
    assert.equal(files.length, 1)
    assert.equal(others.length, 0)

    const file = files[0]
    assert.equal(file.path, "src/index.ts")
    assert.equal(file.netType, "create") // create + modify preserves create netType
    assert.equal(file.insertedTotal, 5)
    assert.equal(file.deletedTotal, 2)
    assert.equal(file.createdLineCount, 2)
    assert.equal(file.edits.length, 1)
  })

  it("handles file delete on existing file and file move correctly", () => {
    const rawArtifacts = [
      {
        artifact_id: "art-1",
        type: "file_delete",
        file_path: "obsolete.txt",
        created_at: "2026-10-13T10:01:00Z",
      },
      {
        artifact_id: "art-2",
        type: "file_move",
        source_path: "old_name.ts",
        target_path: "new_name.ts",
        created_at: "2026-10-13T10:02:00Z",
      },
    ]
    const { files } = artifactsModule.foldArtifacts(rawArtifacts)
    assert.equal(files.length, 2)

    const deletedFile = files.find((f) => f.path === "obsolete.txt")
    assert.ok(deletedFile)
    assert.equal(deletedFile.netType, "delete")

    const movedFile = files.find((f) => f.path === "new_name.ts")
    assert.ok(movedFile)
    assert.equal(movedFile.netType, "move")
    assert.equal(movedFile.originalPath, "old_name.ts")
  })

  it("eliminates net change when file is created then deleted within same task", () => {
    const rawArtifacts = [
      {
        artifact_id: "art-1",
        type: "file_create",
        file_path: "temp.txt",
        created_at: "2026-10-13T10:00:00Z",
      },
      {
        artifact_id: "art-2",
        type: "file_delete",
        file_path: "temp.txt",
        created_at: "2026-10-13T10:01:00Z",
      },
    ]
    const { files } = artifactsModule.foldArtifacts(rawArtifacts)
    assert.equal(files.length, 0) // create then delete cancels out completely
  })
})

describe("taskNoteView: buildTaskNoteView", () => {
  it("merges snapshot items with unbound items and avoids duplicates", () => {
    const response = {
      task_id: "task-1",
      agent_instance_id: "agent-1",
      observing: true,
      watermark: {
        note_version: 2,
        updated_at: "2026-10-13T10:00:00Z",
      },
      snapshot: {
        task_id: "task-1",
        agent_instance_id: "agent-1",
        missions: [
          {
            mission_id: "m-1",
            task_id: "task-1",
            agent_instance_id: "agent-1",
            title: "Mission 1",
            status: "in_progress",
            refined_requirement: "Implement feature",
          },
        ],
        progresses: [
          {
            progress_id: "p-1",
            task_id: "task-1",
            mission_id: "m-1",
            agent_instance_id: "agent-1",
            current_work: "Stage 1 finished",
            next_step: "Run tests",
          },
        ],
        commands: [
          {
            command_id: "cmd-1",
            task_id: "task-1",
            mission_id: "m-1",
            agent_instance_id: "agent-1",
            command_line: "npm test",
          },
        ],
        artifacts: [
          {
            artifact_id: "art-1",
            task_id: "task-1",
            agent_instance_id: "agent-1",
            type: "file_modify",
            file_path: "src/main.ts",
            edits: [{ inserted_lines: 3, deleted_lines: 1 }],
          },
        ],
        agent_messages: [
          {
            message_id: "msg-1",
            task_id: "task-1",
            sender: "agent-1",
            content: "hello",
          },
        ],
      },
      unbound: {
        artifacts: [
          {
            artifact_id: "art-1", // duplicate, should be filtered
            task_id: "task-1",
            agent_instance_id: "agent-1",
            type: "file_modify",
            file_path: "src/main.ts",
          },
          {
            artifact_id: "art-2",
            task_id: "task-1",
            agent_instance_id: "agent-1",
            type: "file_create",
            file_path: "src/helper.ts",
            content_lines: ["export const a = 1;"],
          },
        ],
        agent_messages: [
          {
            message_id: "msg-1", // duplicate, should be filtered
            task_id: "task-1",
            sender: "agent-1",
            content: "hello",
          },
          {
            message_id: "msg-2",
            task_id: "task-1",
            sender: "agent-1",
            content: "world",
          },
        ],
      },
    }

    const view = viewModelModule.buildTaskNoteView(response)
    assert.equal(view.missions.length, 1)
    assert.equal(view.progresses.length, 1)
    assert.equal(view.fileChanges.length, 2)
    assert.equal(view.agentMessages.length, 2)
    assert.equal(view.commandLineById["cmd-1"], "npm test")
    assert.equal(view.observing, true)
    assert.equal(view.noteVersion, 2)
    assert.ok(view.updatedAtText)

    assert.equal(viewModelModule.progressHasContent(view.progresses[0]), true)
    assert.equal(viewModelModule.isMissionPruned(view.missions[0]), false)
    assert.equal(viewModelModule.hasTaskNoteContent(response), true)
  })

  it("handles null or empty snapshot gracefully", () => {
    const view = viewModelModule.buildTaskNoteView(null)
    assert.equal(view.missions.length, 0)
    assert.equal(view.solutions.length, 0)
    assert.equal(view.fileChanges.length, 0)
    assert.equal(view.noteVersion, 0)
    assert.equal(view.observing, false)
    assert.equal(viewModelModule.hasTaskNoteContent(null), false)
  })
})

describe("taskNoteApi: normalizeTaskNoteResponse", () => {
  it("normalizes edits JSON string in artifacts to array of edit blocks", () => {
    const raw = {
      task_id: "t-1",
      agent_instance_id: "a-1",
      snapshot: {
        artifacts: [
          {
            artifact_id: "art-1",
            task_id: "t-1",
            agent_instance_id: "a-1",
            type: "file_modify",
            file_path: "test.py",
            edits: JSON.stringify([
              { inserted_lines: 3, deleted_lines: 1, feature_desc: "refactor" },
            ]),
          },
        ],
      },
    }

    const normalized = apiModule.normalizeTaskNoteResponse(raw)
    assert.ok(normalized.snapshot)
    assert.equal(normalized.snapshot.artifacts[0].edits.length, 1)
    assert.equal(normalized.snapshot.artifacts[0].edits[0].inserted_lines, 3)
  })

  it("safely fills missing arrays with empty lists", () => {
    const raw = {
      task_id: "t-1",
      agent_instance_id: "a-1",
      snapshot: {},
    }
    const normalized = apiModule.normalizeTaskNoteResponse(raw)
    assert.ok(normalized.snapshot)
    assert.deepEqual(normalized.snapshot.missions, [])
    assert.deepEqual(normalized.snapshot.workspace_context, [])
    assert.deepEqual(normalized.snapshot.decisions, [])
    assert.deepEqual(normalized.snapshot.todos, [])
    assert.deepEqual(normalized.snapshot.discoveries, [])
    assert.deepEqual(normalized.snapshot.issues, [])
    assert.deepEqual(normalized.snapshot.artifacts, [])
    assert.deepEqual(normalized.snapshot.commands, [])
  })
})

describe("taskNoteApi: classifyTaskNoteError and shouldRetryTaskNoteQuery", () => {
  it("classifies error status codes correctly", () => {
    const err404 = new httpModule.HttpError("Not found", 404, null)
    const err503 = new httpModule.HttpError("Service Unavailable", 503, null)
    const err500 = new httpModule.HttpError("Internal Error", 500, null)
    const genericErr = new Error("Network error")

    assert.equal(apiModule.classifyTaskNoteError(err404), "agent_not_found")
    assert.equal(apiModule.classifyTaskNoteError(err503), "storage_unavailable")
    assert.equal(apiModule.classifyTaskNoteError(err500), "other")
    assert.equal(apiModule.classifyTaskNoteError(genericErr), "other")
  })

  it("determines retry eligibility correctly", () => {
    const err404 = new httpModule.HttpError("Not found", 404, null)
    const err503 = new httpModule.HttpError("Service Unavailable", 503, null)

    assert.equal(apiModule.shouldRetryTaskNoteQuery(0, err404), false)
    assert.equal(apiModule.shouldRetryTaskNoteQuery(0, err503), true)
    assert.equal(apiModule.shouldRetryTaskNoteQuery(1, err503), false)
  })
})
