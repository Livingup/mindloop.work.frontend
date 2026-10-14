import { isRuntimeAuthInvalidError } from "@/shared/api/runtimeAuthInvalidation"
import { QueryClient } from "@tanstack/react-query"

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !isRuntimeAuthInvalidError(error) && failureCount < 1,
    },
  },
})
