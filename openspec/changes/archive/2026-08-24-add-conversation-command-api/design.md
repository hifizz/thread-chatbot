## Context

规范持久化和 Generation 生命周期已经定义“什么是真实实体”和“执行如何收敛”，但它们不能直接暴露给组件或路由。当前客户端仍倾向于先修改整棵树、PUT 存盘，再发起模型请求；Fork、重试和变体选择也可能在不同模块各自实现事务语义。

本设计建立一个传输无关的应用层，并提供首个 HTTP/JSON 适配器。网页、未来 CLI、MCP 和公开 API 可以改变传输方式，但不能绕过同一命令、授权和仓储事务。

## Goals / Non-Goals

**目标：**

- 为 Conversation/Thread 生命周期、Fork、发送、编辑、重新生成、变体选择和 Generation Stop 建立单一命令入口。
- 让认证、授权、幂等、版本冲突、事务和事件箱具有统一语义。
- 返回规范快照和实体增量，支持后续客户端 normalized Store。
- 给未来 CLI/MCP 留下稳定应用端口，而不是让它们依赖 Next.js 路由或数据库。

**非目标：**

- 在本 change 迁移现有客户端、删除旧 API 或开启生产规范权威。
- 实现分享 token、公开访问、Project Memory/File/Instruction 接口。
- 实现 Issue #39 的 Thread 结论发布、跨 Thread 合并或收敛。
- 规定 UI 布局、轮询视觉或乐观动画。

## Decisions

### D1. 应用层使用显式 Command/Query 端口

应用层按用例导出命令与查询，而不是通用 CRUD 仓储：

```text
Queries
  listConversations
  getConversationSnapshot
  getGeneration

Commands
  createConversation / renameConversation
  archiveConversation / restoreConversation / deleteConversation
  renameThread / archiveThread / restoreThread
  forkThread
  sendTurn
  editTurnInput
  regenerateTurn
  selectTurnVariant
  stopGeneration
```

每个 handler 依赖 `UnitOfWork`、规范仓储、授权策略、时钟、ID、事件箱和 Generation 端口。它们不导入 Next.js Request/Response，也不返回 HTTP 状态。

备选方案是暴露通用 `updateEntity`；它会允许调用方组合非法关系并把不变量分散回传输层，因此拒绝。

### D2. 写命令使用统一内部 envelope

内部命令输入包含：

```text
commandId
actor
scope
targetId
idempotencyKey
expectedRevision
payload
```

幂等记录保存 actor、作用域、命令类型、规范化载荷摘要和序列化结果引用。相同摘要重放原结果，不同摘要返回 `idempotency_conflict`。

HTTP 适配器优先把 `Idempotency-Key` 映射到幂等键，把 `If-Match`/ETag 映射到预期 revision；JSON 只承载领域载荷。内部 envelope 不强迫未来 MCP 使用 HTTP header。

### D3. revision 按最小冲突边界选择

```text
Conversation revision：结构、标题、生命周期、ThreadFork 集合
Thread revision：       Thread 生命周期、标题、Turn 追加顺序
Turn revision：         当前用户/助手变体选择
Generation version：    执行状态、租约与 checkpoint
```

`forkThread` 比较并推进 Conversation revision；发送比较并推进 Thread revision；选择变体比较并推进 Turn revision。事务同时更新多个边界时全部条件必须成功。

备选方案是所有命令锁整条 Conversation；实现简单但会让两个独立 Thread 的发送互相冲突，因此拒绝。完全没有 revision 则会把最后写入者胜出当成正确性，因此也拒绝。

### D4. Fork 保存来源边界，不复制上游 Message

`forkThread` 事务执行：

1. 授权并锁定目标 Conversation revision；
2. 验证来源 Message 属于上游 Thread 且在其当前可用路径中；
3. 创建下游 Thread；
4. 创建唯一 ThreadFork，记录 `sourceMessageId` 与可选 TextAnchor；
5. 将下游提示词上下文边界定义为“沿来源链截至该 Message”的读取投影；
6. 推进 Conversation revision并写入 `ThreadForked` 事件箱事件。

不复制上游 Turn/Message；否则同一历史会有多个身份，反馈、分享和后续修改无法判定引用对象。读取模型负责把继承上下文与下游本地 Turns 投影成一列可理解内容。

### D5. 发送命令创建完整执行意图

`sendTurn` 在事务中创建 Turn、用户 Message、pending 助手 Message、规范 Generation 和 `GenerationRequested` 事件。提交后调度执行器；执行器启动失败由 Generation 生命周期收敛，不回滚已经可查询的意图。

`regenerateTurn` 为同 Turn 创建新的助手 Message/Generation。`editTurnInput` 为当前末尾 Turn 创建用户变体和对应助手变体；若目标 Turn 后面已有内容，返回 `fork_required`，避免静默改变历史含义。

