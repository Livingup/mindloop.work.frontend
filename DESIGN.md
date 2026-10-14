---
version: alpha
name: Spread AI Console
description: A refined, light Chat UI-inspired workspace theme for the whole product shell and management surfaces, with terminal output remaining the only dark visual exception.
colors:
  app-bg: "#F6F8FB"
  shell-bg: "#F8FAFC"
  topbar-bg: "#F8FAFC"
  footer-bg: "#F8FAFC"
  panel-bg: "rgba(255,255,255,0.88)"
  panel-bg-hover: "#F1F5F9"
  border-muted: "rgba(203,213,225,0.80)"
  border-strong: "rgba(148,163,184,0.55)"
  text-primary: "#0F172A"
  text-secondary: "#475569"
  text-muted: "#64748B"
  text-subtle: "#94A3B8"
  accent: "#263A63"
  accent-hover: "#304875"
  success: "#16A34A"
  warning: "#D97706"
  danger: "#DC2626"
  purple: "#7C3AED"
  chat-bg: "#F6F8FB"
  chat-panel-bg: "#F8FAFC"
  chat-rail-bg: "#EEF2F6"
  chat-card-bg: "rgba(255,255,255,0.88)"
  chat-card-border: "rgba(148,163,184,0.24)"
  chat-text-primary: "#1E293B"
  chat-text-secondary: "#64748B"
  chat-text-muted: "#94A3B8"
  chat-user-bubble: "#263A63"
  chat-user-bubble-hover: "#304875"
  chat-accent-muted: "#4F6F96"
  context-compression-bg: "#F5F1FF"
  context-compression-border: "#DDD2FF"
  context-compression-accent: "#6D4AFF"
  summary-panel-header-bg: "#EEE8FF"
  summary-panel-header-text: "#4F3BC9"
  summary-panel-header-border: "#DDD2FF"
  summary-panel-body-bg: "#FFFFFF"
typography:
  page-title:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 1.125rem
    fontWeight: "600"
    lineHeight: "1.75rem"
  section-title:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: "600"
    lineHeight: "1.25rem"
  body:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 0.875rem
    fontWeight: "400"
    lineHeight: "1.5rem"
  caption:
    fontFamily: Inter, ui-sans-serif, system-ui, sans-serif
    fontSize: 0.75rem
    fontWeight: "400"
    lineHeight: "1rem"
  code:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace
    fontSize: 0.75rem
    fontWeight: "400"
    lineHeight: "1.25rem"
rounded:
  sm: 0.25rem
  md: 0.5rem
  lg: 0.75rem
  pill: 9999px
spacing:
  xs: 0.25rem
  sm: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.25rem
  xxl: 1.5rem
components:
  nav-icon:
    backgroundColor: transparent
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: 0.375rem
  nav-icon-active:
    backgroundColor: "rgba(255,255,255,0.12)"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 0.375rem
  subnav-item:
    backgroundColor: transparent
    textColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: 0.5rem
  subnav-item-active:
    backgroundColor: "rgba(255,255,255,0.10)"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 0.5rem
  filter-chip-active:
    backgroundColor: "rgba(255,255,255,0.15)"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.pill}"
    padding: 0.375rem 1rem
  card:
    backgroundColor: "{colors.panel-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 1rem
  card-hover:
    backgroundColor: "{colors.panel-bg-hover}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 1rem
  compact-list:
    backgroundColor: "{colors.app-bg}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: 0.75rem
  detail-stage:
    backgroundColor: "{colors.app-bg}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: 1.5rem
  form-control:
    backgroundColor: "rgba(255,255,255,0.04)"
    borderColor: "{colors.border-muted}"
    textColor: "{colors.text-primary}"
    placeholderColor: "{colors.text-muted}"
    rounded: "{rounded.md}"
    padding: 0.5rem 0.75rem
  select-popup:
    backgroundColor: "#020617"
    borderColor: "rgba(59,130,246,0.22)"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
    padding: 0.25rem
  select-option:
    backgroundColor: transparent
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    padding: 0.5rem 0.625rem
  select-option-hover:
    backgroundColor: "rgba(255,255,255,0.10)"
    textColor: "{colors.text-primary}"
  select-option-active:
    backgroundColor: "rgba(30,64,175,0.62)"
    textColor: "#DBEAFE"
  scrollbar:
    trackColor: transparent
    thumbColor: "rgba(148,163,184,0.32)"
    thumbHoverColor: "rgba(148,163,184,0.46)"
    rounded: "{rounded.pill}"
