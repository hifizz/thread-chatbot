## ADDED Requirements

### Requirement: 统一客户端状态架构术语
客户端规范、设计和实现 MUST 使用以下术语，并 MUST NOT 用同一个 `Action` 同时指代本地状态转换和跨边界业务流程：

- **Store State**：Zustand Store 保存的数据，包括服务端确认实体、运行态、请求状态和本地 UI 状态。
- **Store Action**：与对应 Store 或 slice 共置、通过 Zustand `set`/`setState` 执行一次受控 State Transition 的函数。Store Action MUST NOT 调用后端 API、管理路由或建立事件连接。
- **Application Command**：位于 Store 外、代表一个用户或生命周期业务意图的可测试流程。它 MAY 调用 API、协调订阅与路由，但 MUST 通过 Store Action 提交状态变化，不得自行调用 `set`/`setState`。
- **Selector Hook**：通过细粒度 selector 订阅 Store，并向 UI 暴露 State 或衍生 ViewModel 的读取 Hook。
- **Command Hook**：把作用域 ID 与 Application Command 或纯本地 Store Action 绑定为 UI 事件接口的 Hook；它不得包含业务规则或直接修改 State。
- **Lifecycle Hook**：负责 Bootstrap、按需加载、生成订阅和本地偏好持久化等 React 生命周期接入的 Hook；真正流程仍委托给 Application Command 或 coordinator。

本文中的“状态变更”表示通过 `set`/`setState` 产生新状态并通知订阅者，不表示对现有 State 对象做任意原地修改。

#### Scenario: API 成功后提交状态
- **WHEN** Application Command 收到并校验合法服务端 DTO
- **THEN** 它 MUST 调用语义明确的 Store Action 原子合并 DTO
- **AND** Application Command、Transport 和 React 组件 MUST NOT 绕过 Store Action 直接调用 `set`/`setState`

#### Scenario: 纯本地 UI 操作
- **WHEN** 用户只改变可见列、画布位置或 overlay 等本地 UI State
- **THEN** Command Hook MAY 直接调用对应 UI slice 的 Store Action
- **AND** 不得为了纯本地 State Transition 建立没有跨边界职责的 Application Command

### Requirement: 使用规范化客户端实体模型
客户端 MUST 以 Project、Thread、Message 和 Artifact 的服务端 DTO 作为已确认内容事实，并 MUST 以 `assistantMessageId` 为关联键保存 AssistantRunState。客户端 MUST NOT 把整棵 Thread 拓扑、Message 列表和运行态重新组合成可整体写回的 `ThreadTreeState`。

Thread 的 Root/Branch、children、depth 和 breadcrumb MUST 由 `parentThreadId` 派生；Message 默认时间线 MUST 由 `supersededAt IS NULL` 和 `sequence ASC` 派生。BaseContext MUST 保持为服务端内部事实，不得进入普通客户端实体状态或由客户端重建。

#### Scenario: 合并 ProjectBootstrap
- **WHEN** 客户端收到包含 Project、Thread topology、Message、AssistantRunState 和 Artifact 的合法 ProjectBootstrap
- **THEN** 客户端 MUST 按实体 ID 规范化合并各类 DTO
- **AND** 不得保存第二份整树权威快照

#### Scenario: 派生 Branch 关系
- **WHEN** 一个 Thread 的 `parentThreadId` 指向同 Project 的另一个 Thread
- **THEN** selector MUST 将它作为该 Parent 的 Child/Branch Thread 展示
- **AND** 客户端不得要求服务端同时返回可独立修改的 `children` 数组

### Requirement: 按生命周期划分 Zustand Store
客户端 MUST 使用一个轻量 ProjectCatalogStore 管理 Project 列表，并 MUST 为每个打开的 `projectId` 创建独立 ThreadChatStore。ThreadChatStore MUST 以高内聚 slice 区分已确认 entities、加载/命令状态、生成流状态和本地 workbench UI 状态；它们可以位于同一个 Zustand store，但不得互相复制权威数据。

ProjectCatalogStore MUST NOT 保存 Thread 或 Message。Project-scoped Store 在离开对应 Project 页面后 MUST 可被销毁，不得让多个 Project 的 Message 长期堆积在无边界全局 Store 中。

#### Scenario: 打开两个 Project
- **WHEN** 用户先后打开 Project A 和 Project B
- **THEN** 两个 Project 的 ThreadChatStore MUST 具有隔离的实体、生成和工作台状态
- **AND** ProjectCatalogStore MUST 只保留两者的轻量列表信息

