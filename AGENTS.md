# Spread AI Web Frontend

独立 Web 前端项目，作为 AgentRuntime 的浏览器端用户界面。该目录是独立 Git 项目，不与后端仓库共享提交历史。

## 技术栈

- React + TypeScript + Vite
- TailwindCSS
- TanStack Query
- Zustand
- react-virtuoso
- react-markdown + remark-gfm

## 产品区域

1. **系统设置**：模型、服务商、API Key 等系统资源用户数据。
2. **AI Studio**：Agent 定义管理、Skill 查看、MCP 服务配置、系统提示词模板配置、工具目录查看。
3. **AI 对话界面**：用户输入工作目录、选择 Agent，并通过工具事件驱动的对话窗口与 Agent 协作。
4. **日志工作区**：`/logs` 是独立日志产品面，包含日志统计总览、手动日志清理和 LLM HTTP Trace 精确查询；不要把日志清理入口迁入系统设置，也不要把清理交互设计成 TTL、定时任务或后台自动删除。
5. **Memory 工作区**：`/memory` 只管理当前打开项目根目录下的 `.spread-ai/memory/<agent-id>/memory.md`。Memory 的 workspace 身份必须来自 `useSceneUiStore.currentWorkspacePath`，Renderer 不得从 localStorage、路径猜测、Node/Electron 文件系统或直接本地路径读写恢复 Memory；所有读取与保存必须走 Runtime workspace 域 `/api/workspaces/memory/*` HTTP API，并保留 SHA256 乐观并发提示。

## Chat UI 设计原则

- 主链路以完整工具调用事件、生命周期消息和独立终端流为核心。
- 不渲染半个 LLM tool_use；Runtime 解析并校验完整工具调用后才推送 `tool_call_started`。
- 命令输出流通过 `terminal_session_id` 进入右侧终端面板，不进入 Markdown 聊天气泡。
- 文件读取、文件修改、命令执行等工具通过工具活动流展示开始、参数预览、完成状态和错误信息。
- 大 diff、大工具输出、大命令输出只展示 preview，完整内容后续通过 artifact/cursor 接口读取。
- 生命周期消息通过 `agent_lifecycle` 派生的 `lifecycle_frontend_message` 和 `ask_user_requested` 进入主对话区。
- 同一 Chat scene 内多个 Agent 实例共享一条 scene 级 SSE/communication stream；不要按 Agent 实例拆分 transport。实例隔离必须在业务 reducer/projection 层基于 `metadata.agent_instance_id` 完成，状态展示不得把 scene 级 `runStatus` 当作各 Agent tab 的兜底状态。
- **左右 UI 独立性与更新链路隔离**：
  - 单 SSE 事件源统筹：所有网络实时事件、水合数据、重放与乐观消息统一通过 `chatEventCoordinator` 进行有序接入、去重与分流，禁止业务代码跳过 Coordinator 直接写入 UI Store。
  - 权威存储与 UI 投影隔离：`chatStore` 继续作为全场景业务持久化、恢复、ACK 与水合的唯一权威（SSOT）；左侧对话消费 `conversationUiStore`，右侧监控消费 `timelineUiStore`；两侧通过 `ConversationPane` / `TimelinePane` 独立订阅各自切片，任何一侧的高频更新（如右侧 LLM/Tool 执行增量、左侧文本流）不得引起另一侧 store 或 UI 树重新计算与渲染。
  - 严禁 Projection 回退订阅：UI projection hook（`useAgentConversationProjection`、`useAgentTimelineProjection`）严禁回退订阅或全量扫描 canonical `chatStore.messages`；scope 未就绪时必须返回不可变的稳定空对象。
  - 执行聚合唯一权威：`chatEventCoordinator` + `executionProcess.ts` 集中作为 LLM/Tool 执行状态聚合与气泡生成的唯一权威；ChatPage 严禁重复聚合执行气泡或保留本地增量水合旁路，统一通过 `bubblePersistenceSink` 接入持久化 Outbox。
  - 容器边界隔离：`ConversationPane` 与 `TimelinePane` 仅接收基础标识（`sceneId`, `agentInstanceId`）与稳定回调函数（配合 `React.memo`），禁止向子树直接传递共享 runtime 对象，确保父层 control-plane 重绘时子树能够完全 Bailout。
  - 双消费边界：`task_boundary` 作为跨域事件由 Router 派发专用 DTO 分别进入两侧。
  - 传输流水印与持久化气泡隔离：历史会话水合时，持久化气泡中的 `bubble.metadata.communication_seq` 仅用于前端消息排序/去重，严禁用其初始化活动 SSE 传输流水印（重启或重连后通信流 seq 会从当前传输层的游标重新开始）。`chatEventCoordinator` 的 `watermark.lastAppliedSceneSeq` 必须严格来源于当前传输流的游标（`snapshotWatermark.maxSeq`），防止历史旧 seq 污染流水印导致重启后新一轮实时事件被误判丢弃。
