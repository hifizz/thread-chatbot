# thread-chat-command-api Specification

## Purpose

定义 Thread Chat `/api/v1` 的共享契约、查询、命令、SSE、权限与错误语义。

稳定说明见 [api-contracts.md](./api-contracts.md)。若说明文档与本规范冲突，以本规范中的可验证 Requirement 与 Scenario 为准；任何实现变更都 MUST 同步校验正式规范、说明文档、共享 Schema、Route/Runtime 实现与验收测试。

## Requirements

### Requirement: 使用版本化 API 和服务端实体身份
ThreadChat 后端 MUST 在 `/api/v1` 下提供版本化 Query、Command 和事件接口。客户端 MUST 只提交正在操作的既有资源 ID；Project、Thread、Message 和 MessageRun 的新 ID MUST 由服务端生成并在成功响应中返回。

服务端 MUST 从认证 Session 确定 actor，MUST 对每个 Project、Thread 和 Message 操作执行归属或访问授权校验。普通 JSON 成功响应 MUST 返回 `{ data: T }` 中的权威 DTO，错误 MUST 返回 `{ error: { code, message, details? } }`；204 和事件流除外。请求 Object MUST 严格校验未声明字段。MVP 普通追加、Fork 和生成命令 MUST NOT 要求 Project/Thread revision 或 If-Match。

#### Scenario: 客户端提交待创建实体 ID
- **WHEN** 创建或 Fork 请求包含 newProjectId、newThreadId、newMessageId 或 newMessageRunId
- **THEN** 服务端 MUST 忽略或拒绝这些字段
- **AND** 成功结果中的实体 ID MUST 来自服务端

#### Scenario: 访问其他用户的 Project
- **WHEN** actor 对目标 Project 没有访问权
- **THEN** 服务端 MUST 返回 403 或不泄漏存在性的 404
- **AND** 不得返回 Project topology、Message 或运行状态

### Requirement: 提供 Project 列表与元数据命令
服务端 MUST 提供列出、更新、归档和永久删除 Project 的能力。列表 MUST 为轻量 ProjectSummary，按 `updatedAt DESC, id DESC` 稳定排序，不得包含 Thread topology 或 Message 正文。

Project metadata 更新 MUST 允许独立修改 customTitle、Target 和 Instruction；未提供字段 MUST 保持不变，显式 null MUST 按字段契约清空。MVP 对 metadata 使用服务端最后写入生效，不引入通用 revision。

#### Scenario: 列出 Project
- **WHEN** 客户端请求 `GET /api/v1/projects`
- **THEN** 服务端 MUST 只返回 actor 可访问的 ProjectSummary
- **AND** 每项 MUST 至少包含 id、展示标题、archivedAt、updatedAt 和轻量统计

#### Scenario: 更新 Project Target
- **WHEN** 客户端请求 `PATCH /api/v1/projects/{projectId}` 并提交合法 Target
- **THEN** 服务端 MUST 更新该 Project 的终极、短期和中期目标集合
- **AND** 不得修改 Thread、Message 或其他 Project

#### Scenario: 永久删除 Project
- **WHEN** 已授权 actor 明确请求永久删除 Project
- **THEN** 服务端 MUST 按领域规范清理其 Thread、Message、MessageRun 和附属资源
- **AND** 后续 Bootstrap MUST 返回 not_found

### Requirement: 原子创建首个 Project 对话
服务端 MUST 允许客户端用一条命令提交首条 user Message，并在同一数据库事务创建 Project、唯一 Root Thread、user Message、assistant Message 和 queued MessageRun。事务成功前不得唤醒模型执行；任一实体写入失败 MUST 回滚全部创建。

请求 MUST 包含符合 AI SDK v7 UIMessage.parts 的 `initialMessage.parts`，并 MAY 包含 `requestedModelId`。请求不得包含新实体 ID。响应 MUST 返回全部创建实体、初始 ProjectArtifactSummary 和 AssistantRunState。服务端 MUST NOT 返回或构造 Web 页面 URL；页面路由由客户端根据响应中的 `project.id` 决定。

#### Scenario: 首次发送成功
- **WHEN** 客户端请求 `POST /api/v1/projects` 并提交合法 initialMessage
- **THEN** 服务端 MUST 返回 201 及 Project、Root Thread、U1、A1 和 queued Run
- **AND** 初始 ProjectArtifactSummary MUST 是 `{ changeSequence: 0, total: 0, byKind: {} }`
- **AND** 数据库中不得存在缺少 Root Thread 或缺少 A1 Run 的部分 Project