#### Scenario: 高频流事件只更新相关订阅者
- **WHEN** 某条 assistant Message 收到生成增量
- **THEN** Store MUST 只改变该 `assistantMessageId` 对应的生成流状态
- **AND** 只订阅其他 Thread 或 Project 元数据的组件 MUST NOT 因全局 version 而被强制重算

### Requirement: 区分服务端事实、运行态和本地 UI 态
Project、Thread、Message、Artifact 和 MessageRun 终态 MUST 以服务端响应为权威。运行中的 checkpoint 和 eventSequence MUST 保存于生成 slice；visibleThreadIds、列宽、画布位置、composer 草稿、overlay 和选中 Artifact MUST 保存为本地 UI 态。

客户端 MAY 将设备相关 workbench UI 态持久化到 localStorage，但 MUST NOT 将它提交为 Project 内容。客户端 MUST NOT 为乐观展示伪造 Project、Thread、Message 或 MessageRun ID。

#### Scenario: 发送期间展示等待态
- **WHEN** 用户提交命令但服务端尚未返回新实体
- **THEN** 客户端 MUST 使用本地 submitting/busy 状态展示等待
- **AND** 不得向 entities slice 插入 `temp-*`、`main` 或客户端 UUID 形式的待创建实体

#### Scenario: 恢复工作台偏好
- **WHEN** ProjectBootstrap 成功且浏览器存在该 Project 的列布局偏好
- **THEN** 客户端 MUST 过滤其中已经不存在的 Thread ID 后恢复布局
- **AND** 本地布局不得覆盖服务端返回的 Thread topology

### Requirement: 通过 selector 生成 UI ViewModel
客户端 MUST 使用纯 selector 从 entities、AssistantRunState 和 UI state 生成 ThreadColumnView、ProjectTreeRows、MessageView、ForkAvailability 和 ProjectHeaderView 等 ViewModel。派生结果 MUST NOT 作为另一份可独立修改的领域状态持久化。

Selector MUST 至少覆盖 Root Thread、Child Thread、depth、breadcrumb、有效 Message 时间线、Message 运行展示、Artifact 来源、Fork 可用性和可见列组合。

#### Scenario: replacement 后重算消息视图
- **WHEN** Store 合并一条 replacement Message 并将来源 Message 标记为 superseded
- **THEN** Thread Message selector MUST 隐藏来源 Message并按 sequence 展示 replacement
- **AND** 不得通过手动修改 UI Message 数组维持第二份时间线

#### Scenario: 组合 ThreadColumnView
- **WHEN** UI 请求一个 Thread 的列视图
- **THEN** selector MUST 组合 Thread、有效 Messages、相关 AssistantRunState、Artifact、breadcrumb 和操作可用性
- **AND** 该 ViewModel 不得成为 API 写入对象

### Requirement: 使用 Application Command 执行业务意图
UI 组件和 React Hook MUST NOT 直接调用 `fetch`、构造 Prompt、创建实体 ID或修改服务端实体。跨越 API、事件连接或路由的用户意图 MUST 进入可独立测试的 Application Command，由 Command 调用 API capability、校验结果并通过 Store Action 原子合并 Store。

Application Command MUST 至少覆盖：加载/创建 Project、加载 Thread、发送首条消息、发送后续消息、Fork、Edit、Regenerate、Stop、feedback、更新 Project 元数据以及生成恢复。

#### Scenario: Fork Command 成功
- **WHEN** UI 调用 Fork Application Command 并传入已有 sourceThreadId、sourceMessageId 和选区信息
- **THEN** Command MUST 调用服务端 Fork API 并通过 Store Action 合并服务端返回的 Child Thread
- **AND** UI 层 MAY 在成功后打开新 Thread，但不得自行计算 BaseContext 或 Child Thread ID

#### Scenario: Application Command 失败
- **WHEN** 服务端返回结构化领域错误
- **THEN** Command MUST 保持既有已确认 entities 不变并通过 Store Action 更新相应命令错误状态
- **AND** Hook MUST 向 UI 暴露可展示的失败结果

### Requirement: 使用 Hooks 连接 Store、Command 与 UI
客户端 MUST 将 Hook 分为 Selector Hook、Command Hook 和 Lifecycle Hook。Selector Hook MUST 通过细粒度 selector 订阅 Store；Command Hook MUST 调用 Application Command 或纯本地 Store Action；Lifecycle Hook MUST 只负责把 React 生命周期接入 Bootstrap、按需加载、生成订阅和本地偏好持久化流程。

