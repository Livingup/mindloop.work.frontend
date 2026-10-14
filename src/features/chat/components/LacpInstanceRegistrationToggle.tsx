import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, RadioTower } from "lucide-react"

import {
  getLacpInstanceRegistration,
  setLacpInstanceRegistration,
  type LacpRegistrationResponse,
} from "@/features/chat/api/agentRuntimeApi"

export function LacpInstanceRegistrationToggle({
  instanceId,
}: {
  instanceId: string
}) {
  const queryClient = useQueryClient()
  const queryKey = ["chat", "lacp-instance-registration", instanceId]
  const registrationQuery = useQuery({
    queryKey,
    queryFn: () => getLacpInstanceRegistration(instanceId),
    enabled: Boolean(instanceId),
    refetchInterval: 3000,
  })
  const mutation = useMutation({
    mutationFn: (enabled: boolean) => setLacpInstanceRegistration(instanceId, enabled),
    onSuccess: (registration) => {
      queryClient.setQueryData(queryKey, registration)
      queryClient.invalidateQueries({ queryKey: ["chat", "lacp-status"] })
    },
  })

  const registration = registrationQuery.data
  const isEnabled = Boolean(registration?.enabled)
  const isBusy = registrationQuery.isFetching || mutation.isPending || registration?.status === "registering"
  const view = lacpRegistrationView(registration)
  const nextEnabled = !isEnabled
  const errorText = mutation.error instanceof Error ? mutation.error.message : null

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        type="button"
        onClick={() => mutation.mutate(nextEnabled)}
        disabled={mutation.isPending || !instanceId}
        className={`inline-flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${view.classes}`}
        title={`${view.title}。点击${nextEnabled ? "注册" : "注销"}当前 Agent 实例。`}
        aria-label={`${view.title}。点击${nextEnabled ? "注册" : "注销"}当前 Agent 实例。`}
        aria-pressed={isEnabled}
      >
        {isBusy ? (
          <Loader2 size={13} className="animate-spin" aria-hidden />
        ) : (
          <RadioTower size={13} aria-hidden />
        )}
      </button>
      {errorText ? <span className="max-w-56 truncate text-[11px] text-red-700" title={errorText}>{errorText}</span> : null}
    </div>
  )
}

function lacpRegistrationView(registration: LacpRegistrationResponse | null | undefined): {
  title: string
  classes: string
} {
  if (!registration?.enabled) {
    return {
      title: "当前 Agent 实例未注册到 LACP",
      classes: "text-slate-400 hover:bg-slate-900/[0.04]",
    }
  }
  if (registration.status === "registered") {
    return {
      title: "当前 Agent 实例已注册到 LACP",
      classes: "bg-[#e5eef5] text-[#4f6f96] hover:bg-[#d9e5ee]",
    }
  }
  if (registration.status === "failed") {
    const detail = registration.error_message ? `：${registration.error_message}` : ""
    return {
      title: `当前 Agent 实例注册 LACP 失败${detail}`,
      classes: "bg-red-50 text-red-700 hover:bg-red-100",
    }
  }
  return {
    title: "当前 Agent 实例正在注册到 LACP",
    classes: "bg-amber-50 text-amber-700 hover:bg-amber-100",
  }
}
