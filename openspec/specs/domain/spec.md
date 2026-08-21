# domain Specification

## Purpose

定义 Thread Chat 的统一领域语言：树、线程、分叉、消息、生成、产物与标题的边界，使产品、设计和实现使用同一组术语沟通。

## Requirements

### Requirement: 使用统一的核心术语

系统及项目文档 SHALL 使用以下术语：

- **Thread Tree**：一个独立的树形工作区，拥有唯一的根线程与其全部后代。
- **Thread**：Thread Tree 中的一个对话节点，也是界面中的一栏；它拥有自己的消息序列、模型选择和标题。
- **MainThread**：Thread Tree 中唯一的根 Thread。
- **ForkedThread**：由一次 Fork 创建的非根 Thread；它可以继续产生后代 Thread。
- **Fork**：从某条消息的选区创建 ForkedThread 的关系与动作，不是 Thread 的同义词。
- **Message**：属于一个 Thread 的用户或助手消息节点。
- **Generation**：生成一条助手 Message 的一次模型执行尝试。
- **Artifact**：由某条 Message 产生并持久化的独立内容。
- **Title**：用于识别 Thread 或 Thread Tree 的人类可读标签。

#### Scenario: 描述非根线程

- **WHEN** 产品或代码需要描述由选区创建的对话节点
- **THEN** 使用 ForkedThread 描述该节点，并使用 Fork 描述其创建关系

### Requirement: 维护线程树的层级不变量

每个 Thread Tree SHALL 恰有一个 MainThread。每个 ForkedThread SHALL 有一个父 Thread 和一个来源 Fork；任意 ForkedThread 都可以作为新的 Fork 的来源。Thread 是统一节点类型，MainThread 与 ForkedThread 是其不同领域角色，而非两套不相容的会话模型。角色由树的根、父子关系和 Fork 来源定义；本规范不规定其在持久化状态中的具体字段或标识符表示。

#### Scenario: 创建嵌套分叉

- **WHEN** 用户从一个 ForkedThread 中的消息创建新的 Fork
- **THEN** 系统创建新的 ForkedThread，并将该消息所在 Thread 记录为其父 Thread

#### Scenario: 拒绝 Fork 与拓扑矛盾的状态

- **WHEN** 保存的 ForkedThread 缺少父 Thread 或来源 Fork
- **THEN** 系统拒绝该 Thread Tree 状态

### Requirement: 明确标题的归属与优先级

Title SHALL 描述其目标 Thread。MainThread 的自动 Title 同时作为 Thread Tree 的默认导航标题；ForkedThread 的 Title 描述对应列。用户为 Thread Tree 设置的自定义 Title SHALL 在树级导航和 MainThread 列头展示中优先于自动 Title。

#### Scenario: 主线自动标题与用户重命名并存

- **WHEN** MainThread 已生成自动 Title，且用户随后为其 Thread Tree 设置自定义 Title
- **THEN** 树级导航和 MainThread 列头展示用户自定义 Title，同时保留自动 Title 作为机器派生信息
