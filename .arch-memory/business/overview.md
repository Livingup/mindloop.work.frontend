# 业务总览

## 领域清单
| 域 | 类型 | 职责 | 文件 |
|---|---|---|---|
| runtime-auth | 支撑 | 前端对本机 Runtime 登录会话的感知与登录态切换：Runtime Token 的本地存取，会话失效信号的统一感知（判定以后端返回的 code 为准），以及回到登录态；对应后端 agentruntime 的 auth 域，通信流 SSE 的失效事件对应后端 communication 域 | domains/runtime-auth.md |
