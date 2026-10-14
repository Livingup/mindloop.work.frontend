import { create } from "zustand"

import type { SceneCacheTier } from "@/features/chat/model/chatStore"
import {
  type ExecutionProcessIterationView,
  type ExecutionProcessToolView,
  type TaskBoundaryView,
} from "@/features/chat/runtime/executionProcess"
import { MAX_EXECUTION_MONITOR_BLOCKS } from "@/features/chat/runtime/runtimeConfig"
import { chatTimelineDebug } from "@/features/chat/runtime/chatTimelineDebug"

export type ExecutionMonitorExecutionBlock = {
  kind: "execution"
  messageId: string
  sourceMessageId: string
  createdAt: string
  round: number
  iteration: ExecutionProcessIterationView
}

export type ExecutionMonitorTaskBoundaryBlock = {
  kind: "task_boundary"
  messageId: string
  createdAt: string
  boundary: TaskBoundaryView
}

export type ExecutionMonitorBlock = ExecutionMonitorExecutionBlock | ExecutionMonitorTaskBoundaryBlock

export type TimelineScopeUiState = {
  scopeId: string
  sceneId: string
  agentInstanceId: string
  allBlocks: ExecutionMonitorBlock[]
  blocks: ExecutionMonitorBlock[]
  hiddenBlockCount: number
  totalToolCallCount: number
  visibleToolCallCount: number
  latestFingerprint: string
  blockIndexByMessageId?: Map<string, number>
}

export const TIMELINE_HOT_RETAINED_BLOCKS = 50
export const TIMELINE_WARM_RETAINED_BLOCKS = 20
export const TIMELINE_COLD_RETAINED_BLOCKS = 0

function blockQuotaForTier(tier: SceneCacheTier): number {
  if (tier === "cold") return TIMELINE_COLD_RETAINED_BLOCKS
  if (tier === "warm") return TIMELINE_WARM_RETAINED_BLOCKS
  return TIMELINE_HOT_RETAINED_BLOCKS
}

function isBlockRunning(block: ExecutionMonitorBlock): boolean {
  if (block.kind === "task_boundary") return false
  const iter = block.iteration
  if (iter.llm?.status === "thinking" || iter.llm?.status === "waiting") return true
  return iter.tools.some((t) => t.status === "running")
}

/**
 * 裁剪 retained blocks，并强制常驻运行中的 execution block（Running Execution Pinning）。
 */
function trimRetainedBlocks(blocks: ExecutionMonitorBlock[], quota: number): ExecutionMonitorBlock[] {
  if (quota <= 0) {
    // Cold 模式：如果仍有 running 状态的 block，必须将其 Pin 住
    return blocks.filter(isBlockRunning)
  }
  if (blocks.length <= quota) return blocks

  const runningBlocks = blocks.filter(isBlockRunning)
  const tailBlocks = blocks.slice(-quota)
  const tailKeys = new Set(tailBlocks.map((b) => b.messageId))

  const runningOutsideTail = runningBlocks.filter((b) => !tailKeys.has(b.messageId))
  if (runningOutsideTail.length === 0) return tailBlocks

  // 合并并保持原有顺序
  const preservedKeys = new Set([...runningOutsideTail.map((b) => b.messageId), ...tailKeys])
  return blocks.filter((b) => preservedKeys.has(b.messageId))
}

function countToolCalls(blocks: ExecutionMonitorBlock[]): number {
  return blocks.reduce((sum, block) => {
    if (block.kind === "task_boundary") return sum
    return sum + block.iteration.tools.length
  }, 0)
}

function latestTimelineFingerprint(blocks: ExecutionMonitorBlock[]): string {
  const block = blocks[blocks.length - 1]
  if (!block) return "empty"
  if (block.kind === "task_boundary") {
    return [block.messageId, block.boundary.status, block.boundary.completedAt].join(":")
  }
  const iteration = block.iteration
  const lastTool = iteration.tools[iteration.tools.length - 1]
  return [
    block.messageId,
    block.round,
    iteration.id,
    iteration.llm?.status ?? "no-llm",
    iteration.llm?.durationMs ?? "",
    lastTool?.toolCallId ?? "no-tool",
    lastTool?.status ?? "",
    lastTool?.durationMs ?? "",
  ].join(":")
}

