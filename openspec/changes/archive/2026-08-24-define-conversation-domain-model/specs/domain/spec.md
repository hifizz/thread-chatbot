## MODIFIED Requirements

### Requirement: 使用统一的核心术语

系统、OpenSpec、接口契约和项目文档 SHALL 使用以下术语：

- **Workspace**：成员、租户与授权的最外层边界；它可以拥有多个 Project，不得与前端列布局或画布状态混称。
- **Project**：长期目标、规则、记忆、文件与 Conversation 的上下文和资产边界。
- **Conversation**：Project 中一整个可分叉对话的聚合，拥有稳定 ID、唯一根 Thread、标题与生命周期；它取代旧领域术语 Thread Tree。
- **Thread**：Conversation 中一条可独立继续的对话上下文，也是界面中的一栏；所有根与非根对话列使用同一种 Thread 实体。
- **Main Thread（主 Thread）**：Conversation 的 `rootThreadId` 指向的 Thread，是关系推导角色，不是独立实体类型。
- **Branch Thread（分支 Thread）**：具有入向 ThreadFork 的非根 Thread，是相对于上游 Thread 的关系角色，不是 Branch 实体或另一套 Thread 类型。
- **Fork**：从一个 Thread 的确定 Message 创建另一个 Thread 的服务端动作。
- **ThreadFork**：记录上游 Thread、来源 Message 与下游 Thread 的唯一来源关系。
- **Turn**：Thread 中一个逻辑交互位置，用于约束用户编辑、助手重新生成和回复变体的归属范围。
- **Message**：属于一个 Thread 和 Turn、具有稳定 ID 的用户、助手或明确类型的上下文内容。
- **Generation**：在一个 Thread/Turn 中生成或更新助手输出的一次模型执行尝试；它不是 Message 或 Thread。
- **File**：Project 内具有独立生命周期并可跨 Conversation 复用的持久资产。
- **MemoryItem**：Project 内具有来源、状态与版本的记忆条目，不是无边界增长的文本字段。
- **ProjectInstruction**：Project 级、可版本化的指令；Generation 可以记录实际使用的版本。
- **Artifact**：由 Message 或 Generation 产生的结构化成果；当其需要独立复用和生命周期时，SHALL 通过 Project 资产及来源记录表达，而不是只存在于消息内部。
- **Title**：用于识别 Project、Conversation 或 Thread 的人类可读标签。
- **UI Workspace（界面工作区）**：列、折叠、画布视口、临时选择和打开面板等客户端展示状态；它不是 Workspace 领域实体，也不是 Conversation 事实源。

`Thread Tree`、`MainThread` 和 `ForkedThread` 只允许出现在遗留迁移说明或实现适配器中，不得继续作为新产品能力、接口或领域实体的规范名称。

#### Scenario: 描述非根对话列

- **WHEN** 产品、接口或代码需要描述由 Fork 创建的非根对话列
- **THEN** 将其描述为 Thread，并在需要强调关系时称为分支 Thread，同时使用 ThreadFork 描述来源关系

#### Scenario: 描述完整分叉对话

- **WHEN** 产品或接口需要表示一个根 Thread 及其全部派生 Thread 的整体
- **THEN** 使用 Conversation，而不是 Thread Tree 或 Thread 表示该聚合

### Requirement: 明确标题的归属与优先级

系统 SHALL 明确 Title 归属 Project、Conversation 或 Thread。Conversation 的自动 Title SHALL 由其根 Thread 的内容派生并作为默认导航标题；根 Thread 列头 SHALL 使用 Conversation Title，避免另存一份同义标题。非根 Thread 可以拥有描述对应列的本地 Title。用户为 Conversation 设置的自定义 Title SHALL 在 Conversation 级导航和根 Thread 列头展示中优先于自动 Title，同时系统 SHALL 保留自动 Title 作为机器派生信息。

#### Scenario: Conversation 自动标题与用户重命名并存

- **WHEN** Conversation 已由根 Thread 生成自动 Title，且用户随后为该 Conversation 设置自定义 Title
- **THEN** Conversation 导航和根 Thread 列头展示用户自定义 Title，并保留自动 Title

