import { create } from "zustand"

type MemoryDraftGuardState = {
  dirty: boolean
  confirmLeaveMessage: string
  setDirty: (dirty: boolean) => void
}

export const useMemoryDraftGuardStore = create<MemoryDraftGuardState>((set) => ({
  dirty: false,
  confirmLeaveMessage: "Memory 页面有未保存修改，切换项目会放弃这些修改。是否继续？",
  setDirty: (dirty) => set({ dirty }),
}))

export type MemoryDraftGuardSnapshot = {
  dirty: boolean
  confirmLeaveMessage: string
}

export function readMemoryDraftGuardSnapshot(message?: string): MemoryDraftGuardSnapshot {
  const { dirty, confirmLeaveMessage } = useMemoryDraftGuardStore.getState()
  return {
    dirty,
    confirmLeaveMessage: message ?? confirmLeaveMessage,
  }
}