#### Scenario: 创建响应与 Web 路由解耦
- **WHEN** 服务端成功创建首个 Project 对话
- **THEN** CreationBundle MUST 包含可作为资源身份的 `project.id`
- **AND** CreationBundle MUST NOT 包含 `canonicalUrl`、`pageUrl` 或其他客户端页面路径
- **AND** Web 客户端 MUST 使用集中式路由构造器决定导航目标

#### Scenario: 首次发送校验失败
- **WHEN** initialMessage.parts 为空、非法或不符合允许的 UIMessage part 协议
- **THEN** 服务端 MUST 返回 validation_error
- **AND** 不得创建任何 Project 数据

### Requirement: 提供 ProjectBootstrap Query
服务端 MUST 提供 `GET /api/v1/projects/{projectId}/bootstrap`。响应 MUST 包含 Project DTO、全量轻量 ThreadTopologyItem、ProjectArtifactSummary、唯一 Root Thread 的 MessageBundle，以及恢复这些 Message 所需的 AssistantRunState。Message 中可以包含 Artifact ID 引用，但 Bootstrap 不得返回 Artifact 正文。

Bootstrap MUST NOT 返回 BaseContext、所有 Branch Message、全部 Project File/Artifact 正文或服务端 Prompt。Thread topology MUST 足以由客户端派生 Root、Child、depth 和 breadcrumb。

ProjectArtifactSummary MUST 统计该 Project 的全部 Artifact，并 MUST 至少返回服务端单调 `changeSequence`、总数和按稳定 `kind` 聚合的数量。它不得退化为客户端已经按 ID 加载的 Artifact 数量；`total` 必须等于各 kind 计数之和。`changeSequence` 只用于拒绝乱序旧统计，不得成为 Command 请求参数或写入前置条件。

#### Scenario: 加载现有 Project
- **WHEN** actor 请求可访问 Project 的 Bootstrap
- **THEN** 服务端 MUST 返回且只返回一个 Root Thread，并返回全部轻量 topology
- **AND** Root MessageBundle MUST 按 sequence 升序排列有效 Message
- **AND** ProjectArtifactSummary MUST 覆盖该 Project 全量 Artifact

#### Scenario: Project 不存在
- **WHEN** projectId 不存在或不可访问
- **THEN** 服务端 MUST 返回 not_found
- **AND** 不得创建空 Project 作为降级结果

#### Scenario: 未加载 Branch Artifact 仍计入统计
- **WHEN** Project 的 Branch Thread 中存在 3 个 Markdown Artifact，但 Bootstrap 不返回该 Branch 的 Message
- **THEN** `artifactSummary.byKind.markdown` MUST 仍然等于 3
- **AND** Root bundle MUST NOT 因此返回这 3 个 Artifact 的正文

### Requirement: 按 Thread 提供 MessageBundle
服务端 MUST 提供 `GET /api/v1/threads/{threadId}/messages`，并 MUST 通过 Thread 所属 Project 校验访问权。响应 MUST 返回有效 Message 与相关 AssistantRunState；默认最多返回最新 200 条，再按 sequence 升序输出。

响应 MUST 包含 `hasOlderMessages` 和可供未来向前加载的边界 sequence。MVP 客户端可以不请求更早页面，但 API 不得让调用方通过下载整棵 Project 才能读取一个 Thread。

P0 中，Markdown tool result MUST 在符合 AI SDK v7 的 Message part 中保存 `artifactId`，不得复制 Markdown 正文。客户端需要展示正文时 MUST 通过独立 Artifact Query 按 ID 加载。

#### Scenario: Thread 少于 200 条有效 Message
- **WHEN** 客户端读取包含 80 条有效 Message 的 Thread
- **THEN** 服务端 MUST 返回全部 80 条并设置 `hasOlderMessages=false`

#### Scenario: Thread 超过 200 条有效 Message
- **WHEN** 客户端未指定边界读取包含超过 200 条有效 Message 的 Thread
- **THEN** 服务端 MUST 返回最新 200 条并按 sequence 升序排列
- **AND** 必须设置 `hasOlderMessages=true` 和更早页面边界

### Requirement: 提供 Thread 元数据命令
服务端 MUST 允许授权 actor 更新 Branch Thread 的 customTitle，并 MUST 提供归档和取消归档 Thread 的显式命令。Root Thread 的展示标题 MUST 继续来自 Project，客户端不得通过 Thread metadata 命令为 Root 建立第二套标题权威。

