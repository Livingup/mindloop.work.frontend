import { useCallback } from "react"

import { deleteSceneTerminal } from "@/features/chat/api/agentRuntimeApi"
import { TerminalPanel } from "@/features/chat/components/TerminalPanel"
import { useAgentTerminalProjection } from "@/features/chat/hooks/useAgentUiProjection"
import { useChatStore } from "@/features/chat/model/chatStore"

/**
 * 把 chatStore 当前 scene 的 terminalSessions 与 close-terminal mutation 接到
 * TerminalPanel 上。单独成文件保留 sceneId/workspacePath 入参，让 ChatPage 主体
 * 不再耦合 deleteSceneTerminal API。
 */
export function TerminalPanelContainer({
  sceneId,
  workspacePath,
  agentInstanceId,
}: {
  sceneId: string
  workspacePath: string | null
  agentInstanceId?: string | null
}) {
  const { scopeId: terminalScopeId, terminalSessions } = useAgentTerminalProjection(sceneId, agentInstanceId)
  const removeTerminalSessions = useChatStore((state) => state.removeTerminalSessions)
  const handleCloseTerminal = useCallback(async (terminalId: string) => {
    if (!workspacePath) throw new Error("缺少 workspacePath，无法关闭终端。")
    if (!agentInstanceId) throw new Error("缺少 Agent 实例，无法关闭终端。")
    await deleteSceneTerminal(sceneId, terminalId, workspacePath, agentInstanceId)
    removeTerminalSessions(sceneId, agentInstanceId, terminalId)
  }, [agentInstanceId, removeTerminalSessions, sceneId, workspacePath])
  return (
    <TerminalPanel
      key={terminalScopeId}
      terminalScopeId={terminalScopeId}
      sessions={terminalSessions}
      onCloseTerminal={workspacePath ? handleCloseTerminal : undefined}
    />
  )
}



