## Context

- 见 `proposal.md` 与 `specs/thread-chat-message-actions/spec.md`。现有 `thread-chat` 不运行在 assistant-ui 的 message runtime 中：消息真相来自自定义 `ThreadTreeState`/`ThreadStore`，生成行为由 `chat-controller.ts` 驱动。因此 assistant-ui 的 `ActionBarPrimitive`、`ComposerPrimitive` 只能作为交互参考，不能直接挂到当前 `.message/.bubble` DOM 上。
- 消息有两套宿主：列模式由 `ChatView` 渲染，画布模式由 `CanvasExpand` 渲染；两者必须保留 `.msg-list[data-list] > .message[data-msg-id] > .bubble[data-role]`，否则划选开分支和锚点定位会失效。
- `branch_trees.state` 是整树 JSON，`branch_generations` 是每次 assistant attempt 的权威 sidecar。树 GET 已先合并 current generation 的终态，但活跃 generation 缺失 assistant、空 pending 没有 generation、末尾孤儿 user 等结构完整性仍由客户端 `sanitizeLoadedState` 局部处理；当前逻辑会删除无输出的空 pending，导致 Retry 入口随之消失。
- 正常发送走“客户端追加 user + assistant 占位 → 严格 PUT → `/api/chat` start transaction”。编辑最后一轮 user 与孤儿恢复比普通发送多一个约束：user 文本、assistant 重置/插入、旧 attempt supersede 和新 generation 建立必须作为同一逻辑命令收口，否则 PUT 与 POST 之间的失败窗口会把“新问题 + 旧答案”重新拼在一起。
- 当前 `startGeneration` 在事务里验证已保存的相邻 user/assistant identity 并建立 generation，但模型上下文仍来自客户端请求中的 `messages`。编辑命令需要服务端以事务提交后的树为准编译上下文，避免请求文本与权威 turn snapshot 不一致。
- 现有 `Thread.messages` 是单一线性数组，子 Thread 只以 `forkFromMsgId` 指向被划选的 assistant。若重新生成时复用该 assistant messageId 并覆盖正文，子 Thread 在结构上仍能找到 ID，却失去它真正引用的文本、锚点和 Artifact；这是一种语义孤儿，不能用“保留 forks 字段”解决。

## Goals / Non-Goals

**Goals:**

- 先定义稳定的领域类型与行为接口，再接 UI；列模式、画布模式和服务端共享同一套状态语义。
- 服务端以 tree + current generation 判定恢复状态，客户端只消费结构化结果并提供操作入口。
- 把 Retry assistant、Retry orphan user、Edit last user + regenerate 统一成可验证、可幂等的 generation start intent。
- 将已提交消息视为不可变节点；编辑/重新生成创建 sibling 节点并切换 active leaf，使旧回复、旧 Artifact 和由其派生的子 Thread 保持可追溯。
- 使新 user/assistant 节点与 generation snapshot 一起成为 current active path 的权威增量，抵抗陈旧整树 PUT。
- 反馈按 generation 持久化；复制、编辑草稿、copied/loading 等纯交互状态不污染持久化树。

**Non-Goals:**

- 不实现任意历史消息的编辑/重新生成、任意深度路径重接、后续消息截断或子 Thread 迁移；本变更只为 active path 最后一轮提供版本切换器。
- 不恢复没有 generation 终态的旧模型原文；孤儿恢复启动的是新付费 attempt。
- 不把 thread-chat 迁移到 assistant-ui runtime，也不替换现有 Markdown、Artifact、联网研究、划选锚点或 MessageScroller。
- 不把 `branch_trees` 全量规范化为 message 表；本变更只为恢复命令增加受控的服务端 turn patch。

## Decisions

### D1：三层职责——服务端事实、共享协调、UI 表现

轮次状态不由 `ChatView` 或 `CanvasExpand` 直接用 `messages.at(-1)?.role` 判定。边界固定为：

```text
branch_trees + current branch_generations
                    │
                    ▼
      reconcileThreadChatTurns（纯函数）
          ├─ 修复/合并 assistant
          ├─ 生成 recoverableTurns
          └─ 汇总 feedbackByGenerationId
                    │
                    ▼
        GET tree 200 response / client boot
                    │
                    ▼
       共享消息组件只按 view model 渲染
```

在 `app/thread-chat/generation/types.ts` 扩展共享类型；这些类型不 import React、DOM、数据库或 fetch：

