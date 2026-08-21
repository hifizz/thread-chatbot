## 1. 应用层基础契约

- [ ] 1.1 定义 Command/Query 输入、actor、幂等键、预期 revision、规范 delta 和稳定错误结果，不导入 HTTP 或数据库行类型。
- [ ] 1.2 定义 `UnitOfWork`、授权策略、幂等存储、事务事件箱和规范仓储端口，并建立测试替身。
- [ ] 1.3 实现 Workspace/Project → Conversation/Thread/Message/Generation 的不可枚举授权解析和安全错误 details。
- [ ] 1.4 实现幂等载荷摘要、等价重放、同键异载荷冲突和命令结果恢复。

## 2. Conversation 与 Thread 生命周期

- [ ] 2.1 实现 Conversation 列表、规范快照读取以及创建 Conversation + 根 Thread 的原子命令。
- [ ] 2.2 实现 Conversation 重命名、归档、恢复和受保护删除，覆盖运行中 Generation 冲突。
- [ ] 2.3 实现 Thread 重命名、非根 Thread 归档和恢复，保留 Fork、后代、Message 与 Generation 历史，并要求根 Thread 使用 Conversation 归档。
- [ ] 2.4 增加生命周期命令的权限、幂等、revision 和事务回滚测试。

## 3. Fork 与上下文边界

- [ ] 3.1 实现 `forkThread` 的来源 Message、同 Conversation、当前可用路径和预期 Conversation revision 校验。
- [ ] 3.2 在单事务创建下游 Thread、ThreadFork、上下文边界、revision 与 `ThreadForked` outbox 事件。
- [ ] 3.3 实现不复制上游 Message 的继承上下文读取投影，并覆盖 A → B → C 嵌套 Fork。
- [ ] 3.4 覆盖来源错配、并发 Fork、重复幂等键和事务失败无孤立实体测试。

## 4. Turn、Message 变体与 Generation 命令

- [ ] 4.1 实现 `sendTurn`，原子创建 Turn、用户/助手 Message、Generation 和事件，并在提交后启动执行器。
- [ ] 4.2 实现末尾用户输入编辑和助手重新生成，以新 Message/Generation 变体追加而非覆盖旧身份。
- [ ] 4.3 对已有后续 Turn 的历史编辑返回 `fork_required`，不修改现有上下文。
- [ ] 4.4 实现带 Turn revision 的用户/助手当前变体选择和角色/归属/内容可用性校验。
- [ ] 4.5 实现 Generation 查询与幂等 Stop，复用规范 lifecycle 并让已终结 Stop 返回现有结果。

## 5. HTTP 传输适配器

- [ ] 5.1 定义带 `schemaVersion` 的请求、快照、delta、revision 和错误传输 schema。
- [ ] 5.2 实现 Project/Conversation/Thread/Turn/Generation 资源路由，只调用应用 Command/Query。
- [ ] 5.3 将 `Idempotency-Key`、`If-Match`/ETag 和认证会话映射到内部 command envelope。
- [ ] 5.4 实现 400/401/403/404/409/422/429/500 的稳定错误映射，并验证只有真实冲突返回 409。
- [ ] 5.5 增加接口契约测试，覆盖 owner 伪造、不可见资源、格式错误、幂等重放和 revision 冲突。

## 6. 事件箱与隔离验证

- [ ] 6.1 实现 outbox 写入和幂等 dispatcher，验证事件与规范实体在同一事务提交。
- [ ] 6.2 增加默认关闭的规范 API 开关，拒绝新命令调用旧整树 PUT 或双写旧权威。
- [ ] 6.3 在隔离环境跑通创建 Conversation、发送、Fork、嵌套 Fork、重新生成、选择变体、Stop、归档与恢复端到端流程。
- [ ] 6.4 运行相关测试、`pnpm typecheck`、`pnpm openspec:validate` 和接口 schema 检查并记录结果。