---

## Overview
Spread AI Console 是一个以 Chat UI 浅色工作区为品牌基底的 AgentRuntime 工作台。无论是 Chat 主链路、产品壳层、管理页还是资源详情页，都应共享同一套 refined soft ivory / mist gray / blue-gray 语义主题：页面默认克制、成熟、专业，并在统一的浅色高级工作台里承载高信息密度内容。

## Multi-end Product Design Architecture

同一套视觉语言和业务语义必须同时覆盖 `electron-desktop`、`desktop-web` 与 `mobile-web`。三端共享产品身份、Runtime/session 正确性、路由含义、资源管理交互语法、Chat 状态恢复、错误反馈和账号控制语义；平台差异只允许体现在 shell 容器、布局骨架、导航 chrome、触摸/键鼠交互、详情展开方式和信息密度上。移动浏览器不是桌面工作台的等比例缩放版本，也不是另一套孤立业务产品；它是同一业务前端在单列触摸环境里的任务控制与资源管理体验。浏览器和移动端 release 加载前端后，默认 API 访问应绑定到该页面自身的 HTTP origin 下的 `/api/*`；不要让移动端页面加载成功后再回退到 localhost、dev proxy、localStorage 旧地址或另一个隐式后端地址。

### Product shape by end

| 维度 | 三端共享规则 | Electron desktop | Desktop web | Mobile web |
| --- | --- | --- | --- | --- |
| 产品语义 | Chat、资源管理、设置、日志、Runtime bootstrap、错误恢复和账号控制语义一致 | 完整桌面工作站，适合长时间运行和多面板并列 | PC 浏览器工作站，能力接近 Electron 但不依赖桌面壳能力 | 单列任务控制与资源管理台，保留核心任务控制和状态恢复，不强行并列桌面多栏 |
| Shell | 普通业务 chrome 不暴露 Runtime/base URL/localhost 细节；账号入口属于顶部右侧或等价 shell action 区 | 可使用窗口标题栏、拖拽区、托盘/多窗口和桌面日志入口 | 使用浏览器标签页语境，不渲染 Electron-only 控制 | 使用轻量顶栏、横向/底部业务切换、局部返回、sheet/drawer；适配安全区和软键盘 |
| Layout | 核心业务状态和 route identity 共享，布局组件按断点和 client kind 分叉 | 高密度多栏、拖拽 split panes、常驻终端/目录/监控 | 响应式桌面多栏，宽度不足时渐进降级 | 单列、分步 drill-down、bottom sheet、全屏辅助面板；避免同时展示桌面 rail、目录、消息、终端、详情多栏 |
| Navigation | 一级业务域、二级资源面、详情返回语义一致 | 桌面一级入口在顶部，无全局左 rail；顶部二级导航与局部侧栏可保留 | 与 Electron 桌面一致（一级入口在顶部）或轻度响应式折叠 | 移动继续主菜单下拉导航，不照搬桌面横向排列；一级切换触摸可达，详情必须有明确返回；active 状态不能只靠颜色 |
| Interaction | 提交、停止/中断、确认、详情查看、过滤、搜索、错误重试语义一致 | 鼠标、键盘、拖拽、多窗口优先 | 鼠标、键盘、多标签页优先 | 触摸目标、滑动/滚动、软键盘遮挡、低密度列表和渐进详情优先 |
| Density | 信息可扫描、主任务优先、次要技术信息低对比但可追溯 | 全量高密度工作台 | 中高密度浏览器工作台 | 减少并列信息，优先“当前场景 / 当前任务 / 关键控制 / 状态恢复” |

### Mobile web baseline

`mobile-web` 的基线产品形态定为**单列任务控制与资源管理台**。它必须支持移动浏览器访问和关键业务操作，但不把桌面工作站的所有并列面板同时塞进手机屏幕。移动端设计必须满足：

- 用户能连接/登录 Runtime、完成首次账号/PostgreSQL/OSS bootstrap、看到离线/错误状态并修复。
- 用户能进入 Chat 当前场景，阅读消息流，提交输入，执行确认/取消/中断/停止等关键控制。
- 用户能查看运行状态、工具事件和终端输出，但终端和执行监控可以通过独立 panel、sheet 或 route 展开，不要求与消息流并列。
- 用户能浏览和管理资源，移动端以列表 -> 详情 drill-down 为主，桌面 master-detail 只在宽度足够时出现。
- 用户在后台、锁屏、切换标签页后返回，必须恢复到权威状态；不能因为移动端页面隐藏而误停任务或丢失消息。

