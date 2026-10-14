import { useQuery } from "@tanstack/react-query"
import {
  Archive,
  AppWindow,
  Bot,
  BookOpen,
  Braces,
  ChevronDown,
  Brain,
  Cpu,
  Database,
  FileSearch,
  FileText,
  LogOut,
  Plug,
  RadioTower,
  Server,
  Settings,
  Sparkles,
  UserCircle,
  Wrench,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom"

import { loadWorkspaceGitStatus, type WorkspaceGitRepositoryStatus, type WorkspaceGitStatusResponse } from "@/features/chat/api/workspacesApi"
import { ChatPage } from "@/features/chat/components/ChatPage"
import { useSceneUiStore } from "@/features/chat/model/sceneStore"
import { usePanelVisibilityStore } from "@/shared/layout/panelVisibilityStore"
import { useDocumentTitleFromWorkspace } from "@/shared/hooks/useDocumentTitleFromWorkspace"
import { useIsMobileRuntimeLayout } from "@/shared/hooks/useRuntimeLayoutMode"
import { useRuntimeSession } from "@/shared/runtime/RuntimeAuthGate"

/**
 * Header 折叠按钮使用的「面板」图标。设计意图：用一个图标同时表达「面板可见」与「面板隐藏」两种状态，
 * 视觉上左侧的小列在展开（filled=true）时被填充高亮；折叠（filled=false）时只剩轮廓。
 * 与 VS Code 侧栏切换按钮的视觉语言一致，避免在两个 lucide 图标（PanelLeft / PanelLeftClose）之间切换造成的形状跳变。
 */
function PanelLeftIcon({ filled = false, size = 14 }: { filled?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 3v18" />
      {filled && <rect x="3" y="3" width="6" height="18" rx="2" fill="currentColor" stroke="none" />}
    </svg>
  )
}

/**
 * PanelLeftIcon 的右侧镜像版本。filled=true 时右侧小列填充高亮，用于「右侧终端面板」开关。
 */
function PanelRightIcon({ filled = false, size = 14 }: { filled?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M15 3v18" />
      {filled && <rect x="15" y="3" width="6" height="18" rx="2" fill="currentColor" stroke="none" />}
    </svg>
  )
}

type SpreadDesktopBridge = {
  isElectron?: boolean
  openNewWindow?: () => Promise<unknown>
}

const mainNavItems = [
  {
    to: "/agents",
    label: "Agent",
    icon: Bot,
    children: [
      { to: "/agents/definitions", label: "Agent Definitions", icon: Sparkles },
      { to: "/agents/prompts", label: "Prompt Templates", icon: FileText },
      { to: "/agents/variables", label: "系统变量", icon: Braces },
    ],
  },
  { to: "/mcp", label: "MCP", icon: Plug },
  { to: "/skills", label: "Skill", icon: BookOpen },
  { to: "/memory", label: "Memory", icon: Database },
  {
    to: "/llm",
    label: "LLM",
    icon: Brain,
    children: [
      { to: "/llm/policies", label: "Policies", icon: FileText },
      { to: "/llm/providers", label: "Providers", icon: Server },
      { to: "/llm/models", label: "Models", icon: Cpu },
    ],
  },
  { to: "/context-compression", label: "Compression", icon: Archive },
  { to: "/lacp", label: "LACP", icon: RadioTower },
  { to: "/tools", label: "Tools", icon: Wrench },
]

type WorkspaceGitStatusViewItem = {
  key: string
  repositoryName: string
  statusText: string
  title: string
  dirty: boolean
}

function getWorkspaceGitStatusViewItems(response: WorkspaceGitStatusResponse | undefined): WorkspaceGitStatusViewItem[] {
  if (!response) return []
  return getWorkspaceGitRepositories(response).map((repository) => {
    const repositoryName = getRepositoryDisplayName(repository)
    const statusText = repository.display_text || repository.branch || "HEAD"
    const dirtyText = repository.dirty ? "有未提交更新" : "干净"
    const reasonText = repository.reason ? `；原因: ${repository.reason}` : ""
    return {
      key: repository.repository_path || repository.relative_path,
      repositoryName,
      statusText,
      title: `Git 仓库: ${repositoryName}\n相对路径: ${repository.relative_path}\n路径: ${repository.repository_path}\n状态: ${statusText}（${dirtyText}）${reasonText}`,
      dirty: repository.dirty,
    }
  })
}

function getRepositoryDisplayName(repository: WorkspaceGitRepositoryStatus): string {
  const pathName = getPathBaseName(repository.repository_path)
  if (pathName) return pathName
  const relativeName = repository.relative_path === "." ? null : getPathBaseName(repository.relative_path)
  return relativeName || "Git"
}

function getPathBaseName(path: string | null | undefined): string | null {
  const normalizedPath = path?.replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalizedPath) return null
  return normalizedPath.split("/").filter(Boolean).pop() || null
}

