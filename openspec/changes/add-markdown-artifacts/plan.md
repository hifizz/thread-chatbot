# Markdown Artifact 技术实施计划

> 本文件是补充技术计划；OpenSpec 的可执行清单仍以 `tasks.md` 为准。实现必须先落第 1 节类型与接口，再开始服务端、流、store 或 UI 接线。

## 1. 参数类型与 TypeScript 接口（先行）

### 1.1 共享常量与工具输入

建议新增 `lib/chat/markdown-artifact.ts`，作为服务端 schema、归一化和意图判定的单一事实来源。

```ts
export const MARKDOWN_ARTIFACT_TOOL_NAME = "createMarkdownArtifact" as const
export const MARKDOWN_ARTIFACT_TITLE_MAX_LEN = 80
export const MARKDOWN_ARTIFACT_CONTENT_MAX_CHARS = 64_000

export const markdownArtifactInputSchema = z.object({
  title: z.string().trim().min(1).max(MARKDOWN_ARTIFACT_TITLE_MAX_LEN),
  content: z.string().trim().min(1).max(MARKDOWN_ARTIFACT_CONTENT_MAX_CHARS),
})

export type MarkdownArtifactInput = z.infer<typeof markdownArtifactInputSchema>

export interface MarkdownArtifactToolResult {
  created: true
}
```

模块函数：

```ts
export function normalizeMarkdownArtifactInput(
  input: MarkdownArtifactInput
): MarkdownArtifactInput

export function isExplicitMarkdownDeliverableRequest(text: string): boolean
```

`normalizeMarkdownArtifactInput` 只 trim 标题/正文并拆除覆盖整份内容的单个外层 `markdown`/`md` fence，不修改内部 fence。`isExplicitMarkdownDeliverableRequest` 只处理高置信强制路由；完整的中英文及等价语义识别仍由双语 tool description + system instruction 完成。

### 1.2 领域模型

修改 `app/thread-chat/core/types.ts`：

```ts
export type ArtifactKind = "code" | "note" | "markdown"

export interface Artifact {
  id: string
  title: string
  kind: ArtifactKind
  lang?: string
  content: string
  sourceThreadId: string
}

export interface Message {
  id: string
  role: Role
  text: string
  forks: Fork[]
  artifactIds?: string[]
  quote?: { text: string }
  status?: MessageStatus
  error?: string
}
```

保留既有通用 `Artifact`，新增 `markdown` discriminator；不把服务端 `toolCallId` 持久化到领域状态。

建议增加两个纯 helper 的签名：

```ts
export function validArtifactsOfMessage(
  state: ThreadTreeState,
  message: Message
): Artifact[]

export function hasRenderableAssistantOutput(
  state: ThreadTreeState,
  message: Message
): boolean
```

所有“是否为空回复”的判断必须复用 `hasRenderableAssistantOutput`，不能继续各自判断 `message.text.trim()`。

### 1.3 AI SDK UI stream 边界

修改 `app/thread-chat/net/ui-stream.ts`：

```ts
export interface ToolInputAvailableChunk {
  type: "tool-input-available"
  toolCallId: string
  toolName: string
  input: unknown
}

export interface MarkdownArtifactStreamEvent {
  toolCallId: string
  toolName: typeof MARKDOWN_ARTIFACT_TOOL_NAME
  input: MarkdownArtifactInput
}

export interface UIStreamHandlers {
  onTextDelta(delta: string): void
  onMarkdownArtifact(event: MarkdownArtifactStreamEvent): void
  onError(message: string): void
  onFinish(): void
}

export function isMarkdownArtifactStreamEvent(
  chunk: unknown
): chunk is MarkdownArtifactStreamEvent
```

消费者在单次 `consumeUIMessageStream` 内维护 `Set<string>`，以 `toolCallId` 去重。未知工具、`tool-input-start/delta`、损坏 input 和重复 complete event 继续忽略。

### 1.4 Store 原子操作

修改 `app/thread-chat/core/store.ts`，对外暴露：