```ts
export type GenerationFeedback = "positive" | "negative"

export type RecoverableTurnReason =
  | "missing_assistant"
  | "missing_generation"
  | "interrupted_generation"

export interface RecoverableTurn {
  threadId: string
  userMessageId: string
  assistantMessageId?: string
  reason: RecoverableTurnReason
}

export interface GenerationSummary {
  // 既有 identity/status/result 字段保持不变
  feedback?: GenerationFeedback | null
  feedbackUpdatedAt?: string | null
}

export interface ReconciledThreadChatTree {
  state: ThreadTreeState
  recoverableTurns: RecoverableTurn[]
}
```

服务端协调所需的内部输入比公开 `GenerationSummary` 多 `turnSnapshot`：

```ts
export interface GenerationForReconcile extends GenerationSummary {
  turnSnapshot: GenerationTurnSnapshot
}

export function reconcileThreadChatTurns(input: {
  state: ThreadTreeState
  generations: readonly GenerationForReconcile[]
}): ReconciledThreadChatTree
```

纯函数放在 `app/thread-chat/generation/reconcile-turns.ts`，与既有 `merge-result.ts` 同层。执行顺序固定：

1. 只处理 `isCurrent=true` 的 generation，并先收敛 stale lease。
2. terminal 且有 result：调用 generationId CAS 合并器。
3. running/stop_requested 且目标 assistant 缺失：用 `turnSnapshot` 恢复 user/assistant pair；assistant 保持 pending/streaming 并标记 `backgroundGeneration=true`。
4. 空 pending/streaming assistant 没有匹配 active generation：保留 messageId，转成 `status="error"` 和可重试错误，并产生带 `assistantMessageId` 的 recoverable turn。
5. 协调完成后若 Thread 的 active leaf 仍是 user，且没有以该 userMessageId 为目标的 active/terminal generation：产生 `missing_assistant` recoverable turn，不伪造持久化 assistant 消息。
6. 去重键为 `threadId:userMessageId`；同一轮最多一个恢复入口。

树 GET 使用该函数后返回：

```ts
export interface LoadedTreeResponse {
  state: ThreadTreeState | null
  revision: number
  customTitle: string | null
  generations: GenerationSummary[]
  recoverableTurns: RecoverableTurn[]
}
```

GET 只返回协调后的 projection，不为了展示 error 而写数据库；每次 GET 都能由权威输入得到相同结果。客户端保留一个同函数的防御性调用，用于滚动部署期间兼容旧服务端响应，但不得再维护另一套不同判定规则。

弃选：只在 React render 中判断最后一条是 user。它看不到 generation sidecar，会把“assistant 丢失但后台仍在跑”误判成失败，也会在列/画布复制规则。

### D2：同一 Thread 使用不可变消息节点图，跨列 Thread 绑定准确来源节点

本变更不把“回复版本”和“划选分支”混成同一种对象：

```text
ThreadTree（跨列）
└─ Thread main
   └─ MessageGraph（同列版本）
      ├─ user U1
      │  ├─ assistant A  ← child Thread X 的 forkFromMsgId 永久指向 A
      │  └─ assistant B  ← regenerate 后的 active leaf
      └─ user U2          ← edit U1 后的 sibling user
         └─ assistant C
```

扩展 core 类型；字段保持 JSON 可迁移，不引入 React/数据库类型：

```ts
export interface Message {
  id: string
  parentMessageId: string | null
  // 既有 role/text/status/generationId/forks/artifactIds/... 保持不变
}

export interface Thread {
  // messages 从“当前线性列表”改为“该 Thread 的全部消息节点，按创建顺序保存”
  messages: Message[]
  activeLeafMessageId: string | null
  // 既有 parentId/forkFromMsgId/children/... 保持不变
}

export interface Artifact {
  // 既有字段保持不变
  sourceMessageId: string
}

export interface ThreadTreeState {
  schemaVersion: 2
  // 既有 threads/artifacts/... 保持不变
}
```

消息节点的 parent 只在创建时写入，terminal 后不允许修改正文、parent、generationId、forks 或 Artifact ownership；running 节点只允许当前 generation 更新自己的流式字段。新增纯 selectors：

```ts
activeMessagePath(thread: Thread): Message[]
messagePathTo(thread: Thread, messageId: string): Message[]
assistantTurnAlternatives(thread: Thread, assistantMessageId: string): Message[]
isActiveLeafTurn(thread: Thread, messageId: string): boolean
```

