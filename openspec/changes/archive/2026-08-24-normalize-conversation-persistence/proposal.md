## Why

`define-conversation-domain-model` 已确定 Project、Conversation、Thread、ThreadFork、Turn 与 Message 的身份和归属，但当前数据库仍把整棵 `ThreadTreeState` 存在单个 JSONB 行中，无法用外键拒绝跨 Thread 串线、重复 Fork 来源或错误 active variant。必须先建立规范写模型和可审计迁移入口，后续 Generation、命令接口与客户端才能依赖稳定实体。

## What Changes

- 新增 Workspace/Project、Conversation、Thread、ThreadFork、Turn、Message 的规范化关系表、稳定 ID、复合外键、唯一约束和必要的延迟约束检查。
- Conversation 独占聚合标题与 `rootThreadId`；根 Thread 不再使用 `id = "main"`，非根 Thread 的来源只由 ThreadFork 表达。
- Turn 显式保存当前有效用户/助手 Message，Message 内容继续使用带版本的结构化 JSON 值，避免过度拆分工具片段。
- 新增仓储端口与只读 `ConversationSnapshot` 组装器；快照可供首次加载，但不得作为整包写入数据。
- 新增对 `branch_trees.state` 的只读审计和导入计划，输出逐实体映射、拒绝原因和可重复运行报告；本变更不启用双写，也不切换生产权威来源。
- 为下一步 `migrate-generation-lifecycle` 暴露真实 Thread/Turn/Message 身份，但不在本变更迁移 Generation 状态机、计费或流式终结逻辑。

## Capabilities

### New Capabilities

- `conversation-persistence`：定义 Conversation 核心实体的关系型持久化、不变量、规范快照和遗留数据审计行为。

### Modified Capabilities

- 无。本变更依赖 `define-conversation-domain-model` 的 `domain` 增量规范，不再次复制术语要求。

## Impact

- 数据库：`lib/db/schema.ts`、Drizzle 迁移、约束、索引以及本地重置/迁移脚本。
- 领域与仓储：`lib/thread-chat/domain/`、新的 Conversation 仓储端口和持久化适配器。
- 读取路径：新增规范 `ConversationSnapshot`；现有 `branch_trees` 读取在切换前保持权威。
- 部署：只落表和禁用状态的代码不会改变当前用户行为；正式导入与切换由后续 change 执行。
- 前置依赖：`define-conversation-domain-model`。
- 后续依赖：`migrate-generation-lifecycle`、`add-conversation-command-api`。
