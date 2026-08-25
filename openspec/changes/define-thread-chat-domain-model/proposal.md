## Why

当前 ThreadChat 的真实权威模型是 `ThreadTreeState`：浏览器生成 `treeId`，`branch_trees` 以一行 `state JSONB` 保存整棵树，Thread、Message 与 Artifact 都嵌在该 JSON 中；生成执行则由 `branch_generations` 作为 sidecar 持久化。代码和数据库中目前没有 Project 实体，也没有独立的 Thread、Message 表。

整树读写把内容身份、拓扑、消息、运行状态和界面协作绑在同一个大对象里，已经成为后续分享、独立 API、服务端权限校验和前端增量数据流的共同阻碍。本 change 要从这个真实基线出发，建立规范化的 `Project → Thread → Message` 目标模型：Project 接替当前一棵 Thread Tree 的产品边界，Thread 与 Message 成为可独立寻址的服务端实体。

## What Changes

- **BREAKING**：以 Project 取代当前 Thread Tree 作为一整簇分叉对话的聚合根、列表项、URL 身份与永久删除边界。
- **BREAKING**：退出 `branch_trees.state` 整树 JSON 权威写入；将 Project、Thread、Message 与 MessageRun 规范化持久化。
- **BREAKING**：新实体 ID 全部由服务端生成；客户端不再生成 `treeId` 或待创建的 Thread、Message、MessageRun ID。
- MVP 沿用当前直接用户所有权：Project 通过 `ownerUserId` 归属于用户；本 change 不新建团队、成员或其他平台分组实体。
- Project 成为一整簇 Thread 的唯一聚合边界，拥有且仅拥有一个 Root Thread，并拥有全部后代 Thread。
- “新对话”创建新的 `Project + Root Thread`；当前 UI 的“对话列表”列出当前用户拥有或可访问的 Project。
- Project 负责整簇 Thread 共享的 Memory、Instruction、Target、Files 与 Artifacts；精确资源协议由后续独立 change 定义。
- Artifact 归属于 Project，同时保留来源 Message 身份，用于解释它由哪个 Thread 中的哪条消息产生。
- Root Thread 与 Branch Thread 是统一 Thread 的关系角色；目标模型不保留当前 `MainThread`、`ForkedThread` 或整棵 `ThreadTreeState` 作为持久化实体。
- Thread 内 Message 使用服务端分配的 `sequence` 形成线性追加历史，不要求 user/assistant 角色交替，也不沿用当前 `parentMessageId + activeLeafMessageId` 消息图作为目标时间线模型。
- finalized Message 不允许原地改写；Edit 与 Regenerate 创建 replacement Message，并使用 `supersededAt` 与 `replacesMessageId` 让旧 Message 退出默认时间线。
- Fork 仍由服务端创建 Child Thread，并保存 `parentThreadId`、`sourceMessageId`、`forkSourceSnapshot` 和只包含有序 `messageIds` 的 BaseContext。
- Fork 只能使用 finalized 且具备 Prompt 资格的 Message；最后一条 assistant queued/running 时，前端禁用且后端拒绝 Fork。
- 单条 Message 不执行 hard delete；只有永久删除整个 Project 时，统一清理其 Thread、Message、MessageRun 与 Project 附属资源。
- 每条 assistant Message 对应一条持久化 MessageRun；它取代当前 `branch_generations` 的 attempt/current sidecar 语义。user Message 不具有 MessageRun，浏览器断开不停止后台运行。
- 本 change 只更新领域规范与目标设计，不修改应用代码、数据库、API 或前端；`tasks.md` 按已确认约定暂不更新。

## Capabilities

### New Capabilities

- 无。

### Modified Capabilities

- `domain`：从当前 `Thread Tree → embedded Thread → embedded Message` 基线迁移到规范化的 `Project → Thread → Message`，并明确 Fork、replacement、BaseContext 与 MessageRun 的目标边界。

## Impact

- OpenSpec：重写 `domain` 增量规范和设计；后续持久化、API、MessageRun、客户端 Store 与退役 change 必须以当前 `ThreadTreeState / branch_trees / branch_generations` 为迁移起点。
- 后端目标：新增 `projects`、`threads`、`messages`、`message_runs` 等规范化表；逐步退役 `branch_trees.state` 与 `branch_generations` 权威路径。
- 前端目标：`/thread-chat/{projectId}` 加载 `ProjectBootstrap`；“新对话”创建 Project；“对话列表”列出 Projects；客户端 Store 从整树快照改为规范化实体与衍生拓扑。
- 身份与权限：Project 先直接引用当前登录用户；所有读取和命令都从服务端 Session 校验用户对 Project 的访问权。
- 共享资源：Project Memory、Instruction、Target、Files 和 Artifacts 对该 Project 的全部 Thread 可用，不跨 Project 自动共享。
- 现有数据：迁移必须显式映射 `branch_trees.id/state/title/custom_title/user_id`、嵌入 Thread/Message/Artifact 以及对应 `branch_generations`；不得假设存在其他中间实体或表。