- LLM token streaming 仅作为兼容非工具化 Agent 或 debug/fallback 能力预留，不作为第一版主链路。

## 前端运行时性能目标

1. **后台正确性**：窗口失焦、页面进入后台、Electron 最小化或普通浏览器触发 Page Lifecycle 限制时，前端不能因为后台状态导致 Agent 任务、事件消费、持久化队列、重连恢复或状态同步阻塞、丢失或报错。后台可以降低渲染频率，但不能停止必要的数据处理和一致性维护。
2. **前台高性能渲染**：当前页面可见并处于前台交互时，新消息、工具事件、终端输出和状态变化必须快速、及时、平滑地呈现；输入响应不能被高频事件阻塞；不得出现持续卡顿、明显闪烁、滚动跳动或频繁整页重绘。
3. **长会话稳定性**：长时间运行、多场景并发、高频终端输出、SSE 重连和后台恢复后，内存、数组、Map、终端缓冲、raw events、已写入 ID 集合等必须保持有界增长。

## 多端前端架构规则

Spread AI Web Frontend 的目标是同时支持 `electron-desktop`（壳内 Web）、`desktop-web`（PC 浏览器 Web）和 `mobile-web`（移动浏览器 Web）。正确做法不是每个端独立写一套业务前端，而是采用**一个共享业务 Renderer + 端差异 Shell/布局/交互适配层**：业务协议、路由语义、Runtime/session、事件 reducer、资源 CRUD、设置数据、Chat 状态机必须共享；只有容器能力、导航 chrome、布局密度、输入方式、详情展开方式允许按端分叉。

### 多端分层总模型

```text
HTTP/Electron delivery
  -> src/main.tsx / src/app/router.tsx
  -> RuntimeAuthGate              # 共享 Runtime/session/auth/bootstrap 状态机
  -> AppShell                     # 端差异 Shell、导航、布局骨架组合根
  -> Feature routes               # 共享业务路由与业务状态
  -> Shared layout primitives     # 响应式列表、详情、sheet、panel、form、card
  -> Runtime/API/state modules    # 共享 DTO、API、query、store、reducer
```

