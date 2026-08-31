## Purpose

定义 Thread Chat 输入框中的 Quote Draft 行为，使划选后开分支、当前 Thread 内引用和当前 Thread Markdown Artifact 批量批注共用同一套 Draft 模型，并在用户确认发送前不创建 Message、不触发模型调用。本能力明确不支持任意跨 Thread、跨分栏或 `@Thread` 引用。

## ADDED Requirements

### Requirement: Composer maintains an ordered multi-quote draft

系统 MUST 允许每个 Thread Composer Draft 保存零到 50 个有序 Quote Block、一段可选总文本和附件。Draft Quote MUST 包含本地 Draft ID、来源选择、预览正文、可选 comment、来源类型和是否为第一轮必需引用。Draft 本身 MUST NOT 被当作已发送 Message。

#### Scenario: User adds several current-thread quotes before sending
- **WHEN** 用户连续从当前 Thread 的合法来源添加多份 Quote
- **THEN** Composer 按添加顺序展示多个 Quote Block，用户只在最终发送时产生一条 User Message

#### Scenario: User reaches fifty quotes
- **WHEN** Composer 已有 50 个 Quote Block
- **THEN** 系统阻止继续添加，并明确提示数量上限；已有 Draft 不被自动删除

#### Scenario: Same selection is added twice
- **WHEN** 用户重复添加相同来源和 Anchor
- **THEN** Composer 聚焦已有 Quote Block，而不是创建重复项

#### Scenario: Draft is edited before sending
- **WHEN** 用户修改总问题、Quote comment、顺序或删除非必需 Quote
- **THEN** 这些操作只改变 Draft，不创建 Message、不调用模型，也不影响已经存在的 Prompt Cache

### Requirement: Empty selection-popup submission creates a branch draft without a model call

当用户在来源 Thread 划选文本并打开分支弹窗，但没有输入问题时，系统 MUST 只创建新的 ForkedThread。新 Thread Composer MUST 显示由 Fork 来源派生的 branch-origin Quote Block。此操作 MUST NOT 创建 User Message、Assistant Message、Trace 或模型调用。

#### Scenario: User leaves the popup question empty
- **WHEN** 用户提交空问题的分支弹窗
- **THEN** 系统创建 Thread B、打开 B，并在 Composer 中展示来源 Quote Block；数据库中尚无 B1 和 BA1

#### Scenario: User closes the new thread without sending
- **WHEN** 用户在空分支中没有发送任何内容
- **THEN** 不产生模型 Token、assistant Trace 或失败 Message；Thread B 仍可保留为未开始分支

#### Scenario: User refreshes before sending
- **WHEN** 新 Thread 只有 Fork 字段而没有 B1
- **THEN** Composer 可以从 `forkMessageId / forkAnchor / anchorText` 重建 required branch-origin Quote Block

### Requirement: Branch-origin quote is required and server-derived for the first turn

ForkedThread 第一轮 Composer 中的 branch-origin Quote MUST 位于第一项并标记为 required。客户端 Draft MAY 展示它，但持久化 Quote MUST 由服务端根据 Thread Fork 字段生成。v1 中用户不得从第一轮 Draft 删除或替换 branch-origin Quote。

#### Scenario: User adds current-thread content after the empty branch has activity
- **WHEN** 新 Thread 已产生自己的 completed assistant Message，用户随后将其选区加入该 Thread Composer
- **THEN** 该 Quote 作为普通当前 Thread Quote 添加，不改变历史 branch-origin

#### Scenario: Client resubmits origin as an ordinary selection
- **WHEN** Command 中伪造或重复提交父 Thread 来源
- **THEN** 服务端只使用自动 origin，并拒绝不属于目标 Thread 的普通 Quote Selection

#### Scenario: First message is sent
- **WHEN** 用户提交含总问题或 Quote comment 的第一轮 Draft
- **THEN** 服务端把 origin 与其他合法当前 Thread Quote 物化到 B1 Parts，并只创建一次 assistant attempt

### Requirement: Selection can open a new branch or return to the same thread composer

用户从当前 Thread 的 `completed` assistant Message 划选后，产品 MUST 支持两个语义动作：创建新 ForkedThread，或把选区添加到当前 Thread Composer。添加到当前 Composer MUST NOT 创建新 Thread 或自动发送。

#### Scenario: User adds a quote to the current thread
- **WHEN** 用户选择“引用到当前输入框”
- **THEN** 当前 Thread Composer 新增 Quote Block，当前 Thread 消息列表和模型状态不变化

#### Scenario: User opens a new thread
- **WHEN** 用户选择“开新分支”
- **THEN** 系统按 Fork 语义创建新 Thread，并根据弹窗是否有问题决定直接发送或进入带 Quote 的空 Draft

#### Scenario: Source is not completed
- **WHEN** 来源 assistant Message 为 generating、stopped 或 failed
- **THEN** 两种动作都不可创建可发送 Quote，并显示来源不可引用

### Requirement: Arbitrary cross-thread and cross-column quoting is not supported in v1

