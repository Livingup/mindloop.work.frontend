import { spawn } from "node:child_process"
import { createRequire } from "node:module"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const require = createRequire(import.meta.url)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? "http://127.0.0.1:5173"
const rendererPort = new URL(rendererUrl).port || "5173"
const isWindows = process.platform === "win32"
const electronBinary = require("electron")

const vite = spawn(isWindows ? "npm.cmd" : "npm", [
  "run",
  "dev",
  "--",
  "--host",
  "127.0.0.1",
  "--port",
  rendererPort,
  "--strictPort",
], {
  cwd: projectRoot,
  stdio: "inherit",
  env: process.env,
  shell: isWindows,
})

let electron = null
let stopped = false

async function waitForRenderer() {
  const deadline = Date.now() + 30_000
  while (!stopped && Date.now() < deadline) {
    try {
      const response = await fetch(rendererUrl)
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  throw new Error(`Timed out waiting for Vite renderer at ${rendererUrl}`)
}

async function startElectron() {
  if (stopped) return
  await waitForRenderer()
  electron = spawn(electronBinary, ["."], {
    cwd: projectRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: undefined,
      ELECTRON_RENDERER_URL: rendererUrl,
      ELECTRON_DEBUG_MODE: "1",
    },
  })

  electron.on("exit", (code) => {
    if (stopped) return
    stopped = true
    vite.kill()
    process.exit(code ?? 0)
  })
}

function stop() {
  if (stopped) return
  stopped = true
  electron?.kill()
  vite.kill()
}

process.on("SIGINT", () => {
  stop()
  process.exit(0)
})
process.on("SIGTERM", () => {
  stop()
  process.exit(0)
})

startElectron().catch((error) => {
  console.error(error)
  stop()
  process.exit(1)
})
