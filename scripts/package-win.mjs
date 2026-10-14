import { spawnSync } from "node:child_process"
import fs from "node:fs/promises"
import fsSync from "node:fs"
import os from "node:os"
import path from "node:path"
import process from "node:process"
import { fileURLToPath } from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = path.resolve(projectRoot, "..")
const runtimeRoot = path.join(workspaceRoot, "agentruntime")
const pythonCommand = process.env.PYTHON || "python"
const louyiSourceRoot = process.env.SPREAD_AI_LOUYI_SOURCE_DIR
  ? path.resolve(process.env.SPREAD_AI_LOUYI_SOURCE_DIR)
  : path.resolve(workspaceRoot, "..", "louyi")
const resourcesRoot = path.join(projectRoot, "build-resources")
const backendOutputDir = path.join(resourcesRoot, "backend")
const runtimeConfigDir = path.join(resourcesRoot, "runtime-config")
const frontendResourceDir = path.join(resourcesRoot, "frontend")

function run(command, args, options = {}) {
  const env = {
    ...process.env,
    ...options.env,
  }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? projectRoot,
    stdio: "inherit",
    env,
  })
  if (result.error) {
    throw new Error(`Command failed to start: ${command}`, { cause: result.error })
  }
  if (result.status !== 0) {
    throw new Error(`Command exited with status ${result.status}: ${command}`)
  }
}

function npmCliPath() {
  const explicitPath = process.env.npm_execpath
  if (explicitPath && fsSync.existsSync(explicitPath)) {
    return explicitPath
  }
  return path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
}

await fs.mkdir(backendOutputDir, { recursive: true })
await fs.mkdir(runtimeConfigDir, { recursive: true })
await fs.mkdir(frontendResourceDir, { recursive: true })
await fs.copyFile(
  path.join(runtimeRoot, "config", "agent_runtime.yaml"),
  path.join(runtimeConfigDir, "agent_runtime.yaml"),
)

run(process.execPath, [npmCliPath(), "run", "build"], {
  cwd: projectRoot,
  env: {
    VITE_RUNTIME_API_BASE_URL: "",
    VITE_API_BASE_URL: "",
  },
})
await fs.rm(frontendResourceDir, { recursive: true, force: true })
await fs.cp(path.join(projectRoot, "dist"), frontendResourceDir, { recursive: true })

const louyiPyproject = path.join(louyiSourceRoot, "pyproject.toml")
const louyiPackageRoot = path.join(louyiSourceRoot, "src", "louyi_codex")
if (!fsSync.existsSync(louyiPyproject) || !fsSync.existsSync(louyiPackageRoot)) {
  throw new Error(`louyi-codex source repository not found at ${louyiSourceRoot}. Set SPREAD_AI_LOUYI_SOURCE_DIR to the current SDK source checkout.`)
}
const wheelDir = await fs.mkdtemp(path.join(os.tmpdir(), "spread-ai-louyi-wheel-"))
try {
  run(pythonCommand, ["-m", "pip", "wheel", ".", "--no-deps", "--wheel-dir", wheelDir], { cwd: louyiSourceRoot })
  const wheels = (await fs.readdir(wheelDir)).filter((name) => /^louyi_codex-.*\.whl$/i.test(name))
  if (wheels.length !== 1) {
    throw new Error(`Expected exactly one louyi-codex wheel in ${wheelDir}, found ${wheels.length}.`)
  }
  run(pythonCommand, ["-m", "pip", "install", "--force-reinstall", "--no-deps", path.join(wheelDir, wheels[0])], { cwd: runtimeRoot })
} finally {
  await fs.rm(wheelDir, { recursive: true, force: true })
}

run(pythonCommand, ["-m", "pip", "install", "-e", "."], { cwd: runtimeRoot })
run(pythonCommand, ["-m", "pip", "install", "pyinstaller>=6.0,<7.0"], { cwd: runtimeRoot })
run(pythonCommand, ["scripts/build_desktop_runtime.py", "--output", backendOutputDir], { cwd: runtimeRoot })
const electronBuilderCliPath = path.join(projectRoot, "node_modules", "electron-builder", "cli.js")
const nsisInstallerFlowPatchScript = path.join(projectRoot, "scripts", "patch-nsis-installer-flow.mjs")
run(process.execPath, [nsisInstallerFlowPatchScript], { cwd: projectRoot })
run(process.execPath, [electronBuilderCliPath, "--win"], { cwd: projectRoot })
