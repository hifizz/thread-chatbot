## Context

ThreadChat 是一套独立于 assistant-ui runtime 的树形会话实现。assistant 消息正文已经通过 `MarkdownBody`（`react-markdown` + `remark-gfm`）渲染；`ThreadTreeState` 也已经包含 Artifact registry、顺序表和消息级 `artifactIds`，列视图已有卡片、右侧已有 drawer。当前断点在真实生成链路：`threadChat` 模式不挂后端工具，`ui-stream` 丢弃全部 `tool-*` chunk，store 只能登记 Artifact 而不能绑定消息。

本变更跨越服务端 AI 编排、SSE 消费、消息生命周期、树状态、持久化、提示上下文和列/画布两套消息视图。项目使用 AI SDK v7；完整工具参数以 `tool-input-available` chunk 出现，其中包含 `toolCallId`、`toolName` 和已校验 `input`。

## Goals / Non-Goals

**Goals:**

- 用户以中文、英文或等价自然语言要求生成一份 Markdown 交付物时，系统生成独立 Markdown Artifact，而不是只在普通气泡中输出源码。
- Markdown Artifact 以卡片插入产生它的 assistant 消息，点击卡片在现有右侧 drawer 中渲染。
- Artifact-only 回复在完成、停止、重试、刷新恢复、分支标题和后续追问中均为一等消息输出。
- 类型和模块契约先行，服务端 schema、流事件、store mutator、UI props 和提示序列化边界明确。
- 保持现有整树 JSON 持久化，不引入新表、外部存储或重复 Markdown renderer。

**Non-Goals:**

- 不把所有带 Markdown 排版的普通回答都升级为 Artifact。
- 不支持 Markdown 编辑器、所见即所得编辑、版本历史、文件下载或协同编辑。
- 不把 Artifact 升级为 React Flow 一等节点；画布范围仅为展开消息流里的 Markdown 卡片和入口一致性。
- 不为所有 Artifact 类型建设通用工具框架；本次只接通 Markdown，保留现有 registry 的扩展余地。
- 不承诺对无限自然语言表达做数学意义上的零误判；以双语语义指令、高置信强制路由和验收语料集定义可测试保证。

## Decisions

### D1：类型契约先行，Markdown 是明确的 Artifact kind

领域层增加 `"markdown"` kind，并为工具输入、工具流事件和消息绑定定义显式类型。实现计划中的第一项必须先落这些类型和纯校验函数，后续模块不得各自声明近似结构。

建议核心类型：

```ts
export type ArtifactKind = "code" | "note" | "markdown"

export interface MarkdownArtifactInput {
  title: string
  content: string
}

export interface MarkdownArtifactStreamEvent {
  toolCallId: string
  toolName: "createMarkdownArtifact"
  input: MarkdownArtifactInput
}

export interface UIStreamHandlers {
  onTextDelta(delta: string): void
  onMarkdownArtifact(event: MarkdownArtifactStreamEvent): void
  onError(message: string): void
  onFinish(): void
}
```

`Artifact` 保持 registry 通用结构；`MarkdownArtifactInput` 由服务端 Zod schema 推导或与之同源，客户端边界再做轻量 type guard。弃选把 Markdown 塞进 `kind:"note"`：这会让渲染、文案和后续能力继续依赖隐式约定。

### D2：工具名表达创建语义，renderer 继续复用 `MarkdownBody`

服务端工具命名为 `createMarkdownArtifact`，参数只有 `title` 和 `content`。`content` 必须是可直接交给 renderer 的原始 Markdown，不允许用一层完整的 Markdown 代码围栏包住整份文档；服务端归一化函数会防御性拆掉单个最外层 `markdown`/`md` fence，但保留文档内部代码围栏。

工具 `execute` 只返回轻量成功结果，不回传整份内容；客户端在 `tool-input-available` 时消费完整且已验证的输入，避免 input/output 重复传输。drawer 使用 `<MarkdownBody source={artifact.content} />`，不新建第二套 parser。`react-markdown` 继续不启用 raw HTML。

### D3：双语语义 description + 高置信首步强制，不用单一关键词规则

