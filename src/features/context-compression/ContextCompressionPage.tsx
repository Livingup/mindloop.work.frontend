import { useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, RotateCcw, Save, ZoomIn, ZoomOut } from "lucide-react"
import mermaid from "mermaid"
import ReactMarkdown from "react-markdown"

import {
  getContextCompressionSettings,
  getObserverPrompt,
  updateContextCompressionSettings,
} from "@/features/context-compression/contextCompressionApi"
import { listLlmExecutionPolicies } from "@/features/settings/settingsApi"
import { DarkSelect, type DarkSelectOption } from "@/shared/components/DarkSelect"
import { useAppNotification } from "@/shared/interaction/AppInteractionProvider"

const MERMAID_SEQUENCE_CODE = `sequenceDiagram
    autonumber
    actor User as 用户 (User)
    participant Engine as 业务引擎主线程 (Business Agent)
    participant ConvDB as 会话存储 (Conversation DB)
    participant Slicer as 增量切片器 (Unit Slicer)
    participant Observer as 上下文观察者线程 (Context Observer)
    participant NoteStore as Task Note 存储 (Note Store)
    participant Assembler as 上下文热组装 (Context Assembler)

    Note over User,Engine: 1. 业务主线程轮次执行 (Business Execution)
    User->>Engine: 发送任务指令或业务对话
    Engine->>Engine: 执行业务 Tool Calls & 多轮交互
    Engine->>ConvDB: 追加消息并更新持久化会话记录
    ConvDB-->>Engine: 消息持久化完成

    Note over Engine,Slicer: 2. 增量消息断点切片判断 (80k Token / 步长门禁)
    Engine->>Slicer: 检查当前消息 vs covered_until_message_id
    alt 未达到切片阈值 (增量 < 80k Tokens)
        Slicer-->>Engine: 维持现有短尾历史，前台无感
    else 达到切片阈值 (增量 >= 80k Tokens 或指定步长)
        Slicer->>ConvDB: 拉取增量切片 [covered_until + 1, current_boundary]
        ConvDB-->>Slicer: 返回增量历史消息
        
        Note over Slicer,Observer: 3. 异步后台触发观察者线程 (Async Observer Driving)
        Slicer->>Observer: 派发异步任务: 增量切片 + 当前 Task Note 快照
        Note over Observer: Observer 独立后台运行<br/>结合 5 大认知层级与 4 项原子工具分析切片
        
        loop 观察者工具调用更新
            Observer->>NoteStore: task_note_record_event / add_fact / update_phase
            NoteStore-->>Observer: 确认更新局部状态
        end
        
        Observer->>NoteStore: 生成并写入新快照 (更新 covered_until_message_id 断点)
        NoteStore-->>Observer: Task Note 快照已持久化 (无感收敛)
    end

    Note over Engine,Assembler: 4. 业务上下文热替换 (Context Hot Replacement)
    User->>Engine: 下一轮任务提问 / 发起业务轮次
    Engine->>Engine: 检查自身当前上下文总 Token 窗口 (Threshold Check)
    alt 上下文总窗口 < 设定的压缩阈值 (如 < 80% 模型窗口)
        Engine->>Engine: 继续携带完整历史消息，无需替换 (无损精准交互)
    else 上下文总窗口 >= 压缩阈值 (触发瘦身门禁)
        Engine->>Assembler: 请求消费最新 Task Note 热替换
        Assembler->>NoteStore: 读取最新已就绪的 Task Note 快照
        NoteStore-->>Assembler: 返回 Task Note 结构化快照文本
        Assembler->>ConvDB: 仅截取 covered_until_message_id 之后的短尾增量历史
        ConvDB-->>Assembler: 返回短尾增量消息
        Assembler->>Assembler: 动态注入 Task Note 系统段落 + 拼接短尾增量
        Assembler-->>Engine: 输出轻量级 Prompt (秒级完成瘦身，彻底消除 Token 膨胀)
    end
    Engine->>Engine: 开启高效推理与业务处理`

type CompressionMainTab = "policy" | "system_spec"
type SystemSpecSubTab = "sequence" | "prompt"

export function ContextCompressionPage() {
  const [activeTab, setActiveTab] = useState<CompressionMainTab>("policy")

  return (
    <div className="h-full bg-app-bg text-app-primary">
      {/* 顶栏 Tab */}
      <div className="border-b border-app-border/80 px-6 pt-4">
        <div className="flex gap-2">
          <CompressionMainTabButton
            active={activeTab === "policy"}
            onClick={() => setActiveTab("policy")}
          >
            观察者驱动策略
          </CompressionMainTabButton>
          <CompressionMainTabButton
            active={activeTab === "system_spec"}
            onClick={() => setActiveTab("system_spec")}
          >
            上下文压缩系统说明
          </CompressionMainTabButton>
        </div>
      </div>

      {/* 内容区域 */}
      <div className="h-[calc(100%-3.25rem)] min-h-0 overflow-y-auto">
        {activeTab === "policy" ? <ObserverPolicyPanel /> : <SystemSpecPanel />}
      </div>
    </div>
  )
}

function CompressionMainTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-t-lg border px-4 py-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-400",
        active
          ? "border-app-border/80 border-b-app-bg bg-app-bg text-app-primary"
          : "border-transparent text-app-muted hover:bg-app-surface/85 hover:text-app-secondary",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

function CompressionSubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg px-3.5 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-blue-400",
        active
          ? "border border-blue-200 bg-blue-50 font-semibold text-blue-700 shadow-2xs"
          : "border border-transparent text-app-muted hover:bg-app-surface hover:text-app-primary",
      ].join(" ")}
    >
      {children}
    </button>
  )
}

/** 观察者驱动策略面板 */
function ObserverPolicyPanel() {
  const queryClient = useQueryClient()
  const { notify } = useAppNotification()

  const settingsQuery = useQuery({
    queryKey: ["context-compression", "settings"],
    queryFn: getContextCompressionSettings,
  })
  const policiesQuery = useQuery({
    queryKey: ["llm", "execution-policies"],
    queryFn: listLlmExecutionPolicies,
  })

  const settings = settingsQuery.data
  const policies = policiesQuery.data ?? []

  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("")
  const [isDirty, setIsDirty] = useState(false)

  useEffect(() => {
    if (settings) {
      setSelectedPolicyId(settings.llm_policy_group_id ?? "")
      setIsDirty(false)
    }
  }, [settings])

  const handleSelectPolicy = (value: string) => {
    setSelectedPolicyId(value)
    setIsDirty(value !== (settings?.llm_policy_group_id ?? ""))
  }

  const saveMutation = useMutation({
    mutationFn: (newPolicyId: string) =>
      updateContextCompressionSettings({
        llm_policy_group_id: newPolicyId ? newPolicyId : null,
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(["context-compression", "settings"], updated)
      void queryClient.invalidateQueries({ queryKey: ["context-compression", "settings"] })
      setIsDirty(false)
      notify({
        title: "保存成功",
        message: "观察者驱动策略已更新。",
        tone: "success",
      })
    },
    onError: (error: Error) => {
      notify({
        title: "保存失败",
        message: error.message || "更新策略失败，请检查服务状态。",
        tone: "error",
      })
    },
  })

  const policyOptions: DarkSelectOption[] = useMemo(() => {
    const list: DarkSelectOption[] = [
      {
        value: "",
        label: "未配置（使用系统全局默认策略）",
      },
    ]
    policies.forEach((p) => {
      list.push({
        value: p.policy_group_id,
        label: `${p.name || p.policy_group_id} (${p.policy_group_id})`,
      })
    })
    return list
  }, [policies])

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-app-primary">
            观察者驱动策略
          </h2>
          <p className="mt-1 text-xs text-app-muted">
            配置上下文观察者运行时所使用的 LLM 服务商策略。
          </p>
        </div>
        <button
          type="button"
          onClick={() => saveMutation.mutate(selectedPolicyId)}
          disabled={!isDirty || saveMutation.isPending}
          className="inline-flex items-center justify-center space-x-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saveMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          <span>保存策略</span>
        </button>
      </div>

      <div className="space-y-2 pt-2">
        <label className="block text-xs font-medium text-app-secondary">
          LLM 服务商策略
        </label>
        <DarkSelect
          value={selectedPolicyId}
          onChange={handleSelectPolicy}
          options={policyOptions}
          placeholder="选择策略..."
        />
      </div>
    </div>
  )
}

/** 上下文压缩系统说明面板 */
function SystemSpecPanel() {
  const [subTab, setSubTab] = useState<SystemSpecSubTab>("sequence")

  const observerPromptQuery = useQuery({
    queryKey: ["context-compression", "observer-prompt"],
    queryFn: getObserverPrompt,
  })
  const observerPrompt = observerPromptQuery.data

  return (
    <div className="flex h-full w-full flex-col space-y-4 p-6 min-h-0">
      {/* 二级选项卡：Task Note 更新时序图 / 观察者系统提示词 */}
      <div className="flex items-center justify-between border-b border-app-border/70 pb-3 flex-shrink-0">
        <div className="flex gap-2">
          <CompressionSubTabButton
            active={subTab === "sequence"}
            onClick={() => setSubTab("sequence")}
          >
            Task Note 更新时序图
          </CompressionSubTabButton>
          <CompressionSubTabButton
            active={subTab === "prompt"}
            onClick={() => setSubTab("prompt")}
          >
            观察者系统提示词
          </CompressionSubTabButton>
        </div>
      </div>

      {/* Task Note 更新时序图：直接展示可缩放拖拽的操作面板，无多余单独浮层 */}
      {subTab === "sequence" && (
        <MermaidViewer chart={MERMAID_SEQUENCE_CODE} />
      )}

      {/* 观察者系统提示词 */}
      {subTab === "prompt" && (
        <div className="prose prose-slate max-w-none rounded-lg border border-app-border/80 bg-white p-6 text-xs leading-relaxed text-app-primary overflow-y-auto">
          <ReactMarkdown>
            {observerPrompt?.prompt_text || "未加载到提示词内容"}
          </ReactMarkdown>
        </div>
      )}
    </div>
  )
}

