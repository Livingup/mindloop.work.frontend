# 技术总览

## 架构基线
- 代码按 src/features/<m> 和 src/shared/ 组织。
- 请求统一走 shared/api/httpClient.requestJson，DTO 类型写在 features/chat/api/agentRuntimeApi.ts。
- 服务端状态用 TanStack Query（shared/api/queryClient），客户端状态用 zustand。
- 认证门禁是 shared/runtime/RuntimeAuthGate，mode!=="ready" 时不渲染子树。
- Token 存在 localStorage，由 shared/api/runtimeAccess 读写。
- 错误以 HttpError(message,status,body) 往上抛。
- 测试用 scripts/*.test.mjs（node --test 加 vite ssrLoadModule）。
