import { useEffect, useMemo, useRef } from "react"

import {
  createSceneCommunicationManager,
  type SceneCommunicationCallbacks,
  type SceneCommunicationManager,
} from "@/features/chat/runtime/sceneCommunication"

/**
 * 在 React 组件树中持有一个稳定的 Scene 通信运行时（SSE + heartbeat + gap replay + re-attach）manager。
 *
 * - 使用 useMemo 保证整个组件生命周期内 manager 引用稳定，所有 mutation / effect 回调
 *   都引用同一个 manager 实例。
 * - 通过 `callbacksRef` 间接读取最新一帧的 callbacks，避免每帧 manager 重建。
 *   manager 内部实际持有的是 stable wrapper，每次调用都读 ref.current 拿到 latest 闭包。
 * - unmount 时显式释放所有底层资源：
 *   - close 所有 SSE client
 *   - 停止所有 heartbeat setInterval + heartbeat error 快重试 setTimeout
 *   - 清理所有 pending events flush 定时器 + gap replay buffer
 *   - 清理所有 re-attach recovery 退避定时器
 *   - 清空所有 scene workspace 映射 + cursor
 *   - 释放 reattaching 锁
 *   保证 ChatPage 卸载（路由切换 / Tab 切换）后不出现网络请求 / interval 泄漏 / 内存泄漏。
 */
export function useSceneCommunication(callbacks: SceneCommunicationCallbacks): SceneCommunicationManager {
  const callbacksRef = useRef(callbacks)
  useEffect(() => {
    callbacksRef.current = callbacks
  })

  const manager = useMemo(
    () => createSceneCommunicationManager({
      appendEvents: (sceneId, events) => callbacksRef.current.appendEvents(sceneId, events),
      requestReattach: (sceneId, reason) => callbacksRef.current.requestReattach(sceneId, reason),
      updateCommunicationHealth: (sceneId, updater) =>
        callbacksRef.current.updateCommunicationHealth(sceneId, updater),
      getCommunicationHealth: (sceneId) => callbacksRef.current.getCommunicationHealth(sceneId),
      markSceneDirty: (sceneId, dirty) => callbacksRef.current.markSceneDirty(sceneId, dirty),
      getSceneStreamId: (sceneId) => callbacksRef.current.getSceneStreamId(sceneId),
      isSceneAlive: (sceneId) => callbacksRef.current.isSceneAlive(sceneId),
      isLifecycleBackground: () => callbacksRef.current.isLifecycleBackground(),
      fetchCommunicationGap: (streamId, options) =>
        callbacksRef.current.fetchCommunicationGap(streamId, options),
      detectStaleScene: (state, nowMs) => callbacksRef.current.detectStaleScene(state, nowMs),
      chatDebug: (label, payload) => callbacksRef.current.chatDebug(label, payload),
      onGenerationReset: (sceneId, gen) => callbacksRef.current.onGenerationReset?.(sceneId, gen),
    }),
    [],
  )

  useEffect(() => () => {
    // 顺序：先关 SSE 与 heartbeat 防止再触发回调，再清 timer / buffer / cursor / workspace / reattaching。
    manager.closeAllEventClients()
    manager.stopAllHeartbeats()
    manager.clearAllPendingEvents()
    manager.clearAllRecoveryRetries()
    manager.clearAllHeartbeatQuickRetries()
    manager.clearAllSceneWorkspaces()
    manager.clearAllCursors()
    manager.unmarkAllReattaching()
  }, [manager])

  return manager
}