- **共享业务层必须唯一**：API client、DTO、Zustand store、TanStack Query key、Chat event reducer、Scene Presence、RuntimeAuthGate、资源 CRUD 和设置读写不得按端复制。新增端不能新增另一套 `mobile/*` 业务 API、另一套路由语义或另一套事件 reducer。
- **端差异层必须可定位**：平台判断集中在 `runtimeAccess.ts`、AppShell、共享 layout primitives 或明确命名的 presentation adapter 中。禁止在业务服务、API client、持久化队列、scene reducer 中散落 `isMobile` 特判。
- **页面可有端变体，但业务不可分叉**：当 PC 与移动的信息架构确实不同，页面组件可以拆成 `DesktopXxxView` / `MobileXxxView` 或等价 view adapter；它们必须复用同一个 feature hook、query、mutation、DTO、权限判断和错误处理。
- **移动端是单列控制台，不是缩小桌面**：`mobile-web` 的默认产品形态是“单列任务控制与资源管理台”：优先当前场景、任务状态、消息、Composer、关键停止/确认动作、资源列表和详情 drill-down；桌面三栏并列的工作目录、终端、执行监控、资源详情要通过 sheet、drawer、独立 route 或分步 drill-down 展开。
- **PC Web 与 Electron 壳内 Web 同属桌面工作站**：两者可共享桌面级多栏工作台、顶部一级导航和高信息密度，桌面使用顶部一级导航，不再包含应用级全局左 rail；桌面多栏、Chat 工作目录树、局部业务侧栏仍可保留。Electron 额外拥有窗口拖拽、多窗口、托盘和 preload 桥，但这些能力只能存在于 Shell/desktop adapter，不能成为普通 PC Web 的业务前提。其它多端共享业务约束不变。

### 三端共享层：必须保持一致

- **入口和路由语义共享**：`src/main.tsx -> src/app/router.tsx -> RuntimeAuthGate -> AppShell` 是主工作台启动链路。`/pdf-viewer` 可以保持独立窗口/页面能力；主产品路由、业务路由含义、认证/bootstrap 流程和错误恢复语义必须跨三端一致。
- **Runtime/session 模型共享**：三端一次只面向一个被选中的 Runtime base URL；普通 REST 使用 Bearer `Authorization` header；query-string token 只允许用于 EventSource、文件下载、sendBeacon/detach 等浏览器 API 无法稳定携带 header 的场景。
- **Scene Presence 共享**：Scene attach 返回的 `client_session_id` 是 heartbeat、detach 和 presence 释放的权威身份。关闭窗口、页面 unload、workspace switch、窄屏临时离开 Chat、切换路由或普通 detach 只释放 presence，不等价于停止运行中的 Agent 任务；显式停止必须继续走 stopScene 或 per-Agent interrupt/stop。
- **业务状态正确性共享**：运行时事件、ChatBubble 序列化、终端通道、scene 缓存、持久化队列、资源管理 CRUD、设置读写和日志查询都属于共享业务层，不得因为平台差异产生不同的业务规则、不同的 reducer 语义或不同的数据契约。
- **前后台恢复共享**：三端都必须区分 visible/focused/background/recovering。后台可以降频和减少渲染，但不能让正确性依赖 `requestAnimationFrame`、焦点状态或当前路由可见性。返回前台必须通过 replay、snapshot 或重新 attach 恢复到权威状态。
- **主题 token 共享**：业务页面和共享组件的背景、文字、边框、状态色、hover/focus/selected 反馈必须优先使用 `app-*` 主题 token 或 `src/shared/theme/classes.ts` 的共享样式配方；不得用固定 hex、`blue-*`、`slate-*`、`red-*` 等 Tailwind 具体色承载主题职责。终端、代码高亮、外部文档渲染等具备独立视觉语义的区域可以例外，但边界必须清晰。

### 允许分叉层：端体验外壳和 presentation adapter