### Responsive shell and layout rules

- 桌面端可以继续把 Chat、工作目录、终端、执行监控和管理详情并列为工作台，但这些并列结构必须通过 shared layout primitives 表达，不能散落为页面内硬编码的 `min-width`、固定像素网格或不可收缩分栏。
- 移动端不能显示为缩小版三栏桌面。Chat 应优先呈现当前场景消息、Composer、任务状态与必要的中断/确认操作；目录、终端、执行监控、附件、诊断和设置应通过可返回的分步页面、抽屉、sheet 或独立 route 展开。
- 管理页在桌面端继续使用搜索 + 主/次过滤 + 响应式卡片网格 + adaptive master-detail。移动端必须降级为单列搜索/过滤、卡片列表和详情 drill-down；详情页保留返回列表的上下文，不强行保留桌面左侧压缩列表。
- 表单、下拉、候选列表、过滤 chip 和卡片必须具备足够触摸目标面积。移动端信息密度可以降低，但不得改变资源选择、过滤含义、保存/取消、启用/停用等业务语义。
- 页面或组件不得依赖全局 `min-width: 1280px` 一类桌面锁定来保证布局。需要桌面最小工作区时，应限制在 desktop shell 容器或具体 desktop-only 面板内，并提供窄屏替代路径。
- `desktop-web` 与 `electron-desktop` 可以共享桌面信息架构；Electron 专属窗口拖拽、托盘、多窗口、preload 状态只能出现在壳层 chrome，不得改变普通 PC Web 的主业务布局。

### Mobile surface rules

- **Chat**：移动 Chat 主视图以消息流和 Composer 为中心。场景列表、工作目录、终端、执行 timeline、附件和诊断都属于辅助面，必须通过明确入口打开并能返回主消息流。Composer 在软键盘出现时仍可见或可恢复，发送/停止/确认按钮必须触摸可达；通信、LACP、提示音等状态控件在手机上必须进入可触摸的 inline 状态行或等价移动容器，不得沿用桌面 absolute 浮层坐标；移动附件入口必须显式提供图片/文件触摸按钮，不能只依赖拖拽、粘贴或隐藏纸夹图标。
- **Mobile scene navigation**：mobile-web 在打开项目后必须常驻可触摸的 scene 导航闭环，至少展示“+ 新对话”和已打开 scene tabs；该 scene 导航应放在移动端顶部 header 同一行中主菜单下拉按钮后方的中间可用区域，右侧仍保留打开新标签页、账号图标等必要操作。多 scene tabs 必须横向滑动显示，不得换行或挤压成不可识别的窄片；用户进入 LACP、日志、Settings 或资源管理页后仍应能通过这些入口返回 `/chat`。PC 浏览器 Web 与 Electron 壳已有顶部 scene tabs，不应为修复 mobile-web 问题而重排其导航。
- **Mobile auxiliary panels**：mobile-web 的工作区、执行监控和终端不使用桌面左/右分栏显隐开关；这些辅助面应通过 Chat 内部触摸 tab、sheet 或独立页面进入。桌面端仍可保留工作区/终端分栏开关和宽度调节。
- **Terminal / execution monitor**：终端可以全屏或 bottom sheet 展开，保留复制、滚动、最新输出、停止/中断等关键操作。高频输出仍使用终端通道，不把输出行转换成大量 React 节点。
- **Resource management**：列表页单列，搜索和过滤先于卡片；过滤 chip 超出时收进“更多”弹层或横向滚动，不能撑宽页面。详情页通过 route/sheet/drill-down 打开，提供清晰返回列表入口。
- **Settings / forms**：单列表单、分组标题、低密度说明、可触摸控件；主操作可以 sticky 到底部但不得遮住输入。保存失败、校验错误和跳过/重试必须与桌面语义一致。
- **Runtime bootstrap/offline**：登录、首次初始化、离线和错误页必须居中但可滚动；小屏 padding、卡片宽度、按钮堆叠和输入宽度必须优先保证可读和可操作。

### Implementation guidance from design

1. 先设计共享 Shell 和 layout primitives，再做页面级移动视图。
2. 若页面只需响应式收缩，优先改共享组件；若交互结构不同，再拆 Desktop/Mobile view adapter。
3. 拆 view adapter 时，业务 hook、query、mutation、DTO、错误模型和权限判断必须保持同源。
4. 每次实现必须同时检查 PC Web、Electron 壳内 Web 和 Mobile Web 的入口不被破坏。

