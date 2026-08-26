# Gate 1 出场证据：规范化数据库与应用命令

日期：2026-08-26

## 数据库演练

- 独立测试 database：`thread-chat-normalized-test`
- 初始化：`pnpm db:test:setup`
- 真正空库重置：`pnpm db:test:reset`（同时清理 `thread_chat` 与测试库内的 `drizzle` migration 账本）
- 完整 migration up：`pnpm db:test:migrate`
- 增量 migration：`drizzle/0004_normalized_thread_chat_conversations.sql`
- 结果：完整 migration 链从空 database 成功执行。

## Schema 快照

规范化业务表：

- `projects`：owner、双轨标题、归档状态、原子 `next_footnote`
- `threads`：父子拓扑、冻结 `fork_context`、完整 TextAnchor、脚注、原子 `next_sequence`、双轨标题
- `messages`：完整 AI SDK v7 `parts[]`、单调 sequence、生成状态、soft-supersede、Stop/反馈、原始 provider usage
- `artifacts`：Project 归属与不可变 source Message 溯源；不保存 `thread_id`
- `conversation_commands`：`(user_id,id)` 主键、规范化请求哈希和权威结果收据

重要约束：

- 每个 Project 仅一个根 Thread；Project 内非空脚注唯一。
- Thread 内 sequence 唯一；同一旧 Message 至多有一个 replacement。
- user Message 只能是 `completed`；assistant Message 才能是 `generating`。
- generating/terminal 与 `finished_at` 形状受数据库 check 约束。
- 普通 FK 保证引用对象存在；同 Project/Thread 归属由 owner-scoped 事务锁校验。
- `attachments.user_id` 为非空 FK；附件创建、读取、删除、解析、洞察和模型上下文均按当前用户过滤。
- 旧 billing/payment schema 未修改；新 application/persistence 模块没有计费依赖。

## 自动化验证

- `pnpm test:thread-chat:gate1-db`：通过
  - owner isolation 与统一不可见语义
  - 跨 Project 来源伪造拒绝
  - sequence/footnote 并发原子分配
  - start/send/fork 幂等 replay 与 command 异义冲突
  - Retry 竞态、Edit 原子 supersede、Stop/反馈、删除竞态
  - 双轨标题一次尝试 CAS 与 frozen context 编译
  - text/reasoning/source/file/tool/data parts JSONB 等价往返
  - transient data parts 不落库
- `pnpm typecheck`：通过
- `pnpm lint`：0 errors；仅剩 3 个既有、与本 Gate 无关的 warnings
- Gate 0 领域与框架契约测试：通过
- `node scripts/check-thread-chat-v1-boundaries.mjs`：通过
- `pnpm openspec:validate`：26 passed，0 failed
- `git diff --check`：通过

## UX 与切换边界

Gate 1 没有接线 `/thread-chat` 前端，也没有修改 CSS、DOM 或可见交互。旧整树表仍保留；没有 rename、drop、双写或生产流量切换。