| 层级 | electron-desktop | desktop-web | mobile-web | 约束 |
| --- | --- | --- | --- | --- |
| Shell 容器 | Electron 窗口、系统托盘、多窗口、preload 桥、桌面调试日志 | 浏览器标签页、HTTP served SPA、普通浏览器存储与网络限制 | 手机浏览器视口、触摸输入、安全区、软键盘、移动后台限制 | Shell 只能适配平台能力，不能改写业务路由、Runtime/session 语义或事件 reducer。 |
| 布局骨架 | 可使用固定工作台框架、顶部一级导航（无全局左 rail）、顶部窗口/账号区、可拖拽分栏 | 可使用桌面浏览器工作台布局，但不得依赖 Electron preload | 单列/分步/抽屉/sheet 优先，禁止把桌面三栏工作台等比例缩小 | 布局分叉集中在 AppShell、共享 layout primitives 和 view adapter，不散落到业务服务层。 |
| 导航 chrome | 可使用桌面窗口标题栏、安全拖拽区、新窗口/PDF 辅助窗口 | 使用浏览器常规导航语境，不显示桌面窗口控制 | 使用顶部轻量导航、底部/横向业务切换、局部返回和详情 drill-down | 导航位置可变，但 route identity、deep link、返回语义和 active 状态必须保持可解释。 |
| 交互模型 | 鼠标、键盘、多窗口、拖拽分栏、高信息密度 | 鼠标、键盘、浏览器多标签页 | 触摸目标、软键盘、安全区、窄屏滚动、低信息密度 | 平台交互可变，但任务提交、中断、确认、详情查看、保存/取消和错误恢复语义必须共享。 |
| 信息密度 | 全量桌面工作站，Chat/终端/目录/监控可并列 | 接近桌面工作站，宽度不足时渐进降级 | 单列任务控制台，次要面板按需进入 | Mobile 可以改变并列方式和入口顺序，不能减少核心任务控制和状态恢复能力。 |

### Mobile-web 基线产品形态

`mobile-web` 的当前基线形态定为**单列任务控制与资源管理台**，不是独立业务前端，也不是桌面工作站的缩小版。实现移动能力时遵守以下规则：

- **Chat 移动基线**：默认显示当前 scene 消息流、任务状态、Composer 和关键动作。工作目录树、场景列表、终端、执行监控、附件、工具详情通过 sheet/drawer/route drill-down 展开；打开这些辅助面板不得卸载 Chat scene runtime owner。
- **终端移动基线**：终端输出可以作为独立 route、bottom sheet 或全屏 panel 展示，不要求与消息流并列；终端 session、stream buffer 和停止/复制等操作语义必须与桌面共享。
- **资源管理移动基线**：列表页使用单列搜索/过滤/卡片；详情页通过 drill-down 打开并提供返回列表语义；桌面 master-detail 的左侧压缩列表只在宽度足够时出现。
- **表单移动基线**：表单控件单列排列，底部主操作可 sticky 或紧跟内容；软键盘出现时不能遮住当前输入和主操作；保存、取消、跳过、重试语义与桌面一致。
- **错误/引导移动基线**：Runtime login、auth bootstrap、runtime bootstrap、offline/error 页面必须在手机上可读、可滚动、可输入，不因桌面最小宽度白屏或横向锁死。
- **移动后台恢复基线**：移动浏览器切后台、锁屏或切标签后，返回前台必须通过 replay/snapshot/reattach 恢复权威状态；不能把后台期间未渲染误判为任务停止。

### 实现顺序和准入门槛

1. **规则先行**：涉及 Shell、路由、Runtime access、Chat/runtime、移动端布局或 Electron 边界的实现前，先确认本文件和 `DESIGN.md` 是否覆盖该端差异；未覆盖时先补规则。
2. **基础兼容层**：先移除根级窄屏阻塞，保证 Runtime login/bootstrap/offline 和 AppShell 在手机视口可读可滚动。
3. **共享 primitives**：再改 ResourceManagement、DetailLayout、表单、过滤、sheet/drawer/panel 等共享组件，避免逐页复制移动逻辑。
4. **Feature view adapter**：最后按业务域拆 Desktop/Mobile presentation view，复用同一 feature hooks/API/store。Chat、资源管理、设置、日志分别逐步改造，不一次性在页面内堆 `isMobile`。
5. **验证矩阵**：每次多端改动至少验证 desktop build/typecheck、移动视口无全局横向溢出、Runtime 入口可读；涉及 Chat/Scene 时还必须验证 ChatPage 常驻、presence detach 不误停任务、后台恢复可 replay/resync。

### Electron 桌面边界