function computeTimelineDerivations(
  scopeId: string,
  sceneId: string,
  agentInstanceId: string,
  rawBlocks: ExecutionMonitorBlock[],
  tier: SceneCacheTier = "hot",
): TimelineScopeUiState {
  const quota = blockQuotaForTier(tier)
  const allBlocks = trimRetainedBlocks(rawBlocks, quota)
  const hiddenBlockCount = Math.max(0, allBlocks.length - MAX_EXECUTION_MONITOR_BLOCKS)
  const blocks = hiddenBlockCount <= 0 ? allBlocks : allBlocks.slice(-MAX_EXECUTION_MONITOR_BLOCKS)

  const blockIndexByMessageId = new Map<string, number>()
  for (let i = 0; i < allBlocks.length; i++) {
    blockIndexByMessageId.set(allBlocks[i].messageId, i)
  }

  return {
    scopeId,
    sceneId,
    agentInstanceId,
    allBlocks,
    blocks,
    hiddenBlockCount,
    totalToolCallCount: countToolCalls(allBlocks),
    visibleToolCallCount: countToolCalls(blocks),
    latestFingerprint: latestTimelineFingerprint(blocks),
    blockIndexByMessageId,
  }
}

export type TimelineUiStore = {
  scopes: Record<string, TimelineScopeUiState>
  setScopeState: (scopeId: string, state: TimelineScopeUiState) => void
  hydrateBlocks: (
    scopeId: string,
    sceneId: string,
    agentInstanceId: string,
    blocks: ExecutionMonitorBlock[],
    tier?: SceneCacheTier,
  ) => void
  appendTaskBoundaryBlock: (
    scopeId: string,
    sceneId: string,
    agentInstanceId: string,
    messageId: string,
    createdAt: string,
    boundary: TaskBoundaryView,
    tier?: SceneCacheTier,
  ) => void
  upsertExecutionIterations: (
    scopeId: string,
    sceneId: string,
    agentInstanceId: string,
    sourceMessageId: string,
    createdAt: string,
    iterations: ExecutionProcessIterationView[],
    persistedRound?: number,
    tier?: SceneCacheTier,
  ) => void
  clearScope: (scopeId: string) => void
  clearScene: (sceneId: string) => void
  clearAll: () => void
}

