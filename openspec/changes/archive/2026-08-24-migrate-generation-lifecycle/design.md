## Context

规范 Conversation 持久化提供了真实 Thread、Turn 与 Message，但现有 Generation 仍通过 `branch_generations` 协调整树 JSON、浏览器保存和流式响应。该结构把“执行是否结束”“内容是否可用”“usage 是否完整”“账单是否已结算”混成一组隐式分支，导致 Stop、崩溃恢复和并发终结无法用数据库约束证明正确。

本设计位于规范持久化与命令 API 之间：先建立可独立验证的应用服务、仓储和执行端口，不在本阶段暴露新的公开路由或迁移客户端。

## Goals / Non-Goals

**目标：**

- 让 Generation 通过真实外键绑定 Thread、Turn 和 Message。
- 让服务端在浏览器断线后继续执行并留下可恢复 checkpoint。
- 精确定义 Stop、失败、superseded、僵尸任务收敛和 exactly-once 终结。
- 分离 Generation 状态、Message 内容状态、usage 完整度与计费状态。
- 修复 PR #30 审查中已发现的部分 usage、partial 覆盖、联网活动和 Stop 状态漂移。

**非目标：**

- 设计公共 HTTP 命令、错误码或客户端 Store。
- 正式切换生产流量或删除 `branch_generations`。
- 引入跨 Conversation Agent 工作流、任务队列产品或 Project 资产模型。
- 把每个流片段、token 或工具事件永久保存为独立关系表。

## Decisions

### D1. Generation 是执行实体，不是 Message 状态字段

新增 `conversation_generations`，核心字段为：

```text
id
owner_id / workspace_id / project_id
conversation_id / thread_id / turn_id
input_message_id / output_message_id
intent / attempt / idempotency_key
status / content_state
checkpoint_version / checkpoint
usage / usage_completeness / billing_status
lease_owner / heartbeat_at / stop_requested_at
started_at / finished_at / created_at / updated_at
```

所有关联使用规范表的复合外键，确保同一 Conversation/Thread/Turn。一个 Message 可以保留多个历史 Generation 尝试，但重新生成默认创建新的输出 Message 变体，不覆盖旧身份。

备选方案是继续把 Generation 嵌入 Message 或整树 JSON；这会使执行租约、重试历史和计费幂等无法独立约束，因此拒绝。

### D2. 四组状态正交建模

```text
Generation.status:
  running | stop_requested | completed | stopped | failed | superseded

Message.contentState:
  pending | streaming | complete | incomplete | failed

usageCompleteness:
  complete | partial | unavailable

billingStatus:
  pending | settled | usage_unavailable | not_billable
```

`completed` 通常对应 `complete`，但 `stopped`/`failed` 可以对应 `incomplete`；`settled` 只允许搭配 `complete` usage。数据库 CHECK 和应用状态机同时执行这些组合约束。

备选方案是从 Generation 终态推导其余状态；这正是当前无法表达“失败但有可用部分内容”和“有部分 usage 但不可完整结算”的根因，因此拒绝。

### D3. 开始事务先于任何付费调用

应用服务 `startGeneration` 在单个事务中：

1. 验证所有者、实体归属、意图和相关 Conversation/Thread/Turn 的预期 revision；
2. 追加或确认输出 Message；
3. 创建带幂等键、`running` 状态和初始 checkpoint 的 Generation；
4. 提交后才把执行描述交给模型运行器。

相同幂等键和规范化请求摘要返回原 Generation；键相同但摘要不同返回幂等冲突。事务失败没有付费副作用。

### D4. 服务端执行所有权与 HTTP 响应解耦

执行器独立消费完整模型流。HTTP/SSE 只订阅或转发进度，不把 `request.signal` 作为模型执行的终止信号。进程内 AbortController 注册表只提供低延迟 Stop；持久化 `stop_requested`、心跳和租约支持跨实例观察与恢复。

沿用当前经过验证的短周期 Stop 观察和心跳思路，但具体间隔作为运行配置与测试参数，不写死进领域契约。浏览器轮询频率属于后续客户端 change。

### D5. checkpoint 是服务端可恢复事实