#### Scenario: 分支 Thread 使用独立标题

- **WHEN** 非根 Thread 生成或设置自己的 Title
- **THEN** 该 Title 只描述并标识该 Thread，不覆盖所属 Conversation 的 Title

## ADDED Requirements

### Requirement: 维护 Project、Conversation 与 Thread 的包含不变量

每个 Conversation SHALL 恰好属于一个 Project，并恰有一个属于自身的根 Thread。每个 Thread SHALL 恰好属于一个 Conversation；Thread 的归属创建后不得改变。根与非根角色 SHALL 由 Conversation 根引用及 ThreadFork 关系推导，系统不得使用持久化 `kind`、`root` 布尔值或具有业务含义的魔法 ID 作为第二事实源。

#### Scenario: 创建 Conversation

- **WHEN** 系统在 Project 中创建 Conversation
- **THEN** 系统为 Conversation 和根 Thread 分配稳定且无业务含义的 ID，并使 `rootThreadId` 指向属于该 Conversation 的 Thread

#### Scenario: 拒绝跨 Conversation 的 Thread 归属

- **WHEN** 一个操作试图把既有 Thread 重新归属到另一个 Conversation
- **THEN** 系统拒绝该操作且不改变两个 Conversation

### Requirement: 使用 ThreadFork 维护唯一 Fork 来源

每个非根 Thread SHALL 恰有一个入向 ThreadFork；根 Thread SHALL 没有入向 ThreadFork。ThreadFork SHALL 指向同一 Conversation 中的上游 Thread、属于上游 Thread 的确定来源 Message，以及唯一的下游 Thread。Fork 来源不得同时以可写 `children`、Message 反向链接或下游来源字段重复保存；这些集合和计数只能是可重建投影。

#### Scenario: 从确定消息创建嵌套 Fork

- **WHEN** 用户从任意 Thread 的确定 Message 创建新 Thread
- **THEN** 系统原子创建下游 Thread 与唯一 ThreadFork，并记录该 Message 所属 Thread 为上游 Thread

#### Scenario: 拒绝来源消息错配

- **WHEN** ThreadFork 的来源 Message 不属于声明的上游 Thread，或任一参与实体不属于同一 Conversation
- **THEN** 系统拒绝该关系且不创建孤立的下游 Thread

#### Scenario: 派生 Thread 数量来自投影

- **WHEN** 界面显示某条 Message 的直接派生 Thread 数量
- **THEN** 系统从 ThreadFork 查询或派生该数量，而不是读取独立可写的 Message fork 列表

### Requirement: 用 Turn 约束 Message 变体

每个 Turn SHALL 恰好属于一个 Thread，每个 Message SHALL 恰好属于一个 Thread 和一个 Turn。用户编辑与助手重新生成产生的新 Message 变体 SHALL 留在目标 Thread/Turn 内，不得改变来源 Thread、祖先 Thread 或后代 Thread 的 Message。实现可以保留同一 Turn 内的 Message 因果边，但不得使用 Message 父子边表达 ThreadFork。

#### Scenario: 在分支 Thread 中重新生成

- **WHEN** 用户对分支 Thread 的助手 Message 执行重新生成
- **THEN** 系统只在该 Message 所属 Thread/Turn 中追加助手回复变体，其他 Thread 的变体与派生数量保持不变

#### Scenario: 拒绝跨 Thread 变体

- **WHEN** 操作试图把另一个 Thread 的 Message 加入当前 Turn 的回复变体
- **THEN** 系统拒绝该操作且不改变当前有效变体

### Requirement: 保证 Generation 的执行身份与归属

每个 Generation SHALL 具有稳定的执行尝试 ID，并恰好属于一个 Thread 和 Turn。其输入、输出及重新生成来源 Message SHALL 属于相同 Thread，且输入输出关系必须与该 Turn 一致。Generation ID SHALL 只承担执行幂等、状态、停止、恢复、用量与结算身份，不得替代 Thread、Turn 或 Message 的实体身份。

#### Scenario: Generation 完成到目标 Message

