## Why

ThreadChat 当前以整棵 `branch_trees` JSON 和旁路 `branch_generations` 同时表达会话、分支与生成状态，导致客户端与服务端存在重复权威源，流断开、刷新、停止、重试和分支编辑之间容易出现竞态。现在需要先建立规范化、可恢复且与 HTTP 连接解耦的会话内核，作为后续重新设计计费的稳定基础，同时保持现有工作台 UX/UI。

## What Changes

- **BREAKING**：用规范化的 `projects`、`threads`、`messages`、`artifacts` 数据模型替换 `branch_trees` 整树持久化和 `branch_generations` 旁路状态；切换时不迁移、不只读兼容、不双写，旧会话数据按已确认策略废弃。
- 将创建项目、发送消息、分叉、编辑、重新生成、停止、反馈和标题更新收敛为服务端授权的命令 API；所有写操作校验所有权，以客户端生成的命令/实体 ID 实现幂等，并以数据库原子序号确定消息顺序。
- 基于项目实际安装且不低于 AI SDK v7 的 UI Message 协议持久化完整 `UIMessage.parts[]`，保留文本、推理、来源、工具和数据 parts，以[UI Message 协议]为准。
- 在单台、单 Next.js 进程的 VPS 中，以进程内 Stream Session 管理后台模型任务；任务生命周期独立于 HTTP/SSE 连接，支持即时快照、标准 UI Message chunks、停止和终态落库。
- 刷新或 SSE 断开后不重连/续传流：客户端保留已有快照，显示后台生成状态并轮询数据库终态；进程重启后遗留的 `generating` 消息收敛为 `failed`。
- 重新生成不再改写旧回复：旧终态消息保持不可变，仅写入 `superseded_at`，并创建新的 assistant 消息和 Stream Session；相同重试命令只返回已创建的新消息。由旧回复派生的分支保留冻结上下文，继续独立可用且不迁移到新回复。
- 移除回复版本切换及其 variant picker；除此之外保持现有列视图、画布、编辑器、Artifact 抽屉、工作区本地布局和交互样式不变。
- 本改造完全隔离并忽略现有计费、余额、credits、成本和扣费逻辑；只允许保存与协议/诊断相关的原始模型 usage，不把它解释为费用。计费将在本改造完成后另行设计。

## Capabilities

### New Capabilities

- `conversation-persistence`: 规范化项目、线程、消息、Artifact、冻结分支上下文及完整 UI Message parts 的持久化规则。
- `conversation-generation-lifecycle`: 后台生成、停止、失败、重试、supersede、刷新轮询与进程重启收敛的状态机规则。
- `thread-chat-stream-sessions`: 单进程内 Stream Session 的所有权、订阅快照、UI Message chunk 广播和清理规则。
- `conversation-command-api`: 会话查询与命令 API 的认证、所有权、幂等、原子顺序和响应契约。
- `conversation-client-state`: 服务端权威的前端 Store、流/轮询归并以及不改变既有工作台 UX/UI 的投影规则。
- `conversation-cutover`: 无迁移、无双写的一次性数据切换、遗留计费隔离及分 Gate 发布约束。

### Modified Capabilities

- `domain`: 将 Message/Generation 从可切换版本与整树快照语义改为规范化消息尝试、不可逆终态、soft-supersede 和冻结分支上下文语义。

## Impact

- 数据库：新增规范化表、索引、约束和切换迁移；移除 `branch_trees`、`branch_generations` 作为运行时权威源。
- 服务端：重构 `app/api` 下的 ThreadChat 路由，以及 `lib/db`、会话仓储、应用命令、AI SDK v7 转换和内存 Session Store 模块。
- 前端：重构 `app/thread-chat` 的加载、Store、网络命令和流消费层；保留既有组件外观与布局，只删除回复版本选择相关 UI/状态。
- 测试与运维：增加数据库并发/幂等、状态机、UI Message 协议、SSE、刷新恢复、分支独立性和单进程重启测试；部署约束为 VPS 单实例、单 Next.js 进程。
- 不在本 change 内实现或沿用任何计费决策，也不要求 Redis、队列或多实例协调设施。
