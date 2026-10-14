# Runtime 认证 runtime-auth · 技术设计

## 会话失效处理
- 方案：仅限后端判定为 Runtime 会话失效的信号（REST 与心跳中 code 以 auth_ 开头的 401、通信流 SSE 失效事件，判定依据 agentruntime:AUTH-04；不带 code 的 401 不在此列）统一汇聚到一个共享失效通知点，由认证门禁统一切换登录态；轮询、心跳、重连随门禁子树卸载一并停止，不逐个改造轮询入口（依据 RUNTIME-AUTH-01）
- 不变量：失效通知以请求发出时携带的 Runtime Token 为去重键，同一 Token 只触发一次
- 禁止：业务组件与 feature 不得自行根据 401 清除 Runtime Token 或切换登录态
