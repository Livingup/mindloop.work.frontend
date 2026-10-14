import { create } from "zustand"

/**
 * Chat 页面侧边面板可见性偏好。
 *
 * 用户级布局偏好（独立于 scene/workspace），跨 Tab、跨进程共享，因此使用 localStorage：
 * - 浏览器多个 Tab 之间面板偏好保持一致；Electron 新窗口启动时复用最近一次偏好。
 * - 仅持久化布尔切换状态，不与具体 sceneId 绑定。
 */
const STORAGE_KEY = "spread-ai.layout.panel-visibility"

type StoredState = {
  workspacePanelVisible: boolean
  terminalPanelVisible: boolean
  /**
   * Electron 桌面壳下 header 是否启用 `-webkit-app-region: drag`。
   *
   * 默认 true。dev 模式开发者使用 IDE（Windsurf / Cascade 等）注入的「选择元素」
   * 浮层时，drag region 会在 mousedown 阶段被 Chromium 直接消费给原生窗口拖拽，
   * **事件根本不会冒泡到 JS**，IDE 浮层的 capture-phase click 监听器收不到事件。
   * 用户可以通过键盘快捷键 Ctrl/Cmd+Alt+D 临时关闭 drag，让 IDE 浮层恢复点击优先级；
   * 选完元素后再次按下快捷键恢复 drag。
   *
   * 同时 AppShell 还会自动检测 `<body>` 上的 `cursor: crosshair`（多数 IDE 选择浮层
   * 进入选择模式时会改 body 的 cursor），自动临时让位，无需用户每次按快捷键。
   */
  electronDragEnabled: boolean
}

type PanelVisibilityStore = StoredState & {
  toggleWorkspacePanel: () => void
  toggleTerminalPanel: () => void
  toggleElectronDrag: () => void
  setWorkspacePanelVisible: (visible: boolean) => void
  setTerminalPanelVisible: (visible: boolean) => void
  setElectronDragEnabled: (enabled: boolean) => void
}

const DEFAULT_STATE: StoredState = {
  workspacePanelVisible: true,
  terminalPanelVisible: true,
  electronDragEnabled: true,
}

const initialState = readStoredState()

export const usePanelVisibilityStore = create<PanelVisibilityStore>((set, get) => ({
  ...initialState,
  toggleWorkspacePanel: () => {
    const next = !get().workspacePanelVisible
    set({ workspacePanelVisible: next })
    writeStoredState({ ...get(), workspacePanelVisible: next })
  },
  toggleTerminalPanel: () => {
    const next = !get().terminalPanelVisible
    set({ terminalPanelVisible: next })
    writeStoredState({ ...get(), terminalPanelVisible: next })
  },
  toggleElectronDrag: () => {
    const next = !get().electronDragEnabled
    set({ electronDragEnabled: next })
    writeStoredState({ ...get(), electronDragEnabled: next })
  },
  setWorkspacePanelVisible: (visible) => {
    set({ workspacePanelVisible: visible })
    writeStoredState({ ...get(), workspacePanelVisible: visible })
  },
  setTerminalPanelVisible: (visible) => {
    set({ terminalPanelVisible: visible })
    writeStoredState({ ...get(), terminalPanelVisible: visible })
  },
  setElectronDragEnabled: (enabled) => {
    set({ electronDragEnabled: enabled })
    writeStoredState({ ...get(), electronDragEnabled: enabled })
  },
}))

function readStoredState(): StoredState {
  if (typeof window === "undefined") return DEFAULT_STATE
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STATE
    const parsed = JSON.parse(raw) as Partial<StoredState>
    return {
      workspacePanelVisible: typeof parsed.workspacePanelVisible === "boolean"
        ? parsed.workspacePanelVisible
        : DEFAULT_STATE.workspacePanelVisible,
      terminalPanelVisible: typeof parsed.terminalPanelVisible === "boolean"
        ? parsed.terminalPanelVisible
        : DEFAULT_STATE.terminalPanelVisible,
      electronDragEnabled: typeof parsed.electronDragEnabled === "boolean"
        ? parsed.electronDragEnabled
        : DEFAULT_STATE.electronDragEnabled,
    }
  } catch {
    return DEFAULT_STATE
  }
}

function writeStoredState(state: StoredState) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
      workspacePanelVisible: state.workspacePanelVisible,
      terminalPanelVisible: state.terminalPanelVisible,
      electronDragEnabled: state.electronDragEnabled,
    }))
  } catch {
    // localStorage 不可用 / 配额耗尽：吞掉。最坏情况是退化为内存态偏好。
  }
}
