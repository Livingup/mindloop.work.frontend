import { requestJson } from "@/shared/api/httpClient"

export type ContextCompressionSettings = {
  enabled: boolean
  llm_policy_group_id: string | null
  updated_at: string | null
}

export type ContextCompressionSettingsUpdateBody = {
  llm_policy_group_id?: string | null
}

export type ObserverPromptDetail = {
  prompt_text: string
}

/** 获取上下文观察者策略设置 */
export function getContextCompressionSettings() {
  return requestJson<ContextCompressionSettings>("/api/context-compression/settings")
}

/** 更新上下文观察者绑定的 LLM 执行策略组 */
export function updateContextCompressionSettings(body: ContextCompressionSettingsUpdateBody) {
  return requestJson<ContextCompressionSettings>("/api/context-compression/settings", {
    method: "PUT",
    body,
  })
}

/** 获取观察者系统提示词 */
export function getObserverPrompt() {
  return requestJson<ObserverPromptDetail>("/api/context-compression/observer-prompt")
}