工具 description 和 ThreadChat system prompt 同时用中英文说明：当用户要求创建、生成、输出、整理、改写或交付一份 Markdown/`.md` 文档时调用；语言和句式不限，只看“独立 Markdown 交付物”的语义；仅解释 Markdown 概念或普通回答采用 Markdown 排版时不得调用。

对服务端能高置信识别的显式交付表达，首个 `prepareStep` 强制 `createMarkdownArtifact`；后续 step 取消强制并关闭该工具，防止多步循环重复创建。其他等价表达保留 `auto`，由双语 description 和 system prompt 决策。弃选“出现 markdown 字符串就强制”：`Markdown 是什么？`会误触发。弃选为每次请求增加独立 LLM 分类调用：增加延迟和费用，先以语料回归衡量是否需要。

### D4：标准 AI SDK tool chunk 进入现有 SSE 消费器

`ui-stream` 增加对 `tool-input-available` 的窄解析：仅当 `toolName === "createMarkdownArtifact"`、`toolCallId` 合法、`input.title/content` 为非空字符串时回调 `onMarkdownArtifact`；其他 tool chunk 仍保持静默忽略。每次响应以 `toolCallId` 去重，损坏或重复事件不得生成重复卡片。

弃选自定义 `data-markdown` stream：它需要额外包裹 `createUIMessageStream`，而标准工具事件已经携带完整参数，没有足够收益支付平行协议成本。

### D5：Artifact 登记与消息绑定必须是一个 store 原子操作

新增通用 mutator：

```ts
attachArtifactToMessage(
  threadId: string,
  messageId: string,
  seed: ArtifactSeed,
): string | null
```

它在一次 mutate/notify 内验证 thread 和 assistant message、分配 Artifact id、写 registry/order、把 id 追加到 `message.artifactIds`。任一步失败不得留下孤儿 Artifact。`resetAssistantMessage` 在重试前删除该消息关联的旧 Artifact registry/order 项并清空 `artifactIds`，保证重试是替换而非叠加。

### D6：Artifact 是有效输出，不再以 text 字符数作为唯一成功条件

chat-controller 将终态依据从 `receivedChars > 0` 改为“收到正文或至少一个有效 Artifact”。Artifact-only 输出完成后记为 `done`；停止发生在完整 Artifact 到达之后也保留 Artifact 并完成，完整 Artifact 到达之前且无正文仍按已停止错误处理。

列和画布消息 renderer 在 Artifact-only 状态下不画空 assistant bubble，只画身份标签与卡片。流式等待期间仍显示 typing；Artifact 完整事件到达后用卡片替换 typing。错误提示和卡片不得同时表示互相矛盾的终态。

### D7：持久化恢复和分支标题按“可渲染输出”判断

整树 JSON 已自动保存 `artifacts`、`artifactOrder` 和 `message.artifactIds`，无 SQL migration。`sanitizeLoadedState` 对 pending/streaming assistant 消息的恢复规则改为：有正文或有可解析 Artifact 关联则转 `done`；两者都没有才删除空占位。加载时忽略不存在的 Artifact id，并可清理 registry/order 中无消息引用的孤儿项。

分支标题生成寻找首条完成的 assistant 输出时，正文或 Markdown Artifact 均有效；Artifact-only 时以文档标题加内容摘要作为 answer。

### D8：后续模型上下文必须包含 Markdown 文档内容

`buildRequestBody` 不再只序列化 `message.text`，而是通过共享的 `serializeMessageForModel(state, message)` 组合正文和关联 Artifact。Markdown 用明确边界表示标题和原始内容，使“修改刚才的 Markdown”“再加一节”等追问可理解。继承上文的字符预算对组合后的内容生效；当前会话仍沿用现有不截断策略。

不持久化原始 tool-call/tool-result parts：ThreadChat 的领域消息模型不是 AI SDK `UIMessage`，把 Artifact 内容还原成 assistant 文本上下文足以保持语义，并避免引入第二套消息格式。

### D9：卡片组件共享，用户文案统一为 Markdown

