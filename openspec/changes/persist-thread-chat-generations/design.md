## Context

- 见 `proposal.md` 的动机。当前 `app/thread-chat/net/chat-controller.ts` 在浏览器内消费 `/api/chat` 的 UI Message Stream，并直接把 text delta、Artifact、研究活动写进内存 store；服务端不知道 treeId、目标 threadId、assistant messageId 或 attempt。
- `branch_trees.state` 是整棵 `ThreadTreeState` JSON。客户端按 version 变化 1.5 秒防抖 PUT，卸载时 best-effort flush；流式中间态可能被存盘，加载时 `sanitizeLoadedState` 会把 partial 置 done、把空 pending 删除。
- `/api/chat` 已用 `after(result.consumeStream())` 在客户端断连后继续消费模型流，因此正常结束计费通常会发生；但这条服务端消费分支丢弃内容，且浏览器 Stop 也只 abort 本地 fetch，不能停止服务端模型。
- thread-chat 的输出不只有正文：Markdown 工具输入会生成消息所属 Artifact，联网工具会生成活动/来源，路由与研究计划通过自定义 data part 发送。P0 必须持久化这些结构化结果，不能只存 `result.text`。
- AI SDK v7 的 `createUIMessageStream`/`toUIMessageStream` 能在 `onEnd` 提供完整或被中止的 `responseMessage`；`createUIMessageStreamResponse.consumeSseStream` 可独立消费 SSE 副本，使浏览器断连不取消上游。`streamText.onAbort` 不会触发 `streamText.onEnd`，且只提供已完成 steps，因此 Stop 的用量证据要单独处理。
- `/api/chat` 的 `maxDuration` 为 300 秒。P0 不引入 Redis、队列或 durable workflow，不能承诺函数进程被强杀后从原位置恢复模型执行。

## Goals / Non-Goals

**Goals:**

- 每次付费模型调用在开始前都有可验证、可幂等的服务端 generation 身份和已落库的消息目标。
- 浏览器连接与模型执行解耦：刷新/断网不停止，明确 Stop/Retry 才停止或替换。
- 正常完成、明确停止、生成失败都形成服务端可恢复终态，并在刷新后的页面自动出现。
- 侧边 generation 记录成为回复终态的权威来源，避免整树 JSON 的客户端旧快照覆盖最终结果。
- 计费与 generation attempt 一一对应，完成回调重入不重复扣费。

**Non-Goals:**

- 不做 SSE 字节持久化、cursor、sessionStorage reconnect 或 token 级实时续流；这是 P1。
- 不做进程崩溃后的模型执行恢复、工具步骤重放或 exactly-once 外部副作用；这是 P2/durable workflow 范畴。
- 不把整棵 `ThreadTreeState` 规范化为 thread/message 多表，也不改 assistant-ui 线性主页的持久化栈。
- 不承诺供应商未返回的中止中步骤 usage 可以被精确还原；必须显式标记证据不可得，而不是伪造零用量。

## Decisions

### D1：以 generation sidecar 作为终态真相源，不让服务端与浏览器竞争写整树 JSON

新增 `branch_generations` 表，核心字段如下：

- 身份：`id`（客户端生成 UUID，应用 generation id）、`user_id`、`tree_id`、`thread_id`、`user_message_id`、`assistant_message_id`、`attempt`。
- 当前指针：`is_current`；对 `(tree_id, thread_id, assistant_message_id) WHERE is_current` 建部分唯一索引。
- 生命周期：`status` ∈ `running | stop_requested | completed | stopped | failed | superseded`，以及 `created_at/updated_at/heartbeat_at/finished_at/stop_requested_at`。
- 生成上下文：`model_id`、assistant 在 thread 内的位置，以及经服务端从已保存树中验证后的 user message/assistant placeholder 最小 turn snapshot，用于读修复。
- 结果：带 `version` 的 JSONB `result`（generation-owned patch）、错误摘要和 `billing_status`。

`branch_generations.tree_id` 引用 `branch_trees.id`。终态树删除可级联清理；存在 `running/stop_requested` 时 API 先返回 409，不允许删除持久化目标。

不在生成完成时直接 read-modify-write `branch_trees.state`。这样即使客户端随后 PUT 了旧 partial 快照，下一次 GET 仍会以当前 generation sidecar 覆盖它；客户端拿到合并结果后的正常防抖 PUT 可以做 read repair，但不是可靠性的必要条件。

