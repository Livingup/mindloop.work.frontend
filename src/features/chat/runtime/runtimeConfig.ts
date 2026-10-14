/**
 * Chat 模块的运行时调参常量集中点。
 *
 * 设计目的：
 * - 把所有「行为参数」（间隔、超时、重试退避、缓存大小、布局尺寸等）集中到一处，
 *   方便：调优、灰度、e2e 测试覆盖、单点 review。
 * - 该文件不导出业务实体类型，只导出常量。
 * - 各调用方通过 import 引用，避免在巨型组件文件顶部出现一大坨常量。
 *
 * 注：与 xterm 行数相关的 TERMINAL_SCROLLBACK_LINE_LIMIT 仍在
 * components/terminalXtermPresentation.ts 中维护（属于渲染层语义，不挪到这里）。
 */

import {
  SCENE_HEARTBEAT_INTERVAL_MS,
  SCENE_HEARTBEAT_STALE_TIMEOUT_SECONDS,
} from "@/features/chat/api/agentRuntimeApi"

// ── 布局：拖拽分栏 ───────────────────────────────────────────────────

export const DEFAULT_WORKSPACE_PANEL_WIDTH_PX = 250
export const MIN_WORKSPACE_PANEL_WIDTH_PX = 180
export const MAX_WORKSPACE_PANEL_WIDTH_PX = 520
export const SPLIT_SEPARATOR_WIDTH_PX = 8
export const MIN_CHAT_PANEL_WIDTH_PX = 420
export const DEFAULT_TERMINAL_PANEL_WIDTH_PX = 336
export const MIN_TERMINAL_PANEL_WIDTH_PX = 320
export const MAX_TERMINAL_PANEL_WIDTH_PX = 900

// ── SSE 事件批处理与缓冲 ────────────────────────────────────────────

/** 前台 Tab：高频 agent 事件批处理 flush 间隔（约一帧）。 */
export const FOREGROUND_EVENT_FLUSH_DELAY_MS = 16
/** 后台 Tab：减少节流损耗，拉长 flush 间隔。 */
export const BACKGROUND_EVENT_FLUSH_DELAY_MS = 250
/** 单 scene 缓冲事件上限；超过后触发立即 flush，避免内存膨胀。 */
export const MAX_PENDING_EVENTS_PER_SCENE = 200

// ── Chat Bubble 持久化队列 ─────────────────────────────────────────

export const CHAT_BUBBLE_PERSISTENCE_TIMEOUT_MS = 12_000
export const CHAT_BUBBLE_PERSISTENCE_RETRY_LIMIT = 2
export const CHAT_BUBBLE_PERSISTENCE_RETRY_DELAY_MS = 500
/** 连续 llm.content.delta 的 latest-snapshot 合并持久化节拍。 */
export const CHAT_BUBBLE_CONTENT_DELTA_PERSIST_DELAY_MS = 120

// ── SSE 通信 cursor / gap replay ───────────────────────────────────

export const LATEST_COMMUNICATION_CURSOR_EVENT_LIMIT = 1
/** 与后端 memory_ring_max_events=4000 对齐，避免一次 replay 超过 ring 窗口。 */
export const COMMUNICATION_GAP_REPLAY_LIMIT = 4_000
export const SCENE_ATTACH_HYDRATE_REQUEST_TIMEOUT_MS = 10_000

// ── Scene 终端历史回放（attach 后初始化用） ─────────────────────────

export const LATEST_TERMINAL_OUTPUT_LINE_LIMIT = 1000
/** 与后端 terminal.max_output_chars_per_read / output_ring_max_chars 对齐。 */
export const LATEST_TERMINAL_OUTPUT_CHAR_LIMIT = 100_000

// ── 心跳调度 ───────────────────────────────────────────────────────

