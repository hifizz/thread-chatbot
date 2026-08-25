## 0. 阶段 0：冻结实施边界

- [x] 0.1 对本 change 与 `design-thread-chat-client-api` 执行严格校验，确认 Project、Thread、Message、MessageRun、BaseContext、replacement 与 Artifact 术语一致。
- [x] 0.2 固定职责分界：本 change 只交付数据库、领域、Repository、Application 与 MessageRun 后台执行；API、客户端、UI 和 E2E 由 `design-thread-chat-client-api` 承担。
- [x] 0.3 固定本地数据库策略：不迁移现有 `branch_trees` 数据，不建立 treeId 映射或双写；使用独立测试数据库验证后，通过 `pnpm db:push` 重建本地目标 Schema。
- [x] 0.4 固定测试策略：Vitest 负责单元、Repository 和 Application 集成测试；真实 PostgreSQL 不 mock；AI Runtime、邮件和外部存储在自动测试中使用可控 adapter。
- [x] 0.5 固定阶段门与归档顺序：后端领域通过后才能实现 API，后端/API 全部通过后才能接入前端，E2E 通过后先归档本 change，再归档客户端/API change。

## 1. 建立后端测试基础设施

- [ ] 1.1 增加 Vitest 及 `test`、`test:unit`、`test:integration`、`test:api`、`test:watch` 脚本；默认命令不得调用真实模型供应商。
- [ ] 1.2 建立物理隔离的 PostgreSQL 测试数据库配置，例如 `thread-chat-test`，并让测试专用 Drizzle 配置只读取 `TEST_DATABASE_URL`。
- [ ] 1.3 在测试初始化中校验数据库名称或明确 allowlist；目标不是测试数据库时立即终止，禁止误删开发数据库。
- [ ] 1.4 建立测试 Schema 重建流程：只删除测试库的 `thread_chat` schema，再执行测试配置对应的 `drizzle-kit push`。
- [ ] 1.5 建立用户、Project、Thread、Message、Artifact 与 MessageRun fixture factory；测试 ID 仍由服务端/fixture factory 生成，不进入生产客户端逻辑。
- [ ] 1.6 定义可注入的 AI Runtime capability 与 Fake AI Runtime，支持固定 delta、completed、failed、stopped、Markdown Artifact tool output 和恢复事件。
- [ ] 1.7 约束测试并行：纯单元测试可以并行；共享 PostgreSQL 的集成/API 测试在证明数据隔离前使用单 worker 或独立事务边界。

## 2. 建立规范化数据库 Schema

- [ ] 2.1 在 `lib/db/schema.ts` 中新增 `projects`、`threads`、`messages`、`message_runs`、`artifacts` 与 Message feedback 表；Project Memory/File 只保留后续扩展边界，不实现完整协议。
- [ ] 2.2 为 Project owner、唯一 Root Thread、Thread 内唯一 sequence、同 Message 单一 replacement 和 assistant Message 单一 MessageRun 建立数据库可表达的约束与索引。
- [ ] 2.3 为 Root/Branch ForkFacts 的空值组合、Message role、MessageRun status 和非负 eventSequence 建立数据库可表达的约束。
- [ ] 2.4 明确无法由普通 CHECK 表达的同 Project Parent/source/replacement 关系，交给事务内 Repository 校验，不伪造不可靠约束。
- [ ] 2.5 为 Project 永久删除定义级联边界；普通 Message Repository 和 Route 不得暴露单 Message hard delete。
- [ ] 2.6 对隔离测试数据库执行 `pnpm db:push` 等价的测试配置命令，并验证从空库可以一次建立完整目标 Schema。

## 3. 实现纯领域模型与 Repository

- [ ] 3.1 按 design 的模块骨架建立不依赖 React、HTTP、Drizzle 或具体 AI Runtime 的 Project、Thread、Message、MessageRun、BaseContext 与 Artifact 领域类型。
- [ ] 3.2 实现 Root/Branch 关系判定、唯一 Root、同 Project Parent/source、无环拓扑与 ForkFacts 完整性验证。
- [ ] 3.3 实现 Thread 内服务端 sequence 分配，并用数据库唯一约束与并发测试保证无重复 sequence。
- [ ] 3.4 实现 finalized Message 不可变与 replacement 规则；Repository 的更新入口必须明确禁止原地覆盖 finalized parts 和 sequence。
- [ ] 3.5 实现 BaseContextV1 的验证、持久化和有序 Message ID 解析；BaseContext 只能由服务端计算。
- [ ] 3.6 实现 MessageRun 的 queued/running/completed/failed/stopped 条件状态转换、checkpointParts、eventSequence 与 Stop 请求持久化。
- [ ] 3.7 实现 Project、Thread、Message、MessageRun、Artifact 与 feedback Repository；所有 Query 从 actor 校验 Project owner scope。
- [ ] 3.8 实现 Artifact 独立持久化及 `sourceMessageId` provenance；Message 的 AI SDK v7 tool output 只保存 `artifactId`，不复制 Markdown 正文。