弃选：服务端完成时直接更新整树 JSON。它无法与客户端防抖 PUT 建立共同 revision/CAS，后到的旧浏览器快照仍会把最终答案覆盖掉。

### D2：给分支树补所有者；历史无主树采用受限认领迁移

`branch_trees` 增加 nullable `user_id` 外键作为迁移态，所有 branch-tree API 和 generation API 都先取真实 session：

- 新树第一次 PUT 时写入当前 `user_id`，后续所有操作使用 `(id, user_id)` 条件。
- migration 若检测数据库中恰好只有一个用户，则把全部历史无主树回填给该用户。
- 多用户环境无法可靠推断旧数据归属；无主树不进入任何人的列表。用户通过原精确 tree URL 打开时，GET 在事务里以 `WHERE id=? AND user_id IS NULL` 原子认领，随后只对认领者可见。
- 对已归属他人的 tree/generation 统一返回 404，避免存在性泄露。

这是把原先“知道 UUID 即可访问”的遗留数据收口到真实用户身份。弃选继续把 URL 当凭据：generation 最终结果与账单均包含用户敏感数据，不能把不可猜测 ID 当授权。

### D3：发送前设置严格持久化屏障，generation 建立成功后才调用模型

发送顺序改为：

1. 客户端生成 `generationId`，追加 user message 与带该 id 的 assistant pending placeholder，保持现有乐观 UI。
2. 通过现有 per-tree 写链执行一个“失败会抛出”的立即 PUT，等待完整树快照成功落库；普通防抖 `saveTree` 仍可保留 best-effort 行为。
3. `POST /api/chat` 的 `threadChat` 增加 `{ treeId, threadId, userMessageId, assistantMessageId, generationId }`。
4. 服务端事务锁定对应 tree 行，验证 owner、thread、相邻 user/assistant 消息和 placeholder 上的 generationId，锁定该 assistant slot，建立 `branch_generations` 当前 attempt；只有事务提交后才构造 `streamText`。

同一 generation id 重放时返回已有状态而不再次调用模型。为同一 assistant message 开新 attempt 时，事务先把旧 current 改为 `is_current=false/status=superseded`，再插入新 current；树行锁与部分唯一索引共同防止并发双 current。

如果屏障失败，客户端把 placeholder 置为“保存失败，未开始生成”的可重试错误。不能退回旧的“先花钱、以后尽力存”顺序。

### D4：服务端消费完整 UI Message Stream；请求连接的 signal 不进入模型

服务端使用一个带稳定 assistant message id 的顶层 `createUIMessageStream({ originalMessages, generateId, onEnd })` 合并研究前置信息与 `streamText` 输出，并通过：

```text
createUIMessageStreamResponse
  ├─ client SSE branch  → 浏览器；断开只取消这一支
  └─ consumeSseStream   → after(consumeStream)；服务端持续消费到终态
```

模型的 `abortSignal` 只接服务端拥有的 `AbortController`，绝不接 `req.signal`。顶层 UI stream 的 `onEnd` 因服务端消费分支仍在而能拿到完整 `responseMessage`；明确 Stop 产生 abort part 时，`onEnd.isAborted` 能拿到停止前的 partial message。

现有单独的 `after(result.consumeStream())` 被这一条完整 UI stream 消费替代，避免“计费流消费完了、可持久化 UI 流却随客户端取消”的双轨问题。

### D5：用版本化 generation-owned patch 投影结构化结果

新增服务端/客户端共享的纯投影与合并层，`GenerationResultV1` 只拥有以下字段：

- `text/status/error/generationId`
- `artifactIds` 与完整 Artifact 数据
- `webResearch/webResearchTextOffset`
- `researchRoute/researchPlan`
- 可用的 usage metadata

投影器从最终 AI SDK `responseMessage.parts` 提取正文、Markdown 工具输入和联网工具结果；`researchRoute/researchPlan` 也可直接取服务端已知编排结果。Artifact id 使用 generation id + toolCallId 派生的确定性 ID，同一结果重复合并不会创建重复 Artifact。

合并器只覆盖 generation-owned 字段，保留目标消息现有的 `forks` 及后续用户关系。如果目标 message 被旧快照删掉，则利用服务端验证并保存的 turn snapshot 和位置做读修复。合并旧 Artifact 时先删除该目标消息原先引用、但不属于其他消息的 generation Artifact，再绑定确定性新集合。