## Theme Zones
前端现在采用统一主题系统，而不是 Chat 浅色 + 管理页深色的双主题分区。Chat 主页面已经定义了产品的权威视觉语言：雾灰白、象牙白、低饱和蓝灰、近白卡片、低对比 slate 边界和深靛蓝小面积强调。这套视觉语言必须扩展到产品壳层、顶部菜单、管理设置页面（Agent、MCP、Skill、LLM、工具、提示词等资源管理）、列表页、详情页、表单和抽屉。不要为了表现“控制台感”把非 Chat 页面切回深色，也不要引入高饱和、强装饰或偏暖米黄色的临时视觉。

命令行终端是唯一明确保留的暗色例外：它服务于真实终端输出阅读，允许继续使用暗色 xterm 主题，但终端外壳与页面衔接处仍应服从统一的浅色产品主题。跨区域共享组件默认遵循浅色统一主题；只有终端内部输出容器和终端专属状态 chrome 可以使用暗色语义。

应用壳层与导航遵循统一、克制的浅色视觉原则：背景贴近 Chat 主面板的 mist gray / soft ivory 中性色，边界使用低对比 slate 分隔线；顶部一级导航与局部辅助侧栏的图标、文字、hover 和 active 状态使用蓝灰或深靛蓝小面积强调，保证可读和可点击，避免形成突兀的深色竖条或重色块。虽然应用级全局左 rail 已移除，但该浅色、低对比、克制的导航视觉原则继续适用于顶部导航与仍存在的局部辅助区域，不改动主题设计系统。

## Chat Conversation Visual System
Chat 对话区必须保持同一产品和功能结构，只做视觉层级收敛：顶部栏、场景 Tab、左侧工作目录树、中间消息流、右侧终端入口、右侧时间线和底部 Composer 都应保留原信息架构。页面底色使用 refined soft ivory 与 mist gray neutrals，例如 `#F6F8FB`、`#F8FAFC`、`#EEF2F6`；主消息卡片使用白色或近白色半透明表面，配合 1px 低对比边框、柔和圆角和轻阴影，不使用重边框、大面积渐变或高饱和装饰。用户消息气泡使用低饱和深靛蓝 / blue-gray，例如 `#263A63`，白色文字，允许轻微深度但不使用强烈霓虹、强渐变或亮蓝紫。Agent 回复、工具调用、诊断、附件和场景选择卡片使用高级浅色卡片体系，token、耗时、ID、retry、时间戳等调试元信息必须保留但降低对比度，成为清晰可读的二级信息。Agent 普通回复、local_agent 子 Agent 和 remote_agent 远程 Agent 的结构化正文（HTML/Markdown）必须复用同一套 document 内容样式，避免同一消息流里 HTML 与 Markdown 出现两套标题、列表、表格或代码块视觉；普通用户深色气泡保持用户消息自身样式。状态图标和右侧 dotted timeline 使用低饱和 teal / blue-gray，运行、成功、失败仍需可辨识，但不能抢占主视觉。底部输入区应呈现为 refined floating composer：柔和边框、细腻阴影、muted placeholder、克制发送按钮，保持附件、@、上传、发送和中断能力不变。

多 Agent Chat 场景的布局归属必须保持清晰：顶部 Agent 实例标签列表属于当前 scene 的共享导航区域，用于在同一 scene 内切换 root/subagent/远程协作 Agent；消息流、底部 Composer、执行监控投影和右侧/移动端终端入口属于当前选中 agentInstanceId 的私有工作区。某个 Agent 创建终端或产生执行输出时，只能影响该 Agent 自己的对话区域、终端区域和移动端终端入口，不能让同一 scene 下其它无终端 Agent 出现空的右侧终端栏或被挤占布局。
顶部 Agent 实例标签列表在桌面端和移动端都应呈现为轻量文字导航：选中态使用加粗主文字与小面积底部强调线/折角指示表达，不使用圆角边框、白底阴影卡片或厚重按钮外观；未选中态保持低对比文字导航，只保留必要 hover/focus 反馈。

## Context Compression Lifecycle Bubble

