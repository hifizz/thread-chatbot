## 1. Generation 数据结构

- [x] 1.1 定义 `conversation_generations` 的身份、规范实体复合外键、意图、尝试、幂等键、状态、租约、checkpoint、usage 与时间字段。
- [x] 1.2 增加合法状态组合、唯一幂等键、当前尝试和 `usage_records.app_generation_id` 的约束与索引。
- [x] 1.3 生成数据库迁移，并用集成用例验证跨 Conversation/Thread/Turn/Message 引用和非法状态组合会被拒绝。

## 2. 开始与执行所有权

- [x] 2.1 建立纯应用层 Generation 仓储和执行器端口，不依赖 HTTP、React 或遗留整树类型。
- [x] 2.2 实现 `startGeneration` 事务，覆盖预期版本、输出 Message 追加、幂等重放、载荷冲突和提交前禁止模型调用。
- [x] 2.3 实现与 HTTP 连接解耦的服务端流消费、AbortController 注册、持久化 Stop 观察、租约和心跳。
- [x] 2.4 增加浏览器断线后继续执行以及重新查询可见进行中 Generation 的集成验证。

## 3. Checkpoint 与结构化部分结果

- [x] 3.1 定义带 `schemaVersion` 的 checkpoint 解析器，覆盖正文、Artifact、研究计划、联网活动、来源、内容状态和已知 usage。
- [x] 3.2 实现按版本比较交换的节流 checkpoint 写入与终结前强制刷新，拒绝旧版本覆盖。
- [x] 3.3 修正联网活动投影，使输入/执行阶段保持 `running`，仅输出或错误后进入相应终态。
- [x] 3.4 覆盖正文、Artifact、研究活动混合 partial 的保存、刷新恢复和旧 checkpoint 竞态测试。

## 4. Stop、失败与僵尸任务收敛

- [x] 4.1 实现幂等 Stop 应用操作：先持久化 `stop_requested`，再通知本地执行器，终态请求只返回既有结果。
- [x] 4.2 实现统一 `finalizeGeneration` 事务，原子提交 Generation、Message 内容状态、Turn 当前变体和计费结果。
- [x] 4.3 实现基于租约/心跳和条件更新的 stale claim，始终从最新服务端 checkpoint 收敛，不再用开始快照覆盖 partial。
- [x] 4.4 覆盖有输出 Stop、无输出失败、进程崩溃、健康执行器抢先完成、旧尝试晚到和重复终结测试。

## 5. Usage 与计费真实性

- [x] 5.1 实现 `complete`、`partial`、`unavailable` usage 完整度的聚合和持久化。
- [x] 5.2 修改结算规则：仅完整 usage 可 `settled`；partial/unavailable 必须 `usage_unavailable`，无付费调用为 `not_billable`。
- [x] 5.3 覆盖“已完成 step 有 usage、当前中止 step 无 usage”的回归用例，并验证保留已知值但不伪装完整结算。
- [x] 5.4 覆盖并发响应消费、Stop 和 stale 收敛只产生一次 usage 记录及一次扣费的事务测试。

## 6. 隔离接入与验证

- [x] 6.1 增加默认关闭的规范 Generation 组合根，明确拒绝同一次执行双写新旧 Generation 权威。
- [x] 6.2 在隔离 Conversation 路径跑通开始、流式 checkpoint、查询、Stop、完成、失败和恢复端到端测试。
- [x] 6.3 运行数据库迁移、相关测试、`pnpm typecheck` 与 `pnpm openspec:validate` 并记录结果。
