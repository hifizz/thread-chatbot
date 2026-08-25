## 0. 阶段 0：冻结 API、客户端与 UI 实施边界

- [x] 0.1 对本 change 与 `define-thread-chat-domain-model` 执行严格校验，确认 API/客户端只消费既定领域关系，不重新定义 Project、Thread、Message、MessageRun、replacement 或 BaseContext。
- [x] 0.2 固定职责分界：本 change 负责共享契约、`/api/v1`、SSE、API 测试、客户端状态架构、现有 UI 接入与 E2E；数据库、领域、Repository 和 MessageRun 执行由 domain change 负责。
- [x] 0.3 固定 P0：发送原子创建 `user + assistant + Run`、Markdown tool output 只保存 `artifactId`、生成 Transport 使用 SSE、通用幂等命令留到 V2。
- [x] 0.4 固定 UI 硬门槛：允许改变 Project loading、拆分组件和替换数据胶水；最终布局、样式和既有交互行为不得改变。若实现必须产生用户可见差异，立即暂停并向用户确认。
- [x] 0.5 固定实施顺序：后端领域门 → API 门 → 前端 Store/Runtime/Hooks → UI 无损接入 → 前后端集成 → Ego Browser E2E → 清理归档。
- [x] 0.6 固定归档顺序：E2E 与旧权威清理完成后先归档 domain change，再归档本 change，避免循环依赖。

## 1. 建立共享 V1 契约与 Transport 边界

- [x] 1.1 为 `api-contracts.md` 中全部 ID、DTO、Request、Response、Error 和 SSE Event 建立前后端共享严格 Zod Schema。
- [x] 1.2 为 AI SDK v7 `UIMessage.parts` 建立共享校验入口，限制客户端提交合法 user parts，并定义 Markdown tool output 的 `artifactId` 结构。
- [x] 1.3 定义不依赖 Zustand、React 或具体 HTTP 库的 `ThreadChatApiCapabilities`，覆盖 Project、Thread、Message、Artifact、feedback、SSE 与 Stop。
- [x] 1.4 实现 JSON Transport 的 Session/认证处理、请求编码、响应 Schema 校验和统一 `ClientError` 映射。
- [x] 1.5 实现集中式 `threadChatRoutes`；页面 URL 只由客户端构造，服务端 DTO 不包含 `canonicalUrl` 或其他页面路径。
- [x] 1.6 建立契约 fixture，覆盖成功 DTO、结构化错误、未知字段拒绝、错误实体归属和非法 AI SDK part。

## 2. 实现 Project 与 Thread Query API

- [x] 2.1 实现 `GET /api/v1/projects` 的 owner scope、active/archived 过滤、稳定排序、limit 和绑定查询条件的不透明 cursor。
- [x] 2.2 实现 `GET /api/v1/projects/{projectId}/bootstrap`，返回 Project、全量轻量 topology、ProjectArtifactSummary 与唯一 Root ThreadMessageBundle。
- [x] 2.3 实现 `GET /api/v1/threads/{threadId}/messages`，按有效 Message sequence 查询最新最多 200 条并返回窗口边界。
- [x] 2.4 确保 Bootstrap 和 MessageBundle 不返回 BaseContext、Prompt History、未打开 Branch Message 或 Artifact 正文。
- [x] 2.5 实现 `GET /api/v1/artifacts/{artifactId}`，从 Artifact 所属 Project 校验 actor，并只在按 ID 请求时返回完整内容。
- [x] 2.6 实现 ProjectArtifactSummary 的服务端统计和单调 `changeSequence`，不得从客户端已加载 Artifact 数量反推。

## 3. 实现 Project、Thread 与 Message Command API

- [x] 3.1 实现 `POST /api/v1/projects`，调用后端 Application 原子创建 Project、Root、U1、A1 与 queued Run，并在响应中返回 CreationBundle。
- [x] 3.2 实现 Project metadata、archive/unarchive 和永久删除 API，保持缺省字段与显式 null 的不同语义。
- [x] 3.3 实现 Branch Thread title、archive/unarchive API，并拒绝通过 Thread metadata 修改 Root 标题或归档 Root。
- [x] 3.4 实现 `POST /api/v1/threads/{threadId}/messages`，原子返回 user Message、assistant Message 与 queued Run；P0 不增加 user-only append API。
- [x] 3.5 实现 Fork API，只接受既有 sourceThreadId、sourceMessageId 与 anchor，不接受 Child ID、BaseContext 或 ForkSourceSnapshot 权威字段。
- [x] 3.6 实现 Edit 与 Regenerate replacement API，返回 ReplacementBundle，保证旧 finalized Message parts 与 sequence 不变。
- [x] 3.7 实现 feedback API，只允许对合格 assistant Message 设置 positive、negative 或 null。
- [x] 3.8 为全部 Route 加入 Session actor、owner scope、归档状态、业务资格、严格字段校验和统一错误映射。

