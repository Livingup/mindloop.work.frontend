/**
 * Chat Bubble 前端持久化串行队列。
 *
 * 角色定位
 * - 前端是 Chat Bubble 持久化的唯一触发方（业务约定：后端不做自动兜底持久化）。
 * - 每个 scene 单独维护一个串行任务队列：保证同一 bubble 的 upsert/patch 顺序、
 *   并发不会乱序覆盖。
 * - 支持任务级 abort（超时 / scene 清理时立即终止当前请求，避免内存与连接泄漏）。
 *
 * 设计要点
 * - 纯模块，无 React 依赖；由 useChatBubblePersistence hook 在组件层 wire。
 * - 单 scene 内任务串行：同时仅一个 AbortController 处于活跃状态。
 * - 任务 id 去重：避免重复入队（如同一 bubble 的多次相同 upsert 触发）。
 * - generation 标记：clearScene 时递增 generation，让正在执行的 runTask 在
 *   resume 时检测到 generation 变化主动 return，避免老任务继续重试 / 写入。
 * - 重试退避：retryDelayMs * (attempt + 1)，attempt 从 0 开始。
 * - 故意吞 final attempt 异常：持久化失败不应阻塞 UI；以 console.warn 暴露。
 */

export type ChatBubblePersistenceTask = {
  id: string
  sceneId: string
  label: string
  run: (signal: AbortSignal) => Promise<void>
  /** 任务从串行队列移除后调用；供 latest-wins 调度下一份快照。 */
  onSettled?: () => void
}

/** 同一逻辑 Bubble 的高频完整快照；key 不包含 event seq，后来的快照覆盖旧 pending snapshot。 */
export type ChatBubbleLatestPersistenceTask = {
  /** 同一 durable outbox snapshot 的稳定 ID；重复 attach/replay 不重复入队。 */
  id: string
  key: string
  sceneId: string
  label: string
  run: (signal: AbortSignal) => Promise<void>
  /** coalesced flush 延迟；终态可使用 force 立即入队。 */
  delayMs: number
  force?: boolean
}

type LatestTaskState = {
  latest: ChatBubbleLatestPersistenceTask | null
  active: ChatBubbleLatestPersistenceTask | null
  timer: ReturnType<typeof setTimeout> | null
  queuedOrRunning: boolean
  generation: number
}

export type ChatBubblePersistenceQueueOptions = {
  /** 单次请求超时（毫秒）。到时间 AbortController.abort()。 */
  timeoutMs: number
  /** 重试次数上限（不含首次执行）。retryLimit=2 即最多执行 3 次。 */
  retryLimit: number
  /** 重试间隔基数（毫秒）。实际间隔 = retryDelayMs * (attempt + 1)。 */
  retryDelayMs: number
}

export type ChatBubblePersistenceQueue = {
  /**
   * 入队一个持久化任务。
   * - 同一 (sceneId, taskId) 已存在则忽略，实现任务级幂等。
   * - 入队后立即触发 drain（如果该 scene 当前没有运行中的 drain）。
   */
  enqueue: (task: ChatBubblePersistenceTask) => void
  /** 同一 scene/key 至多保留一个 in-flight 与一个最新 pending snapshot。 */
  enqueueLatest: (task: ChatBubbleLatestPersistenceTask) => void
  /**
   * 清空指定 scene 的所有队列与活跃请求：
   * - 调用当前活跃 AbortController.abort()；
   * - 删除 queue / taskIds / runningScenes 记录；
   * - generation +1：让正在执行的 runTask / drainScene 在 await 返回后主动退出。
   */
  clearScene: (sceneId: string) => void
  /** 清空所有 scene 的队列（unmount 时调用，确保不残留 AbortController/Map）。 */
  clearAll: () => void
}

