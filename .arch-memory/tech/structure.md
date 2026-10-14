# 项目结构地图

## 域映射
```text
src/shared/runtime/**                               [runtime-auth]
src/shared/api/runtimeAccess.ts                      [runtime-auth]
src/shared/api/runtimeAuthInvalidation.ts             [runtime-auth]
src/shared/api/httpClient.ts                         [公共]
src/shared/api/httpError.ts                          [公共]
src/shared/api/sseClient.ts                          [公共]
src/shared/api/queryClient.ts                        [公共]
src/features/chat/api/agentRuntimeApi.ts              [公共]
scripts/runtime-auth-invalidation.test.mjs            [runtime-auth]
package.json                                        [公共]
```

## 节点标注
```text
src/shared/runtime/RuntimeAuthGate.tsx                RUNTIME-AUTH-01
src/features/chat/api/agentRuntimeApi.ts              [runtime-auth·心跳与通信流失效信号适配]
```
