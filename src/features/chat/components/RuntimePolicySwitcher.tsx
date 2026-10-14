import { ChevronDown, Cpu, Loader2 } from "lucide-react"
import { useMemo } from "react"

import type { AgentRuntimeInstance } from "@/features/chat/api/agentRuntimeApi"
import { type LlmExecutionPolicy } from "@/features/settings/settingsApi"
import { type AgentDefinition } from "@/features/studio/studioApi"

/**
 * Chat header 右上角的 LLM 策略切换器（运行时切换 agent instance 的 llm_policy_group_id）。
 *
 * - 输入：当前 agent 的允许策略组列表 + agent_definition 的可用策略子集；
 *   过滤后只展示当前 agent 允许的策略。
 * - 列表为空或正在切换时整体置为 disabled。
 * - 选中变化时调用 onSwitch；切换中显示 loading；切换报错在右侧展示 truncate 文本。
 */
export function RuntimePolicySwitcher({
  agent,
  instance,
  policies,
  isSwitching,
  error,
  onBeforeOpen,
  onSwitch,
}: {
  agent: AgentDefinition | null
  instance: AgentRuntimeInstance
  policies: LlmExecutionPolicy[]
  isSwitching: boolean
  error: string | null
  onBeforeOpen?: () => void
  onSwitch: (policyGroupId: string) => void
}) {
  const allowedPolicies = useMemo(() => filterPoliciesForAgent(policies, agent), [agent, policies])
  const currentPolicy = instance.llm_policy_group_id
    ? allowedPolicies.find((policy) => policy.policy_group_id === instance.llm_policy_group_id) ?? null
    : null
  const currentLabel = currentPolicy
    ? currentPolicy.name ?? currentPolicy.policy_group_id
    : instance.llm_policy_group_id
      ? instance.llm_policy_group_id
      : "直接模型"
  const isDisabled = isSwitching || allowedPolicies.length === 0
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div
        className={`relative inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] transition-colors ${
          isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:bg-slate-900/[0.04]"
        }`}
        title={`LLM 策略：${currentLabel}`}
        onMouseDown={() => {
          if (!isSwitching) onBeforeOpen?.()
        }}
      >
        <Cpu size={12} className="shrink-0 text-slate-500" aria-hidden />
        <span className="max-w-[180px] truncate font-medium text-slate-800">{currentLabel}</span>
        {isSwitching ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-slate-400" aria-hidden />
        ) : (
          <ChevronDown size={11} className="shrink-0 text-slate-400" aria-hidden />
        )}
        <select
          value={instance.llm_policy_group_id ?? ""}
          onFocus={() => {
            if (!isSwitching) onBeforeOpen?.()
          }}
          onChange={(event) => {
            if (event.target.value && event.target.value !== instance.llm_policy_group_id) onSwitch(event.target.value)
          }}
          disabled={isDisabled}
          aria-label="切换 LLM 策略"
          className="absolute inset-0 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        >
          {!instance.llm_policy_group_id ? <option value="">直接模型</option> : null}
          {allowedPolicies.map((policy) => (
            <option key={policy.policy_group_id} value={policy.policy_group_id}>
              {policy.name ?? policy.policy_group_id}
            </option>
          ))}
        </select>
      </div>
      {error ? <div className="max-w-48 truncate text-[11px] text-red-700">{error}</div> : null}
    </div>
  )
}

function filterPoliciesForAgent(policies: LlmExecutionPolicy[], agent: AgentDefinition | null) {
  const allowedPolicyGroupIds = agent?.allowed_llm_policy_group_ids ?? []
  if (!agent || allowedPolicyGroupIds.length === 0) return policies
  const allowed = new Set(allowedPolicyGroupIds)
  return policies.filter((policy) => allowed.has(policy.policy_group_id))
}
