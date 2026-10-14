import { type MutableRefObject, useCallback, useEffect, useRef, useState } from "react"

import interactionNotificationSoundUrl from "@/features/chat/assets/interaction-notification.mp3"
import { useChatStore, type SceneSlice } from "@/features/chat/model/chatStore"

const AGENT_INTERACTION_SOUND_STORAGE_KEY = "spread-ai.chat.agent-interaction-sound.enabled-by-agent-instance"
const MAX_SEEN_INTERACTION_IDS = 500

type AgentInteractionSoundPreferences = Record<string, boolean>

type PendingInteractionSoundCandidate = {
  interactionId: string
  agentInstanceId: string
}

export function isAgentInteractionSoundEnabled(agentInstanceId: string | null | undefined): boolean {
  if (!agentInstanceId) return false
  return readAgentInteractionSoundPreferences()[agentInstanceId] === true
}

export function setAgentInteractionSoundEnabled(agentInstanceId: string, enabled: boolean) {
  const preferences = readAgentInteractionSoundPreferences()
  if (enabled) {
    preferences[agentInstanceId] = true
  } else {
    delete preferences[agentInstanceId]
  }
  writeAgentInteractionSoundPreferences(preferences)
}

export function useAgentInteractionSoundPreference(agentInstanceId: string | null | undefined): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(() => isAgentInteractionSoundEnabled(agentInstanceId))

  useEffect(() => {
    setEnabledState(isAgentInteractionSoundEnabled(agentInstanceId))
    if (typeof window === "undefined") return undefined

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== AGENT_INTERACTION_SOUND_STORAGE_KEY) return
      setEnabledState(isAgentInteractionSoundEnabled(agentInstanceId))
    }

    window.addEventListener("storage", handleStorage)
    return () => window.removeEventListener("storage", handleStorage)
  }, [agentInstanceId])

  const setEnabled = useCallback((nextEnabled: boolean) => {
    if (!agentInstanceId) return
    setAgentInteractionSoundEnabled(agentInstanceId, nextEnabled)
    setEnabledState(nextEnabled)
  }, [agentInstanceId])

  return [enabled, setEnabled]
}

export function useAgentInteractionSoundNotifications() {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const seenInteractionIdsRef = useRef<Set<string>>(new Set())
  const seenInteractionOrderRef = useRef<string[]>([])

  useEffect(() => {
    const seenInteractionIds = seenInteractionIdsRef.current
    const seenInteractionOrder = seenInteractionOrderRef.current
    const rememberSeen = (interactionId: string) => rememberSeenInteraction(interactionId, seenInteractionIds, seenInteractionOrder)

    for (const candidate of collectPendingInteractionSoundCandidates(useChatStore.getState().scenes)) {
      rememberSeen(candidate.interactionId)
    }

    const unsubscribe = useChatStore.subscribe((state) => {
      for (const candidate of collectPendingInteractionSoundCandidates(state.scenes)) {
        if (seenInteractionIds.has(candidate.interactionId)) continue
        rememberSeen(candidate.interactionId)
        if (isAgentInteractionSoundEnabled(candidate.agentInstanceId)) {
          playInteractionNotificationSound(audioRef)
        }
      }
    })

    return unsubscribe
  }, [])
}

function readAgentInteractionSoundPreferences(): AgentInteractionSoundPreferences {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(AGENT_INTERACTION_SOUND_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}

    const preferences: AgentInteractionSoundPreferences = {}
    for (const [agentInstanceId, enabled] of Object.entries(parsed)) {
      if (enabled === true) preferences[agentInstanceId] = true
    }
    return preferences
  } catch {
    return {}
  }
}

function writeAgentInteractionSoundPreferences(preferences: AgentInteractionSoundPreferences) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(AGENT_INTERACTION_SOUND_STORAGE_KEY, JSON.stringify(preferences))
  } catch (error) {
    console.warn("[chat] persist agent interaction sound preference failed:", error)
  }
}

function collectPendingInteractionSoundCandidates(scenes: Record<string, SceneSlice>): PendingInteractionSoundCandidate[] {
  const candidates: PendingInteractionSoundCandidate[] = []
  for (const scene of Object.values(scenes)) {
    for (const runtimeState of Object.values(scene.agentRuntimeStates)) {
      const pendingInteraction = runtimeState.pendingInteraction
      const agentInstanceId = runtimeState.agentInstanceId
      if (!pendingInteraction || !agentInstanceId) continue

      candidates.push({
        interactionId: pendingInteraction.eventId,
        agentInstanceId,
      })
    }
  }
  return candidates
}

function rememberSeenInteraction(interactionId: string, seenInteractionIds: Set<string>, seenInteractionOrder: string[]) {
  if (seenInteractionIds.has(interactionId)) return
  seenInteractionIds.add(interactionId)
  seenInteractionOrder.push(interactionId)

  while (seenInteractionOrder.length > MAX_SEEN_INTERACTION_IDS) {
    const oldestInteractionId = seenInteractionOrder.shift()
    if (oldestInteractionId) seenInteractionIds.delete(oldestInteractionId)
  }
}

function playInteractionNotificationSound(audioRef: MutableRefObject<HTMLAudioElement | null>) {
  if (typeof Audio === "undefined") return

  const audio = audioRef.current ?? new Audio(interactionNotificationSoundUrl)
  if (!audioRef.current) {
    audio.preload = "auto"
    audioRef.current = audio
  }

  try {
    audio.currentTime = 0
  } catch {
    // 浏览器可能在媒体尚未可 seek 时拒绝重置，继续尝试播放即可。
  }

  void audio.play().catch((error) => {
    console.warn("[chat] play interaction notification sound failed:", error)
  })
}
