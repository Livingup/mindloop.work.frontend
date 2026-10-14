import type { ArtifactEditBlock, ArtifactItem } from "@/features/chat/api/taskNoteApi"

export type FileChangeEntry = {
  key: string
  path: string
  originalPath?: string
  netType: "create" | "modify" | "delete" | "move"
  edits: ArtifactEditBlock[]
  insertedTotal: number
  deletedTotal: number
  createdLineCount?: number
  moveReason?: string | null
  artifactIds: string[]
  firstAt?: string
  lastAt?: string
}

function normalizePath(path?: string | null): string {
  if (!path) return ""
  return path.replace(/\\/g, "/")
}

export function foldArtifacts(artifacts: ArtifactItem[]): {
  files: FileChangeEntry[]
  others: ArtifactItem[]
} {
  const others: ArtifactItem[] = []
  const fileItems: ArtifactItem[] = []

  for (const art of artifacts) {
    if (art.type === "other") {
      others.push(art)
    } else {
      fileItems.push(art)
    }
  }

  // 稳定按 created_at 升序排列
  const sortedItems = [...fileItems].sort((a, b) => {
    if (!a.created_at || !b.created_at) return 0
    return a.created_at.localeCompare(b.created_at)
  })

  const fileMap = new Map<string, FileChangeEntry>()

  for (const art of sortedItems) {
    const rawPath = art.file_path || art.target_path || art.source_path || ""
    const key = normalizePath(rawPath)
    if (!key && art.type !== "file_move") continue

    if (art.type === "file_create") {
      const createdLineCount = Array.isArray(art.content_lines) ? art.content_lines.length : 0
      const existing = fileMap.get(key)
      const artifactIds = existing ? [...existing.artifactIds, art.artifact_id] : [art.artifact_id]
      const firstAt = existing?.firstAt || art.created_at

      fileMap.set(key, {
        key,
        path: key,
        netType: "create",
        edits: [],
        insertedTotal: 0,
        deletedTotal: 0,
        createdLineCount,
        artifactIds,
        firstAt,
        lastAt: art.created_at || existing?.lastAt,
      })
    } else if (art.type === "file_modify") {
      let entry = fileMap.get(key)
      if (!entry) {
        entry = {
          key,
          path: key,
          netType: "modify",
          edits: [],
          insertedTotal: 0,
          deletedTotal: 0,
          artifactIds: [],
          firstAt: art.created_at,
          lastAt: art.created_at,
        }
        fileMap.set(key, entry)
      }

      if (entry.netType !== "create" && entry.netType !== "move") {
        entry.netType = "modify"
      }

      if (Array.isArray(art.edits)) {
        entry.edits.push(...art.edits)
        for (const edit of art.edits) {
          entry.insertedTotal += Number(edit.inserted_lines || 0)
          entry.deletedTotal += Number(edit.deleted_lines || 0)
        }
      }

      if (!entry.artifactIds.includes(art.artifact_id)) {
        entry.artifactIds.push(art.artifact_id)
      }
      entry.lastAt = art.created_at || entry.lastAt
    } else if (art.type === "file_delete") {
      const entry = fileMap.get(key)
      if (entry && entry.netType === "create") {
        // 先创建后删除，净变化消除
        fileMap.delete(key)
      } else if (entry) {
        entry.netType = "delete"
        entry.edits = []
        entry.insertedTotal = 0
        entry.deletedTotal = 0
        if (!entry.artifactIds.includes(art.artifact_id)) {
          entry.artifactIds.push(art.artifact_id)
        }
        entry.lastAt = art.created_at || entry.lastAt
      } else {
        fileMap.set(key, {
          key,
          path: key,
          netType: "delete",
          edits: [],
          insertedTotal: 0,
          deletedTotal: 0,
          artifactIds: [art.artifact_id],
          firstAt: art.created_at,
          lastAt: art.created_at,
        })
      }
    } else if (art.type === "file_move") {
      const srcKey = normalizePath(art.source_path)
      const dstKey = normalizePath(art.target_path || art.file_path)
      if (!dstKey) continue

      const oldEntry = srcKey ? fileMap.get(srcKey) : undefined
      if (oldEntry && srcKey) {
        fileMap.delete(srcKey)
      }

      const originalPath = oldEntry?.originalPath || normalizePath(art.source_path) || undefined
      const isCreate = oldEntry?.netType === "create"

      const targetEntry: FileChangeEntry = {
        key: dstKey,
        path: dstKey,
        originalPath,
        netType: isCreate ? "create" : "move",
        edits: oldEntry ? [...oldEntry.edits] : [],
        insertedTotal: oldEntry?.insertedTotal ?? 0,
        deletedTotal: oldEntry?.deletedTotal ?? 0,
        createdLineCount: oldEntry?.createdLineCount,
        moveReason: art.content || oldEntry?.moveReason || null,
        artifactIds: oldEntry ? [...oldEntry.artifactIds, art.artifact_id] : [art.artifact_id],
        firstAt: oldEntry?.firstAt || art.created_at,
        lastAt: art.created_at || oldEntry?.lastAt,
      }

      fileMap.set(dstKey, targetEntry)
    }
  }

  const files = Array.from(fileMap.values()).sort((a, b) => {
    if (!a.firstAt || !b.firstAt) return 0
    return a.firstAt.localeCompare(b.firstAt)
  })

  return { files, others }
}
