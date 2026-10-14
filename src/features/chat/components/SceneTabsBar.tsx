import { Plus, X } from "lucide-react"

import { statusToneClasses } from "@/features/chat/components/statusTone"

export type SceneTabViewModel = {
  sceneId: string
  sceneName: string
  runStatus: string
  hasPendingInteraction: boolean
}

const ACTIVE_SCENE_TAB_CLASS = "relative z-10 h-8 rounded-t-lg bg-[#f8fafc] font-semibold text-slate-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.85),0_-1px_0_rgba(148,163,184,0.16)] before:pointer-events-none before:absolute before:-left-[10px] before:bottom-0 before:size-[10px] before:bg-[radial-gradient(circle_at_top_left,transparent_9.5px,#f8fafc_10.5px)] before:content-[''] after:pointer-events-none after:absolute after:-right-[10px] after:bottom-0 after:size-[10px] after:bg-[radial-gradient(circle_at_top_right,transparent_9.5px,#f8fafc_10.5px)] after:content-['']"
const INACTIVE_SCENE_TAB_CLASS = "h-7 rounded-md text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
const ACTIVE_SCENE_TAB_CLOSE_CLASS = "text-slate-500 opacity-70 hover:bg-slate-900/10 hover:text-slate-900 group-hover:opacity-100"
const INACTIVE_SCENE_TAB_CLOSE_CLASS = "text-slate-400 opacity-80 hover:bg-slate-200/80 hover:text-slate-900 group-hover:opacity-100"
const BACKGROUND_PENDING_INTERACTION_DOT_CLASS = [
  "inline-block size-2 shrink-0 rounded-full",
  statusToneClasses("warning").dot,
  "ring-2 ring-app-warning-surface",
].join(" ")

/**
 * Scene Tabs Bar：通过 createPortal 挂载到 AppShell `#chat-scene-tabs-header-slot`
 * DOM 节点，跨路由常驻于 header 中央。
 *
 * Electron 桌面壳交互边界：外层滚动容器**不加** `electron-no-drag`，让 tabs 间隙、
 * 两侧 padding、tabs 后空白作为 Electron 拖动窗口的可用像素；4 个可点击元素
 * （新对话按钮、tab 包装 div、tab 选择按钮、tab 关闭按钮）**必须**加
 * `electron-no-drag`，否则 Electron 把 hit-region 当作拖拽区会吞掉 click。
 * 底部横向滚动条需要单独的 no-drag 覆盖层接管 scrollbar gutter 的 hit-region，
 * 否则用户拖动 scrollbar thumb 会被 Electron 误判为拖动窗口；覆盖层只占用
 * 底部滚动条高度，不覆盖 tabs 内容区或 tabs 后空白拖拽区。
 * 该契约与 AppShell slot 互为镜像，不能在 SceneTabsBar 里去掉、也不能在
 * AppShell slot 里加 no-drag，否则平衡被打破。
 */
export function SceneTabsBar({
  openedScenes,
  activeSceneId,
  onSelectTab,
  onCloseTab,
  onNewScene,
}: {
  openedScenes: SceneTabViewModel[]
  activeSceneId: string | null
  onSelectTab: (sceneId: string) => void
  onCloseTab: (sceneId: string) => void
  onNewScene: () => void
}) {
  return (
    <div className="scene-tabs-scroll-frame relative h-full w-full min-w-0 max-w-full">
      <div className="scene-tabs-scroll-container flex h-full w-full min-w-0 max-w-full items-center justify-start gap-2 overflow-x-auto whitespace-nowrap px-1 text-[11px] sm:gap-3 sm:px-3">
        <button
          type="button"
          onClick={onNewScene}
          className="electron-no-drag inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2 text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-900 sm:mr-1"
          title="返回场景选择页面并创建新对话"
        >
          <Plus size={12} />
          新对话
        </button>
        {openedScenes.map((slice) => {
          const isActive = slice.sceneId === activeSceneId
          const isBackgroundPendingInteraction = !isActive && slice.hasPendingInteraction
          const pendingInteractionLabel = isBackgroundPendingInteraction ? "\n等待用户输入" : ""
          return (
            <div
              key={slice.sceneId}
            className={[
              "electron-no-drag group inline-flex shrink-0 items-center gap-1.5 px-2 transition",
              isActive ? ACTIVE_SCENE_TAB_CLASS : INACTIVE_SCENE_TAB_CLASS,
            ].join(" ")}
          >
            <button
              type="button"
              onClick={() => onSelectTab(slice.sceneId)}
              className="electron-no-drag flex min-w-0 max-w-48 items-center gap-1.5"
              title={`${slice.sceneName}\nID ${slice.sceneId}\n${slice.runStatus}${pendingInteractionLabel}`}
            >
              {isBackgroundPendingInteraction ? (
                <span
                  className={BACKGROUND_PENDING_INTERACTION_DOT_CLASS}
                  aria-hidden="true"
                />
              ) : null}
              <span className="truncate">{slice.sceneName}</span>
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                onCloseTab(slice.sceneId)
              }}
              className={[
                "electron-no-drag inline-flex size-4 items-center justify-center rounded",
                isActive ? ACTIVE_SCENE_TAB_CLOSE_CLASS : INACTIVE_SCENE_TAB_CLOSE_CLASS,
              ].join(" ")}
              title="关闭该对话 Tab"
            >
              <X size={12} />
            </button>
            </div>
          )
        })}
      </div>
      <div className="scene-tabs-scrollbar-hit-region electron-no-drag" aria-hidden="true" />
    </div>
  )
}



