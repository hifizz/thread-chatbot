# 消息身份、生成执行与反馈归属决策

## 文档状态

- 状态：已接受（Accepted）
- 日期：2026-08-19
- 适用变更：`add-thread-chat-message-actions`
- 取代：原 Design D7“反馈作为 generation 的一对一可变属性”及所有 `feedbackByGenerationId` 方案
- 实施状态：已实现；数据库 migration、严格协议、message feedback API、共享 UI 状态与回归测试均已按本文调整

## 1. 我们要回答的问题

这次讨论最初暴露出一个不合理行为：一条已经完成并落库的 assistant 消息，因为前端拿不到 `generationId`，点赞和点踩会提示“该回复没有可评价的 generation”。

需要回答四个问题：

1. 为什么系统需要 `generationId`？
2. `messageId` 和 `generationId` 分别代表什么？
3. 点赞、点踩应该绑定 message 还是 generation？
4. 在仍处于内测、允许清空 thread-chat 数据的前提下，是否还需要兼容旧消息结构？

## 2. 先区分两个领域对象

### 2.1 Message 是产品对象

`Message` 表示用户在聊天界面中看到的一条消息。

```ts
type MessageId = string

interface Message {
  id: MessageId
  role: "user" | "assistant"
  status: "pending" | "streaming" | "done" | "error"
  text: string
}
```

以下产品行为都以 `messageId` 为目标：

- 复制 Markdown；
- 编辑消息；
- 重新生成某条回复；
- 点赞、点踩；
- 建立消息父子关系和版本分支；
- Artifact、引用和子 Thread 的来源追踪。

### 2.2 Generation 是执行对象

`Generation` 表示服务端执行的一次模型任务。`generationId` 更接近 `executionId`、`jobId` 或 OpenAI API 中的 `responseId`，并不是消息 ID 的另一种叫法。

```ts
type GenerationId = string

interface Generation {
  id: GenerationId
  assistantMessageId: MessageId
  status: "running" | "stop_requested" | "completed" | "stopped" | "failed"
  modelId: string
  usage?: Usage
  billingStatus: BillingStatus
}
```

它解决的是执行生命周期问题：

- 浏览器刷新或 SSE 断开后，服务端任务继续运行；
- 查询、轮询和恢复某次后台执行；
- 精确停止某次执行；
- 请求重放时保持幂等，避免重复调用模型和重复扣费；
- 记录模型、token、usage 和计费状态；
- regeneration 或并发请求发生时，防止旧执行的晚到结果覆盖新消息；
- 对一次执行进行日志、trace 和模型质量分析。

## 3. 两者的关系

领域关系是 generation 指向它产生的 assistant message：

```text
Generation G1 ── assistantMessageId ──> Assistant Message M1
```

在当前不可变消息 DAG 方案中，重新生成会创建新的 sibling message，也会启动新的 generation：

```text
User U1
  ├─ Generation G1 → Assistant M1
  └─ Generation G2 → Assistant M2   (当前选择)
```

因此 regeneration 不覆盖 M1，也不会让从 M1 派生的子 Thread 和 Artifact 失去来源。

从概念上说，一个 message 和一次 execution 仍然是不同对象。即使当前正常路径通常是 1:1，也不应合并语义：供应商重试、fallback、幂等重放或未来的 attempt 模型都可能让一次产品结果背后出现多个执行记录。

## 4. 为什么最初会把反馈绑定 generation

原方案把 `feedback` 字段直接放进 `branch_generations`，理由是：每次重新生成都有独立 generation，把反馈放在那里可以准确评价用户当时看到的某次模型输出。

这个思路适用于模型可观测性和评测系统，但不适合作为 thread-chat 的产品反馈主模型。它造成了错误耦合：

- UI 必须持有 `generationId` 才能评价已完成消息；
- 历史或异常恢复出来的消息即使有稳定 `messageId`，也可能无法反馈；
- “没有 generation”被错误解释为“没有可评价的消息”；
- toolbar 的可用性被执行层数据泄漏控制；
- API 表达的是“评价一次执行”，而不是用户真正做的“评价这条回复”。

这正是“该回复没有可评价的 generation”文案出现的根因。

## 5. 业界公开方案

