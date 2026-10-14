/// <reference types="vite/client" />

type SpreadDesktopPathOperationResult = {
  ok: boolean
  error?: string
}

interface SpreadDesktopBridge {
  platform?: string
  isElectron?: boolean
  isDebugMode?: boolean
  openNewWindow?: () => Promise<unknown>
  openPdfWindow?: (targetUrl: string) => Promise<unknown>
  openExternalUrl?: (targetUrl: string) => Promise<unknown>
  openSystemPath?: (targetPath: string) => Promise<SpreadDesktopPathOperationResult>
  revealSystemPath?: (targetPath: string) => Promise<SpreadDesktopPathOperationResult>
  getFileUri?: (file: File) => string | null | Promise<string | null>
  appendLlmStreamLog?: (line: string) => Promise<unknown>
  appendNetworkLog?: (records: unknown) => Promise<unknown>
  getRuntimeApiBaseUrl?: () => string | null
}

interface Window {
  spreadDesktop?: SpreadDesktopBridge
}
