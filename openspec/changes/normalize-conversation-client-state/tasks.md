## 1. 规范化 Store 基础

- [x] 1.1 定义只读 Conversation/Thread/ThreadFork/Turn/Message/Generation ID maps、revision 和 checkpoint version 状态。
- [x] 1.2 实现 ConversationSnapshot 临时解析、归属/引用校验和单次原子安装，失败时不部分覆盖旧状态。
- [x] 1.3 实现带 tombstone、schemaVersion 和每实体版本比较的 CanonicalDelta 合并器。
- [x] 1.4 增加开发模式实体冻结、重复/旧 delta 幂等、版本间隙重取和未知 schema 拒绝测试。

## 2. 派生索引与细粒度订阅

- [x] 2.1 实现 Conversation → Threads、ThreadFork parent/children、Thread → Turns、Turn → Messages 的可重建索引。
- [x] 2.2 实现根 Thread、嵌套深度、Fork 数量、继承上下文、当前有效路径和画布边 selector。
- [x] 2.3 将 Store 通知拆为实体/索引/UI key，并提供按 ID 定位的 React hooks 与稳定 memoized selector。
- [x] 2.4 验证清空派生缓存可重建等价结果，以及一个 Message 流式更新不会通知无关 Thread 订阅。

## 3. UI Workspace 与乐观状态

- [x] 3.1 将 visible/folded/selected Thread、列策略、画布 viewport、面板、草稿和本地提示迁入独立 UI Workspace slice。
- [x] 3.2 为 UI localStorage payload 增加 schemaVersion/Conversation ID，并在加载时过滤归档或缺失 Thread。
- [x] 3.3 实现按 commandId 管理的 pending overlay、草稿恢复、确认中、成功替换和失败回滚。
- [x] 3.4 验证折叠/画布/面板操作不改变 canonical revision 或发出领域命令。

## 4. Client gateway 与 GenerationCoordinator

- [x] 4.1 实现统一 client gateway，附加 Idempotency-Key、最小预期 revision并解析 snapshot/delta/稳定错误。
- [x] 4.2 实现网络不确定时复用幂等键、409 revision 恢复和组件卸载后共享结果合并。
- [x] 4.3 实现按 Generation ID 引用计数的 stream/poll 协调器、可见/隐藏频率、终态停止和 checkpoint 乱序保护。
- [x] 4.4 覆盖多视图共享一个监控、最后订阅释放、重新挂载恢复以及卸载不发送 Stop 的测试。

## 5. 只读界面切片迁移

- [x] 5.1 迁移 boot、Conversation 列表/标题和根 Thread 识别，不再使用魔法 `main` ID。
- [x] 5.2 迁移列、Thread switcher、tree list、breadcrumb、selection anchor 和嵌套 Fork 展示到 ThreadFork selectors。
- [x] 5.3 迁移 Message/Markdown/研究活动/Artifact/反馈展示到稳定 ID selectors。
- [x] 5.4 迁移 React Flow 画布节点/边和聚焦行为到可重建投影，并验证懒加载不复制 canonical 实体。

## 6. 写交互切片迁移

- [x] 6.1 迁移 composer/send/stop 到 client gateway 和 pending overlay，删除规范路径的 `persistNow` 前置屏障。
- [x] 6.2 迁移重新生成、用户输入编辑和变体选择到 Turn/Message 命令与 revision。
- [x] 6.3 迁移 selection Fork 到单个 `forkThread` 命令，不再本地写 parent/children/Message forks。
- [x] 6.4 迁移复制、反馈、Artifact 定位和其余 Message actions，全部使用稳定 Message/Turn/Thread ID。

## 7. 互斥模式与行为验证

- [x] 7.1 增加 Conversation 页面 legacy/canonical 互斥 boot 开关，canonical 模式不实例化旧 Tree Store、整树 persistence 或 reconcile。
- [x] 7.2 覆盖发送、流式、Stop partial、刷新恢复、重新生成、选择变体、A → B → C Fork、归档/恢复和标题行为矩阵。
- [x] 7.3 增加 selector 通知计数与关键渲染性能验证，确认无关列不会随全局树 version 重渲染。
- [x] 7.4 运行相关单元/组件/端到端测试、`pnpm typecheck` 与 `pnpm openspec:validate` 并记录结果。

## 8. 2026-08-22 验收记录

- `pnpm build`：Next.js 16.3.1 生产构建通过，新增 canonical 页面和反馈 API 路由均完成编译与静态检查。
- `pnpm typecheck`：通过。
- `pnpm lint`：0 error；保留 4 条与本 change 无关的既有 warning。
- `pnpm openspec:validate`：严格模式 31 项全部通过。
- `pnpm test:conversation-domain`：8/8 通过。
- `pnpm test:conversation-generation-unit`：7/7 通过；覆盖较早 Turn 重新生成时排除当前 Thread 后续消息。
- `pnpm test:conversation-client`：13/13 通过；覆盖原子快照、A → B → C、历史 Fork 来源、细粒度通知、幂等/冲突、GenerationCoordinator、稳定反馈 ID、Markdown/研究活动/Artifact 来源。
- `pnpm test:conversation-command-contract`：4/4 通过。
- `pnpm test:conversation-generation`：52 项数据库断言通过；模型标识为 `glm-5.3`，覆盖浏览器断线后继续执行、Stop partial、持久化 `incomplete` 正文与研究活动、计费 exactly-once。
- `pnpm test:conversation-persistence`：26 项数据库断言通过；`root → A → B → C` 快照稳定且无整树写端口。
- `pnpm test:conversation-command-api`：69 项数据库断言通过；覆盖 outbox exactly-once、命令并发、嵌套 Fork、反馈权限/完成态/Generation 关联/幂等更新与删除。
- Ego Browser 任务空间 79：真实 GLM 5.3 发送、流式完成和刷新恢复；重新生成与变体选择；A → B → C 三列；3 节点/2 边画布；Conversation 与 Thread 标题、归档/恢复；复制状态；按稳定 Message ID 点赞并经 API 回读、刷新恢复；页面无错误提示。