- 普通发送：在 `activeLeafMessageId` 后追加 user，再追加其 assistant child，并把 active leaf 指向 assistant。
- 重新生成 assistant A：以 A 的 user parent 为 parent 创建新 assistant B；A/B 是 sibling，active leaf 改为 B。
- 编辑 user U1：以 U1 的 parent 创建 sibling user U2，再创建 assistant C；active leaf 改为 C。U1、A 及其派生关系不变。
- 孤儿 user 重试：原 user 没有 assistant 时直接创建其 assistant child；孤儿 user 编辑仍创建 sibling user，避免对已提交记录做原位覆盖。
- 最新轮次版本切换：把 `activeLeafMessageId` 改到目标 assistant alternative。P0 的 alternative 都是叶子；任意历史节点及带同列后续对话的路径重接不在本变更范围。

`assistantTurnAlternatives` 同时覆盖两种 sibling：同一个 user 下的多个 assistant（纯 regenerate），以及同一个上游 parent 下多个 user edit 分支各自产生的 assistant。UI 因而用一个 `TurnVariantPicker` 切换完整问答版本，而不是分别给 user/assistant 两套容易失配的 picker。

加载旧树时运行一次确定性内存迁移：按旧 `messages[]` 顺序补 `parentMessageId`，把最后一条设为 `activeLeafMessageId`，从每条消息的 `artifactIds` 回填 `Artifact.sourceMessageId`，最后写 `schemaVersion=2`。第一次带 revision 的正常 PUT 写回新结构。迁移函数必须幂等，并拒绝环、重复 parent 或不存在的 active leaf。

`collectInherited` 不再对父 Thread 的数组做 `slice(0, forkIndex + 1)`，而是调用 `messagePathTo(parent, child.forkFromMsgId)`。因此 child Thread X 永远继承到 A 的准确历史，即使父列当前显示 B。`forks[]` 继续挂在 A 上：显示 A 时恢复锚点高亮；显示 B 时不伪造 A 的锚点。

右侧分栏采用“保持工作区、标注非当前来源”的产品规则：

- regeneration 后，已经打开的 child Thread 列不自动关闭、不迁移到 B，也不变成孤儿。
- 当其来源 A 不在父 Thread active path 时，列头显示“基于回复 1/2 · 当前未展示”，并提供“查看来源”；点击后切回 A。
- 未打开的 A 子分支不在 B 正文上显示脚注，但仍可从版本切换器的分支数量提示、子树切换器和画布访问。
- 在 B 上新划选产生的 child Thread 只绑定 B；不得按 quote 文本猜测并迁移 A 的 child。

Artifact 生命周期同样绑定不可变 assistant message：A 产生的 Artifact A 保留 `sourceMessageId=A`，B 产生 Artifact B 绑定 B。默认 drawer/inline selector 展示当前 active paths 上的 Artifact；已打开的旧 Artifact 标签不强制关闭，而是标注“来自回复 1/2 · 历史版本”。切回 A 或打开其 child Thread 时 Artifact A 恢复为当前来源。系统不得因 regenerate 自动删除 Artifact A；显式删除与无引用垃圾回收另开 change。

弃选：复用 A 的 messageId、只把旧正文塞进 generation 历史。这样 child `forkFromMsgId=A` 仍无法表达“引用 A 的哪次 generation”，且现有 `forks`、锚点与 Artifact registry 都会继续错绑。不可变 message node 让 identity 本身就是 provenance。

该形状也与仓库已安装的 assistant-ui 领域模型一致：其 `MessageRepository` 以 parentId 组织 message siblings，`BranchPicker` 切换 sibling branch；本项目不直接接入其 runtime，但复用这条数据建模原则。ChatGPT 的公开 “Branch in new chat” 同样明确以保留原 thread 为产品目标。两者只作为模式验证，thread-chat 的跨列 child Thread 与同列 message variants 仍由本设计自己的类型负责。

### D3：所有生成操作使用显式 start intent

扩展 `/api/chat` 的 thread-chat persistence identity，保持旧客户端未传 intent 时等价于 `persisted-turn`：

```ts
export type ThreadChatStartIntent =
  | { kind: "persisted-turn" }
  | {
      kind: "regenerate-assistant"
      sourceAssistantMessageId: string
    }
  | { kind: "retry-orphan-user" }
  | {
      kind: "edit-last-user"
      sourceUserMessageId: string
      text: string
    }

export interface ThreadChatGenerationRequest
  extends GenerationTurnIdentity {
  anchorText: string | null
  intent?: ThreadChatStartIntent
}
```