- **WHEN** 一个 Generation 成功、停止或失败并产生可持久化结果
- **THEN** 系统只更新该 Generation 绑定的 Thread/Turn/Message，并保留确定的执行尝试、状态和用量归属

#### Scenario: 拒绝跨 Thread Generation

- **WHEN** Generation 声明的输入或输出 Message 不属于其 Thread
- **THEN** 系统在模型调用或结算前拒绝该 Generation

### Requirement: 持久化影响后续上下文的当前有效变体

Thread/Turn 的当前有效变体会决定后续提示词、Fork 来源与继续生成路径，系统 SHALL 将其作为有版本的领域选择持久化，并将切换限制在同一 Thread/Turn。列可见性、折叠、画布视口、临时选择与面板状态 SHALL 保持在界面工作区，且不得改变实体归属或当前有效变体。

#### Scenario: 切换变体后继续对话

- **WHEN** 用户在一个 Turn 内切换当前有效助手回复变体并继续发送消息
- **THEN** 后续 Generation 使用持久化后的有效路径，刷新后仍保持相同选择

#### Scenario: UI 布局不改变领域选择

- **WHEN** 用户折叠列、切换画布或关闭面板
- **THEN** Conversation、Thread、Turn、Message 归属和当前有效变体均保持不变

### Requirement: 维护 Project 级上下文与资产边界

Conversation SHALL 通过 Project 获得可复用上下文和资产边界。ProjectInstruction、MemoryItem 与 File 在存在时 SHALL 归属 Project 并具有独立身份；Message 和 Generation SHALL 通过明确引用或来源记录使用它们，不得把其唯一事实仅嵌入某棵 Conversation JSON。一个 Thread 中产生的 File 在被保存为 Project 资产后 SHALL 可由同一 Project 的其他 Conversation 引用，而不需要复制文件实体。

#### Scenario: 跨 Conversation 使用 Project File

- **WHEN** 一个 Thread 生成的文件被保存为 Project File，随后同一 Project 的另一个 Conversation 引用该文件
- **THEN** 两个 Conversation 引用同一个稳定 File，并保留原始 Message/Generation 来源记录

#### Scenario: Generation 记录 Project Instruction 版本

- **WHEN** Project Instruction 在两次 Generation 之间发生修改
- **THEN** 每次 Generation 都能识别自己实际使用的指令版本，旧回答不会被解释为使用了新版本

### Requirement: 分离领域事实、应用命令、传输、持久化与界面状态

领域事实 SHALL 独立于 React 组件、HTTP 路由、数据库对象关系映射与客户端布局存在。所有改变 Conversation、Thread、ThreadFork、Turn、Message、Generation 或当前有效变体的操作 SHALL 通过有明确输入、权限、幂等和冲突语义的应用命令执行。服务端可以返回组装后的只读快照，但客户端不得提交可覆盖整个 Conversation 事实状态的整树 JSON。

#### Scenario: 客户端执行 Fork

- **WHEN** 客户端请求从确定 Message 创建 Thread
- **THEN** 服务端命令校验归属并原子提交规范实体增量，客户端只合并受影响实体

#### Scenario: 拒绝整 Conversation 覆盖

- **WHEN** 客户端提交包含全部 Thread、Message 与 Fork 的可写整树快照以覆盖服务端事实
- **THEN** 系统拒绝或不提供该权威写入路径，并要求使用实体级命令

## REMOVED Requirements

### Requirement: 维护线程树的层级不变量

**Reason**：该 Requirement 把完整对话命名为 Thread Tree，并以 MainThread/ForkedThread 表述两类节点，无法表达 Project → Conversation → Thread 聚合边界，也继续暴露当前整树实现形状。

**Migration**：使用新增的“维护 Project、Conversation 与 Thread 的包含不变量”和“使用 ThreadFork 维护唯一 Fork 来源”Requirements。现有 `ThreadTreeState`、MainThread 与 ForkedThread 引用迁移到 Conversation、Thread 角色及 ThreadFork；遗留名称仅可保留在明确标记的迁移适配器中。
