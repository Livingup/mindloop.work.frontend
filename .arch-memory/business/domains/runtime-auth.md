# runtime-auth

## 需求约束
- RUNTIME-AUTH-01 收到 Runtime 会话失效信号后，前端必须清除本地 Runtime Token 并回到登录态，登录态下不得再发起需要鉴权的轮询、心跳或重连（依据 agentruntime:AUTH-04、agentruntime:COMMUNICATION-01）。
- RUNTIME-AUTH-02 会话失效、退出登录、重新登录只释放 scene presence（detach），不得停止 Agent 任务。
