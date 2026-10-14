import { Volume2, VolumeX } from "lucide-react"

import { useAgentInteractionSoundPreference } from "@/features/chat/runtime/agentInteractionSound"

export function AgentInteractionSoundToggle({
  agentInstanceId,
  presentation = "floating",
}: {
  agentInstanceId: string | null | undefined
  presentation?: "floating" | "inline" | "rail"
}) {
  const [enabled, setEnabled] = useAgentInteractionSoundPreference(agentInstanceId)
  if (!agentInstanceId) return null

  const Icon = enabled ? Volume2 : VolumeX
  const title = enabled ? "当前 Agent 提示音已开启，点击关闭" : "当前 Agent 提示音已关闭，点击开启"
  const inline = presentation === "inline"
  const rail = presentation === "rail"

  return (
    <button
      type="button"
      className={`pointer-events-auto inline-flex items-center justify-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-app-accent-muted/20 ${
        rail
          ? "size-9"
          : inline
            ? "h-8 gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-2 text-[11px] font-medium shadow-sm"
            : "absolute left-3 top-[4.25rem] z-10 rounded-full p-1"
      } ${enabled ? "text-app-success hover:text-app-success/85" : "text-app-subtle hover:text-app-muted"}`}
      title={title}
      aria-label={title}
      aria-pressed={enabled}
      onClick={() => setEnabled(!enabled)}
    >
      <Icon className="size-4" aria-hidden="true" />
      {inline ? <span>提示音</span> : null}
    </button>
  )
}