执行器按节流策略把以下规范投影保存到 JSON checkpoint：

```text
schemaVersion
body
artifactIds
researchPlan
researchActivities[{ id, kind, status, sources, error }]
contentState
knownUsage
```

每次更新使用 `checkpoint_version` 比较交换。浏览器收到的流片段可以领先最后一次 checkpoint，但浏览器整树 PUT 不再是恢复权威。工具活动只有在获得输出或错误时才进入 `complete`/`error`；输入阶段保持 `running`。

备选方案是保存每个 token 事件；成本和写放大远高于恢复收益，因此使用有版本快照 checkpoint，并允许终结时强制刷新。

### D6. Stop 和僵尸任务共用同一终结器

Stop 首先将 `running` 条件更新为 `stop_requested`；注册表通知只是加速。执行器观察取消后把最后 checkpoint 交给统一 `finalizeGeneration`。

僵尸收敛器按 `status + heartbeat_at + lease` 领取失联任务，并直接读取最新 Generation checkpoint 与输出 Message，不再使用开始时的空 `turnSnapshot` 重建。终结条件更新包含当前版本，健康执行器若已推进或完成，收敛写入自然失败。

### D7. usage 完整度决定能否结算

终结输入同时携带 `knownUsage` 与 `usageCompleteness`。规则为：

```text
complete    -> 可幂等写 usage_records，billing = settled
partial     -> 保留已知值，billing = usage_unavailable
unavailable -> 不伪造零值，billing = usage_unavailable
无付费调用   -> billing = not_billable
```

`usage_records.app_generation_id` 保持唯一。若业务需要对 partial usage 先扣已知部分，必须另立计费 ADR；本 change 不把不完整账单称为已结算。

### D8. 终结是唯一原子提交边界

`finalizeGeneration` 在一个事务中：

- 以 Generation 状态、租约和版本做比较交换；
- 刷新最终 checkpoint 与 Message 内容状态；
- 仅在仍为当前尝试时更新 Turn 的有效助手 Message；
- 写入或确认唯一 usage 记录与计费状态；
- 记录终态、错误分类和完成时间。

较旧尝试晚到时进入 `superseded` 或发现已有终态后幂等返回，不得覆盖当前变体。

### D9. 新生命周期默认关闭

本阶段通过显式服务端开关或隔离应用组合根启用，只允许集成测试和后续命令 API 使用。遗留路由继续走旧权威路径；禁止把同一次 Generation 同时写入旧 `branch_generations` 和新表。

## Risks / Trade-offs

- **[风险] checkpoint 节流意味着进程硬崩溃时可能丢失最后少量 token。** → 终结前强制刷新，并让节流周期可配置；契约保证不丢已确认 checkpoint，而非承诺逐 token durability。
- **[风险] 状态维度增加实现复杂度。** → 用类型、数据库 CHECK、集中状态机和表驱动测试限制合法组合，换取语义真实性。
- **[风险] 服务端继续执行可能占用无消费者资源。** → 使用租约、心跳、超时和持久化 Stop；资源策略不依赖浏览器连接。
- **[风险] 新旧 Generation 并存期间难以诊断。** → 运行模式互斥、日志带 authority/version 标签，不做隐式双写。
- **[风险] partial usage 暂不结算可能产生待对账余额。** → 明确 `usage_unavailable` 并保留已知 usage，后续计费策略可以安全重放。

## Migration Plan

1. 增加规范 Generation 表、枚举/约束、复合外键和 usage 唯一关联。
2. 实现开始、checkpoint、Stop、心跳、stale claim 与统一终结应用服务。
3. 用模拟执行器验证断线、并发 Stop、崩溃、late result 和 usage 组合。
4. 在隔离模式将规范生命周期接到测试 Conversation，不承载现有生产路由。
5. 由 `add-conversation-command-api` 暴露命令，由最终切换 change 决定正式启用和旧表退场。

回滚时关闭规范生命周期并删除未承载生产权威的新代码/表；不得在同一运行模式回退为双写。

## Open Questions

无。本 change 不决定 checkpoint 的最终节流数值，也不决定 partial usage 的未来补扣策略；两者分别是运行参数与独立计费决策，不阻塞领域契约。
