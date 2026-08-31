## Purpose

定义 Thread Chat 输入框中的 Quote Draft 行为，使划选后开分支、当前 Thread 引用、跨分栏引用和 Markdown Artifact 批量批注共用同一套 Draft 模型，并在用户确认发送前不创建 Message、不触发模型调用。

## ADDED Requirements

### Requirement: Composer maintains an ordered multi-quote draft

系统 MUST 允许每个 Thread Composer Draft 保存零到 50 个有序 Quote Block、一段可选总文本和附件。Draft Quote MUST 包含本地 Draft ID、来源选择、预览正文、可选 comment、来源类型和是否为第一轮必需引用。Draft 本身 MUST NOT 被当作已发送 Message。

#### Scenario: User adds several quotes before sending
- **WHEN** 用户连续从多个合法来源选择内容并添加到同一个 Composer
- **THEN** Composer 按添加顺序展示多个 Quote Block，用户只在最终发送时产生一条 User Message

#### Scenario: User reaches fifty quotes
- **WHEN** Composer 已有 50 个 Quote Block
- **THEN** 系统阻止继续添加，并明确提示数量上限；已有 Draft 不被自动删除

#### Scenario: Same selection is added twice
- **WHEN** 用户重复添加相同来源和 Anchor
- **THEN** Composer 聚焦已有 Quote Block，而不是创建重复项

### Requirement: Empty selection-popup submission creates a branch draft without a model call

当用户在来源 Thread 划选文本并打开分支弹窗，但没有输入问题时，系统 MUST 只创建新的 ForkedThread。新 Thread Composer MUST 显示由 Fork 来源派生的 branch-origin Quote Block。此操作 MUST NOT 创建 User Message、Assistant Message 或模型调用。

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

ForkedThread 第一轮 Composer 中的 branch-origin Quote MUST 位于第一项并标记为 required。客户端 Draft MAY 展示它，但持久化 Quote MUST 由服务端根据 Thread Fork 字段生成。v1 中用户不得从第一轮 Draft 删除 branch-origin Quote。

#### Scenario: User adds more quotes to an empty branch
- **WHEN** branch-origin 已存在，用户再添加其他 Quote
- **THEN** origin 保持第一项，其他 Quote 按用户顺序排在后面

#### Scenario: Client resubmits origin as an ordinary selection
- **WHEN** Command 中的 Quote Selection 与 branch-origin 相同
- **THEN** 服务端保留自动 origin，并去除重复 Selection

#### Scenario: First message is sent
- **WHEN** 用户提交含总问题或 Quote comment 的第一轮 Draft
- **THEN** 服务端把 origin 与其他 Quote 统一物化到 B1 Parts，并只创建一次 assistant attempt

### Requirement: Selection can be routed to a new thread or the current composer

用户从 completed assistant Message 或合法 Artifact 划选后，产品 MUST 支持至少两个语义动作：创建新 ForkedThread，或添加到当前 Thread Composer。添加到当前 Composer MUST NOT 创建新 Thread 或自动发送。

#### Scenario: User adds a quote to the current thread
- **WHEN** 用户选择“引用到当前 Thread”
- **THEN** 当前 Composer 新增 Quote Block，当前 Thread 消息列表和模型状态不变化

#### Scenario: User opens a new thread
- **WHEN** 用户选择“开新分支”
- **THEN** 系统按 Fork 语义创建新 Thread，并根据是否有问题决定直接发送或进入带 Quote 的空 Draft

#### Scenario: Source is not completed
- **WHEN** 来源 assistant Message 为 generating、stopped 或 failed
- **THEN** 两种动作都不可创建可发送 Quote，并显示来源不可引用

### Requirement: Cross-column quotes use the same draft contract

同 Project 其他分栏中的 completed assistant Message 或 Artifact 可以作为当前 Composer 的 Quote 来源。跨分栏引用 MUST 使用与当前 Thread 引用相同的 `QuoteSourceInput` 和 Draft Item，不得建立另一套 `@` 专用消息协议。

#### Scenario: User references another visible column
- **WHEN** 用户把 B Thread 中的合法选区添加到 A Thread Composer
- **THEN** A 的 Draft 新增普通 Quote Block，来源保留 B 的真实 Thread/Message 或 Artifact ID