归档 Thread MUST 保留其 Message、Child Thread、Fork 来源和 BaseContext；它只改变默认导航可见性，不得等同于永久删除。

#### Scenario: 重命名 Branch Thread
- **WHEN** 客户端请求 `PATCH /api/v1/threads/{threadId}` 并提交合法 customTitle
- **THEN** 服务端 MUST 更新该 Branch Thread 标题并返回最新 Thread DTO
- **AND** 不得修改 Project 标题

#### Scenario: 归档 Thread
- **WHEN** 客户端请求 `POST /api/v1/threads/{threadId}/archive`
- **THEN** 服务端 MUST 设置 archivedAt 并保留完整 Thread 内容和后代关系

### Requirement: 原子发送后续消息并启动生成
服务端 MUST 提供在既有 Thread 中发送 user Message 的常用原子命令。该命令 MUST 在同一事务创建 user Message、assistant Message 和 queued MessageRun，并返回三者；模型执行只能在事务提交后启动。

Path MUST 包含已有 `threadId`；Body MUST 只包含合法 user `parts` 和可选 `requestedModelId`。服务端 MUST 根据当前有效历史构造 Prompt，客户端不得提交 Prompt History、BaseContext、待创建 ID 或整棵 Project 状态。

P0 MUST NOT 额外提供“只创建 user Message、不创建 assistant Message 与 MessageRun”的发送命令。该限制只是当前 API 能力边界，不得被实现为 user/assistant 必须角色交替的数据库约束。

P0 MUST NOT 额外提供“只创建 user Message、不创建 assistant Message 与 MessageRun”的发送命令。该限制只是当前 API 能力边界，不得被实现为 user/assistant 必须角色交替的数据库约束。

#### Scenario: 在 Root Thread 发送消息
- **WHEN** 客户端请求 `POST /api/v1/threads/{threadId}/messages` 并提交合法 user parts
- **THEN** 服务端 MUST 分配新的 sequence 并返回 user Message、assistant Message 和 queued Run
- **AND** 响应中的所有新 ID MUST 由服务端生成

#### Scenario: 同 Thread 已有运行中生成
- **WHEN** 当前产品策略不允许同一 Thread 并发生成且已有 queued/running Run
- **THEN** 服务端 MUST 返回 `thread_generation_in_progress`
- **AND** 不得依赖客户端 busy 状态作为唯一保护

### Requirement: 原子创建 Fork Thread
服务端 MUST 提供从已有 sourceThreadId 和 sourceMessageId 创建 Child Thread 的命令。请求 MAY 包含用户选区 anchor/quote，但 MUST NOT 包含 BaseContext、ForkSourceSnapshot 的权威字段或 Child Thread ID。

服务端 MUST 验证来源资格、同 Project 关系和无环约束，在一个事务中计算并持久化 BaseContext、ForkSourceSnapshot 和 Child Thread，然后返回新 Thread DTO。

#### Scenario: 从 completed assistant Message Fork
- **WHEN** 客户端请求 `POST /api/v1/threads/{sourceThreadId}/forks` 且 sourceMessage 合格
- **THEN** 服务端 MUST 返回 201 和服务端创建的 Child Thread
- **AND** Child Thread 必须属于同一 Project并冻结到来源 Message 的 BaseContext

#### Scenario: 从 running assistant Message Fork
- **WHEN** sourceMessage 的 Run 为 queued 或 running
- **THEN** 服务端 MUST 返回 `fork_source_not_finalized`
- **AND** 不得创建部分 Child Thread

### Requirement: 使用 replacement 命令实现 Edit 和 Regenerate
服务端 MUST 分别提供 Edit 最后一条有效 user Message 和 Regenerate 当前可重新生成 assistant Message 的命令。两种命令 MUST 创建服务端 ID 的 replacement Message；Regenerate 以及 Edit 后的新回答 MUST 同时创建新的 queued MessageRun，且不得覆盖旧 Message.parts 或 sequence。

Edit 请求 MUST 只提交 sourceUserMessageId、新 parts 和可选 requestedModelId。Regenerate 请求 MUST 只提交 sourceAssistantMessageId 和可选 requestedModelId。响应 MUST 返回被 superseded 的 Message ID、全部新增 Message 和新的 AssistantRunState。

