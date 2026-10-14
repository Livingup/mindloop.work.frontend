import React from "react"
import ReactDOM from "react-dom/client"
import { QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router-dom"

import { router } from "@/app/router"
import { queryClient } from "@/shared/api/queryClient"
import { installElectronFrontendDebugMode } from "@/shared/electron/frontendDebugMode"
import { AppInteractionProvider } from "@/shared/interaction/AppInteractionProvider"
import "@/styles.css"

installElectronFrontendDebugMode()

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppInteractionProvider>
        <RouterProvider router={router} />
      </AppInteractionProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