`GenerationTurnIdentity.userMessageId/assistantMessageId` 始终表示本次新 generation 的目标 pair：regenerate 的 userMessageId 是 source assistant 的原 user parent、assistantMessageId 是新 sibling；edit 的两个 ID 都是新节点。source ID 只放在 intent，避免同一请求出现两份“新 ID”。

四类行为：

- `persisted-turn`：普通 send 与兼容旧 Retry；沿用“客户端严格 PUT 后验证”。
- `regenerate-assistant`：source 必须是 active path 最后一轮 assistant；服务端以其 user parent 创建请求 identity 中的 `assistantMessageId` sibling，不修改 source。
- `retry-orphan-user`：指定 user 必须是 active leaf，或其后仅有一个由协调层判定为 recoverable 的 assistant；assistant 缺失时使用客户端预生成的 assistantMessageId 插入 child 占位。
- `edit-last-user`：source user 必须属于 active path 最后一轮；服务端用 trim 后非空的新文本创建请求 identity 中的 `userMessageId` sibling，复制 source 的 role/quote 等用户语义字段但不复制 forks，再创建 identity 中的 `assistantMessageId` child。

后三种行为由 `lib/thread-chat-generation/repository.ts` 中新的事务入口统一准备：

```ts
export type PrepareGenerationResult =
  | {
      created: true
      generation: GenerationRow
      state: ThreadTreeState
      turnSnapshot: GenerationTurnSnapshot
    }
  | { created: false; generation: GenerationRow }

export async function prepareGeneration(
  input: StartGenerationInput & { intent: ThreadChatStartIntent }
): Promise<PrepareGenerationResult>
```

事务在 owner-scoped tree row lock 内完成：

1. 迁移/验证 message graph，确认 source 位于 active path 最后一轮，校验新 ID 在全树未使用。
2. retry orphan 复用原 user；edit 创建 sibling user；regenerate 复用 source 的 user parent。
3. 创建全新的空 pending assistant node；除 orphan 已有 recoverable 空占位的兼容路径外，不重置或复用已有 terminal assistant。
4. 将 Thread `activeLeafMessageId` 原子切到新 assistant；旧消息、forks、Artifact registry/order 和 terminal generation 全部保留。
5. 仅当被替换 attempt 仍 active 时标记 superseded 并让 observer abort；已 terminal 的 A 保持原状态和反馈。
6. 将新 generationId 写入新 assistant，更新 `branch_trees.state`。
7. 用事务内最终新 pair 创建 generation/turnSnapshot；事务提交即构成新的服务端持久化屏障。

因此编辑路径不再执行“先独立 PUT 编辑树，再 POST 建 generation”这两个可能分裂的写操作，也不会覆盖 A 来制造隐形孤儿。模型只在事务提交且 `created=true` 后启动；相同 generationId 重放仍返回 202，不重复创建 sibling 或调用模型。

### D4：模型上下文从事务提交后的 active path 编译

将当前 `buildRequestBody` 中“继承上文 + 当前 Thread 消息 + Artifact 序列化”的纯编译部分抽为：

```ts
export function compileThreadChatMessages(input: {
  state: ThreadTreeState
  threadId: string
  excludeAssistantMessageId: string
}): UIMessageLike[]
```

模块建议为 `app/thread-chat/net/message-context.ts`，只依赖 core selectors、message serialization 和常量，可被客户端与 route handler 导入。当前 Thread 使用 `activeMessagePath`；祖先 Thread 使用 `messagePathTo(parent, child.forkFromMsgId)`，不得从祖先当前 active leaf 推断继承内容。

`prepareGeneration(created=true)` 返回事务内最终 state；`/api/chat` 对所有 thread-chat 请求使用该 state 编译 `resolvedMessages`，而不是把客户端 `messages` 当权威上下文。请求中的 `messages` 暂时保留以兼容旧 body 和类型演进，但 thread-chat 模式不再依赖它决定被编辑的最后一问。线性 assistant-ui 聊天仍沿用原 messages 路径。

这保证：服务端保存的编辑文本、generation turnSnapshot、计费对应输入和实际模型上下文是同一份数据。