#### Scenario: Regenerate 当前 assistant Message
- **WHEN** 客户端请求 `POST /api/v1/messages/{assistantMessageId}/regenerations` 且来源可重新生成
- **THEN** 服务端 MUST 返回 replacement assistant Message 和新的 queued Run
- **AND** 来源 Message 的内容与 sequence 必须保持不变

#### Scenario: Edit 最后一条 user Message
- **WHEN** 客户端请求 `POST /api/v1/messages/{userMessageId}/edits` 并提交新 parts
- **THEN** 服务端 MUST 返回 replacement user Message、replacement assistant Message、queued Run 和被 superseded 的后缀 ID

#### Scenario: Edit 历史 user Message
- **WHEN** sourceUserMessageId 不是当前 Thread 最后一条有效 user Message
- **THEN** 服务端 MUST 返回 `fork_required`
- **AND** 不得修改任何既有 Message

### Requirement: 通过 assistantMessageId 管理生成生命周期
服务端 MUST 允许客户端使用 assistantMessageId 查询、通过 SSE 订阅并停止对应 MessageRun，而不要求客户端理解内部 MessageRun ID。SSE 事件流 MUST 使用严格递增的 eventSequence，并 MUST 支持 `afterEventSequence` 恢复。每次连接 MUST 先返回当前持久化 checkpoint snapshot 及其 cursor；若仍在运行，后续 live event MUST 严格大于该 cursor。旧 token delta MAY 不逐条重放，但恢复结果不得丢失已经持久化的生成内容。

Stop MUST 是显式 Command；连接关闭、页面刷新或取消订阅不得自动停止 Run。终态事件 MUST 携带或允许随后取得 finalized Message 和终态 AssistantRunState。`run.snapshot` 与 `run.completed` MUST 携带当前 ProjectArtifactSummary，使客户端能够在刷新、重连和 Artifact 生成完成后校正 Project 页面统计；客户端不得依赖事件次数自行累加。

#### Scenario: 恢复 running 事件流
- **WHEN** 客户端请求 assistant Message 事件且提交 `afterEventSequence=42`
- **THEN** 服务端 MUST 先发送不旧于该游标的当前 checkpoint snapshot
- **AND** 后续 live event MUST 大于 snapshot cursor
- **AND** 不得重新启动第二个 MessageRun

#### Scenario: 显式停止生成
- **WHEN** 客户端请求 `POST /api/v1/assistant-messages/{assistantMessageId}/stop`
- **THEN** 服务端 MUST 对 queued/running Run 记录 stop 请求并返回最新 AssistantRunState
- **AND** 重复 Stop MUST 返回相同终态或当前状态而不创建新 Run

#### Scenario: 仅断开订阅
- **WHEN** 浏览器关闭事件连接但未发送 Stop
- **THEN** MessageRun MUST 继续由服务端执行

### Requirement: 按 ID 加载 Artifact
服务端 MUST 提供 `GET /api/v1/artifacts/{artifactId}`，并 MUST 通过 Artifact 所属 Project 校验访问权。Message、ThreadMessageBundle、ProjectBootstrap 和生成事件 MUST 只通过 `artifactId` 引用 Artifact，不得复制 Markdown 正文。

#### Scenario: 打开 Markdown Artifact
- **WHEN** 用户打开 Message tool result 引用的 Markdown Artifact
- **THEN** 客户端 MUST 使用 `artifactId` 请求 Artifact Query
- **AND** 服务端 MUST 返回对应 Artifact 的完整内容

#### Scenario: 未打开 Artifact
- **WHEN** 客户端只加载 ProjectBootstrap 或 ThreadMessageBundle，但用户没有打开 Artifact
- **THEN** 服务端 MUST NOT 返回 Artifact 正文

### Requirement: 提供 Message feedback 命令
服务端 MUST 允许客户端按 assistantMessageId 设置 positive、negative 或 null feedback。只有 finalized 且允许评价的 assistant Message 可以接受 feedback；命令不得修改 Message 内容或 MessageRun。

#### Scenario: 设置正向反馈
- **WHEN** 客户端请求 `PUT /api/v1/messages/{assistantMessageId}/feedback` 并提交 `positive`
- **THEN** 服务端 MUST 返回该 Message 最新 feedback

#### Scenario: 评价 user Message
- **WHEN** 目标 Message 不是 assistant Message
- **THEN** 服务端 MUST 返回 `message_not_feedback_eligible`