### D6. 读取快照与写入 delta 使用统一传输版本

HTTP 成功响应使用稳定 envelope：

```json
{
  "schemaVersion": 1,
  "data": {},
  "revisions": {},
  "delta": {
    "upsert": {},
    "remove": {},
    "invalidate": []
  }
}
```

首次 `ConversationSnapshot` 可以包含全部规范实体与明确的派生投影；命令只返回受影响实体、移除 tombstone 和需要重取的投影键。响应中的 JSON schema 通过共享传输契约解析，但领域实体不直接依赖该 schema。

### D7. HTTP 资源路径服务于稳定身份

首个适配器采用资源和领域动作组合：

```text
GET/POST   /api/projects/{projectId}/conversations
GET/PATCH/DELETE /api/conversations/{conversationId}
POST       /api/conversations/{conversationId}/restore
PATCH      /api/threads/{threadId}
POST       /api/threads/{threadId}/restore
POST       /api/threads/{threadId}/forks
POST       /api/threads/{threadId}/turns
POST       /api/turns/{turnId}/input-edits
POST       /api/turns/{turnId}/regenerations
POST       /api/turns/{turnId}/active-variant
GET        /api/generations/{generationId}
POST       /api/generations/{generationId}/stop
```

PATCH 只接受明确允许的标题/生命周期字段，不是任意数据库 patch。具体文件可以按 Next.js 当前版本约定组织，但路由只调用应用端口。

### D8. 统一授权且不信任归属载荷

认证适配器产生 actor；应用授权策略从规范包含关系解析 Workspace/Project/Conversation/Thread/Message/Generation。请求载荷不得决定 owner 或成员身份。不可见资源和不存在资源统一返回 `not_found`，避免 ID 枚举。

未来分享 token 会引入另一种 actor 与权限范围，但必须复用同一策略端口；本 change 不提前实现它。

### D9. 错误为应用结果，不是散落异常文本

应用层稳定分类与 HTTP 映射为：

```text
invalid_request          -> 400
unauthenticated          -> 401
forbidden                -> 403（仅资源存在性已对 actor 可见时）
not_found                -> 404
version_conflict         -> 409
idempotency_conflict     -> 409
state_conflict           -> 409
semantic_validation      -> 422
rate_limited             -> 429
internal                 -> 500
```

Stop 已终结 Generation 是幂等成功，不是 `state_conflict`。每个错误携带稳定 `code`、`requestId` 和安全 details；日志可以保存内部 cause，但响应不泄漏数据库或模型错误。

### D10. 事务事件箱位于同一提交边界

会触发执行、标题生成、审计或未来订阅的命令，在规范实体事务内追加 outbox 事件。事件至少包含事件 ID、聚合 ID、聚合 revision、类型、schemaVersion、actor 和发生时间。消费者以事件 ID 幂等；事件不是新的写入权威。

### D11. 新 API 默认不承载现有客户端

路由可以在隔离测试或显式配置下启用，但旧客户端在 `normalize-conversation-client-state` 完成前不切换。禁止新命令同时调用旧整树 PUT，也禁止从旧树回写规范实体。最终 change 执行一次性 cutover。

## Risks / Trade-offs

- **[风险] 显式命令数量比通用 CRUD 多。** → 这是把业务语义集中并可测试的必要成本；共享 envelope、结果和端口降低样板。
- **[风险] 多层 revision 会增加客户端处理。** → 每个命令只携带最小边界 revision，响应统一返回更新值，避免全 Conversation 冲突。
- **[风险] 继承上下文读取投影可能较复杂。** → ThreadFork 保存唯一来源，查询层集中组装并缓存可重建投影，不复制规范 Message。
- **[风险] outbox 消费存在至少一次投递。** → 事件和消费者使用稳定 ID 幂等，实体事务不依赖同步消费者成功。
- **[风险] 新旧 API 并存容易误调用。** → 使用互斥 authority 配置、清晰模块命名和契约测试，客户端切换前不启用生产规范写入。

## Migration Plan

1. 建立应用命令/查询、统一结果、授权、幂等与 UnitOfWork 端口。
2. 实现 Conversation/Thread 生命周期和 `forkThread`，验证事务与 revision。
3. 接入 `sendTurn`、编辑、重新生成、变体选择与 Generation 查询/Stop。
4. 增加 HTTP 传输 schema、路由、ETag/Idempotency-Key 和错误映射。
5. 增加 outbox dispatcher、契约测试和隔离端到端测试。
6. 保持生产旧客户端未切换，把新契约交给 `normalize-conversation-client-state`。

回滚通过关闭规范 API 路由完成；规范数据不可回写旧 JSON，也不启用双写补偿。

## Open Questions

无。公开分享 actor、速率套餐和外部 API 版本生命周期属于后续独立提案，不阻塞内部应用契约和首个网页适配器。
