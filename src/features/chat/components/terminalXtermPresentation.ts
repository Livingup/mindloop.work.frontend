import type { TerminalSession } from "@/features/chat/model/chatTypes"

/** 每个 Agent 终端在前端最多保留和显示的输出行数，超出后丢弃最早历史。 */
export const TERMINAL_SCROLLBACK_LINE_LIMIT = 1000

export type TerminalPane = {
  /** 稳定业务终端 ID；缺失时使用 session id 兜底，保证 UI tab 有稳定业务键。 */
  terminalId: string
  /** 当前终端最近一次命令会话，用于 tab 状态、cwd、shell 和标题展示。 */
  latestSession: TerminalSession
  /** 同一终端内按时间从旧到新的命令会话列表。 */
  sessions: TerminalSession[]
  /** 当前终端是否仍有 Agent 命令在运行。 */
  isRunning: boolean
}

export type TerminalPlaybackChunk = {
  /** 同一终端内用于 xterm 增量回放去重的稳定片段 ID。 */
  id: string
  /** 写入 xterm 的真实 stdout/stderr/pty 输出。 */
  text: string
}

/**
 * 将 scene 内的命令 session 按后端 terminal_id 聚合为终端面板 tab。
 *
 * chatStore 中 terminalSessions 采用“最新 session 在前”的顺序保存；xterm 回放需要按时间
 * 从旧到新写入，因此这里会在每个 terminal 分组内恢复为旧→新的业务顺序。
 */
export function buildTerminalPanes(sessions: TerminalSession[]): TerminalPane[] {
  const paneByTerminalId = new Map<string, TerminalSession[]>()

  for (const session of sessions) {
    const terminalId = terminalSessionKey(session)
    const terminalSessions = paneByTerminalId.get(terminalId) ?? []
    terminalSessions.push(session)
    paneByTerminalId.set(terminalId, terminalSessions)
  }

  return Array.from(paneByTerminalId.entries()).map(([terminalId, terminalSessions]) => {
    const sessionsNewestFirst = [...terminalSessions]
    const latestSession = sessionsNewestFirst[0]
    const sessionsOldestFirst = [...sessionsNewestFirst].reverse()
    return {
      terminalId,
      latestSession,
      sessions: sessionsOldestFirst,
      isRunning: sessionsNewestFirst.some((session) => session.status === "running"),
    }
  })
}

/**
 * 将某个终端下的命令会话转换为可顺序写入 xterm 的片段。
 *
 * 这里不解析 ANSI、不合成 prompt/命令行，只保留后端输出给 xterm 解释。
 */
export function buildTerminalPlaybackChunks(pane: TerminalPane): TerminalPlaybackChunk[] {
  const chunks: TerminalPlaybackChunk[] = []

  for (const session of pane.sessions) {
    for (const outputChunk of session.output) {
      const text = outputChunk.chunk
      if (!text) continue
      chunks.push({
        id: `${session.id}:output:${outputChunk.chunk_index}`,
        text,
      })
    }

  }

  return chunks
}

/** 生成终端 tab 的人类可读标题，优先显示后端真实 terminal_id。 */
export function terminalPaneTitle(pane: TerminalPane): string {
  return pane.terminalId
}

/** 生成终端 tab 的状态文案，表达该 terminal 最近业务状态。 */
export function terminalPaneStatusLabel(pane: TerminalPane): string {
  if (pane.isRunning) return "running"
  return pane.latestSession.status
}

function terminalSessionKey(session: TerminalSession): string {
  return session.terminalId ?? session.id
}