/** 心跳最短间隔，确保最快每 10s 至少发一次。 */
export const HEARTBEAT_MIN_INTERVAL_MS = Math.min(10_000, SCENE_HEARTBEAT_INTERVAL_MS)
/** 心跳过期窗口：与后端 SCENE_HEARTBEAT_STALE_TIMEOUT_SECONDS 对齐。 */
export const HEARTBEAT_STALE_TIMEOUT_MS = SCENE_HEARTBEAT_STALE_TIMEOUT_SECONDS * 1000
/** stale watchdog 检测间隔：在 setInterval 节流时也能及早发现过期。 */
export const HEARTBEAT_STALE_WATCHDOG_INTERVAL_MS = 5_000
/** heartbeat 首次 error 后的快重试延迟，不等 setInterval 节拍。 */
export const HEARTBEAT_ERROR_QUICK_RETRY_DELAY_MS = 5_000
/** 连续 N 次 heartbeat error 后升级为 re-attach。 */
export const HEARTBEAT_ERROR_REATTACH_THRESHOLD = 2

// ── 通信恢复 / re-attach ──────────────────────────────────────────

/**
 * re-attach 退避阶梯（毫秒）。多次失败后退避到 30s；超过阶梯取末尾。
 * 策略：后端重启通常 5-30s，退避节奏要能跨过重启窗口但不能太慢让用户等不住。
 * 自动恢复不会因为达到阶梯末尾而停止，只会继续按末尾间隔后台重试。
 */
export const COMMUNICATION_RECOVERY_RETRY_BACKOFF_MS = [2_000, 5_000, 10_000, 20_000, 30_000] as const
/** 自动恢复持续超过该阈值后升级提示文案；不停止后台重试。 */
export const COMMUNICATION_RECOVERY_LONG_RUNNING_NOTICE_MS = 2 * 60 * 1000

// ── Scene transport/control-plane 缓存策略 ─────────────────────────

/** Scene transport cache policy 周期性巡检间隔。 */
export const SCENE_CACHE_POLICY_INTERVAL_MS = 30_000
/** 同时保持 warm transport control-plane 的 Scene 数（除当前 active 外）。 */
export const WARM_SCENE_COUNT = 3
/** 长期未访问后降级为 cold 的阈值：2 小时。 */
export const COLD_AFTER_INACTIVE_MS = 2 * 60 * 60 * 1000

// ── Agent UI working-set 上限（按 Agent scope 独立） ─────────────────
// 注意：额度必须按 agent_instance_id 独立生效；全局预算只能选择降级哪个 Agent scope。

/** 除 active/pending/running 等 pin 外，进程内最多保留的 warm Agent UI scope 数。 */
export const WARM_AGENT_SCOPE_COUNT = 12

export const MAX_HOT_MESSAGES = 200
export const MAX_WARM_MESSAGES = 100
/** cold 默认不保留该 Agent 消息正文；pending interaction 由裁剪保护逻辑单独保留。 */
export const MAX_COLD_MESSAGES = 0
/** 生产路径 rawEvents=0；仅 chat.debug=1 时 hot 允许调试窗口。 */
export const MAX_HOT_RAW_EVENTS = 0
export const MAX_WARM_RAW_EVENTS = 0
export const MAX_COLD_RAW_EVENTS = 0
/** chat.debug 开启时 hot scene rawEvents 调试上限。 */
export const MAX_HOT_RAW_EVENTS_DEBUG = 50

/** 每个 Agent 终端最多保留的输出行数（hot tier 上限），随 cache tier 进一步收紧。 */
export const MAX_TERMINAL_VISIBLE_LINES_PER_TERMINAL = 1000
export const MAX_WARM_TERMINAL_LINES = 300
/** cold 只保留 terminal session 元数据，不保留输出行。 */
export const MAX_COLD_TERMINAL_LINES = 0

// ── Chat UI 投影展示上限 ─────────────────────────────────────────────

export const MAX_CONVERSATION_VISIBLE_MESSAGES = 100
export const MAX_EXECUTION_MONITOR_BLOCKS = 20

// ── 调试 ───────────────────────────────────────────────────────────

export const CHAT_DEBUG_STORAGE_KEY = "chat.debug"



