## Why

服务端命令 API 已能返回规范快照和实体增量，但当前前端仍以可变 `ThreadTreeState` 为中心，组件会直接改 `children`、`activeLeafMessageId` 等关系，再依赖整树存盘和刷新协调。若只替换请求 URL，旧的重复事实和竞态仍会保留在浏览器；必须把客户端改为按稳定 ID 规范化实体，并把领域状态与列/画布视图状态彻底分开。

## What Changes

- 新增按 ID 保存 Conversation、Thread、ThreadFork、Turn、Message 与 Generation 的规范化客户端 Store；实体关系只接受服务端快照或命令 delta。
- 派生 Thread children、深度、Fork 数量、有效消息路径和列投影；这些索引可丢弃重建，不作为可写事实。
- 将 visible columns、折叠、选中 Thread、画布 viewport、面板、草稿和 pending command 放入独立 UI Workspace slice。
- 首次加载从 `ConversationSnapshot` 原子归一化；后续命令通过统一 client gateway 发送幂等键/revision，并合并规范 delta 或处理冲突重取。
- 流式 Generation 由单一协调器订阅/轮询，按 checkpoint version 更新 Message/Generation；组件挂载只订阅所需 ID，卸载时释放订阅。
- 乐观体验使用临时展示 overlay 和可回滚 pending command，不允许组件生成权威 Fork/Message 关系或触发整树 PUT。
- 迁移列、画布、composer、Message actions、标题、反馈和恢复展示到 ID-scoped selector；保留现有 Markdown、Artifact 和流式视觉能力。
- **BREAKING**：规范客户端路径不再调用 `persistNow`、save debounce、整树 CAS、启动 reconcile 或 `activeLeafMessageId` 写入；正式删除由最终切换 change 完成。

## Capabilities

### New Capabilities

- `conversation-client-state`：定义规范化实体 Store、派生索引、界面状态、命令 delta、Generation 订阅和组件边界。

### Modified Capabilities

- 无。现有界面能力保持产品行为，旧客户端协议的退场由 `retire-thread-tree-authority` 处理。

## Impact

- 前端核心：`app/thread-chat/core/store.ts`、types/selectors、boot、chat controller、persistence 与 generation reconciliation。
- 组件：列、画布、composer、selection/fork、Message actions、标题、帮助/反馈和 Artifact 展示。
- 网络：新增 Conversation client gateway、snapshot/delta parser、命令状态和 Generation polling/subscription coordinator。
- 测试：Store reducer/selectors、delta/revision、并发冲突、订阅释放、刷新恢复和 UI 回归。
- 前置依赖：`define-conversation-domain-model`、`add-conversation-command-api`，并间接依赖规范持久化与 Generation 生命周期。
- 后续依赖：`retire-thread-tree-authority`。