- Electron 是首选桌面容器，但 Renderer 必须继续是 sandboxed/isolated Web App。主窗口必须保持 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`backgroundThrottling: false`。
- Renderer 不得直接依赖 Node、Electron 主进程对象、文件系统或本机路径规则；桌面专属能力只能通过 `electron/preload.cjs` 暴露的最小 `window.spreadDesktop` API 访问。
- Electron 专属优化不能破坏 `desktop-web` 和 `mobile-web`。业务 UI 必须在没有 preload 的普通浏览器环境中可构建、可加载、可解释地失败或引导连接 Runtime。
- Packaged desktop Runtime URL 所有权在 Electron 主进程：正式包从 `userData/runtime-config/agent_runtime.yaml` 派生后端 base URL，等待 `/api/health` ready 后再创建主窗口，并通过 preload 暴露同一个只读 Runtime URL。该 URL 是主进程到本地 runtime 的上游地址和 UI 展示/诊断标签，不是 renderer 业务请求的直连目标；正式 packaged renderer 不得从 `localStorage`、猜测 localhost 端口、`.env` 或 `VITE_*` 默认值决定 Runtime URL。
- Electron 桌面端的 REST、SSE/EventSource、scene heartbeat、presence detach/sendBeacon 等后端通信必须使用相对 `/api/*` 进入 `app://renderer/api/*` 主进程 broker，由 Electron main process 再访问本地 runtime。Renderer 禁止把共享业务 API/SSE 解析成 `http://127.0.0.1:<port>` 绝对 URL 直连后端；否则多 scene、多 agent、SSE 长连接和 REST 短请求会共享 Chromium renderer 对同一 HTTP/1.1 host 的有限连接池，连接池被长连接占满后 REST 请求会在 renderer 网络栈内排队超时且不会进入后端日志。
- Electron main-process broker 必须把 REST 与 SSE 上游通道分离并保留可观测性：SSE 长连接使用独立 Node HTTP(S) agent 和明确 `maxSockets` 容量，REST 请求必须有超时、abort 转发和 active_rest/active_sse 日志；不得把长连接重新压回 renderer 的单 host 连接池。

### Browser / mobile delivery 边界

- `app://renderer` 是 packaged Electron asset delivery，不是普通浏览器或手机浏览器可复用的发布路径。`desktop-web` 和 `mobile-web` 必须通过 HTTP-served frontend 路径交付；release 浏览器/移动端默认采用加载前端页面的同一个 HTTP origin 访问 Runtime `/api/*`，不能在页面加载后再猜测 `127.0.0.1`、dev 端口或其它后端地址。
- Vite dev `/api` proxy 只属于开发体验；不能把 `VITE_API_BASE_URL` 默认值当作生产浏览器/手机连接策略。浏览器/mobile 的 Runtime 选择、保存和错误提示可以与 Electron 分叉，但仍必须通过 `runtimeAccess.ts` 一类共享边界集中管理。release 普通 HTTP(S) 浏览器在没有 Electron preload、没有显式 `VITE_*` 构建覆盖时，必须使用 `window.location.origin` 作为 Runtime API base URL；旧的 localStorage 保存地址只能作为 dev/诊断辅助，不能在 release 页面加载后覆盖同源 Runtime。
- 浏览器多标签页只能使用同源内的 scene claim 协作防止同一 scene 被多 tab 同时驱动；它不是跨浏览器、跨设备或跨机器的后端独占锁替代品。

## 前端技术实现约束

