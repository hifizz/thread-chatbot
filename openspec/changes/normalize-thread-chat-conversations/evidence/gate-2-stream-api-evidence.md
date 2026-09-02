# Gate 2 出场证据：独立 Stream Session、AI SDK v7 与 v1 API

日期：2026-08-26

Route Handler + PostgreSQL 补充验证：2026-08-27

## 运行边界

- `SessionStore` 使用 `globalThis` Symbol 单例，先登记 Session 再以已 catch 的 Promise 启动任务。
- 模型任务只接收 Session 自己的 `AbortController.signal`；SSE 取消只注销 subscriber。
- 新链路不依赖 Route Handler `after()`，不读取 `request.signal`，不使用 `result.textStream`。
- 进程启动初始化会把遗留 `generating` 行条件更新为 `failed/PROCESS_RESTARTED`，保留已有 checkpoint parts。
- 当前实现仍严格依赖 proposal 已确认的单 VPS、单 Next.js Node 进程部署约束。

## AI SDK v7 与持久化

- 使用安装版独立 `toUIMessageStream({ stream: result.stream })` 和 `readUIMessageStream`。
- Session 广播前先更新完整 UI Message snapshot，再增加 event sequence。
- 完整保留 text、reasoning、source、file、tool 与 typed data parts；Artifact progress 为 transient，不写入 DB。
- generating checkpoint 使用 `status='generating'` CAS、850ms 节流、无变化跳过和 finalize 前强制 flush。
- 唯一 finalize 以 CAS 决定 completed/stopped/failed，在同一事务写 Message、Markdown Artifact 和 provider raw usage。
- Stop 只记录请求并 abort Session；无 Session 的 generating 行收敛为 failed/SESSION_LOST。

## v1 API

- 新增 `/api/thread-chat/v1` 下 Project、Thread、Message、Artifact 查询与全部命令 Route Handlers。
- 所有动态参数使用 `await context.params`；JSON 响应 no-store，SSE 设置 no-cache/no-transform/X-Accel-Buffering。
- command replay 只返回原收据；只有 `replayed:false` 的生成命令尝试启动 Session。
- owner 不匹配与不存在资源均不泄露 DB row 或 error stack；strict Zod body 拒绝未知字段。

## 自动化验证

- `pnpm db:test:reset && pnpm db:test:migrate`：通过；从空 `thread_chat` schema 和空 migration 账本重建专用测试库后再运行以下数据库测试。
- `pnpm test:thread-chat:gate2-session`：通过
  - 重复 start、同步 snapshot 订阅、chunk/订阅竞态、两个订阅者、零订阅继续运行、迟到终态、TTL cleanup、SSE 终态关闭、checkpoint 节流。
- `pnpm test:thread-chat:gate2-pipeline`：通过
  - text/reasoning/source/file/tool input delta/output/data、Artifact-only、partial error、abort、空回复。
- `pnpm test:thread-chat:gate2-api`：通过
  - strict JSON、no-cache、401/404/409、command envelope、error stack 隔离、13 个 Route Handlers、Next.js 16 params 与禁用 request.signal/after/textStream。
- `pnpm test:thread-chat:gate2-api-db`：专用 `thread-chat-normalized-test` PostgreSQL 通过
  - 使用真实 Better Auth 签名 session cookie，直接调用实际 v1 Route Handler exports；请求完整经过 auth、handler、application、repository 与数据库事务。
  - 模型执行位置使用可控 fake generation，未 mock API、会话业务或 PostgreSQL；覆盖首发与重放、strict body 零写入、bootstrap/Message poll、终态及活跃 SSE、断流不 abort、Stop、Retry、Edit、Fork、Artifact 原子落库和 owner 404、反馈、Project/Thread 标题、列表及级联删除。
  - 该脚本是 Route Handler 数据库集成测试，不启动监听端口；部署后经真实网络栈的 HTTP smoke 保留在 Gate 5。
- `pnpm test:thread-chat:gate2-db`：专用 `thread-chat-normalized-test` PostgreSQL 通过
  - 单 Message 单 pipeline、checkpoint、重启 sweep、Session 丢失 Stop、终态 CAS、空回复、部分错误、Artifact/usage 原子落库、owner isolation、SSE 不可用后 Message poll。
- `pnpm test:thread-chat:gate1-db`：Gate 1 PostgreSQL 回归通过。
- `pnpm typecheck`：通过。
- `pnpm lint`：0 errors；仅 3 个既有、与本 Gate 无关的 warnings。
- `node scripts/check-thread-chat-v1-boundaries.mjs`：通过；无 billing/payments/usage-store/旧 generation import。
- `pnpm openspec:validate`：26 passed，0 failed。

## UX/UI

Gate 2 仅新增未接线的 v1 后端、流协议和测试，没有修改 `/thread-chat` 组件、DOM、CSS 或任何现有可见交互。