## 4. 实现核心 Application Command 与 Query

- [ ] 4.1 原子创建 `Project + Root Thread + U1 + A1 + queued MessageRun`，所有新实体 ID 由服务端生成，提交前不启动 AI Runtime。
- [ ] 4.2 原子追加 `user Message + assistant Message + queued MessageRun`，不把 user/assistant 角色交替建成数据库不变量。
- [ ] 4.3 实现 Fork Thread：验证 finalized source、冻结 ForkSourceSnapshot 和 BaseContext、创建 Child Thread，任一步失败整体回滚。
- [ ] 4.4 实现 Regenerate：保留旧 assistant Message 内容和 sequence，标记 superseded，追加 replacement assistant Message 与新 MessageRun。
- [ ] 4.5 实现 Edit last user Message：追加 replacement user Message，将依赖旧输入的有效后缀 supersede，并创建新 assistant Message 与 MessageRun。
- [ ] 4.6 实现 Project metadata、Branch metadata、archive/unarchive、feedback 与 Project 永久删除 Application Command。
- [ ] 4.7 实现 Project 列表、ProjectBootstrap、Thread Message 和 Artifact-by-ID Query；Bootstrap 只返回轻量 topology 与 Root bundle，Thread 默认最多 200 条有效 Message。
- [ ] 4.8 实现 Prompt History：`BaseContext.messageIds + 当前 Thread 有效 Prompt Message`，排除不合格 assistant 状态，且不依赖客户端已加载窗口。

## 5. 实现 MessageRun 后台执行

- [ ] 5.1 将 `message_runs.status=queued` 作为持久化待执行事实；事务提交后才尝试唤醒执行器，不建立通用任务平台。
- [ ] 5.2 实现条件领取 queued Run、heartbeat、checkpoint/eventSequence 持久化和 completed/failed/stopped 原子终态提交，防止同一 Run 重复执行。
- [ ] 5.3 实现最小 queued scanner，补偿事务已提交但即时唤醒失败的 Run；不得创建第二条 assistant Message 或 MessageRun。
- [ ] 5.4 接入真实 AI Runtime adapter，并确保领域/Application 只依赖 capability；自动测试使用 Fake AI Runtime，不发起真实计费请求。
- [ ] 5.5 完成 Markdown Artifact 工具结果投影：创建独立 Artifact，最终 Message tool output 保存稳定 `artifactId`。
- [ ] 5.6 实现显式 Stop；浏览器刷新、断开连接或客户端 Runtime 销毁不得调用 Stop，也不得终止后台执行。

## 6. 后端领域验收门

- [ ] 6.1 完成领域单元测试：Root/Branch、拓扑无环、sequence、replacement、Fork 资格、BaseContext、Prompt History 与 MessageRun 状态机。
- [ ] 6.2 完成 Repository 集成测试：真实 PostgreSQL owner scope、唯一 Root、并发 sequence、finalized 不可变、replacement、Artifact provenance 与单一 MessageRun。
- [ ] 6.3 完成 Application 集成测试：create/send/Fork/Edit/Regenerate/Stop/delete 的事务提交与整体回滚。
- [ ] 6.4 使用 Fake AI Runtime 测试 delta、完成、失败、Stop、queued scanner 补偿、刷新时 checkpoint 恢复与 Artifact tool output。
- [ ] 6.5 执行 `pnpm typecheck`、后端 unit/integration tests 和 `pnpm openspec:validate`，全部通过后记录实现证据；未通过不得进入 API Route 实现。

## 7. E2E 通过后的旧后端退役

- [ ] 7.1 等待 `design-thread-chat-client-api` 完成 API、前端接入与 Ego Browser E2E；在此前保留旧实现代码，但不建立新旧数据双写。
- [ ] 7.2 E2E 通过后删除旧 `branch_trees.state`、`branch_generations`、消息图 active leaf 与旧整体保存的后端权威职责。
- [ ] 7.3 从 Drizzle Schema 删除不再使用的旧表/列，并对本地与隔离测试数据库执行 `pnpm db:push`；无需迁移或保留旧数据。
- [ ] 7.4 再次执行后端、API、前端集成、build、E2E 与 OpenSpec 严格校验，确认代码中不存在旧写入路径。
- [ ] 7.5 对照 domain spec 的 Requirement/Scenario 记录自动测试或手动验收证据。
- [ ] 7.6 在全部门槛满足后先归档 `define-thread-chat-domain-model`，将增量 domain spec 合入正式 `openspec/specs/domain/spec.md`。

## 8. 归档后提炼永久领域架构

- [ ] 8.1 从已归档 design 提炼稳定目标架构到 `openspec/specs/domain/architecture.md`，只保留实体、关系、ER 图、不变量、最终 DB Schema 与模块边界。
- [ ] 8.2 在正式 `openspec/specs/domain/spec.md` 中链接 `architecture.md`，明确冲突时可验证 Requirement 优先。
- [ ] 8.3 校验永久架构文档与正式 spec、实际 Drizzle Schema 和模块结构一致，并把后续同步更新列为验收项。
