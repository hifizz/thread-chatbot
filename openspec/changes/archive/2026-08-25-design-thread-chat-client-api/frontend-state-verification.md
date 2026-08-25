# 前端状态架构验收证据

## 自动化门槛

| 门槛 | 命令 | 结果 |
|---|---|---|
| 客户端 Store / Runtime / Hook 测试 | `pnpm test:client` | 3 个文件、13 个测试通过；使用 jsdom、Testing Library 与 user-event |
| 全量自动化测试 | `pnpm test` | 领域单元 14、客户端 13、PostgreSQL 集成 20、API 32，共 79 个测试通过 |
| TypeScript | `pnpm typecheck` | 通过 |
| 客户端静态检查 | `pnpm exec eslint lib/thread-chat/client tests/client vitest.client.config.ts` | 通过 |
| OpenSpec | `pnpm openspec:validate` | 27 项严格校验通过 |

## 覆盖映射

| 客户端能力 | 自动化证据 |
|---|---|
| App Store、Project Store、normalizer、sequence、replacement、乱序 Artifact Summary、稳定 Slot、宽度、折叠与 Snapshot 过滤 | `tests/client/store.test.ts` |
| ThreadMessageLoader 同 ID 去重、跨 Thread 并行、Runtime Abort；ArtifactLoader 按 ID 缓存与 Project 隔离 | `tests/client/runtime.test.ts` |
| GenerationCoordinator 连接去重、checkpoint 合帧、terminal、断线重连、取消订阅不触发 Stop | `tests/client/runtime.test.ts` |
| Application Command 请求边界、服务端 ID 合并与订阅启动；ProjectRuntimeRegistry seed handoff 与 lease | `tests/client/runtime.test.ts` |
| Provider-scoped Runtime、React Strict Mode 生命周期、Selector/Command Hook 与 `/new` 先 seed 后导航 | `tests/client/providers.test.tsx` |

客户端测试通过注入的 `ThreadChatApiCapabilities` adapter 运行，不接现有 UI，不请求真实后端或模型。