弃选：只校验 ID、继续相信客户端 messages。客户端可能发送编辑后的 UI 文本但服务端树仍是旧文本，或反之，导致恢复与回答上下文不一致。

### D5：tree revision CAS 保护消息图，generation snapshot 负责结果修复

generation sidecar 已保存 user/assistant pair；编辑现在创建新节点而非覆盖旧 user，因此无需 `userMessageAuthority="edited"`。但另一个标签页的旧整树 PUT 仍可能删掉新 U2/B 或把 active leaf 改回 A。仅靠“最新 generation 强制 active B”也不正确，因为用户可能随后明确切回 A。为 `branch_trees` 增加：

```ts
revision: integer("revision").notNull().default(0)
```

树 GET 返回 `revision`。整树保存改为 `PUT { state, title, baseRevision }`，只在 owner 与 `revision=baseRevision` 时更新并令 revision + 1；不匹配返回 `409 tree_revision_conflict` 和当前 revision，不接受 last-write-wins。generation preparation 在同一 row lock/transaction 内写新节点并 revision + 1。版本切换不走通用整树 PUT，而走 owner-scoped 命令：

```text
PATCH /api/branch-trees/{treeId}/active-leaf
body: { threadId, assistantMessageId, baseRevision }
```

服务端验证目标属于 `assistantTurnAlternatives` 且是 P0 最新轮次叶子，原子更新 `activeLeafMessageId` 并 revision + 1。响应返回新 revision 和协调后的最小 thread patch。`switchTurnVariant` 只在该命令成功后更新客户端 store；409 时 reload 最新树，不乐观覆盖另一标签页的选择。

generation snapshot 仍扩展图关系，作为“节点/结果恢复”而不是“选择权威”：

```ts
export interface GenerationTurnSnapshot {
  // 既有字段保持不变
  userParentMessageId?: string | null
  assistantParentMessageId?: string
  activatesAssistantMessageId?: string
}
```

- `edit-last-user` snapshot 保存新 user 的 parent、新 assistant 的 parent，并声明新 assistant 是事务接受后的 active leaf。
- `regenerate-assistant` snapshot 保存新 assistant 指向原 user，并声明新 assistant 是 active leaf。
- `reconcileThreadChatTurns` 发现 current generation 的节点缺失时，按 snapshot 恢复新节点；若节点存在则只合并 generation-owned 字段，不覆盖 forks。
- generation transaction 提交时把 active leaf 设为新 assistant；此后由 tree revision CAS 保护用户显式版本选择，GET reconciliation 不得根据 generation 时间擅自切换 active leaf。
- 旧 snapshot 没有 graph 字段时按 legacy 相邻索引恢复，并由内存迁移补 parent/head。

新客户端收到 409 后不得把整个本地 state 自动重试覆盖；先 GET 最新 revision，再按领域命令重新应用尚未保存的安全本地变化。P0 对无法自动 rebase 的普通防抖 PUT显示“其他标签页已更新，已重新加载”，以不丢图为优先。旧客户端未携带 `baseRevision` 时只允许写尚未升级为 message graph 的 legacy tree；一旦 state schemaVersion 升级，返回 `428 revision_required`，防止滚动部署中的旧页面降写。

### D6：先定义 headless 行为接口，UI 不直接操作 store/fetch

显式导出 `ChatController` 接口，替代只靠 `ReturnType<typeof createChatController>` 隐式推断公共行为面：

```ts
export type MessageActionFailureCode =
  | "not_found"
  | "not_latest_turn"
  | "generation_conflict"
  | "tree_revision_conflict"
  | "revision_required"
  | "persistence_failed"
  | "unauthorized"
  | "network_error"

export type GenerationActionResult =
  | {
      ok: true
      generationId: string
      userMessageId: string
      assistantMessageId: string
      sourceUserMessageId?: string
      sourceAssistantMessageId?: string
    }
  | {
      ok: false
      code: MessageActionFailureCode
      message: string
    }

export type VariantSwitchResult =
  | {
      ok: true
      threadId: string
      assistantMessageId: string
      revision: number
    }
  | {
      ok: false
      code: MessageActionFailureCode
      message: string
    }

export interface ThreadMessageActionCommands {
  retryAssistant(
    threadId: string,
    assistantMessageId: string
  ): Promise<GenerationActionResult>
  retryUserTurn(
    threadId: string,
    userMessageId: string
  ): Promise<GenerationActionResult>
  editAndRegenerate(
    threadId: string,
    userMessageId: string,
    text: string
  ): Promise<GenerationActionResult>
  switchTurnVariant(
    threadId: string,
    assistantMessageId: string
  ): Promise<VariantSwitchResult>
  submitFeedback(
    generationId: string,
    feedback: GenerationFeedback
  ): Promise<void>
}
```