export function createChatBubblePersistenceQueue(options: ChatBubblePersistenceQueueOptions): ChatBubblePersistenceQueue {
  const queuesByScene = new Map<string, ChatBubblePersistenceTask[]>()
  const taskIdsByScene = new Map<string, Set<string>>()
  const controllersByScene = new Map<string, AbortController>()
  const runningScenes = new Set<string>()
  const generationsByScene = new Map<string, number>()
  const latestStatesByScene = new Map<string, Map<string, LatestTaskState>>()

  function currentGeneration(sceneId: string): number {
    return generationsByScene.get(sceneId) ?? 0
  }

  function clearScene(sceneId: string): void {
    queuesByScene.delete(sceneId)
    taskIdsByScene.delete(sceneId)
    controllersByScene.get(sceneId)?.abort()
    controllersByScene.delete(sceneId)
    runningScenes.delete(sceneId)
    const latestStates = latestStatesByScene.get(sceneId)
    if (latestStates) {
      for (const state of latestStates.values()) {
        if (state.timer) clearTimeout(state.timer)
      }
    }
    latestStatesByScene.delete(sceneId)
    generationsByScene.set(sceneId, currentGeneration(sceneId) + 1)
  }

  function clearAll(): void {
    const sceneIds = new Set<string>([
      ...queuesByScene.keys(),
      ...controllersByScene.keys(),
      ...runningScenes,
      ...latestStatesByScene.keys(),
    ])
    for (const sceneId of sceneIds) clearScene(sceneId)
    queuesByScene.clear()
    taskIdsByScene.clear()
    controllersByScene.clear()
    runningScenes.clear()
  }

  function enqueue(task: ChatBubblePersistenceTask): void {
    enqueueInternal(task)
  }

  function enqueueInternal(task: ChatBubblePersistenceTask): void {
    const queue = queuesByScene.get(task.sceneId) ?? []
    const taskIds = taskIdsByScene.get(task.sceneId) ?? new Set<string>()
    if (taskIds.has(task.id)) return
    taskIds.add(task.id)
    taskIdsByScene.set(task.sceneId, taskIds)
    queue.push(task)
    queuesByScene.set(task.sceneId, queue)
    void drainScene(task.sceneId)
  }

  function enqueueLatest(task: ChatBubbleLatestPersistenceTask): void {
    const states = latestStatesByScene.get(task.sceneId) ?? new Map<string, LatestTaskState>()
    const state = states.get(task.key) ?? {
      latest: null,
      active: null,
      timer: null,
      queuedOrRunning: false,
      generation: currentGeneration(task.sceneId),
    }
    if (state.latest?.id === task.id || state.active?.id === task.id) return
    state.latest = task
    states.set(task.key, state)
    latestStatesByScene.set(task.sceneId, states)
    if (state.queuedOrRunning) return
    if (state.timer) {
      if (!task.force) return
      clearTimeout(state.timer)
      state.timer = null
    }
    scheduleLatestTask(task.sceneId, task.key, state, task.force ? 0 : task.delayMs)
  }

  function scheduleLatestTask(
    sceneId: string,
    key: string,
    state: LatestTaskState,
    delayMs: number,
  ): void {
    if (state.timer || state.queuedOrRunning || state.generation !== currentGeneration(sceneId)) return
    state.timer = setTimeout(() => {
      state.timer = null
      if (state.generation !== currentGeneration(sceneId) || state.queuedOrRunning) return
      state.queuedOrRunning = true
      enqueueInternal({
        id: `latest:${key}`,
        sceneId,
        label: state.latest?.label ?? "latest chat bubble snapshot",
        run: async (signal) => {
          if (!state.active) {
            state.active = state.latest
            state.latest = null
          }
          if (state.active) await state.active.run(signal)
        },
        onSettled: () => {
          if (state.generation !== currentGeneration(sceneId)) return
          state.active = null
          state.queuedOrRunning = false
          const next = state.latest
          if (next) {
            scheduleLatestTask(sceneId, key, state, next.force ? 0 : next.delayMs)
            return
          }
          latestStatesByScene.get(sceneId)?.delete(key)
          if (latestStatesByScene.get(sceneId)?.size === 0) latestStatesByScene.delete(sceneId)
        },
      })
    }, Math.max(0, delayMs))
  }

  async function drainScene(sceneId: string): Promise<void> {
    if (runningScenes.has(sceneId)) return
    runningScenes.add(sceneId)
    const generation = currentGeneration(sceneId)
    try {
      while (generation === currentGeneration(sceneId)) {
        const queue = queuesByScene.get(sceneId)
        if (!queue || queue.length === 0) {
          queuesByScene.delete(sceneId)
          break
        }
        const task = queue.shift()!
        if (queue.length === 0) queuesByScene.delete(sceneId)
        await runTask(task, generation)
        if (generation === currentGeneration(sceneId)) {
          taskIdsByScene.get(sceneId)?.delete(task.id)
          task.onSettled?.()
        }
      }
    } finally {
      const isCurrentGeneration = generation === currentGeneration(sceneId)
      if (!isCurrentGeneration) return
      runningScenes.delete(sceneId)
      const queue = queuesByScene.get(sceneId)
      if (queue && queue.length > 0) {
        void drainScene(sceneId)
      }
    }
  }

  async function runTask(task: ChatBubblePersistenceTask, generation: number): Promise<void> {
    for (let attempt = 0; attempt <= options.retryLimit; attempt += 1) {
      if (generation !== currentGeneration(task.sceneId)) return
      const controller = new AbortController()
      controllersByScene.set(task.sceneId, controller)
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs)
      try {
        await task.run(controller.signal)
        return
      } catch (error) {
        if (generation !== currentGeneration(task.sceneId)) return
        if (attempt >= options.retryLimit) {
          console.warn(`[chat] persist ${task.label} failed:`, error)
          return
        }
        await sleep(options.retryDelayMs * (attempt + 1))
      } finally {
        clearTimeout(timeoutId)
        if (controllersByScene.get(task.sceneId) === controller) {
          controllersByScene.delete(task.sceneId)
        }
      }
    }
  }

  return { enqueue, enqueueLatest, clearScene, clearAll }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
