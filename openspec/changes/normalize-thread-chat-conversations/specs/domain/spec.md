## MODIFIED Requirements

### Requirement: 使用统一的核心术语

系统及项目文档 SHALL 使用以下术语：

- **Thread Tree**：一个独立的树形工作区，拥有唯一的根线程与其全部后代；持久化领域中对应一个 Project。
- **Thread**：Thread Tree 中的一个对话节点，也是界面中的一栏；它拥有自己的有序消息序列、模型选择、标题和冻结分支上下文。
- **MainThread**：Thread Tree 中唯一的根 Thread。
- **ForkedThread**：由一次 Fork 创建的非根 Thread；它可以继续产生后代 Thread。
- **Fork**：从某条 Message 的选区创建 ForkedThread 的关系与动作，不是 Thread 的同义词。
- **Message**：属于一个 Thread 的、按单调序号排列的用户或助手消息记录；每次助手生成尝试都对应一条独立 Message。
- **Generation**：创建一条新助手 Message 的一次模型执行尝试，不是同一 Message 内可切换的版本。
- **Supersede**：旧 Message 仍保持原内容与终态，仅被标记为已由一条新 Message 取代的关系。
- **Artifact**：由某条 Message 产生并持久化的独立内容。
- **Title**：用于识别 Thread 或 Thread Tree 的人类可读标签。

#### Scenario: 描述非根线程

- **WHEN** 产品或代码需要描述由选区创建的对话节点
- **THEN** 使用 ForkedThread 描述该节点，并使用 Fork 描述其创建关系

#### Scenario: 描述一次重新生成

- **WHEN** 用户对一条失败或已完成的助手回复执行 Retry 或 Regenerate
- **THEN** 系统将该操作描述为新的 Generation 和新的 Message，而不是旧 Message 的新版本

### Requirement: 维护线程树的层级不变量

每个 Thread Tree SHALL 恰有一个 MainThread。每个 ForkedThread SHALL 有一个父 Thread、一条来源 Message 和创建时冻结的上下文；任意 ForkedThread 都可以作为新的 Fork 的来源。Thread 是统一节点类型，MainThread 与 ForkedThread 是其不同领域角色，而非两套不相容的会话模型。来源 Message 后续被 supersede SHALL NOT 改变既有 ForkedThread 的来源、上下文或可用性。

#### Scenario: 创建嵌套分叉

- **WHEN** 用户从一个 ForkedThread 中的消息创建新的 Fork
- **THEN** 系统创建新的 ForkedThread，并将该消息所在 Thread 记录为其父 Thread

#### Scenario: 拒绝 Fork 与拓扑矛盾的状态

- **WHEN** 保存的 ForkedThread 缺少父 Thread、来源 Message 或冻结上下文
- **THEN** 系统拒绝该 Thread Tree 状态

#### Scenario: 来源回复被取代

- **WHEN** 一个 ForkedThread 的来源助手 Message 随后被另一条 Message supersede
- **THEN** 该 ForkedThread 继续使用创建时的冻结上下文，且不自动迁移到新回复

## ADDED Requirements

### Requirement: 助手消息终态不可逆

助手 Message SHALL 从 `generating` 进入且仅进入 `completed`、`stopped` 或 `failed` 之一；终态的内容和状态 SHALL NOT 被 Stop、Retry、Regenerate 或重复完成回调改写。系统 MAY 在终态 Message 上追加不改变生成结果的 `superseded_at` 关系元数据。

#### Scenario: 失败回复重试

- **WHEN** 一条助手 Message 已处于 `failed` 且用户执行 Retry
- **THEN** 原 Message 仍为 `failed` 且保留原内容，系统创建一条新的 `generating` 助手 Message

#### Scenario: 迟到的完成信号

- **WHEN** 一条助手 Message 已经进入任一终态后又收到完成或停止信号
- **THEN** 系统忽略迟到信号并返回现有终态结果