## 4. 实现 SSE 生成恢复与 Stop

- [x] 4.1 实现 `GET /api/v1/assistant-messages/{id}/events` SSE；每次连接首个业务事件固定为持久化 `run.snapshot`。
- [x] 4.2 实现 `afterEventSequence` 校验、重复/倒序过滤和 snapshot 后严格递增的 live event。
- [x] 4.3 实现 `run.delta`、`run.completed`、`run.failed`、`run.stopped` Schema，并在 snapshot/completed 携带最新 Artifact Summary。
- [x] 4.4 确保 finalized Message tool output 只包含 `artifactId`，SSE 不复制 Artifact 正文。
- [x] 4.5 实现显式 Stop API；关闭页面、刷新、切换 Thread 或取消 SSE 不得触发 Stop。
- [x] 4.6 验证 queued/running Run 刷新后复用同一 assistantMessageId 和 MessageRun，不启动第二次执行。

## 5. 后端 API 验收门

- [x] 5.1 在 domain change 的 Vitest 与隔离 PostgreSQL 基础上完成 API 合同测试；自动测试统一使用 Fake AI Runtime，不调用真实模型。
- [x] 5.2 覆盖 Project list/bootstrap、Thread Message window、Artifact-by-ID、metadata、archive/delete、feedback 和全部错误码。
- [x] 5.3 覆盖 create/send/Fork/Edit/Regenerate/Stop 的权限、严格输入、原子响应与事务回滚；确认服务端不返回页面 URL。
- [x] 5.4 覆盖 SSE snapshot、eventSequence、delta、terminal、断开重连、重复连接和显式 Stop。
- [x] 5.5 覆盖 Markdown Artifact：Message 只保存 `artifactId`、Bootstrap/MessageBundle/SSE 无正文、Artifact Query 按 ID 返回正文。
- [x] 5.6 执行 `pnpm typecheck`、domain unit/integration、API tests、`pnpm build` 与 `pnpm openspec:validate`；全部通过并记录证据后才能开始第 6 节前端工作。

## 6. 建立前端测试基础与 Zustand Store

- [x] 6.1 增加 Testing Library、user-event 与适配 React Hooks 的 Vitest DOM 环境；不得把 Ego Browser E2E 混入单元测试。
- [x] 6.2 使用 vanilla Zustand 建立 Provider-scoped `ThreadChatAppStore`，包含 Project Catalog 与 AppShellUi slices，不保存 selectedProjectId。
- [x] 6.3 建立按 projectId 创建的 `ThreadChatProjectStore`，包含 entities、runs、requests、readModels 与 workbench ui slices。
- [x] 6.4 实现共享 normalizer，维护 `messagesById + messageIdsByThreadId` 的归属、去重与 sequence 排序。
- [x] 6.5 实现 Creation、Bootstrap、Message、replacement、Run Event、Artifact 与 Summary 的语义化 Store Actions。
- [x] 6.6 实现稳定 Column Slot、Root/Branch 宽度、折叠、焦点、placement、Canvas pin、overlay 与 Workbench Snapshot Store Actions。
- [x] 6.7 确保 Store Action 只同步调用 Zustand `set`/`setState`，不请求 API、不导航、不创建连接，也不原地修改已确认实体。
- [x] 6.8 完成 Store/normalizer 测试：归属拒绝、sequence、replacement、重复 DTO、乱序 Summary、局部 Run 更新与 Snapshot 校验。

## 7. 实现 Runtime、Application Commands 与 Hooks

- [x] 7.1 实现 `ThreadChatAppRuntime`、`ThreadChatProjectRuntime` 与 `ProjectRuntimeRegistry`，保证 Provider 生命周期内 projectId 对应唯一 Runtime。
- [x] 7.2 实现 `ThreadChatAppProvider`、`ThreadChatProjectProvider` 与 `NewProjectDraftProvider`，避免 Next.js 服务端模块级 Store 跨请求共享。
- [x] 7.3 实现 `/thread-chat/new` seeded Runtime handoff：先合并 CreationBundle，再由客户端 route builder replace，目标 Provider 跳过第二次 Bootstrap。
- [x] 7.4 实现 ThreadMessageLoader 的 threadId 级 Promise 去重、跨 Thread 并行与 Runtime destroy 统一 Abort。
- [x] 7.5 实现 ArtifactLoader 的 artifactId 级按需缓存，不因 Thread 加载自动请求正文。
- [x] 7.6 实现 GenerationCoordinator 的 assistantMessageId 级连接去重、snapshot 合并、断线重连、取消订阅和 destroy。
- [x] 7.7 实现 Catalog、Bootstrap、send、Fork、Edit、Regenerate、Stop、feedback 和 metadata Application Commands；客户端不生成服务端实体 ID。
- [x] 7.8 实现纯 selectors、Selector Hooks、Command Hooks 与 Lifecycle Hooks；组件不得直接 fetch 或维护第二份领域状态。
- [x] 7.9 完成 Runtime、Loader、Coordinator、Command、Selector 与 Hook 的接口注入测试。