`ChatController` 组合现有 `send/stop/detachAll` 与 `ThreadMessageActionCommands`。generation action Promise 在服务端接受/重放 attempt 后 resolve，不等待完整模型流结束；流消费仍由 controller 内部持续进行。这样 inline editor 能区分“正在提交命令”和“模型正在生成”。

store 增加原子应用接口，而不是让 controller 连续调用 update user、reset assistant、notify：

```ts
export interface PreparedTurnPatch {
  threadId: string
  addedMessages: readonly Message[]
  nextActiveLeafMessageId: string
  supersededGenerationId?: string
}

prepareRegenerationPatch(
  state: ThreadTreeState,
  input: PrepareRegenerationInput
): PreparedTurnPatch | null

applyPreparedTurn(patch: PreparedTurnPatch): void
```

纯 preparer 与服务端 transaction 使用相同验证和节点创建规则；它只能追加节点和移动 active leaf，不能改写 source 节点或删除 Artifact。客户端在请求等待期间只保存编辑 draft/submitting UI，服务端接受后再把 patch 原子应用到 store 并开始消费流。若请求被拒绝，编辑器保留 draft 和错误，不需要回滚已经持久化的树。

### D7：反馈作为 generation 的一对一可变属性

在 `branch_generations` 增加：

```ts
feedback: "positive" | "negative" | null
feedbackUpdatedAt: Date | null
```

不单建 feedback 表：当前产品只需要每位 generation owner 的最新互斥评价，而 generation 已经唯一绑定 owner，旧 generation 行也天然保留旧答案的评价。若未来要记录多次反馈事件、原因或运营审计，再独立事件表。

API 使用幂等替换语义：

```text
PUT /api/branch-generations/{generationId}/feedback
body: { feedback: "positive" | "negative" }
```

- 未登录 401；不存在或非 owner 统一 404；非法值 400。
- 允许评价 owner 的 terminal generation，即使它刚被新 attempt supersede；这保证“点击时看到的答案”仍能按其 generationId 被准确评价。
- 同值重复 PUT 零语义变化；正负切换覆盖该行值。
- tree GET 和 generation GET summary 都返回 feedback；新 generation 初始为 null。

客户端不把 feedback 写进 `ThreadTreeState.Message`，避免整树旧快照覆盖 server feedback。`ThreadChatDemoInner` 持有由 summaries 初始化的 `feedbackByGenerationId`，提交时乐观更新、失败回滚并 toast；该 map 作为 view state 同时传给列和画布。

### D8：组件边界按“行为共享、正文渲染保留”切分

不直接用 assistant-ui primitives，也不整体替换现有 message DOM。新增组件建议：

```text
app/thread-chat/chat/
├─ message-action-types.ts       # 仅 UI props/view model 类型
├─ use-copy-markdown.ts          # navigator.clipboard adapter + copied timer
├─ message-toolbar.tsx           # 通用 icon button/tooltip/aria/pressed/loading
├─ editable-user-message.tsx     # user bubble ⇄ inline editor + orphan notice
├─ assistant-message-toolbar.tsx # copy/regenerate/positive/negative
└─ turn-variant-picker.tsx       # 最新轮次 sibling 切换、来源分支数与 1/N
```

核心 props 先固定：

```ts
export interface MessageActionViewState {
  recoverableByUserMessageId: ReadonlyMap<string, RecoverableTurn>
  feedbackByGenerationId: ReadonlyMap<string, GenerationFeedback>
  activePathByThreadId: ReadonlyMap<string, readonly string[]>
}

export interface EditableUserMessageProps {
  threadId: string
  message: Message
  editable: boolean
  recovery?: RecoverableTurn
  commands: Pick<
    ThreadMessageActionCommands,
    "retryUserTurn" | "editAndRegenerate"
  >
}

export interface AssistantMessageToolbarProps {
  threadId: string
  message: Message
  regeneratable: boolean
  feedback?: GenerationFeedback
  commands: Pick<
    ThreadMessageActionCommands,
    "retryAssistant" | "submitFeedback"
  >
}

export interface TurnVariantPickerProps {
  threadId: string
  activeAssistantMessageId: string
  alternatives: readonly {
    assistantMessageId: string
    generationId?: string
    derivedThreadCount: number
  }[]
  onSwitch: ThreadMessageActionCommands["switchTurnVariant"]
}
```