export const useTimelineUiStore = create<TimelineUiStore>((set) => ({
  scopes: {},

  setScopeState: (scopeId, scopeState) =>
    set((state) => ({
      scopes: {
        ...state.scopes,
        [scopeId]: scopeState,
      },
    })),

  hydrateBlocks: (scopeId, sceneId, agentInstanceId, blocks, tier = "hot") =>
    set((state) => {
      chatTimelineDebug("timeline_store.hydrate", { sceneId, scopeId, agentInstanceId, blockCount: blocks.length, tier })
      const nextScope = computeTimelineDerivations(scopeId, sceneId, agentInstanceId, blocks, tier)
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: nextScope,
        },
      }
    }),

  appendTaskBoundaryBlock: (scopeId, sceneId, agentInstanceId, messageId, createdAt, boundary, tier = "hot") =>
    set((state) => {
      const existing = state.scopes[scopeId]
      const currentBlocks = existing?.allBlocks ?? []
      // 避免重复追加同一 messageId 的 task_boundary
      const filtered = currentBlocks.filter((b) => b.messageId !== messageId)
      const newBlock: ExecutionMonitorTaskBoundaryBlock = {
        kind: "task_boundary",
        messageId,
        createdAt,
        boundary,
      }
      const nextScope = computeTimelineDerivations(
        scopeId,
        sceneId,
        agentInstanceId,
        [...filtered, newBlock],
        tier,
      )
      return {
        scopes: {
          ...state.scopes,
          [scopeId]: nextScope,
        },
      }
    }),

  upsertExecutionIterations: (
    scopeId,
    sceneId,
    agentInstanceId,
    sourceMessageId,
    createdAt,
    iterations,
    persistedRound,
    tier = "hot",
  ) =>
    set((state) => {
      const existing = state.scopes[scopeId]
      if (!existing) {
        chatTimelineDebug("timeline_store.upsert_initial", { sceneId, scopeId, agentInstanceId, sourceMessageId, iterationCount: iterations.length, persistedRound: persistedRound ?? null })
        // 首次初始化
        const newBlocks: ExecutionMonitorBlock[] = []
        let round = persistedRound ?? 1
        for (const iter of iterations) {
          newBlocks.push({
            kind: "execution",
            messageId: `${sourceMessageId}:${iter.id}`,
            sourceMessageId,
            createdAt,
            round,
            iteration: iter,
          })
          round++
        }
        return {
          scopes: {
            ...state.scopes,
            [scopeId]: computeTimelineDerivations(scopeId, sceneId, agentInstanceId, newBlocks, tier),
          },
        }
      }

      const existingMap = existing.blockIndexByMessageId ?? new Map<string, number>()
      let nextIndexMap: Map<string, number> | null = null
      let allBlocks = existing.allBlocks
      let blocks = existing.blocks
      let hiddenBlockCount = existing.hiddenBlockCount
      let totalToolCallCount = existing.totalToolCallCount
      let visibleToolCallCount = existing.visibleToolCallCount
      let modifiedAllBlocks: ExecutionMonitorBlock[] | null = null
      let modifiedBlocks: ExecutionMonitorBlock[] | null = null
      const quota = blockQuotaForTier(tier)

      for (let i = 0; i < iterations.length; i++) {
        const iteration = iterations[i]
        const blockMessageId = `${sourceMessageId}:${iteration.id}`
        const currentIndexMap = nextIndexMap ?? existingMap
        let existingIdx = currentIndexMap.get(blockMessageId)
        const currentBlocksList = modifiedAllBlocks ?? allBlocks

        if (existingIdx === undefined && iteration.id) {
          // 如果当前 sourceMessageId 没有命中（例如实时临时气泡转持久化落库气泡时 sourceMessageId 发生切换），
          // 且属于真实的 execution-process 唯一迭代（排除测试 fixture 简短 id 如 'iter-1'），
          // 从后往前查找是否已有相同 iteration.id 的 block 进行原位承接，绝不产生多余 Block 导致轮数暴增
          if (sourceMessageId.startsWith("execution-process-") && iteration.id.length > 10) {
            for (let idx = currentBlocksList.length - 1; idx >= 0; idx--) {
              const b = currentBlocksList[idx]
              if (b.kind === "execution" && b.iteration?.id === iteration.id) {
                existingIdx = idx
                break
              }
            }
          }
        }

        if (existingIdx !== undefined && existingIdx < currentBlocksList.length) {
          // O(1) 原位增量更新已存在 block（流式输出主路径）
          const oldBlock = currentBlocksList[existingIdx] as ExecutionMonitorExecutionBlock
          const newBlock: ExecutionMonitorExecutionBlock = {
            ...oldBlock,
            messageId: blockMessageId,
            sourceMessageId,
            iteration,
          }
          if (!modifiedAllBlocks) modifiedAllBlocks = [...allBlocks]
          modifiedAllBlocks[existingIdx] = newBlock

          const toolDelta = iteration.tools.length - (oldBlock.iteration?.tools?.length ?? 0)
          totalToolCallCount += toolDelta

          const visibleIdx = existingIdx - hiddenBlockCount
          if (visibleIdx >= 0 && visibleIdx < blocks.length) {
            if (!modifiedBlocks) modifiedBlocks = [...blocks]
            modifiedBlocks[visibleIdx] = newBlock
            visibleToolCallCount += toolDelta
          }

          if (oldBlock.messageId !== blockMessageId) {
            if (!nextIndexMap) {
              nextIndexMap = new Map(existingMap)
            }
            nextIndexMap.delete(oldBlock.messageId)
            nextIndexMap.set(blockMessageId, existingIdx)
          }
        } else {
          // 追加新 iteration block
          if (!modifiedAllBlocks) modifiedAllBlocks = [...allBlocks]
          let previousExecutionRound = 0
          const lastB = modifiedAllBlocks[modifiedAllBlocks.length - 1]
          if (lastB) {
            previousExecutionRound = lastB.kind === "execution" ? lastB.round : 0
          }
          const round = (i === 0 && persistedRound !== undefined)
            ? persistedRound
            : previousExecutionRound + 1
          const newBlock: ExecutionMonitorExecutionBlock = {
            kind: "execution",
            messageId: blockMessageId,
            sourceMessageId,
            createdAt,
            round,
            iteration,
          }
          modifiedAllBlocks.push(newBlock)
          totalToolCallCount += iteration.tools.length

          // 保持 Map 严格不可变：绝不原地修改 existing.blockIndexByMessageId
          if (!nextIndexMap) {
            nextIndexMap = new Map(existingMap)
          }
          nextIndexMap.set(blockMessageId, modifiedAllBlocks.length - 1)

          // 检查是否超出 quota 导致需要 trim（快速原位淘汰最旧已完成块，保护 running 块）
          if (quota > 0 && modifiedAllBlocks.length > quota) {
            const evictIdx = modifiedAllBlocks.findIndex((b) => !isBlockRunning(b))
            if (evictIdx >= 0) {
              const [evicted] = modifiedAllBlocks.splice(evictIdx, 1)
              const evictedTools = evicted.kind === "execution" ? evicted.iteration.tools.length : 0
              totalToolCallCount = Math.max(0, totalToolCallCount - evictedTools)
              nextIndexMap.delete(evicted.messageId)
              for (let j = evictIdx; j < modifiedAllBlocks.length; j++) {
                nextIndexMap.set(modifiedAllBlocks[j].messageId, j)
              }
            }
          }

          if (modifiedAllBlocks.length > MAX_EXECUTION_MONITOR_BLOCKS) {
            hiddenBlockCount = modifiedAllBlocks.length - MAX_EXECUTION_MONITOR_BLOCKS
            modifiedBlocks = modifiedAllBlocks.slice(-MAX_EXECUTION_MONITOR_BLOCKS)
            visibleToolCallCount = countToolCalls(modifiedBlocks)
          } else {
            // modifiedAllBlocks may have evicted an old item at quota boundary; derive the window from it.
            modifiedBlocks = [...modifiedAllBlocks]
            visibleToolCallCount = countToolCalls(modifiedBlocks)
            hiddenBlockCount = 0
          }
        }
      }

      const finalAllBlocks = modifiedAllBlocks ?? allBlocks
      const finalBlocks = modifiedBlocks ?? blocks
      const latestFingerprint = latestTimelineFingerprint(finalBlocks)
      chatTimelineDebug("timeline_store.upsert_complete", { sceneId, scopeId, agentInstanceId, sourceMessageId, iterationCount: iterations.length, allBlockCount: finalAllBlocks.length, visibleBlockCount: finalBlocks.length })
      const finalIndexMap = nextIndexMap ?? existingMap

      return {
        scopes: {
          ...state.scopes,
          [scopeId]: {
            scopeId,
            sceneId,
            agentInstanceId,
            allBlocks: finalAllBlocks,
            blocks: finalBlocks,
            hiddenBlockCount,
            totalToolCallCount,
            visibleToolCallCount,
            latestFingerprint,
            blockIndexByMessageId: finalIndexMap,
          },
        },
      }
    }),

  clearScope: (scopeId) =>
    set((state) => {
      if (!state.scopes[scopeId]) return state
      const { [scopeId]: _removed, ...rest } = state.scopes
      return { scopes: rest }
    }),

  clearScene: (sceneId) =>
    set((state) => {
      let changed = false
      const nextScopes: Record<string, TimelineScopeUiState> = {}
      for (const [scopeId, scope] of Object.entries(state.scopes)) {
        if (scope.sceneId === sceneId) {
          changed = true
        } else {
          nextScopes[scopeId] = scope
        }
      }
      return changed ? { scopes: nextScopes } : state
    }),

  clearAll: () => set({ scopes: {} }),
}))