## 8. 建立 UI Parity 基线并无损接入现有 UI

- [x] 8.1 在修改 UI 数据接缝前，使用 Ego Browser 和专用本地测试账号记录现有空白页、单列、多栏、Header、Fork、Artifact Drawer、折叠/切换、breadcrumb 与分割线拖拽的参考截图和交互清单。
- [x] 8.2 保持现有组件、CSS 类名、布局与交互输出，先只把 Project 列表、`/new` 和已有 Project 页面接到新的 Provider/Runtime。
- [x] 8.3 将 Root/Branch Column 改为消费 ThreadColumnView 和 ThreadColumnHeaderView；允许内部拆分复用，但最终呈现不得变化。
- [x] 8.4 接入现有 Header 的 Child 选择、Thread 切换、收起和 breadcrumb，保持稳定物理 Slot 与列宽。
- [x] 8.5 保留相邻列分割线拖拽；Pointer Move 使用组件瞬时状态，Pointer Up/键盘/双击复位只提交一次 Store Action。
- [x] 8.6 实现按 projectId 的 Workbench Snapshot 防抖保存和刷新恢复；恢复多栏、折叠、焦点和列宽，不恢复滚动条或 Composer 草稿。
- [x] 8.7 接入 Artifact Drawer 按 `artifactId` 加载及独立 loading/error；生成期间禁用 Fork，服务端仍作最终校验。
- [x] 8.8 逐项对照阶段 8.1 的截图和交互清单；任何必须产生用户可见差异的实现立即停止，记录影响并向用户确认后才能继续。

## 9. 前后端集成与 Ego Browser E2E

- [x] 9.1 完成 `/new` 无实体草稿、首次发送、seeded Runtime 无空白帧切换和 AI 事件早于目标 Provider 挂载的集成测试。
- [x] 9.2 完成已有 Project 冷启动、有/无 Workbench Snapshot、多 Branch 并行加载、单列失败和刷新恢复 running Run 的集成测试。
- [x] 9.3 使用 Ego Browser 通过邮箱注册专用本地测试账号；不得依赖真实邮箱验证或真实模型随机输出作为断言。
- [x] 9.4 E2E 验证 Project 创建/列表、首条与后续消息、生成中刷新、Stop、Edit、Regenerate、Fork 与嵌套 Fork。
- [x] 9.5 E2E 验证多栏异步加载、Header Child 选择、Thread 切换、收起、breadcrumb、分割线拖拽与刷新视图恢复。
- [x] 9.6 E2E 验证 Markdown Artifact 创建、消息 `artifactId` 引用、Drawer 按 ID 加载和其他 Project 访问隔离。
- [x] 9.7 对比 UI parity 基线，确认除已批准的 Project loading 外，最终样式和交互行为没有变化。

## 10. 旧客户端退役与归档

- [x] 10.1 E2E 通过后将 `/thread-chat/new`、`/thread-chat/{projectId}` 和 Project 列表切到新权威路径；开发期间不维护 feature flag 或双写。
- [x] 10.2 删除客户端 treeId、新实体 UUID、整树 version 订阅、旧 ThreadTree 写回和 monolithic chat-controller 权威职责；保留仍被新组合根复用的纯 UI 部件。
- [x] 10.3 通知 domain change 执行旧后端/Schema 退役，并等待其完成全量测试和先行归档。
- [x] 10.4 domain change 归档后，执行 `pnpm typecheck`、全部自动测试、`pnpm build`、Ego Browser E2E 和 OpenSpec 严格校验。
- [x] 10.5 对照两个增量 spec 的 Requirement/Scenario 汇总实现证据，在全部门槛满足后归档 `design-thread-chat-client-api`。

## 11. 归档后沉淀稳定客户端与 API 文档

- [x] 11.1 从已归档 design 提炼客户端架构到 `openspec/specs/thread-chat-client-state/architecture.md`，保留 Store、Runtime、Provider、Command、Hook 与异步加载边界。
- [x] 11.2 将落地后的 API 合同提炼到 `openspec/specs/thread-chat-command-api/api-contracts.md`，并校验它与共享 Schema 和实际 Route Handler 一致。
- [x] 11.3 在两个正式 `spec.md` 中链接对应说明文档，明确冲突时可验证 Requirement 优先，并把后续同步更新列为验收项。