- **架构优先**：涉及 Shell、路由、Runtime access、Chat/runtime、移动端布局或 Electron 边界的实现前，必须先确认本规则和 `DESIGN.md` 是否已覆盖该平台差异；未覆盖时先补规则再实现。
- **全局确认与通知边界**：生产 Renderer 禁止使用任何浏览器原生阻塞式对话框，包括未限定的 `alert(...)` / `confirm(...)` / `prompt(...)`、`window.*`、`globalThis.*`，也禁止按平台回退到 Electron 主进程原生弹窗；Electron、desktop-web、mobile-web 必须统一使用应用组合根装配的共享异步确认/持久通知能力。`beforeunload` 浏览器协议确认是唯一例外。异步确认调用方必须快照业务目标、阻止重复请求，并在用户确认后重新校验目标与前置条件；关闭 modal 时由共享层负责 exactly-once 结算、焦点圈定与恢复，禁止用 BrowserWindow `blur()/focus()` 或定时反复 `focus()` 作为正常路径。验收必须使用能区分本地 `useAppConfirm()` 绑定与 DOM 全局符号的源码/AST 检查，不能只搜索 `window.confirm` 或按调用数量判断。
- **生命周期感知**：所有实时事件消费必须区分前台与后台策略。前台优先低延迟批处理和快速刷新；后台优先低成本缓冲、合并、必要状态推进和恢复后的 snapshot/replay 校准。不要把正确性依赖放在 `requestAnimationFrame`、可见页面渲染或用户焦点上。
- **事件一致性**：SSE/运行时事件必须维护按场景的 sequence cursor，支持 `after_seq` replay、gap 检测和 snapshot resync。事件 reducer 必须幂等，重复事件、重连事件和后台恢复事件不能造成重复 UI 或错误状态。
- **状态更新批处理**：高频事件不得逐条触发大范围 Zustand/React 更新。需要先在本地队列或缓冲区聚合，再按前台/后台节奏 flush；超过安全阈值时才强制 flush，避免主线程长任务和输入阻塞。
- **订阅粒度最小化**：组件只能订阅自己真正需要的 store slice。禁止在大父组件中订阅大型对象或高频变化字段后向整棵树传递。新增 UI 时优先把订阅下沉到子组件，并使用稳定 selector、浅比较或局部 memo 降低重渲染面积。
- **Chat 页面常驻**：Chat 主工作台、终端面板、Composer、事件流和本地队列不能因为切换到设置/资源管理页面而被卸载。非 Chat 路由应隐藏 ChatPage，而不是销毁运行中的对话上下文。移动端若使用单列/分步 Chat，也必须保持 ChatPage 或等价 scene runtime owner 常驻，不能因打开资源页或详情页丢失事件流。
- **终端输出专用通道**：命令输出流必须按 `terminal_session_id` 进入终端展示通道，不进入 Markdown 聊天气泡。高频输出应通过 xterm/presentation buffer 增量写入，不允许把每一行终端输出都变成 React 节点或全局状态大数组。
- **持久化队列**：ChatBubble 创建和 patch 必须走按 scene 串行的持久化队列，具备 timeout、有限 retry、场景清理取消和 resync 协调能力。禁止无序 fire-and-forget 写入导致乱序覆盖、重复写或后台恢复不一致。
- **渲染稳定性**：消息列表、工具活动、大输出 preview 等必须使用稳定 key、增量更新和虚拟化/截断策略。禁止因为 token、终端行、工具事件等高频输入导致整页重排、整列表重建或滚动位置抖动。
- **资源有界**：raw events、终端可见行、工具输出 preview、written-id 集合、待处理事件队列和错误日志都必须有明确上限或淘汰策略。新增缓存、Map、队列时必须同时定义生命周期和清理条件。

## 前端性能验收基线

- **Chat 可见延迟**：前台用户消息、Agent 生命周期消息和关键工具状态的可见延迟目标为 100ms 以内。
- **终端可见延迟**：前台终端输出的可见延迟目标为 50-100ms，持续高频输出期间 Composer 仍需可输入、可提交。
- **主线程健康**：正常输出压力下不应出现持续超过 50ms 的 main-thread long task；偶发尖峰必须可解释且不影响输入。
- **后台恢复**：运行 Agent 任务时隐藏/最小化 1 分钟和 10 分钟后恢复，UI 必须通过 replay 或 snapshot 达到正确状态，不能丢消息、重复消息或卡住队列。
- **多场景压力**：活跃场景保持流畅；非活跃场景可以低频合并更新，但不能丢失必要状态，也不能消耗与前台同等级别的渲染资源。

