# 后端 API 验收证据

## 自动化门槛

| 门槛 | 命令 | 结果 |
|---|---|---|
| 领域单元测试 | `pnpm test:unit` | 4 个文件、14 个测试通过 |
| Repository / Application / Runtime 集成测试 | `pnpm test:integration` | 5 个文件、20 个测试通过；使用隔离的 `thread-chat-test` PostgreSQL |
| API 合同与集成测试 | `pnpm test:api` | 5 个文件、32 个测试通过；使用 Fake AI Runtime，不请求真实模型 |
| TypeScript | `pnpm typecheck` | 通过 |
| 生产构建 | `pnpm build --webpack` | Next.js 16.3.1 官方 webpack 构建通过；编译、类型检查、静态生成和全部 `/api/v1` Route 收集完成 |
| OpenSpec | `pnpm openspec:validate` | 27 项严格校验通过 |

默认 Turbopack 构建已执行到 PostCSS 处理阶段，但当前受管执行环境禁止其内部进程绑定端口并触发 Turbopack panic。使用 Next.js 16.3.1 官方 `--webpack` 回退后生产构建完整通过，未修改项目默认构建器。

## 覆盖映射

| API 能力 | 自动化证据 |
|---|---|
| 严格 Zod DTO、实体归属、非法 user part、Artifact tool output 仅含 `artifactId` | `tests/api/contracts.test.ts` |
| JSON Transport 请求编码、严格响应、ClientError 与 SSE frame 解析 | `tests/api/transport.test.ts` |
| Session、owner scope、Project cursor、空 Query、窗口边界、metadata、archive、delete、feedback | `tests/api/handlers.test.ts` |
| create、send、Fork、Edit、Regenerate、Stop 的关联响应、严格输入、资格失败与无半成品回滚 | `tests/api/handlers.test.ts` |
| 公开领域错误、Route fallback、Zod details 与未知异常隐藏 | `tests/api/errors.test.ts` |
| snapshot、cursor、重复连接、取消订阅、completed、failed、stopped 与断线重连 | `tests/api/sse.test.ts` |
| Artifact 正文只由按 ID Query 返回，Bootstrap、MessageBundle 与 SSE 只携带引用或摘要 | `tests/api/handlers.test.ts`、`tests/api/sse.test.ts` |

API 自动化测试不会唤醒真实后台模型执行，也不会请求真实模型供应商。
