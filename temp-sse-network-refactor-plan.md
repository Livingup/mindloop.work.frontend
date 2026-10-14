# 前后端 SSE 网络通信重构方案（临时）

## 目标

构建正确、稳定、高流量、高并发、低延迟、高性能的前后端网络通信模型：

- 后端 Agent 执行层与前后端网络通信层解耦。
- 前端网络异常不影响后端 Agent 执行循环。
- 同一个 Agent/Scene 支持多个前端同时连接，后端通信层向所有订阅者广播执行事件。
- 前端支持真实网络中断后的自动重连与 after_seq 续传。
- 心跳延迟、诊断请求超时、控制面短暂慢不能误判为 SSE 断链。
- 业务 SSE 事件本身作为 SSE 连接活性信号。

## 当前问题摘要

当前前端通信健康状态把 SSE transport、Scene presence heartbeat、后端控制面 health/diagnostics、re-attach 恢复流程折叠到一个用户可见状态中，导致普通 HTTP heartbeat timeout、diagnostics timeout 或 attach 恢复失败都可能把 UI 推到“重连中/自动恢复中”。这会在高事件量、前端主线程繁忙、后端控制面短暂延迟或多端并发时产生误报。

## 架构分层

| 层次 | 职责 | 重构约束 |
|---|---|---|
| 后端 Agent 执行层 | 运行 Agent loop 并产出执行事件 | 不依赖前端连接状态；前端断线不得影响 Agent 执行 |
| 前后端网络通信层 | 持久化事件、广播 SSE、提供 replay 和背压 | 以 stream/seq/cursor 为恢复基础；支持多 subscriber；慢消费者只影响自身 |
| 前端 | 消费 SSE、维护 cursor、重连恢复和 UI 投影 | 正确区分 SSE transport、presence heartbeat、control plane 和 Agent execution |

## 设计原则

1. SSE 断链只由 SSE 证据判断：EventSource error/closed、长时间无任何 SSE 入站 activity、replay 失败。
2. 任意业务 SSE 事件都刷新 SSE activity，证明当前连接刚刚可用。
3. HTTP heartbeat 只表示 Scene presence 租约续期，不判断 SSE 是否断开。
4. health/diagnostics 只表示控制面可用性，不判断 SSE 是否断开。
5. restore/re-attach 只用于 presence/scene attach 恢复，不应默认显示实时流断链。
6. 多前端连接相互独立：每个前端维护自己的 cursor，后端 EventHub 对同一 stream fan-out。
7. 高流量路径必须轻量：收包只解析、更新 cursor 和入队；React/UI 投影批量 flush。

## 修改方案

### 1. 前端 SseClient 增加入站活性语义

文件：`src/shared/api/sseClient.ts`

新增：

- `SseActivity` 类型。
- `onActivity?: (activity: SseActivity) => void` 选项。
- `onopen` 触发 activity kind=`open`。
- 每条业务 message 触发 activity kind=`message`，包含 `lastEventId` 和 message count。
- EventSource error 仍只表示 transport error/reconnect 证据，不与 heartbeat 混用。

### 2. Agent 通信客户端透传 activity

文件：`src/features/chat/api/agentRuntimeApi.ts`

修改：

- `createAgentCommunicationClient()` 增加 `onActivity` 选项，并传给 `SseClient`。
- 保持现有 `communication.message` 业务事件类型不变。

### 3. CommunicationHealthState 增加 SSE activity 时间

文件：`src/features/chat/runtime/communicationHealth.ts`

新增字段：

- `lastSseActivityAt?: string`：任意 SSE open/message/ping activity 时间。
- `lastSseMessageAt?: string`：最近业务 message 时间。
- `lastSseErrorAt?: string`：最近 EventSource error 时间。
- `sseErrorCount: number`：连续 SSE transport error 计数。

修改 UI 合成：

- `restoreStatus=reattaching` 不再无条件作为最高优先级强横幅。
- 如果 SSE 最近有 activity 且仍 connected，则 reattach/presence 恢复只显示弱提示或不显示“实时流重连”。
- heartbeat error 只显示“会话保活延迟/通信波动”，不显示“SSE 重连”。
- backend/control-plane unhealthy 只显示“后端控制面暂慢”，不把 sseStatus 改成 error。

### 4. Scene 通信运行时拆分 transport 与 presence

文件：`src/features/chat/runtime/sceneCommunication.ts`

修改：