## 目录结构

```text
src/
├── app/                         # 路由入口
├── shared/                      # 通用 API、布局、基础组件
└── features/
    ├── chat/                    # 工具事件驱动的对话界面
    ├── settings/                # 系统设置
    └── studio/                  # AI Studio
```

## 启动方式与开发命令

```bash
npm install
npm run typecheck
npm run build
```

- **浏览器调试**：运行 `npm run dev` 启动 Vite dev server，用浏览器访问控制台输出的本地地址；浏览器 dev API 通过 Vite `/api` proxy 指向 `VITE_API_BASE_URL`，默认 `http://127.0.0.1:18000`。
- **Electron 桌面调试**：先在后端仓库运行 `python -m agent_runtime.desktop_server --config-file config/agent_runtime.yaml --env-file config/.env.dev` 启动 dev 后端，再运行 `npm run electron:dev`。该脚本只启动 Vite 和 Electron dev 壳，不自动启动后端；dev 后端固定监听 `127.0.0.1:18000`，并通过 `config/.env.dev` 默认使用 `~/.spread-ai-dev` 沙箱数据根，避免写入正式安装版的 `~/.spread-ai` 用户数据。
- **浏览器生产预览**：运行 `npm run build` 后运行 `npm run preview`，用 Vite preview 检查生产构建产物。
- **Electron 正式启动验证**：运行 `npm run electron:start` 只用于本地验证 `dist/` 加载能力；它不是正式发布包，也不会模拟 packaged 模式自动携带后端 sidecar。
- **Windows 正式版打包**：运行 `npm run package:win`。脚本会清除子进程环境里的 `ELECTRON_RUN_AS_NODE`，先执行前端 production build，并把同一份 Vite `dist/` 复制到 `build-resources/frontend` 作为 Runtime HTTP release 前端资源；随后调用后端仓库 `scripts/build_desktop_runtime.py` 以 PyInstaller `--onedir` 模式生成 `build-resources/backend/spread-ai-runtime/spread-ai-runtime.exe`，复制后端 `config/agent_runtime.yaml` 到 `build-resources/runtime-config/agent_runtime.yaml`，并用 `electron-builder --win` 同时生成 portable 与 NSIS 安装包。
- **Windows release 产物**：`release/win-unpacked/Spread AI.exe` 是展开目录验证产物；`release/Spread AI 0.1.0.exe` 是免安装 portable 单文件；`release/Spread AI Setup 0.1.0.exe` 是推荐给最终用户的 NSIS 安装包。`*.blockmap` 用于差分更新，不作为用户直接安装入口。正式安装包和程序图标来自 `build-resources/icons/icon.ico`，运行时窗口/托盘图标资源来自打包后的 `resources/icons`。
- **安装与覆盖升级**：安装版 `appId` 固定为 `mindloop.spread-ai`，NSIS 配置为交互式安装、允许选择安装目录、创建桌面和开始菜单快捷方式，并设置 `deleteAppDataOnUninstall: false`。重新发布同一 appId 的新版本时，直接运行新的 `Spread AI Setup x.y.z.exe` 覆盖安装即可；覆盖安装前建议从托盘菜单退出旧版，或结束 `Spread AI.exe` 与 `spread-ai-runtime.exe` 进程，避免安装器替换运行中文件失败。卸载默认不删除 `%APPDATA%/spread-ai-web` 与 `%USERPROFILE%/.spread-ai` 用户数据。
- **正式版后端启动方式**：正式版用户只启动 `Spread AI.exe` 或安装后的快捷方式，不需要安装 Python/Node.js，也不需要手动执行任何 `spread-ai` OS/system CLI。Electron packaged 主进程必须读取随包复制到 `userData/runtime-config/agent_runtime.yaml` 的 release 启动元数据，从 `agent_runtime_service.service_host/service_port` 派生后端 base URL，确认该固定端口可用后再以 `--config-file` 拉起 `resources/backend/spread-ai-runtime/spread-ai-runtime.exe`。正式版不得通过 `.env`、`SPREAD_AI_*` / `VITE_*` 目标机器环境变量、随机端口或 build-time Vite 默认值决定后端地址；如果 YAML 配置端口被占用，应清晰失败，不得静默切换端口或连接无关服务。
- **正式版窗口与 Runtime URL 契约**：packaged 主进程必须在后端 `/api/health` ready 后再创建主窗口；renderer 通过 preload/IPC 获取同一个 YAML 派生的 Runtime API base URL，并把该地址视为桌面托管只读地址。正式版 renderer 不应由 localStorage、`VITE_API_BASE_URL` 或猜测的 localhost 端口决定 Runtime URL；业务 REST/SSE 请求必须保持相对 `/api/*`，通过 `app://renderer/api/*` 同源代理进入 Electron main-process broker，再由主进程访问 YAML 派生的本地后端地址。
- **后端单例与托盘常驻**：正式版采用用户级后台常驻，不安装 Windows Service。主进程通过共享状态文件、启动锁和客户端心跳确保同一用户下只有一个 `spread-ai-runtime.exe` 后端；只有当状态文件记录的 host、port、baseUrl 和 config 路径与当前 YAML 派生目标一致时才可复用既有后端，避免复用旧动态端口或 dev 后端。关闭主窗口只隐藏到系统托盘，Electron 主进程和后端继续运行；再次双击桌面/开始菜单快捷方式会触发 Electron 单实例恢复主窗口并复用已有后端。只有托盘菜单“退出 Spread AI”或真正退出应用时才停止后端并清理状态文件。
- **多窗口生命周期**：启动入口窗口是 `primaryWindow`，托盘和二次启动只恢复主窗口。应用内部 `openNewWindow()`、PDF 窗口和同源 `window.open` 创建的是辅助窗口；辅助窗口关闭时必须真正销毁，不能隐藏到托盘，避免隐藏 renderer 继续持有“其他标签页驱动中”等业务状态。
- **正式版配置与数据目录**：首次启动时，Electron 会把 `resources/runtime-config/agent_runtime.yaml` 复制到 Electron `userData/runtime-config/agent_runtime.yaml`，该 YAML 只承载正式版程序启动元数据（例如服务 host/port、本机数据根、bootstrap/cloud 默认元数据），不能写入用户资源密钥、Runtime 本地登录凭据或共享云配置的长期本地权威缓存。Electron 主进程不决定业务数据目录，不注入 `SPREAD_AI_DATA_ROOT`；正式版业务数据路径由后端 `agent_runtime.yaml` 与用户设置决定，未显式设置时默认使用 `~/.spread-ai`。dev 与 release 的 Electron `userData` 分别是 `%APPDATA%/spread-ai-web-dev` 与 `%APPDATA%/spread-ai-web`；源码 dev 后端数据根由后端仓库 `config/.env.dev` 固定为 `~/.spread-ai-dev`，普通源码自测不应读写 release 用户数据根。
- **正式版运维验证**：启动/安装及运行异常排查优先查看 `%APPDATA%/spread-ai-web/logs/` 目录下的专用错误日志 `backend-error.log`（后端 ERROR/Exception 专收）与 `electron-error.log`（主进程未捕获异常专收），全量流式日志见 `electron-main.log`、`backend-stdout.log`、`backend-stderr.log`。验证进程可用 PowerShell 查询 `Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'Spread AI*.exe' -or $_.Name -eq 'spread-ai-runtime.exe' }`；正常托盘常驻时 Electron 会有多个 Chromium 子进程，但 `spread-ai-runtime.exe` 应保持单例。测试 `release/win-unpacked/Spread AI.exe` 或安装版时不要继承 `ELECTRON_RUN_AS_NODE=1`，否则 Electron exe 会按 Node 模式运行而不加载主进程入口。
