## Context

当前外部 Store 保持一份对象身份稳定、原地修改的 `ThreadTreeState`，每次 mutation 递增全局 version 并通知全部订阅者。Fork 会同时写下游 `parentId`、上游 `children`、来源 Message `forks`、depth 和 footnote；发送和重新生成写 Message 图及 `activeLeafMessageId`。网络层再对整树做 debounce PUT、卸载 flush 和启动 reconcile。

新的服务端 API 已把这些关系收敛为规范实体和原子命令。客户端必须同步改变状态形状；否则它仍会在本地维护第二套领域模型。

## Goals / Non-Goals

**目标：**

- 用 ID map 和服务端版本保存规范实体，避免嵌套副本和全树 mutation。
- 把派生拓扑、UI Workspace、pending command 和规范实体分层。
- 用统一网关与 Generation 协调器处理命令、delta、订阅和冲突。
- 逐组件迁移且保持现有聊天、分叉、画布和 Message actions 行为。

**非目标：**

- 重做视觉设计、Markdown 渲染、编辑器或 React Flow。
- 在客户端实现离线优先、多用户协同 CRDT 或跨 Conversation 收敛。
- 让浏览器成为 Generation durability 或关系修复的权威。
- 在本 change 删除服务端旧表/旧路由；最终 cutover change 负责删除。

## Decisions

### D1. Store 分为四个正交区域

```text
canonical
  conversationsById
  threadsById
  threadForksById
  turnsById
  messagesById
  generationsById
  revisions/checkpointVersions

derived
  threadIdsByConversation
  incomingForkByThread
  outgoingForkIdsByThread
  turnIdsByThread
  messageIdsByTurn
  activePath / canvas edges / counts

uiWorkspace
  visibleThreadIds / foldedThreadIds / selectedThreadId
  column sizes/policy / canvas viewport
  panels / drafts / local hints

commands
  pendingByCommandId / optimisticOverlays / errors
```

`canonical` 只接受服务端数据。`derived` 可以按需 memoize 并全部重建。`uiWorkspace` 可以按 Conversation ID 存 localStorage，但不能进入 API 写载荷。`commands` 只描述尚未确认的交互。

备选方案是继续保留嵌套树并增加 adapter；这会使 adapter 本身成为第二关系权威，因此拒绝。

### D2. 实体更新使用对象替换和细粒度订阅

保留零框架依赖的外部 Store 与 React `useSyncExternalStore` 边界，但不再用单一全树 version 触发所有组件。Store 为 `entityType:id`、Conversation 索引和 UI slice 维护订阅 key；更新实体时替换该对象并只通知受影响 key。

Selector 返回只读视图或稳定 memoized 结果。开发模式冻结规范实体，以尽早发现组件原地修改。

备选方案是立即引入另一套状态库；当前问题是领域形状而不是库能力，引入依赖不会自动消除重复事实，因此不作为前置条件。

### D3. 快照安装是事务式 Store commit

boot 流程先在临时结构中：

1. 解析传输 schemaVersion；
2. 按 ID 去重并验证复合归属；
3. 验证根 Thread、ThreadFork、Turn/Message 与有效变体引用；
4. 构建基础索引；
5. 一次 commit 替换目标 Conversation 的旧实体集合。

失败时保留上一次可用 Store 或展示明确加载错误，不创建空树并静默覆盖远端数据。

### D4. delta 合并使用每实体 revision

命令响应和查询都转换为统一 `CanonicalDelta`：

```text
schemaVersion
upsert[type][id]
remove[type][id] = tombstoneRevision
revisions
invalidate[]
```

Store 逐实体比较 revision；Generation/Message 流 checkpoint 额外比较 checkpointVersion。重复和旧 delta 幂等跳过；检测到未知 schema 或不可解释版本间隙时，把 Conversation 标为 stale 并重取快照。

### D5. client gateway 拥有命令协议

组件调用类型化意图，例如 `forkThread(input)`、`sendTurn(input)`，gateway 负责：

- 读取最小作用域 revision；
- 创建/复用 Idempotency-Key；
- 发请求、解析安全错误和 delta；
- 在组件卸载后仍把已提交结果送入共享 Store；
- 对网络不确定结果用同一键重查/重试；
- 对 409 合并最新 revision 或重取，不盲目生成新键重放。

旧 `chat-controller.persistNow()` 屏障不进入新 gateway。

### D6. 乐观 UI 使用 overlay，不创建规范实体

