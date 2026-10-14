import { Navigate, createBrowserRouter } from "react-router-dom"

import { AgentsPage } from "@/features/agents/AgentsPage"
import { ContextCompressionPage } from "@/features/context-compression/ContextCompressionPage"
import { LacpPage } from "@/features/lacp/LacpPage"
import { LlmPage } from "@/features/llm/LlmPage"
import { LogsPage } from "@/features/logs/LogsPage"
import { McpPage } from "@/features/mcp/McpPage"
import { MemoryPage } from "@/features/memory/MemoryPage"
import { PromptsPage } from "@/features/prompts/PromptsPage"
import { PromptVariablesPage } from "@/features/prompts/PromptVariablesPage"
import { PdfViewerPage } from "@/features/chat/components/PdfViewerPage"

import { SettingsPage } from "@/features/settings/SettingsPage"
import { SkillsPage } from "@/features/skills/SkillsPage"
import { ToolsPage } from "@/features/tools/ToolsPage"
import { AppShell } from "@/shared/layout/AppShell"
import { RuntimeAuthGate } from "@/shared/runtime/RuntimeAuthGate"

export const router = createBrowserRouter([
  {
    path: "/pdf-viewer",
    element: <PdfViewerPage />,
  },
  {
    path: "/",
    element: <RuntimeAuthGate><AppShell /></RuntimeAuthGate>,
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: "chat", element: null },
      { path: "agents", element: <Navigate to="/agents/definitions" replace /> },
      { path: "agents/definitions", element: <AgentsPage /> },
      { path: "agents/prompts", element: <PromptsPage /> },
      { path: "agents/variables", element: <PromptVariablesPage /> },
      { path: "mcp", element: <McpPage /> },
      { path: "skills", element: <SkillsPage /> },
      { path: "memory", element: <MemoryPage /> },
      { path: "llm", element: <Navigate to="/llm/policies" replace /> },
      { path: "llm/providers", element: <LlmPage resource="providers" /> },
      { path: "llm/models", element: <LlmPage resource="models" /> },
      { path: "llm/policies", element: <LlmPage resource="policies" /> },
      { path: "context-compression", element: <ContextCompressionPage /> },
      { path: "lacp", element: <LacpPage /> },
      { path: "logs", element: <Navigate to="/logs/overview" replace /> },
      { path: "logs/overview", element: <LogsPage /> },
      { path: "logs/cleanup", element: <LogsPage /> },
      { path: "logs/llm-http", element: <LogsPage /> },

      { path: "tools", element: <ToolsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "*", element: <Navigate to="/chat" replace /> },
    ],
  },
])