/** 真正的 Mermaid SVG 图形渲染器（页面内直接呈现为可缩放、可滚轮平滑缩放、可鼠标拖拽平移的操作面板） */
function MermaidViewer({ chart }: { chart: string }) {
  const [svgContent, setSvgContent] = useState<string>("")
  const [dimensions, setDimensions] = useState({ width: 1350, height: 2600 })
  const [renderError, setRenderError] = useState<string | null>(null)
  const [rendering, setRendering] = useState(true)

  // 缩放与平移状态
  const [scale, setScale] = useState(1.0)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragStartRef = useRef({ startX: 0, startY: 0, originX: 0, originY: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let active = true
    mermaid.initialize({
      startOnLoad: false,
      theme: "default",
      securityLevel: "loose",
      fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      sequence: {
        diagramMarginX: 40,
        diagramMarginY: 30,
        actorMargin: 60,
        width: 160,
        height: 65,
        boxMargin: 12,
        boxTextMargin: 6,
        noteMargin: 12,
        messageMargin: 38,
        mirrorActors: true,
        useMaxWidth: false,
      },
    })

    const chartId = `mermaid-seq-${Math.random().toString(36).substring(2, 9)}`
    mermaid
      .render(chartId, chart)
      .then(({ svg }) => {
        if (!active) return

        // 提取 viewBox 中的原生尺寸
        const match = svg.match(/viewBox=["']\s*([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s+([0-9.-]+)\s*["']/i)
        let vbW = 1350
        let vbH = 2600
        if (match) {
          const w = parseFloat(match[3])
          const h = parseFloat(match[4])
          if (w > 0 && h > 0) {
            vbW = Math.ceil(w)
            vbH = Math.ceil(h)
          }
        }
        setDimensions({ width: vbW, height: vbH })

        // 彻底清洗 SVG：
        // 赋予明确物理尺寸 min-width 与 100% 宽度，自适应宽屏且永不被挤压变形
        let cleaned = svg.replace(/max-width:\s*[^;]+;?/gi, "")
        cleaned = cleaned.replace(/<svg\b([^>]*)>/i, (_m, attrs) => {
          let newAttrs = attrs
            .replace(/\bstyle=["'][^"']*["']/gi, `style="min-width: ${vbW}px; width: 100%; height: auto; display: block;"`)
            .replace(/\bwidth=["'][^"']*["']/gi, `width="100%"`)
            .replace(/\bheight=["'][^"']*["']/gi, `height="auto"`)
          if (!/width=["']/.test(newAttrs)) {
            newAttrs += ` width="100%"`
          }
          if (!/height=["']/.test(newAttrs)) {
            newAttrs += ` height="auto"`
          }
          return `<svg${newAttrs}>`
        })

        setSvgContent(cleaned)
        setRenderError(null)
        setRendering(false)
      })
      .catch((err) => {
        if (active) {
          console.error("Mermaid 渲染异常:", err)
          setRenderError(err?.message || "渲染时序图失败")
          setRendering(false)
        }
      })

    return () => {
      active = false
    }
  }, [chart])

  // 原生非被动滚轮事件：等待渲染完成、画布挂载后绑定，滑动滚轮直接连续顺畅放大 / 缩小（支持 25% ~ 400%）
  useEffect(() => {
    if (rendering) return
    const canvas = canvasRef.current
    if (!canvas) return

    const handleNativeWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      const factor = e.deltaY < 0 ? 1.15 : 0.87
      setScale((prev) => {
        const next = Number((prev * factor).toFixed(2))
        return Math.min(4.0, Math.max(0.25, next))
      })
    }

    canvas.addEventListener("wheel", handleNativeWheel, { passive: false })
    return () => {
      canvas.removeEventListener("wheel", handleNativeWheel)
    }
  }, [rendering])

  const handleZoomIn = () => {
    setScale((prev) => Math.min(4.0, Number((prev * 1.2).toFixed(2))))
  }

  const handleZoomOut = () => {
    setScale((prev) => Math.max(0.25, Number((prev * 0.83).toFixed(2))))
  }

  const handleReset100 = () => {
    setScale(1.0)
    setPosition({ x: 0, y: 0 })
  }

  const handleFitWidth = () => {
    if (canvasRef.current && dimensions.width > 0) {
      const containerWidth = canvasRef.current.clientWidth - 48
      const fitScale = Math.min(1.5, Math.max(0.35, containerWidth / dimensions.width))
      setScale(Number(fitScale.toFixed(2)))
      setPosition({ x: 0, y: 0 })
    }
  }

  // 鼠标拖拽平移事件：使用全局 window 监听确保高速拖拽不脱手、不卡顿
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    setIsDragging(true)
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: position.x,
      originY: position.y,
    }
  }

  useEffect(() => {
    if (!isDragging) return

    const handleWindowMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.startX
      const dy = e.clientY - dragStartRef.current.startY
      setPosition({
        x: dragStartRef.current.originX + dx,
        y: dragStartRef.current.originY + dy,
      })
    }

    const handleWindowMouseUp = () => {
      setIsDragging(false)
    }

    window.addEventListener("mousemove", handleWindowMouseMove)
    window.addEventListener("mouseup", handleWindowMouseUp)
    return () => {
      window.removeEventListener("mousemove", handleWindowMouseMove)
      window.removeEventListener("mouseup", handleWindowMouseUp)
    }
  }, [isDragging])

  if (rendering) {
    return (
      <div className="flex h-96 items-center justify-center rounded-xl border border-app-border/80 bg-white">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
      </div>
    )
  }

  if (renderError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-xs text-red-700">
        <div className="font-semibold">时序图渲染失败</div>
        <div className="mt-1">{renderError}</div>
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-210px)] min-h-[560px] w-full flex-col rounded-xl border border-app-border/80 bg-white shadow-2xs overflow-hidden">
      {/* 顶部操作控制条 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border/60 bg-slate-50/80 px-4 py-2.5 flex-shrink-0">
        <div className="flex items-center space-x-3">
          <span className="text-xs font-semibold text-app-primary">
            Task Note 更新时序图
          </span>
          <span className="rounded bg-slate-200/80 px-2 py-0.5 font-mono text-xs font-semibold text-blue-700">
            {Math.round(scale * 100)}%
          </span>
          <span className="text-xs text-app-muted">
            (支持鼠标滚轮连续缩放、按住鼠标左键拖拽平移)
          </span>
        </div>

        {/* 缩放控制按钮组 */}
        <div className="flex items-center space-x-1.5">
          <button
            type="button"
            onClick={handleZoomOut}
            title="缩小"
            className="rounded-md border border-app-border/80 bg-white p-1.5 text-app-secondary hover:bg-slate-100 hover:text-app-primary shadow-2xs transition"
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleZoomIn}
            title="放大"
            className="rounded-md border border-app-border/80 bg-white p-1.5 text-app-secondary hover:bg-slate-100 hover:text-app-primary shadow-2xs transition"
          >
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={handleReset100}
            title="恢复 100% 原始比例"
            className="rounded-md border border-app-border/80 bg-white px-2.5 py-1 text-xs font-medium text-app-secondary hover:bg-slate-100 hover:text-app-primary shadow-2xs transition"
          >
            1:1 原始
          </button>
          <button
            type="button"
            onClick={handleFitWidth}
            title="适应屏幕宽度"
            className="rounded-md border border-app-border/80 bg-white px-2.5 py-1 text-xs font-medium text-app-secondary hover:bg-slate-100 hover:text-app-primary shadow-2xs transition"
          >
            适应宽度
          </button>
          <button
            type="button"
            onClick={handleReset100}
            title="复位位置"
            className="rounded-md border border-app-border/80 bg-white p-1.5 text-app-secondary hover:bg-slate-100 hover:text-app-primary shadow-2xs transition"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 交互画布主体：直接在页面内滚轮缩放、拖拽平移，无任何浮层或弹窗 */}
      <div
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onDoubleClick={handleReset100}
        className={[
          "relative flex-1 w-full overflow-hidden bg-slate-50 select-none",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        ].join(" ")}
      >
        <div
          className="absolute left-1/2 top-6 will-change-transform pointer-events-none select-none"
          style={{
            width: `${dimensions.width}px`,
            transform: `translate(calc(-50% + ${position.x}px), ${position.y}px) scale(${scale})`,
            transformOrigin: "center top",
            transition: isDragging ? "none" : "transform 0.08s ease-out",
          }}
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </div>
    </div>
  )
}

