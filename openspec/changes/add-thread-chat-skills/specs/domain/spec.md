## MODIFIED Requirements

### Requirement: 使用统一的核心术语

系统及项目文档 SHALL 使用以下术语：

- **Thread Tree**：一个独立的树形工作区，拥有唯一的根线程与其全部后代。
- **Thread**：Thread Tree 中的一个对话节点，也是界面中的一栏；它拥有自己的消息序列、模型选择、ActiveSkill 和标题。
- **MainThread**：Thread Tree 中唯一的根 Thread。
- **ForkedThread**：由一次 Fork 创建的非根 Thread；它可以继续产生后代 Thread。
- **Fork**：从某条消息的选区创建 ForkedThread 的关系与动作，不是 Thread 的同义词。
- **Message**：属于一个 Thread 的用户或助手消息节点。
- **Generation**：生成一条助手 Message 的一次模型执行尝试。
- **Artifact**：由某条 Message 产生并持久化的独立内容。
- **Title**：用于识别 Thread 或 Thread Tree 的人类可读标签。
- **Skill**：可被发现和选择的逻辑能力身份，例如 Research；它不是一次执行结果，也不是 Slash token。
- **SkillVersion**：某个 Skill 的不可变指令、资源、激活模式和 Capability Profile 快照；它是 Generation 可复现性的依据。
- **ActiveSkill**：某个 Thread 当前用于未来新 Turn 的 sticky SkillVersion 指针；它可以变化，但不得反向改变已经创建的 assistant Message。
- **Pinned SkillVersion**：assistant Message 在创建时固定的实际 SkillVersion；Generation、Retry、Edit、观测和评测以它为事实源。

#### Scenario: 描述非根线程

- **WHEN** 产品或代码需要描述由选区创建的对话节点
- **THEN** 使用 ForkedThread 描述该节点，并使用 Fork 描述其创建关系

#### Scenario: 描述当前 Skill 与历史 Generation

- **WHEN** Thread 已切换到新的 ActiveSkill，但用户查看或重新生成一条由旧 Skill 产生的回复
- **THEN** 使用 ActiveSkill 描述未来新 Turn 的配置，并使用该 assistant Message 的 Pinned SkillVersion 描述历史 Generation 配置