边界规则：

- `EditableUserMessage` 拥有 draft、isEditing、isSubmitting、local error；draft 不进 ThreadStore、不持久化。取消只清本地状态。
- `useCopyMarkdown` 只接收原始 string；不读取 DOM、`innerText`、Artifact card 或 error 文案。成功后 copied=true 约 2 秒，失败保持 false 并走 toast/accessible error。
- `AssistantMessageToolbar` 不读取整个 tree 来判断“是否最后一轮”；上层 selector 提供 `regeneratable`。
- `TurnVariantPicker` 只消费 selector 计算好的 ordered alternatives；切换的是完整问答路径。它不自行寻找 sibling，也不修改 message 内容。
- `ChatView` 继续拥有消息列表骨架和 assistant render slots，只把 user 分支替换为共享 `EditableUserMessage`，在 assistant 后置区插共享 toolbar/recovery。
- `CanvasExpand` 继续拥有 mini scroll/composer/AnchoredMarkdown，但复用相同两个消息组件；不得复制 action handler。
- `components/ui/message.tsx` 仅作为 `MessageFooter` 布局参考，不强行改变 `.tc` DOM 契约。

### D9：可用性、loading 与操作状态

状态语义与 assistant-ui/shadcn 参考保持一致，但由自有组件实现：

- user toolbar：桌面 hover/focus-within 显示；触摸设备保持可发现的操作入口。历史 user 显示复制，编辑按钮禁用并用 tooltip 说明“仅支持编辑最后一轮”。
- assistant toolbar：终态消息左下展示；历史 assistant 可复制/反馈，重新生成禁用并说明原因。
- Copy：成功切换 `Copy → Check`，不改变持久化数据。
- Edit submit：按钮进入 submitting，防重复；服务端接受后 editor 关闭，assistant 立即进入 pending/typing；失败则 editor 保留并显示错误。
- Regenerate：命令提交阶段 refresh 图标旋转；generation 建立后由 message pending/streaming 状态接管 loading。
- Variant picker：当最新轮次有多个 alternative 时显示 `‹ 1/2 ›`；旁边显示该版本派生的子 Thread 数。切换后正文、toolbar feedback 与 inline Artifact 一起切换。
- Feedback：两个按钮使用 `aria-pressed`，乐观互斥；请求失败回滚。
- 任何 icon-only button 都有中文 `aria-label`/tooltip；`prefers-reduced-motion` 下关闭旋转和淡入，不隐藏状态文本。
- 打开编辑器本身不 Stop；只有发送编辑命令才是明确 supersede。现有 composer Stop 仍是单独的显式停止入口。

新样式集中在 `app/thread-chat/styles/message-actions.css`，全部以 `.tc` 为根，并在 `thread-chat.css` 中紧跟 `messages.css` 导入、早于 `messages-stream.css`，避免 toolbar 状态覆盖流式/错误条的后置规则。

### D10：列/画布只接同一行为对象与 view state

`ThreadChatDemoInner` 是组装根：

```ts
const messageActions: ThreadMessageActionCommands = chat
const messageActionState: MessageActionViewState = {
  recoverableByUserMessageId,
  feedbackByGenerationId,
}
```

- 列模式经 `BranchableChat → ChatView` 显式传入这两个对象。
- 画布经 `ThreadCanvas` props 传入，再由既有 `CanvasActionsContext` 暴露同一 commands；feedback/recovery map 必须作为 React props/state 参与重渲，不能藏在不会触发 render 的 `getState()` 中。
- selector 统一计算 active path、`isLatestUserTurn`、`isLatestAssistantTurn`、turn alternatives、inactive-source provenance 和 recovery lookup；两种视图不得自行实现图遍历或索引规则。

### D11：错误契约与观测

generation preparation 延用结构化 error body，并补充稳定 code：

```text
invalid_turn          409  identity/相邻关系不成立
not_latest_turn       409  P0 不允许改写历史轮次
generation_conflict   409  current attempt 竞态
tree_revision_conflict 409 整树或 active-leaf 命令基于陈旧 revision
revision_required     428  graph tree 禁止无 baseRevision 的旧客户端降写
persistence_failed    503  事务未提交、模型未调用
```

