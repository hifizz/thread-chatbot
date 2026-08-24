## Purpose

为 Project、Conversation、Thread、ThreadFork、Turn 与 Message 建立可由数据库和事务强制保护的规范持久化契约，并提供只读快照、遗留数据审计及安全迁移边界。

## Requirements

### Requirement: 持久化稳定的 Conversation 核心实体

系统 SHALL 为 Workspace、Project、Conversation、Thread、Turn 与 Message 分配稳定且无业务含义的服务端 ID，并将每个实体保存为可独立寻址的关系型记录。实体归属创建后不得通过更新外键改变；任何跨所有者、跨 Project 或跨 Conversation 引用 MUST 被拒绝。

#### Scenario: 创建根 Conversation

- **WHEN** 系统在 Project 中创建一条 Conversation
- **THEN** Conversation 与根 Thread 获得独立稳定 ID，且 `rootThreadId` 只能指向属于该 Conversation 的 Thread

#### Scenario: 拒绝移动既有 Thread

- **WHEN** 写入尝试把既有 Thread 的 `conversationId` 改为另一条 Conversation
- **THEN** 系统拒绝写入并保持原归属不变

### Requirement: 使用唯一 ThreadFork 保存分叉来源

系统 SHALL 只通过 ThreadFork 保存上游 Thread、来源 Message 与下游 Thread 的 Fork 事实。来源 Message MUST 属于上游 Thread，三者 MUST 属于同一 Conversation；根 Thread 不得有入向 ThreadFork，非根 Thread MUST 恰有一个入向 ThreadFork，Fork 图不得成环。

#### Scenario: 保存有效嵌套 Fork

- **WHEN** 一条 ThreadFork 指向同一 Conversation 中的上游 Thread、其来源 Message 和尚无来源的下游 Thread
- **THEN** 系统保存该关系，并可从它派生 children、深度与分支数量

#### Scenario: 拒绝第二个来源

- **WHEN** 写入尝试为同一个非根 Thread 建立第二条入向 ThreadFork
- **THEN** 系统拒绝该写入且保留原唯一来源

### Requirement: 使用 Turn 约束 Message 与当前有效变体

每个 Turn SHALL 恰好属于一个 Thread，每个 Message SHALL 同时属于该 Thread 和其中一个 Turn。Turn 的当前有效用户与助手 Message MUST 指向自身变体，角色必须匹配；跨 Thread 或跨 Turn 的变体选择 MUST 被拒绝。

#### Scenario: 保存重新生成变体

- **WHEN** 同一 Turn 产生新的助手 Message 变体并被选为当前有效回答
- **THEN** 系统追加新 Message、更新该 Turn 的有效助手引用，且不修改其他 Thread/Turn

#### Scenario: 拒绝跨 Thread 有效选择

- **WHEN** Turn 尝试把另一个 Thread 的 Message 设为当前有效变体
- **THEN** 系统拒绝该选择且原有效路径不变

### Requirement: 组装只读规范 Conversation 快照

系统 SHALL 能够从规范实体组装包含 Conversation、Threads、ThreadForks、Turns、Messages 和当前有效选择的确定性快照。快照中的派生索引 MUST 可从实体重建；系统不得接受该快照作为覆盖规范行的整包写入。

#### Scenario: 两次读取产生稳定快照

- **WHEN** 底层规范实体未发生变化并连续读取同一 Conversation
- **THEN** 两次快照具有相同实体关系、排序和当前有效路径

#### Scenario: 拒绝整包覆盖

- **WHEN** 调用方提交完整 Conversation 快照试图覆盖服务端实体
- **THEN** 持久化层不提供该权威写入能力，并要求调用实体级仓储或应用命令

### Requirement: 审计遗留 ThreadTreeState

系统 SHALL 提供只读、可重复运行的遗留数据审计，检查所有者、根节点、Thread/Fork、Message 图、当前叶节点、Artifact 来源和辅助 Generation 引用，并输出逐记录的可迁移、需修复或拒绝原因。审计不得修改原始数据。

#### Scenario: 审计合法遗留树

- **WHEN** 遗留 `ThreadTreeState` 满足已知结构和归属不变量
- **THEN** 审计输出确定的规范实体映射及数量，不写入规范表或原表

#### Scenario: 报告污染引用

- **WHEN** 遗留树含缺失来源 Message、重复 Fork、跨 Thread active leaf 或辅助表悬空 ID
- **THEN** 审计将该记录标为不可直接迁移，并给出稳定错误代码和涉及的实体 ID

### Requirement: 迁移阶段保持唯一写入权威

在正式切换前，新增规范表和仓储 SHALL 保持禁用或只读验证状态，旧路径仍是唯一写入权威；切换后则规范实体成为唯一权威，系统不得长期双写 JSON 与规范行。

#### Scenario: 未启用规范路径

- **WHEN** 规范持久化功能开关未启用
- **THEN** 当前用户写入行为不变，新表只能用于显式测试、审计或隔离环境

#### Scenario: 防止无声明双写

- **WHEN** 代码尝试在同一运行模式下同时把一次领域变更写入整树 JSON 与规范实体
- **THEN** 系统拒绝启动该模式或使验证失败