弃选只持久化纯文本：会丢 Markdown Artifact、来源与研究计划，恢复后的消息与用户生成时看到的不等价。

### D6：加载时 reconcile，运行中只轮询终态而不恢复 token 流

`GET /api/branch-trees/{treeId}` 返回：

- 已用当前 terminal generation patch 合并后的 `state`；
- `generations` 摘要（只包含当前用户、当前 attempt，含 id/message/thread/status/updatedAt）。

加载顺序改成“服务端/客户端 reconcile generation → generation-aware sanitize → 创建 store”。`sanitizeLoadedState` 只保留能被当前 `running/stop_requested` generation 证明仍活跃的 pending/streaming 消息；没有有效 generation 的旧僵尸仍按原规则收敛。

页面对每个运行中的 generation 调用 `GET /api/branch-generations/{id}`：前台约每 2 秒轮询，页面隐藏时降频。终态响应携带 patch，客户端以 generation id CAS 到对应 message；若已经不是 current，则丢弃。终态落入 store 后触发现有整树存盘，随后停止轮询。

这不是实时续流：刷新后可以继续展示刷新前已保存的 partial，但直到终态才整体替换为完整结果。该限制在 UI 文案中表现为“正在后台生成，完成后显示”。

### D7：Stop/Retry 使用服务端状态机与跨实例取消观察器

状态转换：

```text
running ──自然完成──▶ completed
   │
   ├─显式 Stop──────▶ stop_requested ──模型 abort/收尾──▶ stopped
   ├─生成错误────────────────────────────────────────▶ failed
   └─Retry 建新 attempt──────────────────────────────▶ superseded
```

`POST /api/branch-generations/{id}/stop` 以 `running → stop_requested` CAS；若已 terminal，返回当前终态且不反向改写。客户端只有收到服务端确认后才 abort 自己的 fetch。

原始生成 Function 内维护 generationId → AbortController 的 best-effort 全局 registry，以便 Stop 恰好落到同实例时即时响应；可靠路径由 DB 状态承担：每个运行中的生成在 `after` 生命周期内以约 1 秒间隔检查自身 generation 状态，看到 `stop_requested/superseded` 即 abort 模型 signal。轮询同时每约 10 秒更新 heartbeat。

Retry 是明确替换：创建新 current attempt 的事务把旧 attempt 标为 superseded；旧 Function 的观察器随后 abort。旧 attempt 的结果与账单保留审计，但所有读合并都因 `is_current=false` 忽略它。

停止后的 Message 终态沿用现有 UI 语义：已有正文/Artifact 则保留并置 `done`，完全无输出则置 `error`（“已停止生成”）；generation 自身始终是 `stopped`。

### D8：最终结果与计费以应用 generation id 幂等收口

`usage_records` 增加 nullable `app_generation_id`，建立唯一索引（普通线性聊天继续为 null）。把现有计费核心拆成可在外层 transaction 使用的 `chargeUsageOnce(tx, appGenerationId, ...)`：先幂等插入 usage，再在确实插入成功时扣余额。

`streamText.onEnd` 不再直接做最终副作用，而是把 usage、provider metadata、steps 和成本证据写入本次请求闭包；顶层 UI stream `onEnd` 在拿到结构化 responseMessage 后调用单一 `finalizeGeneration` transaction：

1. 锁定 generation 行并按状态机决定 completed/stopped/failed/superseded；
2. 保存 `GenerationResultV1`；
3. 对正常完成的计费模型执行 `chargeUsageOnce`；
4. 保存 billing status 与 finishedAt。

事务或回调重入时，generation 终态 CAS 与 usage 唯一键共同保证最多扣一次。`after` 消费会等待该回调完成，并对可重试数据库错误做小次数有界重试。

明确 Stop 时，`streamText.onAbort` 只能提供已完成 steps；这些已确认 usage 可以入账。当前被中止 step 若供应商没有返回最终 usage，则记录 `billing_status=usage_unavailable`（有 gateway generation id 时留待既有成本对账扩展处理），不得写一条“0 token 且已成功结算”的假账。P0 接受直连 provider 的这部分成本可能无法精确追溯。

