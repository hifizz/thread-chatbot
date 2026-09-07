## ADDED Requirements

### Requirement: Inline ordered Artifact references
系统 SHALL 支持普通文字与 Artifact 原子引用在同一 Composer 内混排，并按顺序保存为消息 Parts。

#### Scenario: Compare two documents inline
- **WHEN** 用户输入文字、选择 Artifact A、继续输入文字并选择 Artifact B
- **THEN** 编辑器、保存的消息、编辑恢复和模型内容均保留该顺序

### Requirement: Project-wide access from every Thread
系统 SHALL 允许当前 Project 中任意 Thread 引用该 Project 已完成的 Artifact，包括当前 Thread 自己产生的 Artifact。系统 MUST NOT 对主线、祖先、子级、兄弟分支设置不同的引用范围。

#### Scenario: References across arbitrary branches and self
- **WHEN** 主线、子 Thread 或兄弟 Thread 引用同 Project 自己或其他 Thread 的已完成 Artifact
- **THEN** 服务端允许该引用并提供其正文，无需切换到来源 Thread

#### Scenario: Foreign or incomplete source
- **WHEN** 引用属于其他 Project、其他用户、不存在或来源未完成
- **THEN** 系统在模型调用前拒绝，且客户端保留草稿

### Requirement: Immutable and explicit model context
系统 SHALL 固定 Artifact ID，从服务端读取其完整内容；前文没有完整正文时在对应用户消息展开，已有时使用固定引用标记。系统 MUST NOT 将未引用的其他 Thread 内容隐式加入上下文。

#### Scenario: Source regenerated
- **WHEN** 原 Artifact 来源消息被重新生成替代
- **THEN** 已发送引用仍指向原 Artifact，不切换到新产物

#### Scenario: Repeated reference or oversized content
- **WHEN** 同一消息重复提及同一 Artifact 或引用内容超过预算
- **THEN** 重复提及保留但正文只展开一次；超预算明确拒绝，不静默截断

#### Scenario: Source body already included
- **WHEN** 当前 Thread 或继承历史中的已完成工具记录包含同一 Artifact 的权威完整正文
- **THEN** 后续显式引用只提供固定 ID、标题和前文引用标记，保留原工具记录与引用位置，不再次展开正文

#### Scenario: References across multiple turns
- **WHEN** Artifact 正文已在前一条用户消息首次展开
- **THEN** 后续各条消息对此 Artifact 的引用使用相同固定标记，不重复提供正文

#### Scenario: Incomplete or absent source
- **WHEN** 来源不在实际发送的前文中、被 SDK 剔除、为临时结果，或其身份与完整正文无法核对
- **THEN** 首次显式引用仍提供服务端权威全文，不能仅按 Thread 或标题判定已包含

#### Scenario: Stable cache prefix
- **WHEN** 在同一历史前缀后追加新的引用消息
- **THEN** 前面的模型消息字节保持不变；引用标记字段与顺序固定，不含轮次、位置或时间；不得因后文出现来源正文而改写前文

### Requirement: Reference lifecycle and navigation
系统 SHALL 在发送、编辑、重试、Fork 继承、刷新和历史展示中保留引用，并允许点击打开原 Artifact。

#### Scenario: Edit a referenced message
- **WHEN** 用户编辑最新用户消息并添加、删除或重排引用
- **THEN** 新消息保存编辑后的完整顺序，原附件和已有 Quote 不被静默丢弃

#### Scenario: Submission and draft isolation
- **WHEN** 用户切换 Thread 或发送结果迟到
- **THEN** 各 Thread 草稿互不污染，失败保留草稿，成功不清除提交后新增的输入