```ts
attachArtifactToMessage(
  threadId: string,
  messageId: string,
  seed: ArtifactSeed,
): string | null
```

内部 helper：

```ts
removeMessageArtifactsSilently(message: Message): void
```

原子操作必须同时完成 registry、`artifactOrder` 与 `message.artifactIds` 写入；目标不存在时零变更。`resetAssistantMessage` 调用清理 helper 后再复位消息，保证 retry 不产生重复/孤儿 Artifact。

### 1.5 Controller 生命周期参数

`chat-controller.ts` 不新增持久化类型，只维护单次响应局部状态：

```ts
interface AssistantOutputProgress {
  receivedTextChars: number
  attachedArtifactCount: number
}
```

`onMarkdownArtifact` 将输入归一化为：

```ts
const seed: ArtifactSeed = {
  kind: "markdown",
  title: input.title,
  content: input.content,
}
```

只有 `attachArtifactToMessage` 返回非 null 时才增加 `attachedArtifactCount`。成功/停止裁决条件为 `receivedTextChars > 0 || attachedArtifactCount > 0`。

### 1.6 模型上下文接口

修改 `app/thread-chat/net/prompt.ts`：

```ts
export function serializeMessageForModel(
  state: ThreadTreeState,
  message: Message
): string | null
```

序列化顺序：用户 quote grounding → 正文 → 该消息关联的 Markdown Artifact。建议格式：

```text
<正文，如有>

[Markdown Artifact: <title>]
<raw markdown content>
[/Markdown Artifact]
```

Artifact-only assistant 消息返回非空字符串，必须进入当前线程和继承上下文；继承字符预算按最终序列化字符串计算。

### 1.7 UI 组件接口

新增共享卡片，例如 `app/thread-chat/orchestration/markdown-artifact-card.tsx`：

```ts
export interface MarkdownArtifactCardProps {
  artifact: Artifact
  sourceDepth: number | null
  onOpen: (artifactId: string) => void
  compact?: boolean
}
```

画布动作扩展：

```ts
export interface CanvasActions extends CanvasChatActions {
  focusThread(threadId: string): void
  openArtifact(artifactId: string): void
  getState(): ThreadTreeState
}
```

`ThreadCanvasProps` 相应增加 `onOpenArtifact(artifactId: string): void`，由壳层统一设置 active id 并打开 drawer。列和画布必须使用同一个卡片组件。

## 2. 服务端工具与中英文语义触发

1. 在 `/api/chat` 为 `threadChat` 模式挂载 `createMarkdownArtifact`，普通模式原有 weather/table 工具保持不变。
2. 工具 description 同时写中文和英文，并明确“语言/句式不限，只要语义是要求一份独立 Markdown 交付物就调用”。
3. description 同时给出反例：解释 Markdown、讨论语法、普通回答用 Markdown 排版不调用。
4. ThreadChat system prompt 加同样的双语规则，并要求 `content` 为原始 Markdown、不得套整份外层 fence、一次回复最多创建一份。
5. 高置信显式请求只在 step 0 通过 `prepareStep` 强制该工具；后续 step 禁用该工具，避免重复调用。

## 3. 流与状态接线

1. `ui-stream` 解析 `tool-input-available`，校验、去重后触发 typed handler。
2. controller 将 Markdown 输入转为 `ArtifactSeed` 并原子绑定当前 assistant 消息。
3. Artifact 成为有效响应输出；finish、abort、瞬时 error 和 empty reply 逻辑按统一输出谓词收敛。
4. retry 清理消息名下旧 Artifact，再复用原 message id 发起新流。

## 4. 消息流与右侧面板

1. 抽取共享 Markdown 卡片，用户可见 label/icon/action 全部改为 Markdown。
2. `ArtifactDrawer` 内 `kind === "markdown"` 复用 `MarkdownBody`；旧 code/note 保持兼容。
3. Artifact-only 消息隐藏空 assistant bubble，但保留 who、卡片、错误和滚动语义。
4. CanvasExpand 渲染同一张卡，`CanvasActions.openArtifact` 打开全局 drawer。
5. 顶栏、empty state、help、canvas count 统一文案，不做内部数据结构的大范围重命名。