普通衍生数据 MUST NOT 通过 `useEffect + setState` 镜像 Store。单个 Message 组件 MUST NOT 自行发起 Message 或 Generation 查询。

#### Scenario: Thread 组件读取数据
- **WHEN** ThreadColumn 渲染指定 `threadId`
- **THEN** 它 MUST 通过 Selector Hook 获得 ThreadColumnView
- **AND** 不得接收整棵 Project 状态后自行遍历并维护副本

#### Scenario: 页面恢复生成订阅
- **WHEN** 生命周期 Hook 发现已加载 Message 中存在 queued/running AssistantRunState
- **THEN** 它 MUST 交给统一 generation coordinator 从 eventSequence 恢复订阅
- **AND** 每个 Message 组件不得建立重复订阅

### Requirement: 支持无实体 ID 的新 Project 入口
`/thread-chat/new` MUST 表示本地新 Project 草稿入口，不得把 `new` 当作 Project ID。页面 MUST 在没有 Project/Thread 实体的情况下复用空白聊天 UI；用户第一次发送前不得写入 Project 列表或创建假的 Root Thread。

第一次发送成功后，客户端 MUST 合并服务端原子返回的 Project、Root Thread、user Message、assistant Message 和 AssistantRunState，并 MUST 使用 `router.replace` 进入 `/thread-chat/{projectId}`。失败时 MUST 留在 `/thread-chat/new` 并保留草稿。

#### Scenario: 打开后直接离开 new 页面
- **WHEN** 用户打开 `/thread-chat/new` 但未发送任何内容便离开
- **THEN** 系统 MUST NOT 创建 Project、Thread、Message 或 MessageRun

#### Scenario: 首次发送成功
- **WHEN** 用户在 `/thread-chat/new` 发送第一条有效 Message
- **THEN** 客户端 MUST 调用创建 Project 的 Application Command，并通过 Store Action 使用服务端返回的实体初始化 Project Store
- **AND** URL MUST 被替换为服务端返回的 canonical Project URL

#### Scenario: 首次发送失败
- **WHEN** 创建命令在服务端提交前失败
- **THEN** 客户端 MUST 保留本地输入并允许重试
- **AND** 不得向 ProjectCatalogStore 增加未确认 Project

### Requirement: 采用轻量 Bootstrap 与按 Thread 加载
进入持久化 Project 时，客户端 MUST 首先加载 ProjectBootstrap。Bootstrap MUST 包含 Project、全量轻量 Thread topology、Root Thread 的有效 Message、相关 AssistantRunState 和渲染这些 Message 所需的 Artifact，但 MUST NOT 包含所有 Branch Message、BaseContext 或全部大型资源正文。

其他 Thread 的 Message MUST 在首次打开时按 Thread 加载。MVP 客户端 MUST 支持一次合并最多 200 条按 sequence 升序排列的有效 Message，并 MUST 保留服务端返回的 `hasOlderMessages` 信息，但不要求实现复杂的树内自动分页替换。

#### Scenario: 初次进入已有 Project
- **WHEN** 用户打开 `/thread-chat/{projectId}`
- **THEN** 客户端 MUST 先合并 ProjectBootstrap 并展示 Root Thread
- **AND** 不得为了渲染 topology 下载全部 Branch Message

#### Scenario: 首次打开 Branch Thread
- **WHEN** 用户打开尚未加载 Message 的 Branch Thread
- **THEN** 客户端 MUST 只请求该 Thread 的 Message bundle 并合并结果
- **AND** 重复打开已加载 Thread 不得自动重复请求

### Requirement: 恢复服务端 MessageRun
客户端 MUST 使用 `assistantMessageId + eventSequence` 识别和恢复生成。queued/running 的展示 MUST 先使用服务端 checkpoint，再从最后 eventSequence 之后订阅；completed MUST 使用 finalized Message.parts；failed/stopped MUST 展示终态且不得自动重启。

刷新、路由切换或取消订阅 MUST NOT 发送 Stop。只有明确的用户 Stop Application Command 可以请求服务端停止 MessageRun。

#### Scenario: 刷新后恢复 running Message
- **WHEN** ProjectBootstrap 或 Thread bundle 返回 running AssistantRunState
- **THEN** 客户端 MUST 立即展示 checkpoint 并从返回的 eventSequence 之后恢复订阅
- **AND** 不得创建新的 assistant Message 或 MessageRun

#### Scenario: 收到 completed 事件
- **WHEN** generation coordinator 收到合法 completed 终态
- **THEN** 客户端 MUST 合并服务端给出的 finalized Message 和终态 Run
- **AND** 必须清除对应的临时流缓冲
