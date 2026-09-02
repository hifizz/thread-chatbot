# Agent 可观测性实施基线

记录日期：2026-08-28。该记录用于 `add-agent-observability-and-evaluation` 的实施与回归对比，不代表长期版本承诺。

## 官方与项目内依据

- AI SDK `7.0.83` 项目内迁移文档确认 Node.js 最低版本为 22，生产优先 Node.js 24 或 26；遥测选项已从 `experimental_telemetry` 稳定为 `telemetry`。
- AI SDK 项目内 telemetry 文档确认使用 `registerTelemetry`，OpenTelemetry integration 来自 `@ai-sdk/otel`，注册 integration 后模型调用默认产生遥测。
- AI SDK DevTools `1.0.13` 通过 `DevToolsTelemetry()` 注册，viewer 命令为 `devtools`，数据写入 `.devtools/generations.json`，只能用于本地开发。
- Langfuse 官方 AI SDK 7 integration 使用 `@langfuse/vercel-ai-sdk`、`@langfuse/otel`、`@langfuse/tracing`、`@langfuse/client` 与 `@opentelemetry/sdk-node`。
- Next.js `16.3.1` 项目内文档要求根级 `instrumentation.ts` 导出 `register()`，并通过 `NEXT_RUNTIME === "nodejs"` 动态加载 Node.js 专用代码。
- Coolify 当前使用 `nixpacks.toml`；已固定的 nixpkgs archive 对应 Nixpacks Node.js 24 映射，`package.json` engines 与 `.nvmrc` 同步约束运行时。

## 固定依赖

| 依赖 | 实施版本 |
|---|---:|
| `ai` | `7.0.83` |
| `@ai-sdk/otel` | `1.0.83` |
| `@ai-sdk/devtools` | `1.0.13` |
| `@langfuse/client` | `5.11.0` |
| `@langfuse/vercel-ai-sdk` | `5.11.0` |
| `@langfuse/tracing` | `5.11.0` |
| `@langfuse/otel` | `5.11.0` |
| `@opentelemetry/api` | `1.9.1` |
| `@opentelemetry/sdk-node` | `0.221.0` |

这些包均作为直接依赖声明；DevTools 是纯开发依赖，其余是服务端运行时依赖。

## 实施前结果

本机基线：Node.js `22.23.1`，pnpm `10.32.1`。仓库、CI 和 VPS 目标运行时为 Node.js 24，规范仍允许 Node.js 22 以上。

| 检查 | 结果 |
|---|---|
| `pnpm typecheck` | 通过 |
| `pnpm test:thread-chat:gate2-session` | 通过 |
| `pnpm test:thread-chat:gate2-pipeline` | 通过 |
| `pnpm test:thread-chat:gate2-api` | 通过；存在既有 Better Auth base URL 警告 |
| `pnpm test:thread-chat:gate3-client` | 通过 |
| `pnpm openspec:validate` | 27 项通过、0 项失败 |
| `pnpm build` | 代码编译前因受限网络无法下载 Google Fonts 而失败；错误只涉及 Inter/Geist Mono 下载 |

带 `-db` 的 Gate 需要 `THREAD_CHAT_TEST_DATABASE_URL` 指向专用 PostgreSQL。本工作树没有 `.env.local`，因此基线阶段未执行数据库 Gate，后续完整验收必须在专用测试数据库中执行，禁止连接生产数据库。

## 运行时与依赖变更后复查

- `pnpm typecheck`、Gate 2 Session、Gate 2 UI Message pipeline、Gate 2 API、Gate 3 Client 和全部 OpenSpec strict 校验再次通过。
- 在允许外网后，`pnpm build` 已越过 Google Fonts 下载，但当前执行环境禁止 Turbopack/PostCSS 子进程绑定内部端口，因 `Operation not permitted` 退出。该失败发生在 `@xyflow/react/dist/style.css` 的构建基础设施阶段，不是 TypeScript 或本 change 代码错误；在普通 CI/VPS 环境仍需再次执行正式构建。
