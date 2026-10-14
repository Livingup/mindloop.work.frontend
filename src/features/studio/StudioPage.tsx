import { useQuery } from "@tanstack/react-query"

import { listAgents, listMcpServices, listPromptSnippets, listSkills, listTools } from "@/features/studio/studioApi"
import { Badge } from "@/shared/components/Badge"
import { ResourceCard } from "@/shared/components/ResourceCard"

export function StudioPage() {
  const agentsQuery = useQuery({ queryKey: ["studio", "agents"], queryFn: listAgents })
  const skillsQuery = useQuery({ queryKey: ["studio", "skills"], queryFn: listSkills })
  const mcpQuery = useQuery({ queryKey: ["studio", "mcp-services"], queryFn: listMcpServices })
  const snippetsQuery = useQuery({ queryKey: ["studio", "prompt-snippets"], queryFn: listPromptSnippets })
  const toolsQuery = useQuery({ queryKey: ["studio", "tools"], queryFn: listTools })

  return (
    <div className="h-full overflow-auto px-8 py-7">
      <header className="mb-7">
        <h1 className="text-3xl font-semibold tracking-tight">Studio</h1>
      </header>

      <div className="grid grid-cols-2 gap-5 2xl:grid-cols-3">
        <ResourceCard
          title="Agent"
          items={agentsQuery.data}
          isLoading={agentsQuery.isLoading}
          error={agentsQuery.error}
          emptyText="暂无 Agent"
          getItemKey={(agent) => agent.agent_id}
          renderItem={(agent) => (
            <div className="rounded-2xl border border-app-border/80 bg-app-surface/85 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-app-primary">{agent.name ?? agent.agent_id}</div>
                  <div className="mt-1 truncate font-mono text-xs text-app-muted">{agent.agent_id}</div>
                </div>
                <Badge tone={agent.disabled ? "red" : "green"}>{agent.disabled ? "disabled" : "enabled"}</Badge>
              </div>
              <div className="mt-3 flex gap-4 text-xs text-app-secondary">
                <span>{agent.group}</span>
                <span>工具 {agent.tool_ids.length}</span>
                <span>Skill {agent.skill_ids.length}</span>
              </div>
            </div>
          )}
        />

        <ResourceCard
          title="Skill"
          items={skillsQuery.data}
          isLoading={skillsQuery.isLoading}
          error={skillsQuery.error}
          emptyText="暂无 Skill"
          getItemKey={(skill) => skill.skill_id}
          renderItem={(skill) => (
            <div className="rounded-2xl border border-app-border/80 bg-app-surface/85 p-4">
              <div className="text-sm font-medium text-app-primary">{skill.name}</div>
              <div className="mt-1 truncate font-mono text-xs text-app-muted">{skill.skill_id}</div>
            </div>
          )}
        />

        <ResourceCard
          title="MCP"
          items={mcpQuery.data}
          isLoading={mcpQuery.isLoading}
          error={mcpQuery.error}
          emptyText="暂无 MCP"
          getItemKey={(service) => service.service_id}
          renderItem={(service) => (
            <div className="rounded-2xl border border-app-border/80 bg-app-surface/85 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-app-primary">{service.name}</div>
                  <div className="mt-1 truncate font-mono text-xs text-app-muted">{service.service_id}</div>
                </div>
                <Badge tone={service.connected ? "green" : service.enabled ? "amber" : "slate"}>{service.connected ? "connected" : service.enabled ? "enabled" : "disabled"}</Badge>
              </div>
              <div className="mt-3 text-xs text-app-secondary">{service.transport_type}</div>
            </div>
          )}
        />

        <ResourceCard
          title="Prompt"
          items={snippetsQuery.data}
          isLoading={snippetsQuery.isLoading}
          error={snippetsQuery.error}
          emptyText="暂无 Prompt"
          getItemKey={(snippet) => snippet.name}
          renderItem={(snippet) => (
            <div className="rounded-2xl border border-app-border/80 bg-app-surface/85 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-app-primary">{snippet.name}</div>
                  <div className="mt-1 text-xs text-app-muted">{snippet.category}</div>
                </div>
                <Badge tone="purple">{snippet.text.length}</Badge>
              </div>
            </div>
          )}
        />

        <ResourceCard
          title="工具"
          items={toolsQuery.data}
          isLoading={toolsQuery.isLoading}
          error={toolsQuery.error}
          emptyText="暂无工具"
          getItemKey={(tool) => tool.tool_name}
          renderItem={(tool) => (
            <div className="rounded-2xl border border-app-border/80 bg-app-surface/85 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-sm font-medium text-app-primary">{tool.tool_name}</div>
                  <div className="mt-1 truncate text-xs text-app-muted">{tool.group}</div>
                </div>
                <Badge tone={tool.category === "lifecycle" ? "amber" : tool.category === "system" ? "purple" : "blue"}>{tool.category}</Badge>
              </div>
            </div>
          )}
        />
      </div>
    </div>
  )
}