composer 可立即清空/显示 pending bubble，Fork 可显示 pending column shell，但 overlay 使用 `commandId` 和临时 presentation key，不能被 selector 当作真实 Thread/Message，也不能成为下一条领域命令的目标。

成功 delta 用服务端稳定 ID 替换 overlay；确定失败回滚并恢复草稿；网络不确定则保持“确认中”，用原幂等键查询。这样既保留响应感，也不在浏览器预演数据库关系。

### D7. GenerationCoordinator 按 ID 引用计数

每个 loaded Conversation 有一个协调器注册表：

```text
generationId -> {
  subscribers
  latestCheckpointVersion
  stream/poll handle
  visibility mode
}
```

同一 Generation 的多个组件共享网络监控。可见运行任务保持较快轮询（初始保持现有约 2 秒行为），页面隐藏时降频（初始约 10 秒）；终态停止轮询。SSE 与查询统一转换为 delta，乱序由 checkpointVersion 拒绝。最后订阅释放网络资源，但不会调用 Stop；重新挂载先查询恢复。

运行频率是可测配置，不进入领域模型。

### D8. 由 ThreadFork 和 Turn 生成列/画布读取模型

选择器集中实现：

- 根 Thread 来自 `Conversation.rootThreadId`；
- parent/children 来自 ThreadFork；
- 深度和画布边通过无环遍历派生；
- Thread 的继承上下文截至 `sourceMessageId`，本地内容来自其 Turns；
- 当前 Message 来自 Turn active variant；
- Fork 数量由 outgoing ThreadFork 计数。

组件不再读取 `threads.main`、`parentId`、`children`、Message `forks` 或 `activeLeafMessageId`。

### D9. UI Workspace 只保存展示身份

现有列放置、替换/细条策略、画布焦点和 panel 状态可以保留算法，但输入改为 Thread ID 与派生 selector。localStorage payload 带 UI schemaVersion 和 Conversation ID；读取时过滤已归档/不存在 Thread。它不能恢复或修改规范关系。

### D10. 按竖向能力切片迁移组件

迁移顺序为：

1. 新 Store、snapshot/delta 和 selector 测试；
2. boot/list/title 和 UI Workspace；
3. 只读列、Message、Artifact、画布；
4. Generation 展示与 coordinator；
5. composer/send/stop/regenerate/select variant；
6. selection Fork、反馈和其余 Message actions。

每个切片在隔离规范路由下可端到端运行。避免先写一个巨型兼容 adapter 让所有旧组件继续变异整树。

### D11. 客户端路径按 Conversation 互斥

路由/feature flag 为一次页面会话选择 legacy 或 canonical boot。canonical 路径不会实例化旧 Tree Store、persistence debounce 或 reconcile；legacy 路径不调用新命令。禁止同一 Conversation 页面同时维护两个 Store 并互相同步。

## Risks / Trade-offs

- **[风险] 大量组件依赖旧嵌套类型。** → 按竖向能力切片迁移，先建立 selector facade，但 facade 只读且基于规范实体。
- **[风险] 细粒度订阅和派生缓存可能产生失效错误。** → 所有索引声明依赖 key，增加重建等价测试和开发模式全量校验。
- **[风险] overlay 与规范实体视觉切换可能闪烁。** → 以 commandId 关联响应并保持展示 key，规范身份仍只来自服务端。
- **[风险] 组件卸载后请求回调造成泄漏。** → gateway 属于 Store/application scope，不捕获组件 setState；组件只维护可取消订阅。
- **[风险] feature flag 并存增加测试矩阵。** → 并存只持续到最终 cutover，模式严格互斥并分别标记 authority。

## Migration Plan

1. 实现 normalized Store、只读 selector、快照安装和 delta 合并。
2. 实现 client gateway、pending overlay、冲突恢复和 GenerationCoordinator。
3. 按只读展示 → Generation → 写命令顺序迁移组件。
4. 在隔离规范路由跑现有行为矩阵和渲染/订阅性能验证。
5. 把 canonical 客户端置于默认关闭的 Conversation 级开关后，交由最终 change 执行全量 cutover。

最终生产 cutover 前，回滚可以关闭试验 canonical 页面并切回 legacy 模式；一旦服务端 canonical authority 接受生产写入，只能回滚到仍使用规范 API/数据的兼容客户端版本或进入只读，任何客户端都不得把本地状态序列化回 `branch_trees.state`。

## Open Questions

无。是否未来引入通用状态库、SSE 还是 WebSocket、以及 UI Workspace 是否跨设备同步，均可在不改变规范实体边界的情况下独立决策。
