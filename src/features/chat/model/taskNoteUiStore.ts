import { create } from "zustand"

export type TaskNoteDensityMode = "compact" | "expanded"
export type InspectorTab = "timeline" | "task_note"

type TaskNoteUiState = {
  activeTab: InspectorTab
  activeTabByAgent: Record<string, InspectorTab>
  densityMode: TaskNoteDensityMode
  sectionCollapsed: Record<string, boolean>
  setActiveTab: (tab: InspectorTab, agentInstanceId?: string | null) => void
  getActiveTab: (agentInstanceId?: string | null) => InspectorTab
  setDensityMode: (mode: TaskNoteDensityMode) => void
  toggleDensityMode: () => void
  isSectionCollapsed: (key: string, defaultCollapsed?: boolean) => boolean
  toggleSectionCollapsed: (key: string, defaultCollapsed?: boolean) => void
}

export const useTaskNoteUiStore = create<TaskNoteUiState>((set, get) => ({
  activeTab: "timeline",
  activeTabByAgent: {},
  densityMode: "compact",
  sectionCollapsed: {},

  setActiveTab: (tab, agentInstanceId) =>
    set((state) => ({
      activeTab: tab,
      activeTabByAgent: agentInstanceId
        ? {
            ...state.activeTabByAgent,
            [agentInstanceId]: tab,
          }
        : state.activeTabByAgent,
    })),

  getActiveTab: (agentInstanceId) => {
    if (!agentInstanceId) return get().activeTab
    return get().activeTabByAgent[agentInstanceId] ?? get().activeTab ?? "timeline"
  },
  setDensityMode: (mode) => set({ densityMode: mode }),
  toggleDensityMode: () =>
    set((state) => ({
      densityMode: state.densityMode === "compact" ? "expanded" : "compact",
    })),

  isSectionCollapsed: (key, defaultCollapsed = false) => {
    const custom = get().sectionCollapsed[key]
    return custom !== undefined ? custom : defaultCollapsed
  },

  toggleSectionCollapsed: (key, defaultCollapsed = false) =>
    set((state) => {
      const current =
        state.sectionCollapsed[key] !== undefined
          ? state.sectionCollapsed[key]
          : defaultCollapsed
      return {
        sectionCollapsed: {
          ...state.sectionCollapsed,
          [key]: !current,
        },
      }
    }),
}))
