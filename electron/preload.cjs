const { contextBridge, ipcRenderer, webUtils } = require("electron")

function pathToFileUri(filePath) {
  if (typeof filePath !== "string" || filePath.trim().length === 0) return null
  const normalizedPath = filePath.replace(/\\/g, "/")
  const encodedPath = normalizedPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
  if (normalizedPath.startsWith("//")) return `file:${encodedPath}`
  if (/^[A-Za-z]:\//.test(normalizedPath)) return `file:///${encodedPath}`
  if (normalizedPath.startsWith("/")) return `file://${encodedPath}`
  return null
}

function getFileUri(file) {
  const filePath = webUtils?.getPathForFile?.(file) || file?.path || null
  return pathToFileUri(filePath)
}

contextBridge.exposeInMainWorld("spreadDesktop", {
  platform: process.platform,
  isElectron: true,
  isDebugMode: process.env.ELECTRON_DEBUG_MODE === "1" || Boolean(process.env.ELECTRON_RENDERER_URL),
  // 通知主进程创建一个新的 BrowserWindow；主进程会复用 createMainWindow() 流程，自动加载相同 renderer 入口。
  openNewWindow: () => ipcRenderer.invoke("spread:open-new-window"),
  openPdfWindow: (targetUrl) => ipcRenderer.invoke("spread:open-pdf-window", targetUrl),
  openExternalUrl: (targetUrl) => ipcRenderer.invoke("spread:open-external-url", targetUrl),
  openSystemPath: (targetPath) => ipcRenderer.invoke("spread:open-system-path", targetPath),
  revealSystemPath: (targetPath) => ipcRenderer.invoke("spread:reveal-system-path", targetPath),
  getFileUri,
  appendLlmStreamLog: (line) => ipcRenderer.invoke("spread:append-llm-stream-log", line),
  appendNetworkLog: (records) => ipcRenderer.invoke("spread:append-network-log", records),
  restartRuntime: () => ipcRenderer.invoke("spread:restart-runtime"),
  getRuntimeApiBaseUrl: () => ipcRenderer.sendSync("spread:get-runtime-api-base-url"),
})