#### Scenario: Source column later closes
- **WHEN** 来源分栏在工作区中被收起
- **THEN** Draft Quote 仍有效，因为其身份依赖数据库 ID 和 Anchor，而不是当前列位置

### Requirement: Markdown batch annotations aggregate into one composer draft

Markdown Artifact 的批量批注 MUST 转换为多份 Artifact Quote Draft Item。每份 Item MUST 保存自己的选区和 comment。批量确认后，这些 Item MUST 一次性加入目标 Thread Composer，而不是逐条发送或逐条触发 AI 回复。

#### Scenario: User annotates several paragraphs
- **WHEN** 用户对多个 Artifact 选区分别填写 comment 并确认批量批注
- **THEN** 目标 Composer 按批注顺序新增多个 Quote Block，每个 Block 保持自己的 comment

#### Scenario: User reviews annotations before sending
- **WHEN** 批注已经进入 Composer 但尚未发送
- **THEN** 用户可以继续修改总文本、删除非 required Quote 或调整顺序；不会产生模型调用

#### Scenario: User sends the batch
- **WHEN** 用户最终发送包含多份批注 Quote 的 Draft
- **THEN** 系统创建一条 User Message 和一次 assistant attempt，而不是每条批注一轮

### Requirement: Draft submission uses one canonical command conversion

前端 MUST 通过单一纯函数把 Composer Draft 转换为后端 Command 输入。该转换 MUST 保留非 required Quote 顺序、来源、Anchor 和 comment；branch-origin MUST 标记为服务端派生，不得伪造持久化 Quote ID 或正文。

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

#### Scenario: Ordinary multi-quote question is submitted
- **WHEN** Draft 含两个普通 Quote 和一段总问题
- **THEN** Submission 含两个有序 QuoteSelectionInput 和总文本

#### Scenario: Empty branch first turn is submitted
- **WHEN** Draft 第一项是 required branch-origin，后面有两个普通 Quote
- **THEN** Submission 只提交两个普通 Quote；服务端根据 Thread 自动加入 origin

#### Scenario: Annotation-only draft is submitted
- **WHEN** Draft 没有总文本，但至少一个 Quote comment 非空
- **THEN** Submission 仍可发送；服务端按 comment 验证有效用户意图

#### Scenario: Quote-only draft has no question or comment
- **WHEN** Draft 只有引用正文，没有总文本和 comment
- **THEN** 发送被阻止，Draft 保持不变，避免模型猜测用户意图

### Requirement: Composer quote changes affect only the current dynamic tail before sending

在 Draft 尚未发送时，添加、删除、排序或修改 Quote comment MUST 只改变本轮待发送内容，不改变此前已完成 Message、冻结祖先历史或稳定前缀。发送后，该 Message 才成为下一轮的稳定 Branch History。

#### Scenario: User reorders quotes before sending
- **WHEN** 用户在 Composer 中调整 Quote 顺序
- **THEN** 只有当前用户尾部顺序变化，`inherited-end` 和 `branch-history-end` 以前的 Hash 不变化

#### Scenario: User cancels all draft quotes
- **WHEN** 用户删除全部非 required Quote 并清空文本
- **THEN** 不产生模型调用，现有缓存和历史不变化

#### Scenario: Sent quote message becomes history
- **WHEN** 一条多 Quote Message 已完成对应 assistant 回复，用户继续下一轮
- **THEN** 该 Message 的 Quote/comment/Text 按原 Parts 顺序进入稳定 Branch History，并可参与同 Thread 后续缓存

### Requirement: Frontend component design remains a follow-up decision

本能力只规定 Draft、提交和产品行为，不规定具体 React 组件树、富文本框技术、拖拽库、Quote Block 视觉样式、移动端布局、来源跳转动画或 Draft 持久化实现。后续前端调研 MUST 复用本 Spec，而不得改变后端 Quote Parts 语义。

#### Scenario: Frontend research begins
- **WHEN** 下一阶段比较 textarea、Lexical、ProseMirror 或自定义 block composer
- **THEN** 所有候选都必须能表达本 Spec 的 0..50 Quote Draft、required origin、comment、排序、删除和一次性提交