### D9：以 heartbeat/lease 收敛进程硬失败，不伪装成可恢复执行

运行 Function 每约 10 秒更新 `heartbeat_at`。generation 查询/树加载发现 `running/stop_requested` 且 heartbeat 超过 `maxDuration + 宽限期` 后，使用 CAS 标记 failed，并返回“后台生成中断，请重试”。这保证 UI 不永久转圈。

它不是执行恢复：进程被杀时，P0 可能只有浏览器最后一次 partial 快照，没有服务端最终 patch。真正从断点继续模型/工具执行需要 P2 durable workflow 或 checkpoint/outbox。

### D10：API 与客户端边界

- `POST /api/chat`：线性 assistant-ui 请求保持现状；thread-chat 模式强制携带 persistence identity。
- `GET /api/branch-trees/{treeId}`：返回合并 state、customTitle、当前 generation 摘要，并执行 owner 校验/遗留认领。
- `GET /api/branch-generations/{generationId}`：返回 owner-scoped 状态；terminal 时返回 patch。
- `POST /api/branch-generations/{generationId}/stop`：显式停止，幂等。
- `DELETE /api/branch-trees/{treeId}`：有运行 generation 时 409。

客户端 chat controller 接收 treeId 与严格存盘函数；`abortAll()` 更名/改义为只 detach 本地消费者，不调用 Stop API。Stop 按钮走服务端 endpoint；Retry 走“supersede/stop 旧 attempt → reset 同一 message → 新 generationId → 持久化屏障 → 新请求”。

## Risks / Trade-offs

- **[Postgres 轮询放大]** → 只对当前运行 generation 轮询；客户端前台约 2 秒、后台降频，服务端取消观察约 1 秒且 10 秒才写 heartbeat。P1 引入 Redis/pub-sub 后可去掉高频 DB 取消轮询。
- **[整树旧快照仍会覆盖物化 state]** → generation sidecar 永远先于 `branch_trees.state` 参与读取合并；最终正确性不依赖整树最后一次写入顺序。
- **[顶层流 tee 的慢客户端缓冲]** → 输出已有 `MAX_OUTPUT_TOKENS` 上限，P0 接受单请求有界缓冲；P1 的 Redis replay store 会把客户端速度与 producer 更彻底解耦。
- **[最终 DB transaction 失败]** → `after` 中有界重试；持续 DB 故障时 generation 最终会因 lease 过期显示 failed。P0 不具备跨进程 outbox，强 exactly-once 完成提交留给 P2。
- **[Stop 的当前 step usage 不完整]** → 已完成 steps 幂等计费，未知部分显式标 `usage_unavailable`，有网关证据时对账；不以 0 冒充精确值。
- **[历史无主树归属不可推断]** → 单用户库自动回填；多用户库只允许持有原精确 URL 的用户先到先认领，并提供部署前人工 SQL 映射说明。
- **[Artifact ID 从 `aN` 变为确定性 ID]** → 类型和渲染层只把 id 当 opaque string；合并时清理旧引用，避免重复卡片。实现测试必须覆盖同一 patch 重放。
- **[300 秒硬上限]** → heartbeat 只负责显式失败，不承诺续跑。预计超过上限的深度研究必须进入 P2，而不是偷偷扩大 P0 承诺。

## Migration Plan

1. 先应用向后兼容的 DB migration：`branch_trees.user_id` nullable、`branch_generations`、`usage_records.app_generation_id` 及索引；单用户环境自动回填 owner。保留旧列和旧 API 数据。
2. 部署服务端 owner 校验、generation repository、流独立消费/投影/终态查询与 Stop API；thread-chat 请求缺 persistence identity 时返回明确的客户端需刷新错误，线性聊天不受影响。
3. 部署客户端持久化屏障、generation identity、加载 reconcile/轮询和新 Stop/Retry 语义。
4. 观察 generation 终态、stale/usage_unavailable 比例与重复扣费约束；确认稳定后再启动 P1 resumable stream change。
5. 回滚优先回滚客户端与路由逻辑但保留新增表/列，避免丢失已保存 generation；不得在紧急回滚中 DROP 数据。恢复上线后可继续读取这些 sidecar 记录。

## Open Questions

（无。P0 关键语义、数据所有权、终态合并、Stop 与计费边界均已在本设计定案；Redis provider、实时续流协议与 durable workflow 属后续独立 change。）
