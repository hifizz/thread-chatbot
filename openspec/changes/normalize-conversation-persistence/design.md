## Context

本变更依赖 `define-conversation-domain-model`。当前 `branch_trees.state` 是唯一事实源，`branch_generations`、反馈和 Artifact 只能引用 JSON 内部 ID。本阶段只建立规范结构、仓储和审计能力；在最终切换前不改变线上权威来源。

## Goals / Non-Goals

**目标：**

- 让 Conversation 核心实体拥有可外键约束的服务端身份。
- 用数据库约束和事务保护根 Thread、唯一 Fork、Turn/Message 归属与有效变体。
- 提供稳定的规范快照和可重复遗留审计。
- 为 Generation 迁移提供真实 Thread/Turn/Message 外键目标。

**非目标：**

- 迁移 Generation 状态、计费和流式终结。
- 开放新的写命令接口或迁移客户端 Store。
- 在本阶段启用生产双写或正式删除 `branch_trees`。
- 实现 Project Memory、File、Instruction 的业务表。

## Decisions

### D1. 物理表按 Conversation 领域命名

首批表为：

```text
workspaces
workspace_members
projects
conversations
conversation_threads
thread_forks
conversation_turns
conversation_messages
```

使用 `conversation_*` 前缀避免与其他聊天运行时的线性表混淆。Workspace/Project 只实现最小身份和成员归属；资产能力后续扩展。

### D2. 使用复合键保护归属

除普通主键外，表提供必要的复合唯一键：

```text
conversation_threads:  unique(id, conversation_id)
conversation_turns:    unique(id, thread_id)
conversation_messages: unique(id, thread_id, turn_id)
```

ThreadFork 的 parent/child 与 Conversation 使用复合外键；来源 Message 同时携带 parent Thread 约束。Turn 的 active Message 使用可延迟复合外键，并在事务终点验证角色。仅检查单个 ID 不足以阻止跨 Thread 串线。

### D3. 根引用和 Fork 完整性使用延迟约束

Conversation 与根 Thread、Turn 与 active Message 都存在创建顺序环。迁移使用 PostgreSQL 可延迟约束或等价约束触发器，使一个事务可以先创建双方，再在提交时验证：

- `rootThreadId` 属于当前 Conversation；
- 根 Thread 没有入向 Fork；
- 每个非根 Thread 恰有一条入向 Fork；
- Fork 图无环；
- active user/assistant Message 属于当前 Turn 且角色匹配。

仓储仍执行早期领域校验，以返回可理解错误；数据库约束是最终防线。

### D4. Message 内容保持结构化 JSON 值

Message 行规范化身份、归属、角色、状态和顺序，但 `content` 继续保存有版本的结构化片段 JSON。工具片段、研究计划和 Markdown 内容没有独立权限时不拆表。File/Artifact 的独立生命周期由后续 Project 资产变更处理。

### D5. 快照只读，写入通过仓储端口

`ConversationSnapshot` 按稳定顺序组装实体和派生索引，用于测试和后续首次加载。仓储端口按实体/聚合操作，不提供 `saveConversationSnapshot`。这样后续命令接口无法重新引入整树覆盖。

### D6. 先审计，再决定重置或导入

审计器先对真实数据运行只读报告，输出：

- 总记录数和所有者分布；
- 可直接映射的 Conversation/Thread/Turn/Message/Fork 数量；
- 魔法根 ID、重复 Message、错误 Fork、跨 Thread active leaf；
- `branch_generations`、反馈和 Artifact 的悬空引用；
- 每棵树的确定性映射摘要和错误代码。

根据报告在最终切换变更中选择开发数据重置或一次性导入。本变更不猜测该决定。

### D7. 新路径默认关闭

规范仓储通过显式服务端配置启用，默认不接受生产写入。测试可以在隔离数据库中直接使用；线上仅允许审计。禁止添加自动双写适配器，因为它会在命令 API 出现前建立两个权威来源。

## Risks / Trade-offs

- **[风险] 延迟约束和触发器增加迁移复杂度。** → 同时提供仓储级早期校验、数据库集成验证和清晰约束命名。
- **[风险] Workspace/Project 扩大首批表。** → 只实现身份与成员归属，避免以后再次迁移 Conversation 所有权。
- **[风险] 新表落地但暂不承载流量。** → 通过隔离集成验证和审计证明结构，下一 change 才迁移执行路径。
- **[风险] JSON 内容仍可能包含无效工具片段。** → 内容使用版本化解析器；关系归属不再依赖片段内部 ID。

## Migration Plan

1. 增加表、复合键、索引、延迟约束和仓储端口。
2. 在隔离数据库执行最小与非法关系验证。
3. 实现确定性 `ConversationSnapshot` 读取。
4. 实现只读遗留审计并对目标环境生成报告。
5. 保持规范生产写入关闭，把报告交给下一迁移 change。

回滚只需删除尚未启用写入的新表和代码；不得修改 `branch_trees` 原数据。