上下文压缩完成、压缩中、失败或跳过等生命周期事件在 Chat 消息流中使用浅紫识别体系：外层事件气泡使用 `#F5F1FF` 背景和 `#DDD2FF` 边框，标题、整体状态图标和编号使用 `#6D4AFF` 作为“AI 记忆/上下文处理”的识别色。内部“压缩后的完整 Markdown 摘要”必须作为独立阅读面板呈现：面板 header 使用 `#EEE8FF` 浅紫标题条、`#4F3BC9` 标题文字和 `#DDD2FF` 下边线；正文区域保持 `#FFFFFF` 或极接近白色，避免紫色影响路径、代码和 Markdown 内容阅读。外层浅紫表示生命周期事件类型，内部 header 浅紫表示摘要区块标题，正文白底负责高可读内容。

## Navigation
桌面一级业务入口集中于顶部导航，log（日志）与 Settings 平级并紧随其后（为独立工作区，不是 Settings 子页）；应用壳层不再提供全局左侧导航栏。业务页二级导航与局部辅助面板保持原有职责：二级菜单使用内容区顶部水平导航，表达当前业务域下的管理面（例如 Agent 业务域下的 Agent 定义、提示词模板和系统变量；LLM 业务域下的 Policies、Providers、Models）。明确移除的是应用级全局左侧窄栏，而非 Chat 工作目录树、面板开关或业务页 master-detail 列表。移动端沿用主菜单下拉与跨路由常驻的 scene 导航，不因桌面入口迁移重排菜单。

## Shell Account Controls
登录后的账号入口属于产品壳层顶部右侧操作区，应与窗口、面板和全局操作保持同一层级；不得在主工作区或页面底部额外渲染悬浮账号状态条。普通产品界面不直接展示 Runtime 后端 base URL、localhost 端口或其他后端连接细节；这类信息只适合放在设置、诊断、tooltip 或错误排障上下文中，不能作为常规页面 chrome 文案。桌面端账号触发器应优先展示用户可识别的账号名，并把退出登录作为菜单动作，而不是把账号、Runtime 地址和退出按钮混排成调试状态条；移动端 shell 空间受限时，账号触发器应收敛为纯账号图标按钮，账号名保留在下拉菜单内容中展示。

## Resource List Model
所有管理页使用同一种列表交互模型：可选主操作、搜索框、一级标签过滤、可选二级标签过滤，以及响应式卡片网格。列表页不渲染冗余页面标题和独立总数；资源数量只并入过滤标签表达。分组只作为过滤器表达，不默认渲染成展开树。这样即使资源存在一级或二级分组，页面仍然保持可扫描、可快速定位。

## Adaptive Master Detail
资源管理页必须根据用户当前操作目的切换信息主体。初始列表态时，用户目标是浏览和发现资源，因此主舞台应该是平铺卡片列表，利用宽度展示更多资源并提供搜索与过滤。进入详情态后，用户目标变为理解和操作某一个资源，因此详情内容成为右侧主舞台；原资源列表不能消失，而是压缩为左侧窄单列导航，用于保留上下文、快速切换相邻资源和返回列表态。详情态的返回列表入口只放在左侧压缩列表顶部，右侧详情主舞台不再重复渲染返回按钮。压缩列表必须尽量窄，只展示识别资源所需的最小信息，不额外渲染“本地工具”“提示词模板”“MCP 服务”“Skill”等资源类型标题；如果资源有明确分组，应使用可点击折叠的分组标签分段，而不是在每一行重复展示分组信息。这个主从关系变化体现信息表达张力：当前任务拥有最大空间，辅助导航保持可用但降低视觉权重。

## Filters
选中的过滤标签使用柔和灰色胶囊，并展示当前匹配数量。未选中的过滤项使用低强调文字按钮。搜索需要和过滤条件组合生效，并尽量匹配资源名称、技术 ID、描述、分组、分类、状态等字段。

## Cards
资源卡片是可点击的低对比矩形卡片。每张卡片包含标题、技术标识、可选描述和元数据徽标。卡片不应该变成小型详情页，只提供足够帮助用户选中正确资源的信息。