系统 MUST NOT 允许用户选择另一个 Thread、另一个分栏或一个 Thread 标题/ID，把其内容加入当前 Composer。Composer Draft 与 Command 输入 MUST NOT 暴露目标 Thread 选择器、`sourceThreadId` 或 `@Thread` 语义。

#### Scenario: User selects text in another visible column
- **WHEN** 用户当前编辑 Thread A，但划选发生在 Thread B
- **THEN** 产品不得提供“引用到 A”的动作；用户只能在 B 内引用或从 B 开新分支

#### Scenario: Client submits another thread message ID
- **WHEN** 客户端绕过 UI，向 Thread A 的发送接口提交 Thread B 的 Message ID
- **THEN** 服务端拒绝命令，不创建 User Message 或模型调用

#### Scenario: Product later needs cross-thread references
- **WHEN** 未来需要 `@Thread`、跨 Thread 聚合或多分栏合并
- **THEN** 必须通过独立 Research/OpenSpec change 设计权限、上下文去重、预算、嵌套引用和缓存顺序

### Requirement: Markdown batch annotations return to the artifact source thread composer

Markdown Artifact 的批量批注 MUST 转换为多份 Artifact Quote Draft Item。每份 Item MUST 保存自己的选区和 comment。批量确认后，这些 Item MUST 一次性加入该 Artifact 来源 Message 所属 Thread 的 Composer，不得选择其他 Thread 作为目标。

#### Scenario: User annotates several paragraphs
- **WHEN** 用户对多个 Artifact 选区分别填写 comment 并确认批量批注
- **THEN** Artifact 来源 Thread 的 Composer 按批注顺序新增多个 Quote Block，每个 Block 保持自己的 comment

#### Scenario: User reviews annotations before sending
- **WHEN** 批注已经进入 Composer 但尚未发送
- **THEN** 用户可以继续修改总文本、comment、删除非 required Quote 或调整顺序；不会产生模型调用

#### Scenario: User sends the batch
- **WHEN** 用户最终发送包含多份批注 Quote 的 Draft
- **THEN** 系统创建一条 User Message 和一次 assistant attempt，而不是每条批注一轮

#### Scenario: Artifact belongs to another thread
- **WHEN** 当前 Composer 不属于 Artifact 来源 Message 所在 Thread
- **THEN** 批量批注不能回填当前 Composer，产品应导航到来源 Thread 或提示该限制

### Requirement: Draft submission uses one canonical command conversion

前端 MUST 通过单一纯函数把 Composer Draft 转换为后端 Command 输入。转换 MUST 保留非 required Quote 顺序、来源、Anchor 和 comment；branch-origin MUST 标记为服务端派生，不得伪造持久化 Quote ID、正文或父 Thread 来源。

```ts
export interface ComposerSubmission {
  text: string
  files: CommandFileReference[]
  quotes: QuoteSelectionInput[]
}

export function composerDraftToSubmission(
  draft: ThreadComposerDraft
): ComposerSubmission
```

#### Scenario: Ordinary current-thread multi-quote question is submitted
- **WHEN** Draft 含两个当前 Thread Quote 和一段总问题
- **THEN** Submission 含两个有序 QuoteSelectionInput 和总文本，不包含 `sourceThreadId`

#### Scenario: Empty branch first turn is submitted
- **WHEN** Draft 第一项是 required branch-origin
- **THEN** Submission 不把 origin 作为普通 Quote 伪造；服务端根据目标 ForkedThread 自动生成它

#### Scenario: Batch annotations have no total text
- **WHEN** Draft 总文本为空，但至少一个 Quote comment 非空
- **THEN** Draft 仍可发送并形成一条 User Message

#### Scenario: Quote-only draft has no question or comment
- **WHEN** Draft 只有无 comment 的 Quote，且总文本为空
- **THEN** 发送保持禁用，避免向模型提交没有用户意图的请求

### Requirement: Quote draft submission is subject to count and input budget checks

Composer 的 50 个 Quote 上限 MUST 与后端模型输入预算分开处理。前端可以提供预计大小提示，但后端 MUST 重新校验，并在付费模型调用前拒绝超出当前模型 Route 输入预算的 Draft。

#### Scenario: Fifty short quotes fit the budget
- **WHEN** Draft 达到 50 个短 Quote 且完整模型输入仍在预算内
- **THEN** 系统允许一次发送

#### Scenario: Fewer long quotes exceed the budget
- **WHEN** Draft 只有少量 Quote，但完整输入预计超出模型窗口或安全预算
- **THEN** 系统拒绝发送或在模型调用前终止，并明确要求用户删减，不静默截断

### Requirement: Frontend component selection remains a later research decision

本能力只定义 Draft 状态、行为和后端提交合同，不规定 textarea、Lexical、ProseMirror、ContentEditable、Quote Pill 视觉、拖拽库、移动端布局、Draft 持久化或来源跳转实现。

#### Scenario: Frontend research begins
- **WHEN** 下一阶段评估 Composer 实现
- **THEN** 候选方案必须消费本规范的当前 Thread-only Draft、50 Quote、required origin 和 canonical submission 合同，不得重新发明 Message 协议