从列视图现有 `renderAfterMessage` 中抽出共享 `MarkdownArtifactCard`。列视图点击走现有 `onOpenArtifact`；画布 `CanvasActions` 增加 `openArtifact(id)`，使展开面板中的同一消息也能打开全局 drawer。顶栏、drawer 标题/空态、卡片类型、画布计数统一使用 Markdown 文案；内部 `ArtifactDrawer`、`artifacts` 字段可暂时保留，避免无价值的大范围重命名。

### D10：生成进度使用标准工具输入事件，不伪造百分比

`tool-input-start(createMarkdownArtifact)` 到达时立即在最终卡片位置显示不可点击的 Markdown 进度卡；`tool-input-delta` 按 `toolCallId` 累积原始参数文本，使用 AI SDK v7 公共 `parsePartialJson` 解析修复后的局部对象，再展示真实 `characterCount`、`lineCount`、`partialTitle` 和最近三个 ATX 标题。未知总长度时使用不确定进度动画，不显示无法证明的百分比。

完整且已校验的 `tool-input-available` 到达后，进度卡必须与正式 Artifact 在同一 store 变更中完成替换。delta 合帧到每帧最多一次 store 更新，避免长文参数导致全树高频重渲。

### D11：进度是临时消息态，不属于持久化领域数据

`Message.markdownGeneration` 只用于当前页面渲染，保存 `branch_trees.state` 前通过纯函数剥离；加载 sanitize 也防御性删除旧快照里的该字段。临时态只保存标题、计数和最近章节，不保存局部 Markdown 正文。完成、失败、停止、重试和完整 Artifact 绑定均清理该字段，避免刷新后出现无法继续推进的僵尸进度卡。

### D12：Markdown 工具是终止工具，空白 delta 不构成可见正文

ThreadChat 的 `stopWhen` 增加 `hasToolCall(createMarkdownArtifact)`；该工具输入完整并执行后直接终止本轮 loop，不发起第二个模型 step。完成提示由正式卡片自身表达，不再消耗模型 token 生成重复摘要。

正文气泡按 `message.text.trim()` 判断是否可见；仅收到空格或换行时继续显示 typing，而不是渲染裸 caret。controller 的有效正文计数同样忽略空白字符，防止纯空白响应被错误判为成功。

## Risks / Trade-offs

- **[模型对长 Markdown 工具参数的支持存在供应商差异]** → 默认 MiniMax 及所有可选模型分别做真实工具调用验收；保留普通文本错误态和重试入口。
- **[语义触发存在误判/漏判]** → 双语 description + system 规则、高置信首步强制、正反例语料回归；根据数据再决定是否引入独立分类器。
- **[Artifact 内容扩大后续上下文]** → 继承段沿用字符预算；当前线程暂不截断，与普通长回复现状一致，后续统一做会话摘要而非只针对 Artifact 打补丁。
- **[流中重复或损坏 tool chunk 产生脏状态]** → `toolCallId` 响应内去重、客户端形状校验、store 原子绑定。
- **[旧快照含 code/note 或孤儿 Artifact]** → 保留旧 kind 的兼容读取；加载 sanitize 忽略坏引用并清理孤儿，不要求数据库迁移。
- **[Artifact-only 消息影响依赖非空 text 的隐式逻辑]** → 审计终态、恢复、标题、摘要、选择器和测试，统一改用“可渲染输出”谓词。

## Migration Plan

1. 先引入类型、schema、纯意图判定与可渲染输出/序列化 helpers，不改变 UI 行为。
2. 挂载 ThreadChat Markdown 工具并扩展 SSE/controller/store 链路，保持功能在 UI 文案切换前可测试。
3. 接入共享卡片与 drawer Markdown 渲染，再补画布入口和用户可见文案。
4. 更新 sanitize、重试、分支标题和上下文回放，运行纯函数、typecheck、lint、真实模型与持久化验收。
5. 回滚时整体 revert；数据层保留 `markdown` JSON 不会破坏旧代码的树读取，但旧 UI 不识别该 kind，因此回滚前不应继续产生新 Markdown Artifact。

## Open Questions

- v1 是否需要“下载 `.md`”按钮？当前明确作为非目标，后续可在不改数据模型的前提下独立增加。
- 是否在产品数据证明自动工具选择漏判明显后，引入一次独立语义分类调用？当前不提前支付额外延迟与费用。