## Agent Editor Candidate Lists
Agent 定义编辑页右侧待选列表（提示词模板、本地工具、MCP 服务与工具权限、Skill、子 Agent）共享同一套浅色候选列表模型：侧栏保持低对比浅色背景，顶部使用小字号标题/数量与搜索/过滤控件，分组以细线和小型折叠头表达层级，资源项使用紧凑矩形卡片而不是重型详情卡。具备候选选择状态的列表应提供统一的“全部 / 未选 / 已选”过滤条，提示词模板中的“已引用”、MCP 服务中的“已绑定/配置”在视觉和过滤语义上归入已选态。已选、已引用或已绑定的卡片必须在保持克制的前提下比普通卡片更清楚：使用低饱和蓝灰边框、浅选中底色、小面积选中徽标或细 ring/阴影增强；禁止使用大面积高饱和色块、强渐变或改变布局来表达选中态。不同候选来源的按钮文案可以按业务语义使用“添加/已选/插入/已引用/绑定/配置”，但视觉结构和状态强度应保持一致。

## Details
长内容或结构化内容应该使用详情主舞台。Skill Markdown、MCP 配置、工具 Schema、提示词编辑内容以及未来的 Agent 编辑内容，都应该在详情主舞台中获得充足宽度，而不是放在狭窄侧栏里。详情态左侧压缩列表只承担导航、上下文保持和返回列表态，不承载完整卡片信息；右侧详情主舞台不放返回平铺列表按钮，也不渲染“Local Tool”“编辑提示词片段”这类只说明页面类型的静态提示文本，避免重复操作入口和低价值信息占用主舞台。

## Global Confirmations and Notifications
所有需要用户确认的危险操作、未保存草稿放弃、导航阻断和状态切换都使用同一套 Renderer 内异步 modal，不使用浏览器/Electron 原生 `alert`、`confirm` 或 `prompt`。确认框是跨 `electron-desktop`、`desktop-web`、`mobile-web` 的共享交互语法：浅色 app-surface 卡片、app-overlay 遮罩、明确标题/说明、可见的确认与取消文案；危险动作使用 danger 语义，放弃草稿使用 warning 语义，普通生效切换使用 primary 语义，不能只靠颜色表达风险。

Modal 打开后初始焦点默认落在取消操作，Tab/Shift+Tab 只能在对话框内循环，Escape、关闭按钮和允许的遮罩点击都等价于取消；背景内容在 modal 存续期间不可交互。关闭时先卸载 modal，再恢复到触发元素；若触发元素将卸载或禁用，则恢复到调用方提供的稳定业务输入目标。持久通知用于替代无返回值依赖的 `alert`：error/warning 默认由用户主动关闭，不抢占当前输入焦点，并通过 alert/status 语义让屏幕阅读器获知。

## Forms
表单控件必须保持统一、克制、低对比，不允许同一管理页混用原生系统下拉、页面局部自绘下拉和共享下拉。文本输入、数字输入、文本域、下拉触发器都应使用同一套浅色表面、低对比边框、圆角和字号。提示词等模板编辑器在多行文本域上方提供统一的「插入系统变量」下拉交互，下拉面板采用浅色卡片弹层，支持变量过滤检索、按分类分组，点击后在光标处无缝插入占位符并自动重获焦点；系统变量占位符采用等宽代码样式展示并提供一键复制能力。下拉菜单必须使用自绘浅色弹层，不使用浏览器原生白底选项；弹层背景贴近主卡片体系，边界使用 slate 低对比分隔，hover 使用更浅一层表面增强，active 使用低饱和蓝灰选中态，不使用系统蓝条或大面积高亮。技术 ID、模型名、协议名等值可以使用 monospace，但同一个业务区域内的下拉字体风格必须一致。

## Scrollbars
所有滚动条保持低存在感。滚动条轨道必须透明，不渲染明显背景条、凹槽或上下箭头；默认只显示圆角滑块。全局滚动条轨道尺寸统一为 10px，视觉滑块宽度/高度保持约 6px，通过透明留白形成轻量系统感。滑块使用低对比灰色 `rgba(148, 163, 184, 0.32)`，hover 时增强为 `rgba(148, 163, 184, 0.46)`，只能增强滑块本身，不能形成持续可见的竖向背景块。

xterm.js 终端滚动条是自绘 DOM，不会自动继承浏览器 `::-webkit-scrollbar`；终端区必须通过 `.xterm .xterm-scrollable-element` 相关样式单独对齐全局滚动条规范。终端滚动条同样必须隐藏箭头、保持透明轨道、使用 10px 轨道和约 6px 圆角滑块，禁止出现粗大的方块滑块、明显轨道背景或与系统滚动条不一致的视觉。

