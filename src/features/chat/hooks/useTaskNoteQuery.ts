import { useQuery } from "@tanstack/react-query"
import {
  classifyTaskNoteError,
  fetchTaskNoteSnapshot,
  shouldRetryTaskNoteQuery,
  taskNoteKeys,
  type TaskNoteErrorKind,
} from "@/features/chat/api/taskNoteApi"

export function useTaskNoteQuery(
  taskId: string | null | undefined,
  agentInstanceId: string | null | undefined,
) {
  const query = useQuery({
    queryKey: taskNoteKeys.detail(taskId, agentInstanceId),
    queryFn: () => fetchTaskNoteSnapshot(taskId!, agentInstanceId!),
    enabled: Boolean(taskId?.trim() && agentInstanceId),
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: shouldRetryTaskNoteQuery,
  })

  const errorKind: TaskNoteErrorKind | null = query.error
    ? classifyTaskNoteError(query.error)
    : null

  return {
    ...query,
    errorKind,
  }
}
