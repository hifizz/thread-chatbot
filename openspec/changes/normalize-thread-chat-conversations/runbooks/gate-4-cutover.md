# Gate 4 一次性 cutover 与 rollback runbook

## 范围与不变量

- 仅操作 ThreadChat 旧三张表：`branch_trees`、`branch_generations`、`branch_message_feedback`。
- 不迁移旧会话到 `projects/threads/messages/artifacts`，不双写、不建兼容 view、不 fallback。
- billing/payment/Better Auth/附件/RAG/线性 assistant-ui 表均不改名、不删除。
- 正式执行前必须停写；应用与 migration 不允许并发跨版本运行。

## 上线前备份验证

1. 记录目标数据库 host/database/schema、应用 commit 和 UTC 时间；确认不是本地测试库。
2. 以 PostgreSQL 自带工具创建可恢复备份，文件名包含数据库名、UTC 时间和 Gate 4 commit：

   ```bash
   pg_dump --format=custom --no-owner --no-acl --file=thread-chat-pre-gate4.dump "$DATABASE_URL"
   ```

3. 对备份执行目录读取验证：

   ```bash
   pg_restore --list thread-chat-pre-gate4.dump
   ```

4. 在隔离的临时 database 做一次真实 restore，并查询旧三表行数；仅“命令退出 0”不算验证完成。
5. 记录切换前旧三表行数、规范化五表行数和 migration journal；正式 cutover 要求规范化业务表为空。

## 维护窗口

1. 在反向代理/Coolify 停止应用写入并确认没有旧 Next.js 进程、PM2 worker 或第二副本。
2. 查询 `pg_stat_activity`，确认没有旧应用事务仍在目标 database 执行。
3. 再次记录旧三表行数；与备份时不一致则重新备份并更新记录。
4. 应用 Gate 4 migration。migration 只 rename 旧表/约束/索引为明确 legacy 名称，不 drop 数据。
5. 验证：
   - `legacy_branch_trees_backup`、`legacy_branch_generations_backup`、`legacy_branch_message_feedback_backup` 存在且行数与切换前一致；
   - `branch_trees`、`branch_generations`、`branch_message_feedback` 不存在；
   - `projects/threads/messages/artifacts/conversation_commands` 存在且为空；
   - Better Auth、attachments、RAG、billing/payment 表仍存在且行数未变。

## 应用切换与 smoke

1. 部署与 migration 同 commit 的应用，且固定一个 Next.js Node 进程/副本。
2. 执行认证 smoke：未登录跳转、真实 session、owner 404。
3. 打开合法新 Project UUID：应显示空工作台，不读取 legacy 表。
4. 首发一条消息，验证只新增 Project、MainThread、user Message、assistant Message 和 command receipt。
5. 验证 Project list、bootstrap、SSE、Message poll、Artifact read、command replay、feedback/title/archive/delete。
6. 用数据库日志/spy 确认 legacy backup 三表零读写，billing/credits/cost 函数零调用。

## 运维级 rollback

rollback 只恢复“旧应用 + 旧 schema”，不转换 Gate 4 后产生的新会话：

1. 立即停止新应用写入并保存故障现场；记录新规范化表行数。
2. 优先恢复上线前完整数据库备份到新的隔离 database，验证后把旧应用指向该恢复库；这是最安全路径。
3. 若经负责人确认只做原库 SQL 回退：确保旧表名目前不存在，再在单事务中把三张 legacy backup 表 rename 回原名，并恢复被 rename 的约束/索引名称；随后部署与该 schema 匹配的旧应用。
4. 不把 `projects/threads/messages/artifacts` 自动转成整树 JSON；rollback 后 Gate 4 窗口产生的新会话不可见是已接受限制。
5. rollback 后重跑旧应用认证/列表/读取/发送 smoke，并保留新规范化表供事故分析，不擅自删除。

## 放行记录

实际 VPS 执行属于 Gate 5。Gate 4 只在专用测试 PostgreSQL 用带旧历史种子的隔离 schema 演练本 runbook；任何生产命令都必须由用户在维护窗口明确授权。