## Hierarchy
单层资源使用一行过滤标签。双层资源使用一级过滤标签表示大类，再使用二级过滤标签表示子分组或状态。工具页使用 `category` 作为一级过滤，工具 `group` 作为二级过滤。MCP 页使用服务 `group` 作为一级过滤，状态和传输类型作为二级过滤。Agent 页使用 `group` 作为一级过滤，启用状态作为二级过滤。Skill 页使用 `group` 作为一级过滤。提示词模板页使用 `category` 作为一级过滤。系统变量字典页使用变量 `category` 作为一级过滤，并支持按占位符、变量名、说明与取值逻辑进行全局全文匹配。

## Accessibility
可点击卡片和过滤标签必须使用可键盘聚焦的按钮或链接。激活状态不能只依赖颜色，还要通过形状或背景变化体现。深色背景上的文本对比度必须保持可读。

## Task Note & Inspector Visual System
Chat 界面中右侧 `TimelinePane` 演进为 Agent 独立巡检容器（Inspector），承载双 Tab 模式：
1. **双 Tab 与信息架构**：
   - Tab 1: `LLM TimeLine`（工具流水与大模型对话过程）
   - Tab 2: `Task Note`（当前 Agent 任务现场工作手记可视化）
   - 顶部全宽 Agent 导航栏保持三位一体联动：切换 Agent 实例时，聊天消息、Timeline 与 Task Note 同步指向目标 `agent_instance_id`，且各 Agent 实例独立持久化各自当前选中的 Tab（LLM TimeLine 或 Task Note）状态，切换 Agent 时各自恢复自己的巡检视图。
2. **宽度规范与离散切换**：
   - 设现有 Timeline 宽度为 $W$（`clamp(28ch, 32ch, min(42ch, 36vw))`）；
   - Task Note 宽度固定为同源两倍 $2W$（`clamp(56ch, 64ch, min(84ch, 72vw))`）；
   - Task Note 内部提供的 Compact（紧凑）与 Expanded（展开）密度切换仅改变章节的展开折叠密度，容器外层宽度固定为 $2W$ 不变；
   - 切换 Tab 采用离散布局切换，禁止添加 CSS transition/animation 动画，避免连续 reflow 引起视觉重排抖动；左侧会话区域与滚动条必须保持绝对稳定。
