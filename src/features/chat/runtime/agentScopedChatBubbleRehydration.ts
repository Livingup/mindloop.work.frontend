import type { AgentRuntimeInstance, ChatBubbleMessageDto } from "@/features/chat/api/agentRuntimeApi"
import {
  listAgentScopesNeedingHydration,
  type AgentRuntimeState,
  type AgentScopedChatBubbleHydration,
  type ChatBubbleHydrationOptions,
} from "@/features/chat/model/chatStore"
import { chatTimelineDebug } from "@/features/chat/runtime/chatTimelineDebug"

type AgentHydrationSceneSnapshot = {
  agentInstance: AgentRuntimeInstance | null
  isRestoring: boolean
  agentRuntimeStates: Record<string, AgentRuntimeState>
}

export type AgentChatBubbleRehydrationDependencies = {
  getScene: (sceneId: string) => AgentHydrationSceneSnapshot | null | undefined
  listChatBubbles: (sceneId: string, agentInstanceId: string) => Promise<{ messages: ChatBubbleMessageDto[] }>
  markHydrating: (sceneId: string, agentInstanceIds: string[]) => void
  beginHydration: (sceneId: string, agentInstanceId: string) => number
  hydrate: (
    sceneId: string,
    batches: AgentScopedChatBubbleHydration[],
    options: ChatBubbleHydrationOptions,
    requestGeneration: number,
  ) => boolean
  cancelHydration: (sceneId: string, agentInstanceId: string, requestGeneration: number) => void
  markFailed: (sceneId: string, agentInstanceIds: string[]) => void
  onError?: (sceneId: string, agentInstanceId: string, error: unknown) => void
}

export type AgentChatBubbleRehydrationResult = "skipped" | "hydrated" | "failed"

/**
 * Restore exactly one explicitly selected Agent ledger from ChatBubble durable history.
 *
 * This function deliberately has no Scene transport/attach dependency: a healthy Scene SSE must not be
 * rebuilt merely because one Agent UI working set was evicted. Calling it again while the target is
 * hydrating is a no-op because the store selector excludes hydrating scopes.
 */
export async function rehydrateAgentChatBubbles(
  sceneId: string,
  agentInstanceId: string | null | undefined,
  dependencies: AgentChatBubbleRehydrationDependencies,
): Promise<AgentChatBubbleRehydrationResult> {
  const targetAgentInstanceId = agentInstanceId?.trim()
  if (!targetAgentInstanceId) return "skipped"

  const scene = dependencies.getScene(sceneId)
  if (!scene?.agentInstance || scene.isRestoring) return "skipped"
  const [targetState] = listAgentScopesNeedingHydration(scene, targetAgentInstanceId)
  if (!targetState) return "skipped"

  dependencies.markHydrating(sceneId, [targetAgentInstanceId])
  const requestGeneration = dependencies.beginHydration(sceneId, targetAgentInstanceId)
  chatTimelineDebug("targeted_hydration.start", { sceneId, agentInstanceId: targetAgentInstanceId, requestGeneration })
  try {
    const result = await dependencies.listChatBubbles(sceneId, targetAgentInstanceId)
    const invalidBubble = result.messages.find((bubble) => {
      const owner = typeof bubble.agent_instance_id === "string" ? bubble.agent_instance_id.trim() : ""
      return owner !== targetAgentInstanceId
    })
    if (invalidBubble) {
      const actualOwner = typeof invalidBubble.agent_instance_id === "string"
        ? invalidBubble.agent_instance_id.trim()
        : ""
      throw new Error(
        `ChatBubble owner contract violation: bubble=${invalidBubble.bubble_id} expected=${targetAgentInstanceId} actual=${actualOwner || "missing"}`,
      )
    }

    const hydrated = dependencies.hydrate(
      sceneId,
      [{ agentInstanceId: targetAgentInstanceId, bubbles: result.messages }],
      { mode: "baseline" },
      requestGeneration,
    )
    if (!hydrated) throw new Error("Coordinator rejected targeted ChatBubble hydration")
    chatTimelineDebug("targeted_hydration.complete", { sceneId, agentInstanceId: targetAgentInstanceId, requestGeneration, bubbleCount: result.messages.length })
    return "hydrated"
  } catch (error) {
    chatTimelineDebug("targeted_hydration.failed", { sceneId, agentInstanceId: targetAgentInstanceId, requestGeneration, error: error instanceof Error ? error.name : "unknown" })
    dependencies.cancelHydration(sceneId, targetAgentInstanceId, requestGeneration)
    dependencies.markFailed(sceneId, [targetAgentInstanceId])
    dependencies.onError?.(sceneId, targetAgentInstanceId, error)
    return "failed"
  }
}