- 业务 SSE event 到达时更新 `lastSseActivityAt`、`lastSseMessageAt`、`lastEventAt`，并把 transport 标为 connected。
- `onOpen` 更新 transport open activity。
- `onError` 只更新 SSE transport error/reconnecting，不触发 presence reattach。
- `recordHeartbeatResult(error)` 只更新 heartbeatStatus/consecutiveHeartbeatErrors，不再把 `sseStatus` 置为 error。
- 普通 heartbeat error 达到阈值后不再触发 `requestReattach()`；只保持 presence degraded。
- `recordHeartbeatResult(expired)` 仍触发 re-attach，因为 404 表示后端 presence session 确实不存在。
- `detectStaleAndRecover()` 只在 heartbeat expired 或明确 presence 失效时触发恢复；不能因为 lastHeartbeatAt 过旧但 SSE 仍活跃而显示实时流重连。
- `scheduleRecoveryRetry()` 若当前 SSE connected 或最近有 activity，则保持 sseStatus=connected，不改成 reconnecting。

### 5. ChatPage 控制面状态不污染 SSE

文件：`src/features/chat/components/ChatPage.tsx`

修改：

- `markBackendUnhealthy()` 不再设置 `sseStatus=error` 和 `heartbeatStatus=error`。
- diagnostics/health 超时只更新 backendStatus/control-plane 提示。
- attach mutation 的 restore onMutate/onError：如果当前 SSE connected 或最近有 activity，保持 transport connected；恢复失败只影响 restore/presence 状态。
- 手动 retry 仍可显式进入 reattach，但不强制认为现有 SSE 已断。

### 6. 后端 SSE 可见 ping（可选增强，本轮执行）

文件：`AgentRuntime/src/agent_runtime/communication/north_gateway/communication_rest_adapter.py`

修改：

- 空闲超时继续保留 comment keep-alive 的代理保活能力。
- 增加 named event `communication.ping`，data 包含 server_time、stream_id、latest sent_count/keepalive_count，可被前端显式消费并刷新 activity。
- ping 不进入 communication message log，不占用业务 seq，不参与 cursor/replay。

前端本轮可先不把 ping 纳入 AgentEvent reducer，只把它作为 SseClient activity 处理；如果 EventSource eventTypes 只监听 communication.message，则 ping 需要由 SseClient 单独注册。

## 执行计划

1. 创建本方案临时文件。
2. 修改前端 SseClient 与 createAgentCommunicationClient，加入 activity 回调。
3. 修改 CommunicationHealthState 与 getCommunicationView，降低 restore/heartbeat/control-plane 对“重连中”的误报。
4. 修改 sceneCommunication，拆分 SSE transport 与 heartbeat presence 更新路径。
5. 修改 ChatPage 中 backend unhealthy、attach restore、diagnostics 相关状态写入。
6. 后端 SSE endpoint 增加可见 ping 事件并保留 comment keepalive。
7. 添加或更新相关前端单元/类型验证（若项目无对应测试，至少执行 typecheck/build）。
8. 执行后端相关 pytest 或语法检查。
9. 验证通过后维护必要 codebase-rag 知识。
10. 分别提交 web-frontend 与 AgentRuntime Git 变更。
11. 推送两个仓库。
12. 在 web-frontend 执行 Windows release 打包。

## 验证计划与结果

- 前端 `npm run typecheck`：已通过。
- 前端 `npm run build`：已通过，仅保留 Vite 大 chunk 常规警告。
- 后端 communication adapter Python 语法检查与 SSE 语义脚本验证：已通过，覆盖 ping cursor-neutral、业务事件 id/seq、Last-Event-ID 与 after_seq cursor 合并、多 subscriber fan-out 和 per-subscriber replay。
- `npm run package:win`：已通过，生成 `release/Spread AI 0.1.0.exe`、`release/Spread AI Setup 0.1.0.exe` 和 blockmap。
- Chrome 浏览器活体验证：已通过，覆盖 idle `communication.ping` 不显示误恢复、heartbeat/control-plane 降级不污染 SSE transport、真实 SSE 中断后以 `after_seq` 恢复、多前端同 stream 独立恢复；验证中 `communication.ping` 未携带 SSE `id` 且未推进业务 cursor。

## 风险与边界

- 本轮不改变 Agent 执行层逻辑。
- 本轮不改变 communication message 的业务 seq/cursor/replay 协议。
- 后端 ping 不写入消息日志，不影响前端业务事件 reducer。
- 若推送或打包需要凭证/环境缺失，应记录阻塞并向用户报告。