3. **技术文档流式排版与零卡片原则（Document-Style Task Note）**：
   - **彻底废除嵌套卡片**：严禁在 Task Note 外层或内部条目使用圆角背景框卡片（如 `rounded-xl border bg-white shadow` 或 `rounded-lg border bg-slate-50` 框套框结构）。整体排版完全转向技术文档/手记章节流式排版；
    - **章节容器与标题**：各章节使用底部分隔细线（`border-b border-app-border/40 pb-4 pt-2`）轻量隔离，章节标题呈现为文档二级标题（带微型折叠切换，严禁在标题后附带 `MIXED` / `AGENT` / `RUNTIME` 等来源标记）；
    - **单边强调竖线替代卡片容器**：重点信息（如 Blocker、Issue 复盘、决策定型、外部状态变更）严禁使用闭合背景卡片，统一使用 GitHub/Antigravity Markdown Callout 风格的左侧单边强调竖线（`border-l-2 pl-2.5 py-0.5`）；
    - **排版排布**：长文本段落统一使用无边框 Markdown Prose（`prose prose-xs max-w-none text-app-secondary dark:prose-invert`），文件路径与命令统一采用内联代码标签（`code` 样式）；
    - **待办清单可读性保障与零划线原则**：待办清单严禁对已完成文本添加划线/删除线（`line-through`），必须保证所有任务描述 100% 完整清晰可读；状态使用精致微型矢量图标（如绿色 `✓`、蓝色 `⏳`、灰圈 `○` 或 `×`）及右侧状态标签表达，杜绝粗暴划掉文字；
    - **纯粹中文标题与零冗余原则**：章节标题、小标题与条目标签严禁添加不必要的中英文双语对照（如括号英文翻译 `(Mission & Requirements)` 等），直接使用纯粹、干脆、直接的中文表达（如“任务意图与需求规格”）。设计原则是结构清晰直观、简洁干脆、坚决不搞冗余赘述；
    - **标题与状态展示规范**：任务标题必须作为纯粹标题居左展示，严禁在标题正前方放置大块胶囊状态标签（如“执行中”等带底色圆角框），状态应以轻量微型图标与文本右对齐点缀，保持技术文档的优雅与纯粹；
    - **不展示即刻下一步**：Task Note 聚焦于任务全貌、架构方案与事实依据，明确不展示“即刻下一步 (Next Action Pointer)”, 防止冗余干扰；
    - **冻结 6 大认知核心章节（严格对齐 Task Note 确定性状态机说明书）**：
      - 章节 1：任务意图与需求规格 - 对应 `agent_user_mission`，包含任务标题与执行状态、经 Agent 提炼的正式需求规格与验收边界（Markdown Prose）、用户原始意图指令流（可折叠审阅 `raw_prompts`）；
      - 章节 2：执行进展与当前状态 - 对应 `task_progress_content`，包含当前微观断点指针（`current_work`）、阶段已完成总结（`completed_summary`）、阻塞与风险（单边琥珀色强调线 `current_blockers`）、最近验证结论（`recent_validation`）与交接避坑备忘（`handoff_notes`）；**二级标题独立成行排版**：执行进展下的所有子模块必须采用独立的二级标题行（如“当前微观焦点”、“已完成总结”、“最近验证”等），内容在其下方另起一行换行呈现，严禁与标题混排在同一行；
      - 章节 3：技术方案与计划待办 - 对应方案表、决策表与待办表，包含宏观技术方案 Prose、无划线清晰待办清单（矢量状态图标 `✓` / `⏳` / `○`）、关键架构技术决策与权衡（单边蓝紫强调线）；
      - 章节 4：现场背景与避坑认知 - 对应素材表、发现表与问题表，包含工作区核心相关上下文、客观认知突破与架构真相、问题复盘与伤疤记忆（重点突出已解决问题的 `resolution` 根因避坑）；**工作区核心相关上下文**（原“工作区关键坐标”）必须遵循“**摘要在上面，范围位置在下面**”的排版格局，每一项前置统一添加等宽序号徽标（`#1`、`#2`...），核心描述摘要作为核心信息必须使用主色文字高亮清晰呈现，严禁使用浅灰色字弱化；文件与行号范围标签在其下方整齐排列；认知突破与调查证据（Discoveries）严禁采用混乱的圆点长文本列表（`•`），统一采用带序号的天蓝色单边强调竖线（`border-l-2 border-sky-400/60 pl-2.5 py-0.5`）流式排版，分立核心发现、业务影响与证据坐标；代码证据路径必须做智能相对化规约（去除绝对盘符），以带文件图标的内联标签展示，并在末尾精确定位代码行号区间（`:L...`）；
      - 章节 5：交付产物与验证保障 - 对应产物表、验证表与外部状态表，包含代码落地修改账本、质量检验与验收结论、外部环境状态与回滚指引；对于关联的执行命令，作为验证或变更的具体佐证内联展示，彻底废除孤立的命令黑框章节；
      - 章节 6：协作网络与专线通信 - 对应关系表与父子/远程专线消息表，按 Agent 协作对象进行显式分组汇聚，展示各 Agent 角色/拓扑状态（子 Agent/父级调度/远程协同、活跃/已释放）以及彼此之间的双向专线往来通信流水（发送与接收区分单边强调线与方向标识）；
    - **空章节静默隐藏原则**：无数据的章节直接完全不予渲染显示，绝不呈现多余的“暂无记录”空卡片占用空间；仅当整篇手记所有章节皆无数据时，展示全局单一的居中待命占位说明；
    - **折叠交互即时响应与隔离**：章节折叠状态直接通过 Zustand 响应式订阅驱动渲染，并按 `agentInstanceId:sectionKey` 实现实例隔离；用户点击折叠箭头必须即刻切换展开/收起，杜绝点击无反应或延迟滞后问题。
4. **视窗感知更新与零红点规范**：
   - 坚决不使用任何未读小红点、小圆点或徽标提示，保持界面纯粹清爽与专业；
   - 仅当用户当前激活并停留在该 Agent 的 Task Note 面板时，接收到后端 `task_note.updated` SSE 通知后防抖 150ms 主动拉取最新快照；
   - 若未处于当前视野（在 Timeline 或看着其他 Agent），仅将缓存标记为失效，坚决不发起后台网络请求；只有该 Agent 的 Task Note 被重新激活时才刷新。
5. **生命周期与边界状态**：
   - 新打开的 Agent 实例在尚未发生对话、`task_id` 未创建前，面板展示待命就绪引导态，绝对不发起非法 REST 请求，且允许正常切换回 Timeline；
   - 用户主动结束任务或触发任务完成边界时，前端必须立即清除 Task Note 缓存，面板平滑重置为待命就绪态。
