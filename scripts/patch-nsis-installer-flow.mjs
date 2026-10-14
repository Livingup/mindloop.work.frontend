import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const nsisRoot = path.join(projectRoot, "node_modules", "app-builder-lib", "templates", "nsis")

async function patchFile(relativePath, replacements) {
  const filePath = path.join(nsisRoot, relativePath)
  let content = await fs.readFile(filePath, "utf8")
  let changed = false

  for (const { marker, search, replace, alreadyPatched } of replacements) {
    if (content.includes(marker) || (alreadyPatched && content.includes(alreadyPatched))) {
      continue
    }
    if (!content.includes(search)) {
      throw new Error(`Cannot patch ${relativePath}: expected source block not found for marker ${marker}`)
    }
    content = content.replace(search, replace)
    changed = true
  }

  if (changed) {
    await fs.writeFile(filePath, content, "utf8")
    console.log(`Patched electron-builder NSIS installer flow: ${relativePath}`)
  }
}

await patchFile("include/extractAppPackage.nsh", [
  {
    marker: "spread-ai-installer-flow: extractUsing7za auto fallback after CopyFiles failures",
    alreadyPatched: "      Goto FallbackExtract7za",
    search: "      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION \"$(appCannotBeClosed)\" /SD IDRETRY IDCANCEL AbortExtract7za",
    replace: "      # spread-ai-installer-flow: extractUsing7za auto fallback after CopyFiles failures\n      Goto FallbackExtract7za",
  },
  {
    marker: "FallbackExtract7za:",
    search: "    # As an absolutely last resort after a few automatic attempts and user\n    # intervention - we will just overwrite everything with `Nsis7z::Extract`",
    replace: "  FallbackExtract7za:\n    # As an automatic fallback after repeated CopyFiles failures, overwrite everything with `Nsis7z::Extract`\n    # even though it is not atomic and will ignore errors.",
  },
  {
    marker: "spread-ai-installer-flow: removed unused AbortExtract7za label",
    alreadyPatched: "removed unused AbortExtract7za label",
    search: "  AbortExtract7za:\n    Quit\n\n  RetryExtract7za:",
    replace: "  # spread-ai-installer-flow: removed unused AbortExtract7za label\n\n  RetryExtract7za:",
  },
])