服务端日志包含 treeId/threadId/userMessageId/assistantMessageId/generationId/intent，但不得记录完整用户文本。监控至少区分：发现 recoverable turn 数、orphan retry 成功/失败、edit regeneration 成功/失败、feedback 写入失败。客户端文案不得把 409/503 统一伪装成“模型失败”。

## Risks / Trade-offs

- **[历史消息 toolbar 看似可操作但改写动作受限]** → 复制和反馈正常可用；编辑/重新生成显式 disabled + tooltip。非破坏性历史分支另开 change，不在 P0 偷做截断。
- **[编辑 transaction 与其他标签页整树 PUT 竞争]** → tree revision CAS 拒绝陈旧覆盖，generation snapshot 只恢复缺失的新节点/结果；旧节点不可变，active leaf 只由已提交命令改变。
- **[tree revision 冲突导致本地防抖修改未保存]** → 禁止自动整树重试；reload 后只重放有明确领域语义的命令，其他本地变化提示用户已重新加载。相比静默破坏整个消息图，这是可观察且可恢复的失败。
- **[保留旧版本使整树 JSON 增长]** → P0 先换取来源正确性与用户数据不丢失；监控每树节点数/JSONB 字节数。消息图规范化、版本归档与显式删除另开容量 change，不在 regenerate 时偷偷 GC。
- **[父列切到 B 后，A 派生列看似悬空]** → 已打开列继续展示并标注“基于历史回复”，提供一键查看来源；连接线只表达当前可见关系，不决定数据是否有效。
- **[Artifact drawer 被历史资产淹没]** → 默认按 active path 过滤，已打开历史 tab 保留并标注来源；不以删除用户产物换取界面简洁。
- **[服务端编译上下文改变客户端/服务端边界]** → 只对 thread-chat 模式启用，线性 assistant-ui 保持原样；抽取现有纯算法并用 golden tests 对比迁移前 body。
- **[客户端提交 edit 时页面刷新]** → generation transaction 一旦提交即可由既有服务端 consumer 完成；未提交则原树不变，刷新后 editor draft 丢失但不会出现半编辑持久化。
- **[反馈和整树状态分离增加一份 UI map]** → 以 generationId 为唯一键，由 tree/generation GET 初始化和刷新；不牺牲服务端权威性换取表面简单。
- **[GET projection 不写 read repair]** → 每次读取都确定性重算，正确性不依赖客户端随后 PUT；重试/编辑成功时 transaction 会自然物化最新 pair。
- **[原孤儿调用可能已产生供应商费用]** → 新 attempt 仍按自身 generation 独立计费；本 change 不猜测无证据旧 usage，补偿策略属于运营/计费 change。

## Migration Plan

1. 先部署向后兼容 migration：给 `branch_generations` 增加 nullable feedback/feedback timestamp，并给 `branch_trees` 增加 default 0 的 revision；message graph 字段位于 JSONB，不需要额外 DDL。
2. 部署幂等 legacy-tree → message-graph 迁移器、active-path selectors 和只读兼容；旧线性树仍能加载，暂不让旧客户端创建 variants。
3. 部署共享 reconcile、树 GET 的 `recoverableTurns`/feedback 字段、feedback PUT，以及支持新 ID start intent 的 generation transaction；旧客户端未传 intent 时继续走 `persisted-turn`。
4. 服务端切换 thread-chat 模型上下文为事务内 active path / exact fork source 编译，并运行正常发送、Retry、Artifact、联网研究、分支继承与计费回归。
5. 部署客户端 view model、controller commands、`TurnVariantPicker`、共享 toolbar/editor 与列/画布接线；此时存量孤儿消息出现恢复入口，regenerate 开始创建不可变 sibling。
6. 观察 recoverable turn、graph migration error、inactive-source column、tree JSONB size、409、503、重复 generation、feedback error 指标；确认稳定后再考虑历史消息分支式编辑。
7. 回滚时先关闭创建 variant 的客户端入口，再回滚客户端；服务端继续兼容 legacy 和 graph state。不得把 graph state 降写成线性数组、删除旧节点、DROP feedback 数据或删除 generation sidecar。

## Open Questions

（无。P0 的可编辑/可重生成范围、不可变消息节点、右侧分栏来源、Artifact 生命周期、孤儿判定权威、服务端原子准备、反馈归属、共享组件边界和滚动部署顺序均已明确。）
