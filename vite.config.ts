import path from "node:path"
import react from "@vitejs/plugin-react"
import autoprefixer from "autoprefixer"
import tailwindcss from "tailwindcss"
import { defineConfig, loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  const projectRoot = __dirname
  const env = loadEnv(mode, projectRoot, "")
  const apiBaseUrl = env.VITE_API_BASE_URL || "http://127.0.0.1:18000"

  return {
    root: projectRoot,
    envDir: projectRoot,
    plugins: [react()],
    css: {
      postcss: {
        plugins: [
          tailwindcss({ config: path.resolve(projectRoot, "tailwind.config.ts") }),
          autoprefixer(),
        ],
      },
    },
    resolve: {
      alias: { "@": path.resolve(projectRoot, "src") },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: apiBaseUrl,
          changeOrigin: true,
        },
      },
    },
  }
})
