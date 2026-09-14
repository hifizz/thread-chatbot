## MODIFIED Requirements

### Requirement: 使用统一的核心术语

系统及项目文档 SHALL 使用以下术语：

- **Thread Tree**：一个独立的树形工作区，拥有唯一的根线程与其全部后代。
- **Thread**：Thread Tree 中的一个对话节点，也是界面中的一栏；它拥有自己的消息序列、模型选择和标题。
- **MainThread**：Thread Tree 中唯一的根 Thread。
- **ForkedThread**：由一次 Fork 创建的非根 Thread；它可以继续产生后代 Thread。
- **Fork**：从某条消息正文或该消息所产出的 Markdown Artifact 的选区创建 ForkedThread 的关系与动作，不是 Thread 的同义词。
- **Message**：属于一个 Thread 的用户或助手消息节点。
- **Generation**：生成一条助手 Message 的一次模型执行尝试。
- **Artifact**：由某条 Message 产生并持久化的独立内容；以固定 ID 引用时，历史内容与来源保持不变。
- **Title**：用于识别 Thread 或 Thread Tree 的人类可读标签。

#### Scenario: 描述非根线程

- **WHEN** 产品或代码需要描述由选区创建的对话节点
- **THEN** 使用 ForkedThread 描述该节点，并使用 Fork 描述其创建关系

#### Scenario: 描述产物选区来源

- **WHEN** 用户从 Markdown Artifact 的一段文字创建分支
- **THEN** Fork 来源同时标识产生它的 Message、该 Artifact 与文档内选区，而不是把选区当作消息正文

### Requirement: 维护线程树的层级不变量

每个 Thread Tree SHALL 恰有一个 MainThread。每个 ForkedThread SHALL 有一个父 Thread 和一个来源 Fork；任意 ForkedThread 都可以作为新的 Fork 的来源。Thread 是统一节点类型，MainThread 与 ForkedThread 是其不同领域角色，而非两套不相容的会话模型。角色由树的根、父子关系和 Fork 来源定义；本规范不规定其在持久化状态中的具体字段或标识符表示。

消息正文 Fork 的父节点 SHALL 为来源 Message 所属 Thread。Markdown Artifact 选区 Fork 的父节点 SHALL 为产生该 Artifact 的 Message 所属 Thread；项目面板入口、当前焦点列与产物的显示位置 MUST NOT 改变该父节点或继承历史截止点。Artifact 来源关系 SHALL 与父 Thread、来源 Message 保持一致。

#### Scenario: 创建嵌套分叉

- **WHEN** 用户从一个 ForkedThread 中的消息创建新的 Fork
- **THEN** 系统创建新的 ForkedThread，并将该消息所在 Thread 记录为其父 Thread

#### Scenario: 拒绝 Fork 与拓扑矛盾的状态

- **WHEN** 保存的 ForkedThread 缺少父 Thread 或来源 Fork
- **THEN** 系统拒绝该 Thread Tree 状态

#### Scenario: 从项目面板打开其他分支的产物

- **WHEN** 用户焦点位于 Thread A，但从项目面板打开 Thread B 产生的 Markdown Artifact 并划选开分支
- **THEN** 新 ForkedThread 的父节点为 B，继承历史截止于该 Artifact 的来源 Message，而不是 A 的末条消息