### 5.1 OpenAI：Response 与 Output Message 分离

OpenAI Responses API 使用独立的 Response ID 标识模型执行，同时输出消息有自己的 Message ID。

在 Background mode 中，开发者使用 `response.id`：

- 轮询 `queued` / `in_progress` / terminal 状态；
- 取消后台 response；
- SSE 断开后结合事件 `sequence_number` 恢复流。

这说明执行身份和输出消息身份可以、也通常应该分开。这里的 `Response.id` 对应我们的 `generationId`，输出 Message ID 对应我们的 `messageId`。

资料：

- [OpenAI Background mode](https://developers.openai.com/api/docs/guides/background)
- [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses)

### 5.2 Vercel AI SDK：持久化围绕稳定 Message ID

AI SDK 的聊天持久化指南要求每条消息具有稳定 ID：用户消息在发送前获得 ID，assistant 消息由服务端创建稳定 ID，并在流结束时保存完整消息。它没有要求消息 toolbar 先获得某个 generation ID 才能操作消息。

资料：[AI SDK Chatbot Message Persistence](https://ai-sdk.dev/docs/ai-sdk-ui/chatbot-message-persistence)

### 5.3 assistant-ui：反馈是 Message Runtime 的行为

当前项目安装的 `@assistant-ui/core@0.2.20` 中：

- `MessageRuntime.submitFeedback()` 从当前 `MessageState.id` 取得 `messageId`；
- thread runtime 使用 `messageId` 找到消息；
- `FeedbackAdapter.submit()` 接收完整 `ThreadMessage` 和 `positive | negative`；
- 已提交反馈保存在 assistant message 的 `metadata.submittedFeedback` 视图状态中。

本地实现证据：

- `node_modules/@assistant-ui/core/src/runtime/api/message-runtime.ts`
- `node_modules/@assistant-ui/core/src/runtime/base/base-thread-runtime-core.ts`
- `node_modules/@assistant-ui/core/src/adapters/feedback.ts`

因此 assistant-ui 的公开抽象也是“评价消息”，不是“评价 generation”。

### 5.4 LangSmith：Run 反馈属于可观测性和模型评测

LangSmith 把反馈绑定到 trace/run，并允许评价某个 child run，例如 retrieval 或 generation step。这是合理的，因为 LangSmith 解决的是执行观测与评测，而不是聊天产品中的消息 toolbar。

资料：

- [LangSmith Log user feedback](https://docs.langchain.com/langsmith/attach-user-feedback)
- [LangSmith Observability concepts](https://docs.langchain.com/langsmith/observability-concepts)

这两类反馈不冲突，但必须分层：

```text
产品反馈：用户是否喜欢这条可见消息           → messageId
执行评测：某次模型调用或 RAG step 表现如何   → runId / generationId
```

ChatGPT 和 Claude 网页端的内部数据库模型没有公开资料，本文不根据界面行为臆测其具体表结构。

## 6. 考虑过的方案

### 方案 A：继续让反馈绑定 generationId

拒绝。

它更适合 trace/evaluation，无法正确表达产品层“评价一条消息”，并使已完成消息的 toolbar 错误依赖执行层身份。

### 方案 B：删除 generation，将 messageId 同时作为执行 ID

拒绝，至少当前不采用。

在严格 1:1 的极简系统中可以这样做，但 thread-chat 已经需要后台继续生成、停止、幂等、计费、heartbeat、刷新恢复和并发结果防护。合并 ID 会让产品对象承担执行生命周期语义，并使 attempt/fallback 难以扩展。

### 方案 C：保留双身份，产品行为绑定 messageId

接受。

`generationId` 仅负责执行生命周期，`messageId` 负责用户可见对象及其交互。需要分析反馈对应的执行时，服务端通过 `Generation.assistantMessageId` 关联，不要求浏览器提供 generation ID。

## 7. 最终决策

### 7.1 身份职责

- `messageId` 是消息的唯一产品身份。
- `generationId` 是一次后台模型执行的唯一身份。
- generation 必须通过 `assistantMessageId` 指向它产生的消息。
- 已完成消息的 UI 不依赖或暴露 `generationId`。
- stop、poll、resume、billing 和 execution telemetry 可以继续使用 `generationId`；API 也可以接收 `messageId` 后由服务端反查 current generation。

### 7.2 反馈归属

- 点赞、点踩只绑定 `messageId`，与 generation 无直接关系。
- feedback API 的资源路径或请求参数使用 `messageId`。
- feedback 持久化使用独立的 message feedback 记录，不存入 `branch_generations`，也不写入整树 JSON 快照。
- 若需要模型评测或运营分析，通过 `messageId -> generation.assistantMessageId` 关联执行数据。
- 重新生成得到新 message，新 message 不继承旧 message 的反馈。

概念接口：

```ts
type MessageFeedback = "positive" | "negative"

interface MessageFeedbackRecord {
  userId: string
  treeId: string
  threadId: string
  messageId: string
  feedback: MessageFeedback
  createdAt: string
  updatedAt: string
}

interface MessageActionCommands {
  submitFeedback(
    threadId: string,
    messageId: string,
    feedback: MessageFeedback | null
  ): Promise<void>
}
```

### 7.3 消息完成状态与 toolbar

- `pending` / `streaming` / 未完成 / `error` assistant 不显示或不启用复制、点赞、点踩。
- 失败消息保留独立的 Retry 入口；Retry 不是 feedback toolbar 的一部分。
- `done` assistant 必须有稳定 `messageId`，可直接复制、点赞、点踩。
- 系统生成并标记为 `done` 的 assistant message，服务端必须存在能通过 `assistantMessageId` 关联到它的 generation 记录。
- “前端没有 generationId”不得成为禁用已完成消息反馈的理由。

注意：最后一条约束要求服务端存在关联记录，但不要求把 `generationId` 冗余写进消息 JSON。需要时可以由服务端反查。

### 7.4 内测阶段不保留历史兼容

当前仍处于内测，允许清空 thread-chat 会话数据。因此实施本决策时：

- 不迁移旧线性树或缺少严格身份的历史消息；
- 不保留 generation-scoped feedback API 的兼容层；
- 不接受缺少当前 schema version/revision 的旧客户端写入；
- 清空 thread-chat tree、generation 和 message feedback 数据后从严格新模型开始；
- 不清理账号、积分、支付、附件等不属于本次会话模型的业务数据。

## 8. 必须保持的系统不变量

```text
I1. 每条可交互消息都有稳定且唯一的 messageId。

I2. 每次模型执行都有稳定且唯一的 generationId。

I3. 每条系统生成且已完成的 assistant message，
    都能在服务端找到关联它的 generation 记录。

I4. generation 的结果只能合并到其 assistantMessageId 指向的消息，
    不能覆盖 sibling message 或另一条 regeneration 结果。

I5. 产品点赞/点踩只以 messageId 为写入目标。

I6. generation 缺失或执行未完成时，不伪装成可正常评价的完成消息。

I7. message feedback 与整树 JSON 分离，避免旧快照覆盖反馈。
```

## 9. 实施结果

1. `drizzle/0003_strong_bulldozer.sql` 新增 `branch_message_feedback`，并从 `branch_generations` 移除 feedback 字段。
2. feedback API 改为 owner-scoped 的 `/api/branch-trees/{treeId}/messages/{messageId}/feedback`；写入前验证 strict-v2 tree、assistant `done` 状态及 completed generation 关联。
3. 客户端统一使用 `feedbackByMessageId`；列模式与画布模式的 toolbar 都直接提交 `message.id`。
4. pending、streaming、error assistant 不渲染 copy/like/dislike toolbar；部分输出失去 active generation 时保留内容并转为可重试 error。
5. 树 GET 验证所有系统生成的 `done` assistant 均存在 completed generation 关联；generation summary 不再承载产品反馈。
6. parser 只接受 strict schema-v2 图，generation start intent 与 tree revision 均为必填；旧 feedback route 和旧迁移/降级路径已移除。
7. 开发库已应用 migration，并只删除 `branch_trees`（级联 generation/message feedback）；账号、积分、支付和附件计数在清理前后保持一致。

## 10. 一句话总结

> 用户评价的是消息，系统管理的是执行：`messageId` 属于产品交互，`generationId` 属于后台任务；两者关联，但不能混为同一个权限或可用性条件。
