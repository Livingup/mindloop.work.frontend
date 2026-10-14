import { requestJson } from "@/shared/api/httpClient"

export type SystemPromptSegment = {
  text?: string
  template_id?: string
}

export type McpToolBinding = {
  service_id: string
  tool_ids: string[]
}

export type AgentDefinition = {
  agent_id: string
  name: string | null
  description: string | null
  group: string
  system_prompt: SystemPromptSegment[]
  tool_ids: string[]
  mcp_tools: McpToolBinding[]
  skill_ids: string[]
  available_sub_agent_ids: string[]
  default_llm_policy_group_id: string | null
  allowed_llm_policy_group_ids: string[]
  builtin_background_agent: boolean
  disabled: boolean
}

export type AgentDefinitionCreateBody = AgentDefinition

export type AgentDefinitionUpdateBody = Omit<AgentDefinition, "agent_id">

export type SkillInfo = {
  skill_id: string
  name: string
  description: string
  directory_path: string
  license: string | null
  compatibility: string | null
  metadata: Record<string, string>
  allowed_tools: string | null
  group: string
}

export type McpServiceSummary = {
  service_id: string
  name: string
  description: string | null
  transport_type: string
  enabled: boolean
  connected: boolean
  group: string
}

export type PromptSnippet = {
  name: string
  text: string
  category: string
}

export type PromptBuiltinVariable = {
  placeholder: string
  name: string
  description: string
  value_logic: string
  category: string
}

export type ToolSummary = {
  tool_name: string
  description: string
  group: string
  wiki: string | null
  category: "business" | "lifecycle" | "system"
  always_enabled: boolean
  allowed_loop_decisions: string[]
}

export function listAgents() {
  return requestJson<AgentDefinition[]>("/api/agents")
}

export function getAgentDefinition(agentId: string) {
  return requestJson<AgentDefinition>(`/api/agents/${encodeURIComponent(agentId)}`)
}

export function createAgentDefinition(body: AgentDefinitionCreateBody) {
  return requestJson<AgentDefinition>("/api/agents", { method: "POST", body })
}

export function updateAgentDefinition(agentId: string, body: AgentDefinitionUpdateBody) {
  return requestJson<AgentDefinition>(`/api/agents/${encodeURIComponent(agentId)}`, { method: "PUT", body })
}

export function deleteAgentDefinition(agentId: string) {
  return requestJson<null>(`/api/agents/${encodeURIComponent(agentId)}`, { method: "DELETE" })
}

export function enableAgentDefinition(agentId: string) {
  return requestJson<AgentDefinition>(`/api/agents/${encodeURIComponent(agentId)}/enable`, { method: "POST" })
}

export function disableAgentDefinition(agentId: string) {
  return requestJson<AgentDefinition>(`/api/agents/${encodeURIComponent(agentId)}/disable`, { method: "POST" })
}

export function listSkills() {
  return requestJson<SkillInfo[]>("/api/skills")
}

export function setSkillGroup(skillId: string, group: string) {
  return requestJson<{ status: string; message: string }>(`/api/skills/${encodeURIComponent(skillId)}/group`, {
    method: "PATCH",
    body: { group },
  })
}

export function getSkillContent(skillId: string) {
  return requestJson<{ skill_id: string; content: string }>(`/api/skills/${encodeURIComponent(skillId)}/content`)
}

export type McpServiceDetail = {
  service_id: string
  name: string
  description: string | null
  transport: Record<string, unknown>
  enabled: boolean
  connected: boolean
  group: string
  usage_guide: string | null
}

export function listMcpServices() {
  return requestJson<McpServiceSummary[]>("/api/mcp-config/")
}

export function getMcpService(serviceId: string) {
  return requestJson<McpServiceDetail>(`/api/mcp-config/${encodeURIComponent(serviceId)}`)
}

export function addMcpService(body: {
  service_id: string
  name: string
  transport: Record<string, unknown>
  description?: string | null
  enabled?: boolean
  group?: string
  usage_guide?: string | null
}) {
  return requestJson<{ status: string; message: string }>("/api/mcp-config/", { method: "POST", body })
}

export function updateMcpService(
  serviceId: string,
  body: { name?: string; description?: string | null; transport?: Record<string, unknown>; group?: string | null; usage_guide?: string | null },
) {
  return requestJson<{ status: string; message: string }>(`/api/mcp-config/${encodeURIComponent(serviceId)}`, {
    method: "PATCH",
    body,
  })
}

export function deleteMcpService(serviceId: string) {
  return requestJson<{ status: string; message: string }>(`/api/mcp-config/${encodeURIComponent(serviceId)}`, {
    method: "DELETE",
  })
}

export function enableMcpService(serviceId: string) {
  return requestJson<{ status: string; message: string }>(`/api/mcp-config/${encodeURIComponent(serviceId)}/enable`, {
    method: "POST",
  })
}

export function disableMcpService(serviceId: string) {
  return requestJson<{ status: string; message: string }>(`/api/mcp-config/${encodeURIComponent(serviceId)}/disable`, {
    method: "POST",
  })
}

export function connectMcpService(serviceId: string) {
  return requestJson<{ status: string; message: string }>(`/api/mcp-config/${encodeURIComponent(serviceId)}/connect`, {
    method: "POST",
  })
}

export type McpServerInfo = {
  supports_tools: boolean
  supports_resources: boolean
  server_name: string
  server_version: string
  instructions: string | null
}

export type McpToolSummary2 = {
  name: string
  description: string | null
}

export type McpToolDetail = {
  name: string
  description: string | null
  input_schema: Record<string, unknown>
}

export function inspectMcpService(serviceId: string) {
  return requestJson<McpServerInfo>(`/api/mcp/${encodeURIComponent(serviceId)}/inspect`)
}

export function listMcpTools(serviceId: string) {
  return requestJson<McpToolSummary2[]>(`/api/mcp/${encodeURIComponent(serviceId)}/tools`)
}

export function getMcpToolDetail(serviceId: string, toolNames: string[]) {
  return requestJson<McpToolDetail[]>(`/api/mcp/${encodeURIComponent(serviceId)}/tool-detail`, {
    method: "POST",
    body: { tool_names: toolNames },
  })
}

export function listPromptSnippets() {
  return requestJson<PromptSnippet[]>("/api/prompt-snippets/")
}

export function createPromptSnippet(body: { name: string; text: string; category?: string }) {
  return requestJson<PromptSnippet>("/api/prompt-snippets/", { method: "POST", body })
}

export function updatePromptSnippet(
  currentName: string,
  body: { new_name?: string; new_text?: string; new_category?: string },
) {
  return requestJson<PromptSnippet>(`/api/prompt-snippets/${encodeURIComponent(currentName)}`, {
    method: "PUT",
    body,
  })
}

export function deletePromptSnippet(name: string) {
  return requestJson<null>(`/api/prompt-snippets/${encodeURIComponent(name)}`, { method: "DELETE" })
}

export function listPromptBuiltinVariables() {
  return requestJson<PromptBuiltinVariable[]>("/api/prompt-snippets/builtin-variables")
}

export type ToolDetail = {
  tool_name: string
  description: string
  group: string
  public: boolean
  wiki: string | null
  category: "business" | "lifecycle" | "system"
  always_enabled: boolean
  allowed_loop_decisions: string[]
  schemas: Record<string, Record<string, unknown>>
}

export function listTools() {
  return requestJson<ToolSummary[]>("/api/tools/")
}

export function getToolDetail(name: string) {
  return requestJson<ToolDetail>(`/api/tools/${encodeURIComponent(name)}`)
}
