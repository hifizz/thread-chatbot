## 1. 固化规范术语与依赖

- [ ] 1.1 将 `domain` 能力规范归档为 Project、Conversation、Thread、ThreadFork、Turn、Message、Generation、File、MemoryItem 与 ProjectInstruction 的唯一正式术语来源，并核对每个角色、身份和包含关系与增量规范一致。
- [ ] 1.2 新增一份面向开发者的“遗留模型 → 规范模型”迁移表，覆盖 `ThreadTreeState`、`threads.main`、`parentId/children`、`forkFromMsgId/Message.forks`、`activeLeafMessageId`、Artifact 和 `branch_generations` 引用，明确哪些字段只允许存在于迁移适配器。
- [ ] 1.3 审计 README、CLAUDE、活跃 OpenSpec 和 `lib/thread-chat` 注释中的领域术语；把新设计文档改用 Conversation、Thread、ThreadFork，并对必须保留的历史 `Thread Tree` 引用加上遗留标识，不改写已归档变更的历史事实。
- [ ] 1.4 在 `persist-thread-chat-generations`、`add-thread-chat-message-actions`、`add-branch-tree-persistence` 及其他仍依赖整树权威模型的活跃变更中记录其与本变更及后续迁移变更的依赖或被替代范围，禁止继续声称整树 JSON 是最终架构。

## 2. 建立纯领域契约

- [ ] 2.1 在 `lib/thread-chat/domain/` 下建立不依赖 React、Next.js、HTTP 或 Drizzle 的规范 ID 与实体契约，定义 Project、Conversation、Thread、ThreadFork、Turn、Message 和 Generation 的稳定身份与归属字段。
- [ ] 2.2 实现主 Thread 与分支 Thread 的角色推导，以及 Conversation/ThreadFork 拓扑校验；拒绝魔法 `main` 身份、重复入向 Fork、跨 Conversation Fork、来源 Message 与上游 Thread 错配和 Fork 环。
- [ ] 2.3 实现 Turn/Message/Generation 归属校验，拒绝跨 Thread 回复变体、跨 Turn 输出和 Generation 输入输出错配，同时允许 Message 的内容与结构化片段保持为可版本化值对象。
- [ ] 2.4 建立当前有效变体的领域选择契约和版本冲突结果，确保变体只能在同一 Thread/Turn 切换，并与可见列、折叠列、画布视口等界面工作区类型隔离。
- [ ] 2.5 明确 Conversation/Thread Title 解析契约：Conversation 独占聚合导航标题，根 Thread 列头使用 Conversation Title，非根 Thread 可以使用本地 Title，避免重复持久化同义根标题。

## 3. 隔离遗留模型

- [ ] 3.1 将当前 `ThreadTreeState`、`Fork`、`threads.main` 和整树解析器明确移动或标记为遗留边界；新的规范领域模块不得通过类型别名把旧整树对象伪装成 Conversation。
- [ ] 3.2 新增单向、只读的“遗留树 → 规范 Conversation 快照”映射，集中处理根 Thread、Fork、Turn 变体和 Artifact 来源推导；禁止提供“规范模型 → 遗留模型”的权威写回路径。
- [ ] 3.3 为最小根 Conversation、主线 → A → B 嵌套 Fork、B 重新生成回复变体、非法跨 Thread Generation 和重复 Fork 来源建立确定性固定样例及验证脚本，证明规范投影不会把 B 的回复变体投影到 A。
- [ ] 3.4 为旧字段建立允许列表或等价审计检查，使新增领域层和应用层代码中的 `ThreadTreeState`、`threads.main`、可写 `children` 与 `Message.forks` 引用能够在代码审查和持续集成中被发现。

## 4. 准备小步迁移链

- [ ] 4.1 为 `normalize-conversation-persistence` 建立后续变更输入清单：逻辑表、复合外键、不变量、真实数据审计、重置或迁移决策、规范快照和回滚边界。
- [ ] 4.2 为 `migrate-generation-lifecycle` 建立后续变更输入清单：真实 Thread/Turn/Message 外键、启动、停止、心跳、过期恢复、部分结果、用量不可得、计费幂等以及 PR #30 剩余语义缺口。
- [ ] 4.3 为 `add-conversation-command-api` 建立后续变更输入清单：Fork、创建 Turn、重新生成、选择变体、归档、停止等命令，以及所有者校验、幂等、预期版本、错误码、实体增量与事务事件箱。
- [ ] 4.4 为 `normalize-conversation-client-state` 建立后续变更输入清单：规范实体、可重建索引、按 ID 定位的选择器、界面工作区、乐观命令和列、画布、Message 操作迁移。
- [ ] 4.5 为 `retire-thread-tree-authority` 建立后续变更输入清单：数据审计、运行中 Generation 排空、禁用整树 PUT、删除协调合并与防抖保存、删除重复 Fork 事实和遗留适配器的完成条件。
- [ ] 4.6 将 Project Memory、File、Instruction、公开接口、令牌、命令行、MCP 和 Issue #39 Conversation 收敛列为基础迁移后的独立提案，明确它们不阻塞 #34 当前链路。

## 5. 验证与交接

- [ ] 5.1 运行 `pnpm typecheck`，修复规范领域契约、遗留适配器和固定样例的全部类型错误。
- [ ] 5.2 运行 `pnpm openspec:validate`，确保领域增量规范、依赖说明和所有活跃变更严格验证通过。
- [ ] 5.3 检查 Git 差异和术语审计结果，确认未修改无关功能、未把界面工作区混入领域实体、未产生第二个 Fork 事实源，也未把 Issue #39 的收敛机制带入本变更。
- [ ] 5.4 在 Issue #34 回填本变更路径、最终架构决策记录和后续变更依赖链，确保实现者可以从本提案继续而不重新猜测核心数据模型。