## 5. 恢复、标题与上下文

1. sanitize 以正文或有效 Artifact 判断 interrupted message 是否可恢复为 done。
2. 清理坏引用和无消息引用的孤儿 registry/order 项，旧 code/note 快照继续可读。
3. 分支标题使用 Artifact 标题 + 内容摘要作为 Artifact-only answer。
4. `serializeMessageForModel` 同时覆盖当前 thread 与 inherited messages，保证后续修改和子分支 grounding。

## 6. 验证顺序

1. 纯函数：输入 schema、外层 fence 归一化、双语高置信意图正反例、stream chunk guard、序列化和 sanitize。
2. Store：原子绑定、无目标零变更、重复事件不重复、retry 清理、孤儿清理。
3. 组件：Artifact-only 无空气泡、卡片点击、drawer GFM、列/画布一致。
4. 真实模型：中文、英文、混合/改写表达，以及“Markdown 是什么”反例；默认 MiniMax 与其他可选模型分别验证。
5. 持久化：生成 → 保存 → 刷新恢复 → 后续修改 → retry 替换。
6. 最终运行 typecheck、lint、build、OpenSpec strict validation 和既有 ThreadChat e2e 回归。

## 7. Markdown 生成进度增量设计

### 7.1 临时消息类型

```ts
export interface MarkdownGenerationProgress {
  toolCallId: string
  phase: "starting" | "streaming"
  partialTitle?: string
  characterCount: number
  lineCount: number
  headings: string[]
}

export interface Message {
  // ...既有字段
  markdownGeneration?: MarkdownGenerationProgress
}
```

`markdownGeneration` 是当前页面的临时 UI 状态，不是持久化领域数据。`headings` 只保留最近三个 ATX 标题；不在消息中保存局部正文。

### 7.2 工具输入流类型与接口

```ts
export interface ToolInputStartChunk {
  type: "tool-input-start"
  toolCallId: string
  toolName: string
}

export interface ToolInputDeltaChunk {
  type: "tool-input-delta"
  toolCallId: string
  inputTextDelta: string
}

export interface MarkdownArtifactProgressEvent extends MarkdownGenerationProgress {}

export interface UIStreamHandlers {
  onTextDelta(delta: string): void
  onMarkdownArtifactProgress(event: MarkdownArtifactProgressEvent): void
  onMarkdownArtifact(event: MarkdownArtifactStreamEvent): void
  onError(message: string): void
  onFinish(): void
}
```

进度 dispatcher 按 `toolCallId` 维护原始 JSON 缓冲，并串行调用 AI SDK `parsePartialJson`。`tool-input-start` 同步发 `starting`；delta 发 `streaming`；complete 释放缓冲并交给既有完整事件 dispatcher。

### 7.3 Store 与持久化接口

```ts
setMarkdownGenerationProgress(
  threadId: string,
  messageId: string,
  progress: MarkdownGenerationProgress,
): void

withoutTransientGenerationState(
  state: ThreadTreeState,
): ThreadTreeState
```

controller 对 delta 进度复用 rAF/50ms 合帧；start 立即写入以消除感知空窗。`attachArtifactToMessage`、finish、fail 和 reset 都清除进度。`saveTree` 在 JSON 序列化前调用 `withoutTransientGenerationState`。

### 7.4 UI 与服务端终止契约

```ts
export interface MarkdownArtifactProgressCardProps {
  progress: MarkdownGenerationProgress
  sourceDepth: number | null
  compact?: boolean
}
```

进度卡使用非交互 `<div role="status" aria-busy="true">`，不可打开 drawer；列视图和画布共用同一组件。服务端 `stopWhen` 同时包含 `hasToolCall(MARKDOWN_ARTIFACT_TOOL_NAME)` 和既有步数上限，使 Markdown 工具成为本轮终止工具。