function getWorkspaceGitRepositories(response: WorkspaceGitStatusResponse): WorkspaceGitRepositoryStatus[] {
  if (response.repositories?.length) return response.repositories
  if (!response.is_git_repository_root) return []
  return [
    {
      repository_path: response.workspace_path,
      relative_path: ".",
      branch: response.branch,
      dirty: response.dirty,
      display_text: response.display_text,
      reason: response.reason,
    },
  ]
}

export function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  // 多窗口/多 Tab 各自根据本窗口 workspace 同步 OS 窗口标题（任务栏/Alt-Tab）。
  useDocumentTitleFromWorkspace()
  const isChatRoute = location.pathname === "/chat" || location.pathname.startsWith("/chat/")
  const isLogsRoute = location.pathname === "/logs" || location.pathname.startsWith("/logs/")
  const isDesktopShell = typeof window !== "undefined" && "spreadDesktop" in window
  const desktopBridge = isDesktopShell
    ? ((window as Window & { spreadDesktop?: SpreadDesktopBridge }).spreadDesktop ?? null)
    : null
  const isMobileLayout = useIsMobileRuntimeLayout()
  const isMobileShell = !isDesktopShell && isMobileLayout
  const runtimeSession = useRuntimeSession()
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileNavMenuOpen, setMobileNavMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)
  const mobileNavMenuRef = useRef<HTMLDivElement | null>(null)
  const workspacePanelVisible = usePanelVisibilityStore((state) => state.workspacePanelVisible)
  const terminalPanelVisible = usePanelVisibilityStore((state) => state.terminalPanelVisible)
  const electronDragEnabled = usePanelVisibilityStore((state) => state.electronDragEnabled)
  const toggleWorkspacePanel = usePanelVisibilityStore((state) => state.toggleWorkspacePanel)
  const toggleTerminalPanel = usePanelVisibilityStore((state) => state.toggleTerminalPanel)
  const toggleElectronDrag = usePanelVisibilityStore((state) => state.toggleElectronDrag)
  const currentProject = useSceneUiStore((state) => state.currentProject)
  const currentWorkspacePath = useSceneUiStore((state) => state.currentWorkspacePath)
  const hasOpenedProject = Boolean(currentProject && currentWorkspacePath)
  const accountLabel = runtimeSession.account?.username?.trim() || "已登录"
  const showHeaderActions = hasOpenedProject || runtimeSession.authenticated
  const workspaceGitStatusQuery = useQuery({
    queryKey: ["workspace", "git-status", currentWorkspacePath],
    queryFn: () => loadWorkspaceGitStatus({ workspace_path: currentWorkspacePath ?? "" }),
    enabled: Boolean(currentWorkspacePath),
    retry: false,
    staleTime: 5_000,
    refetchInterval: hasOpenedProject ? 10_000 : false,
  })
  const workspaceGitStatusItems = getWorkspaceGitStatusViewItems(workspaceGitStatusQuery.data)
  const workspaceGitStatusTitle = workspaceGitStatusItems.length
    ? workspaceGitStatusItems.map((item) => item.title).join("\n")
    : undefined
  const showTopNavigation = hasOpenedProject && !isMobileShell
  // inspectorOverlayActive：自动检测 IDE 注入的「选择元素」浮层是否处于选择模式。
  // 多数选择器浮层（Windsurf / Cascade / React DevTools 等）进入选择模式时会把 <html>
  // 或 <body> 的 cursor 切到 'crosshair'。我们用 MutationObserver 监听 style/class 变化，
  // 命中时把 header drag-region 临时关闭，让浮层的 capture-phase click 能在 header
  // 区域接收到事件——drag-region 在 mousedown 阶段就被 Chromium 直接消费给原生拖拽，
  // 事件不会冒泡到 JS，必须在 CSS 层让位。
  const [inspectorOverlayActive, setInspectorOverlayActive] = useState(false)
  const activeMain = mainNavItems.find((item) => {
    if (item.children?.some((child) => location.pathname === child.to || location.pathname.startsWith(`${child.to}/`))) return true
    return location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)
  })

  // 键盘快捷键 Ctrl/Cmd+Alt+D：手动切换 header drag-region。
  // 用作自动检测的兜底：如果某个 IDE 浮层选择模式没有改 cursor:crosshair，
  // 用户也能主动按一下让 header 让位、选完元素再按一下恢复拖拽。
  useEffect(() => {
    if (!isDesktopShell) return
    const handler = (event: KeyboardEvent) => {
      if (!event.altKey) return
      if (!(event.ctrlKey || event.metaKey)) return
      if (event.key.toLowerCase() !== "d") return
      event.preventDefault()
      toggleElectronDrag()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isDesktopShell, toggleElectronDrag])

  // 自动检测 <html>/<body> 上 cursor:crosshair：IDE 选择浮层进入选择模式时
  // 通常会临时改 cursor，监听 style/class 变化命中后置 inspectorOverlayActive=true，
  // 在 CSS 层临时关闭 header drag-region 让出 click 优先级。
  useEffect(() => {
    if (!isDesktopShell) return
    if (typeof window === "undefined" || typeof document === "undefined") return
    const detect = () => {
      const bodyCursor = document.body?.style.cursor
      const rootCursor = document.documentElement?.style.cursor
      const computedBodyCursor = document.body ? getComputedStyle(document.body).cursor : ""
      const isCrosshair = (
        bodyCursor === "crosshair"
        || rootCursor === "crosshair"
        || computedBodyCursor === "crosshair"
      )
      setInspectorOverlayActive((prev) => (prev === isCrosshair ? prev : isCrosshair))
    }
    detect()
    const observer = new MutationObserver(detect)
    if (document.body) {
      observer.observe(document.body, { attributes: true, attributeFilter: ["style", "class"] })
    }
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class"] })
    return () => observer.disconnect()
  }, [isDesktopShell])

  // 复合状态：只有「桌面壳 + 用户开关启用 + 当前不在选择元素模式」三者同时成立时才施加 drag-region。
  const applyDragRegion = isDesktopShell && electronDragEnabled && !inspectorOverlayActive

  useEffect(() => {
    if (!accountMenuOpen) return
    if (typeof document === "undefined") return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!accountMenuRef.current?.contains(target)) {
        setAccountMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountMenuOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [accountMenuOpen])

  useEffect(() => {
    if (!mobileNavMenuOpen) return
    if (typeof document === "undefined") return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (!mobileNavMenuRef.current?.contains(target)) {
        setMobileNavMenuOpen(false)
      }
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavMenuOpen(false)
    }

    document.addEventListener("pointerdown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [mobileNavMenuOpen])

  useEffect(() => {
    if (hasOpenedProject || isChatRoute) return
    navigate("/chat", { replace: true })
  }, [hasOpenedProject, isChatRoute, navigate])

  const handleOpenNewWindow = () => {
    // Electron 桌面壳：优先通过 preload IPC 让主进程独立创建新的 BrowserWindow，
    // 拿到回执便于失败时打日志；同时新窗口共享 preload、安全隔离与 backgroundThrottling 配置。
    if (desktopBridge?.openNewWindow) {
      void desktopBridge.openNewWindow().catch((error) => {
        console.error("[shell] open new window failed", error)
      })
      return
    }
    // 浏览器 / 旧版 Electron preload：用 window.open 打开同源新 Tab。
    // noopener 让新 Tab 与当前 Tab 完全独立，sessionStorage 不会从当前 Tab 复制，
    // 保证"一个 Tab 绑定一个工作目录"的产品语义；Electron 主进程对同源 URL 的 setWindowOpenHandler
    // 也会把这个调用拦截到 createMainWindow()，等价于桌面壳新建独立窗口。
    if (typeof window === "undefined") return
    window.open(window.location.href, "_blank", "noopener")
  }

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-app-bg text-app-primary">
      {/*
        header 的 drag/no-drag 与 padding 是分离的两件事：
        - `pl-2 pr-[140px]` 仅取决于是否运行在 Electron 桌面壳，用来给 Windows minimize/maximize/close
          原生 overlay 留空间；浏览器使用 `px-3` 即可。
        - `electron-drag-region` 取决于复合开关 `applyDragRegion`：用户主动关闭、
          或 IDE 选择浮层进入选择模式时都会让位，避免 Chromium 在 mousedown 阶段
          抢走鼠标事件、导致选择浮层无法在 header 区域接收 click。
      */}
      <header className={[
        "flex min-h-9 shrink-0 items-center border-b border-app-border/80 bg-app-shell text-xs text-app-secondary shadow-[0_1px_0_rgba(255,255,255,0.75)]",
        isMobileShell ? "px-2 py-1" : isDesktopShell ? "pl-2 pr-[140px]" : "px-3",
        applyDragRegion ? "electron-drag-region" : "",
      ].filter(Boolean).join(" ")}>
        {isMobileShell && hasOpenedProject && (
          <div ref={mobileNavMenuRef} className="electron-no-drag relative mr-2 min-w-0">
            <button
              type="button"
              onClick={() => setMobileNavMenuOpen((open) => !open)}
              className="inline-flex h-8 max-w-[9.5rem] items-center gap-1.5 rounded-lg border border-app-border/80 bg-app-surface/90 px-2 text-[11px] font-medium text-app-primary shadow-sm transition hover:bg-app-surface-hover"
              title="打开主菜单"
              aria-label="打开主菜单"
              aria-haspopup="menu"
              aria-expanded={mobileNavMenuOpen}
            >
              {activeMain ? <activeMain.icon size={14} /> : <Bot size={14} />}
              <span className="min-w-0 truncate">{activeMain?.label ?? "菜单"}</span>
              <ChevronDown size={12} className={mobileNavMenuOpen ? "shrink-0 rotate-180 transition" : "shrink-0 transition"} />
            </button>
            {mobileNavMenuOpen && (
              <div
                role="menu"
                className="absolute left-0 top-9 z-50 w-56 rounded-2xl border border-app-border/80 bg-app-surface/95 p-1.5 text-xs text-app-secondary shadow-card backdrop-blur"
              >
                {mainNavItems.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.children?.[0]?.to ?? item.to}
                    onClick={() => setMobileNavMenuOpen(false)}
                    className={[
                      "flex items-center gap-2 rounded-xl px-2.5 py-2 transition",
                      activeMain?.to === item.to ? "bg-app-selected text-app-primary" : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                    ].join(" ")}
                    title={item.label}
                    role="menuitem"
                  >
                    <item.icon size={15} />
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  </NavLink>
                ))}
                <div className="my-1 h-px bg-app-border/70" />
                <NavLink
                  to="/logs"
                  onClick={() => setMobileNavMenuOpen(false)}
                  className={({ isActive }) => [
                    "flex items-center gap-2 rounded-xl px-2.5 py-2 transition",
                    isActive || isLogsRoute ? "bg-app-selected text-app-primary" : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                  ].join(" ")}
                  title="log"
                  role="menuitem"
                >
                  <FileSearch size={15} />
                  <span className="min-w-0 flex-1 truncate">log</span>
                </NavLink>
                <NavLink
                  to="/settings"
                  onClick={() => setMobileNavMenuOpen(false)}
                  className={({ isActive }) => [
                    "flex items-center gap-2 rounded-xl px-2.5 py-2 transition",
                    isActive ? "bg-app-selected text-app-primary" : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                  ].join(" ")}
                  title="Settings"
                  role="menuitem"
                >
                  <Settings size={15} />
                  <span className="min-w-0 flex-1 truncate">Settings</span>
                </NavLink>
              </div>
            )}
          </div>
        )}
        {isMobileShell && (
          <div
            id="chat-scene-tabs-header-slot"
            className={[
              "mobile-scene-tabs-header-slot flex h-8 min-w-0 flex-1 items-end overflow-hidden",
              hasOpenedProject ? "" : "hidden",
            ].join(" ")}
          />
        )}
        {showTopNavigation && (
          <div className={[
            "electron-no-drag mr-2 flex shrink-0 items-center gap-1 border-r border-app-border/80 pr-2",
          ].join(" ")}>
            {mainNavItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.children?.[0]?.to ?? item.to}
                className={[
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition",
                  activeMain?.to === item.to
                    ? "bg-app-selected text-app-primary"
                    : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                ].join(" ")}
                title={item.label}
              >
                <item.icon size={14} />
                <span>{item.label}</span>
              </NavLink>
            ))}
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                [
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition",
                  isActive
                    ? "bg-app-selected text-app-primary"
                    : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                ].join(" ")
              }
              title="Settings"
            >
              <Settings size={14} />
              <span>Settings</span>
            </NavLink>
            <NavLink
              to="/logs"
              className={({ isActive }) =>
                [
                  "inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-[11px] transition",
                  isActive || isLogsRoute
                    ? "bg-app-selected text-app-primary"
                    : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                ].join(" ")
              }
              title="log"
            >
              <FileSearch size={14} />
              <span>log</span>
            </NavLink>
          </div>
        )}
        {/*
          chat-scene-tabs-header-slot 不再整块 electron-no-drag。
          header 整体是 electron-drag-region，slot 内部 SceneTabsBar 的 tabs 间隙、tabs 之外的空白会继承 drag，
          用户可以从这片中央区域长按拖动整个 Electron 窗口；SceneTabsBar 内部的可点击按钮自身用 electron-no-drag 标记。
          没有这一改动，header 中央被 no-drag 占满，加上左右两侧的导航/工具栏 no-drag，整个 header 会失去可拖拽像素。
        */}
        {!isMobileShell && (
          <div
            id="chat-scene-tabs-header-slot"
            className="flex h-full min-w-0 flex-1 items-end justify-center overflow-hidden"
          />
        )}
        {showHeaderActions && (
          <div className={[
            isMobileShell
              ? "electron-no-drag ml-auto flex shrink-0 items-center gap-1"
              : "electron-no-drag ml-2 flex shrink-0 items-center gap-1 border-l border-app-border/80 pl-2",
          ].join(" ")}>
            {hasOpenedProject && isChatRoute && !isMobileShell && (
              <button
                type="button"
                onClick={toggleWorkspacePanel}
                title={workspacePanelVisible ? "隐藏左侧工作目录树" : "显示左侧工作目录树"}
                aria-label={workspacePanelVisible ? "隐藏左侧工作目录树" : "显示左侧工作目录树"}
                aria-pressed={workspacePanelVisible}
                className={[
                  "inline-flex h-7 w-7 items-center justify-center rounded-md transition",
                  workspacePanelVisible
                    ? "bg-app-selected text-app-primary"
                    : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                ].join(" ")}
              >
                <PanelLeftIcon size={14} filled={workspacePanelVisible} />
              </button>
            )}
            {hasOpenedProject && isChatRoute && !isMobileShell && (
              <button
                type="button"
                onClick={toggleTerminalPanel}
                title={terminalPanelVisible ? "隐藏右侧执行区" : "显示右侧执行区"}
                aria-label={terminalPanelVisible ? "隐藏右侧执行区" : "显示右侧执行区"}
                aria-pressed={terminalPanelVisible}
                className={[
                  "inline-flex h-7 w-7 items-center justify-center rounded-md transition",
                  terminalPanelVisible
                    ? "bg-app-selected text-app-primary"
                    : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                ].join(" ")}
              >
                <PanelRightIcon size={14} filled={terminalPanelVisible} />
              </button>
            )}
            {hasOpenedProject && (
              <button
                type="button"
                onClick={handleOpenNewWindow}
                title={isDesktopShell ? "新建窗口" : "在新标签页打开"}
                aria-label={isDesktopShell ? "新建窗口" : "在新标签页打开"}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary"
              >
                <AppWindow size={14} />
              </button>
            )}
            {runtimeSession.authenticated && (
              <div ref={accountMenuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setAccountMenuOpen((open) => !open)}
                  title={`当前账号：${accountLabel}`}
                  aria-label={`当前账号：${accountLabel}`}
                  aria-haspopup="menu"
                  aria-expanded={accountMenuOpen}
                  className={[
                    "inline-flex items-center rounded-md text-[11px] text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary",
                    isMobileShell ? "h-8 w-8 justify-center" : "h-7 max-w-40 gap-1 px-2",
                  ].join(" ")}
                >
                  <UserCircle size={isMobileShell ? 16 : 14} />
                  {!isMobileShell ? (
                    <>
                      <span className="max-w-24 truncate">{accountLabel}</span>
                      <ChevronDown size={12} className={accountMenuOpen ? "rotate-180 transition" : "transition"} />
                    </>
                  ) : null}
                </button>
                {accountMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-8 z-50 w-48 rounded-xl border border-app-border/80 bg-app-surface/95 p-1.5 text-xs text-app-secondary shadow-card backdrop-blur"
                  >
                    <div className="px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-[0.16em] text-app-subtle">当前账号</div>
                      <div className="mt-0.5 truncate font-medium text-app-primary" title={accountLabel}>{accountLabel}</div>
                    </div>
                    <div className="my-1 h-px bg-app-border/70" />
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountMenuOpen(false)
                        void runtimeSession.logout()
                      }}
                      disabled={runtimeSession.logoutPending}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-app-muted transition hover:bg-app-surface-hover hover:text-app-primary disabled:cursor-wait disabled:opacity-50"
                    >
                      <LogOut size={13} />
                      <span>{runtimeSession.logoutPending ? "退出中..." : "退出登录"}</span>
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </header>

      <div className="flex min-h-0 min-w-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {hasOpenedProject && activeMain?.children && (
            <div className="flex h-10 shrink-0 items-center gap-1 overflow-x-auto border-b border-app-border/80 bg-app-bg px-2 sm:px-4">
              {activeMain.children.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    [
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs transition",
                      isActive ? "bg-app-selected text-app-primary" : "text-app-muted hover:bg-app-surface-hover hover:text-app-primary",
                    ].join(" ")
                  }
                >
                  <item.icon size={14} />
                  {item.label}
                </NavLink>
              ))}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-hidden">
            <div className={isChatRoute ? "h-full" : "hidden h-full"}>
              <ChatPage />
            </div>
            <div className={isChatRoute ? "hidden h-full" : "h-full"}>
              <Outlet />
            </div>
          </div>
        </main>
      </div>

      {!isMobileShell && (
        <footer className={[
          "flex h-6 shrink-0 items-center justify-between border-t border-app-border/80 bg-app-shell px-3 text-[11px] text-app-muted",
        ].join(" ")}>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap" title={workspaceGitStatusTitle}>
            {workspaceGitStatusItems.map((item, index) => (
              <span key={item.key} className="inline-flex min-w-0 items-center gap-1.5" title={item.title}>
                {index > 0 ? <span className="shrink-0 text-app-muted/45" aria-hidden="true">|</span> : null}
                <span className="min-w-0 max-w-[120px] truncate text-app-secondary">
                  {item.repositoryName}
                </span>
                <span className={item.dirty ? "min-w-0 max-w-[90px] truncate text-emerald-600" : "min-w-0 max-w-[90px] truncate text-app-muted"}>
                  {item.statusText}
                </span>
              </span>
            ))}
          </div>
        </footer>
      )}
    </div>
  )
}
