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
- **WHEN** 客户端收到包含 Project、Thread topology、Root Message、AssistantRunState 和 Project Artifact Summary 的合法 ProjectBootstrap
- **THEN** 客户端 MUST 按实体 ID 规范化合并这些 DTO 与读模型
- **AND** 不得保存第二份整树权威快照
- **AND** Bootstrap 中的 Message 只通过 tool result 的 `artifactId` 引用 Artifact，不得附带 Artifact 正文

#### Scenario: 派生 Branch 关系
- **WHEN** 一个 Thread 的 `parentThreadId` 指向同 Project 的另一个 Thread
- **THEN** selector MUST 将它作为该 Parent 的 Child/Branch Thread 展示
- **AND** 客户端不得要求服务端同时返回可独立修改的 `children` 数组

### Requirement: 按生命周期划分 Zustand Store
客户端 MUST 使用一个轻量 ProjectCatalogStore 管理 Project 列表，并 MUST 为每个打开的 `projectId` 创建独立 ThreadChatStore。ThreadChatStore MUST 以高内聚 slice 区分已确认 entities、服务端统计 read models、加载/命令状态、生成流状态和本地 workbench UI 状态；它们可以位于同一个 Zustand store，但不得互相复制权威数据。

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
Project、Thread、Message、Artifact、Project Artifact Summary 和 MessageRun 终态 MUST 以服务端响应为权威。运行中的 checkpoint 和 eventSequence MUST 保存于生成 slice；visibleThreadIds、Column Slot、列宽、画布位置、composer 草稿、overlay 和选中 Artifact MUST 保存为本地 UI 态。

客户端 MAY 将设备相关 workbench UI 态持久化到 localStorage，但 MUST NOT 将它提交为 Project 内容。客户端 MUST NOT 为乐观展示伪造 Project、Thread、Message 或 MessageRun ID。

#### Scenario: 发送期间展示等待态
- **WHEN** 用户提交命令但服务端尚未返回新实体
- **THEN** 客户端 MUST 使用本地 submitting/busy 状态展示等待
- **AND** 不得向 entities slice 插入 `temp-*`、`main` 或客户端 UUID 形式的待创建实体

#### Scenario: 恢复工作台偏好
- **WHEN** ProjectBootstrap 成功且浏览器存在该 Project 的列布局偏好
- **THEN** 客户端 MUST 过滤其中已经不存在的 Thread ID、重复 Slot/Thread、非法宽度和无效 Canvas pin 后恢复布局
- **AND** 本地布局不得覆盖服务端返回的 Thread topology

### Requirement: 使用稳定 Column Slot 表达物理列
客户端 MUST 使用纯本地 `ColumnSlotId` 表示 Root 右侧物理列，并 MUST 将 Slot 当前展示的 `threadId` 与 Slot 身份分离。Root MUST 使用独立固定列身份，不得进入 Branch Slot 数组。

切换一个物理列所展示的 Thread 时，客户端 MUST 保留该 Slot 的 `slotId`、物理位置、折叠态和显式列宽，只替换 `threadId`。`ColumnSlotId` 不是服务端实体 ID，MUST NOT 进入 Project、Thread、Message、Fork 或 Generation API 请求。

#### Scenario: 本列切换 Thread
- **WHEN** 用户通过现有列 Header 切换器把 Slot S 从 Thread A 切换到 Thread B
- **THEN** Store MUST 保持 S 的 `slotId`、宽度、折叠态和位置不变，并将 S 的 `threadId` 更新为 B
- **AND** 不得因为切换内容而重建物理列或把 A 的宽度改绑到 Thread B 实体

#### Scenario: 恢复重复 Thread 的非法 Snapshot
- **WHEN** 本地 Snapshot 中两个 Slot 指向同一个 Thread 或复用了同一个 Slot ID
- **THEN** 客户端 MUST 按稳定顺序只保留第一个合法 Slot
- **AND** 不得在同一工作台恢复两列相同 Thread

### Requirement: 支持分栏分割线拖拽
客户端 MUST 保留现有相邻展开列之间的分割线拖拽能力。分割线 MUST 同时调整左右两个物理列，并遵守当前 UI 的最小列宽约束；Root 宽度 MUST 归属于固定 Root 列，Branch 宽度 MUST 归属于稳定 Column Slot，而不是 Thread Entity。

Pointer Move 期间的坐标、临时宽度和 Pointer Capture MUST 保持为 Resizer Hook 或组件局部瞬时状态，不得逐帧写入 Zustand。Pointer Up、键盘步进或双击复位时，客户端 MUST 通过一次 Store Action 原子提交受影响列的最终宽度；提交后的宽度 MUST 进入工作台 Snapshot，滚动位置和拖拽瞬时状态不得持久化。该操作 MUST NOT 调用服务端 API。

#### Scenario: 拖拽相邻列分割线
- **WHEN** 用户拖动两个展开列之间的分割线并释放 Pointer
- **THEN** Store MUST 在一次 State Transition 中提交左右两列最终宽度
- **AND** 不得在每次 Pointer Move 时修改 Zustand 或触发服务端请求

#### Scenario: 切换 Thread 后保留列宽
- **WHEN** 用户调整 Slot S 的宽度后，通过现有 Header 切换器把 S 从 Thread A 切换到 Thread B
- **THEN** Slot S MUST 保留原宽度
- **AND** Thread A 与 Thread B Entity 均不得保存该宽度

#### Scenario: 双击分割线恢复自动宽度
- **WHEN** 用户双击现有分割线复位
- **THEN** 客户端 MUST 清除受影响物理列的显式宽度并恢复当前自动均分行为
- **AND** 下一次工作台 Snapshot MUST 保存复位后的状态

### Requirement: 刷新后恢复 Project 工作台视图
客户端 MUST 按 `projectId` 将带 `schemaVersion` 的工作台视图投影防抖保存到设备 localStorage。刷新并完成 ProjectBootstrap 后，客户端 MUST 恢复合法的列槽、每列当前 Thread、折叠态、物理列宽、焦点列、列数偏好、放置模式、Columns/Canvas 模式和 Canvas pin。

工作台 Snapshot MUST NOT 直接序列化整个 UI Store，也 MUST NOT 包含服务端实体、Message/Run、滚动位置、DOM 引用、弹层坐标、动画、文本选区、临时 Switcher/Help 打开态、请求状态、命令状态、流缓冲、Generation 连接或 Composer 草稿。

#### Scenario: 刷新恢复多栏视图
- **WHEN** 用户在 Project P 中打开多个 Branch、调整列宽、折叠一列并刷新页面
- **THEN** Bootstrap 成功后客户端 MUST 恢复刷新前仍然合法的 Slot、Thread、列宽、折叠态和焦点
- **AND** 每列滚动位置 MUST 使用当前 UI 默认行为，不得从 Snapshot 恢复

#### Scenario: Snapshot 损坏或版本未知
- **WHEN** localStorage 不可用、Snapshot 无法解析或 `schemaVersion` 不受支持
- **THEN** 客户端 MUST 安全回退为只显示 Root 且聚焦 Root 的当前默认视图
- **AND** 不得影响 ProjectBootstrap、Message 展示或 Generation 恢复

### Requirement: 通过 selector 生成 UI ViewModel
客户端 MUST 使用纯 selector 从 entities、服务端 read models、AssistantRunState 和 UI state 生成 ThreadColumnView、ThreadColumnHeaderView、ProjectTreeRows、MessageView、ForkAvailability 和 ProjectHeaderView 等 ViewModel。派生结果 MUST NOT 作为另一份可独立修改的领域状态持久化。

Selector MUST 至少覆盖 Root Thread、Child Thread、depth、breadcrumb、有效 Message 时间线、Message 运行展示、Artifact 来源、Fork 可用性、可见列组合、物理 Slot、页面统计和列 Header 操作信息。

#### Scenario: replacement 后重算消息视图
- **WHEN** Store 合并一条 replacement Message 并将来源 Message 标记为 superseded
- **THEN** Thread Message selector MUST 隐藏来源 Message并按 sequence 展示 replacement
- **AND** 不得通过手动修改 UI Message 数组维持第二份时间线

#### Scenario: 组合 ThreadColumnView
- **WHEN** UI 请求一个 Thread 的列视图
- **THEN** selector MUST 组合 Thread、有效 Messages、相关 AssistantRunState、Message 中的 Artifact 引用、breadcrumb 和操作可用性
- **AND** 该 ViewModel 不得成为 API 写入对象

#### Scenario: 打开 Artifact Drawer
- **WHEN** 用户打开 Message tool result 中 `artifactId` 指向的 Artifact
- **THEN** Lifecycle/Command Hook MUST 按 ID 调用 Artifact Query，并将成功结果缓存到当前 Project Store
- **AND** Message 组件不得自行请求或复制 Artifact 正文

#### Scenario: 组合每列 Header ViewModel
- **WHEN** UI 请求 Root 或某个 Branch Slot 的 Header
- **THEN** selector MUST 派生标题、Root/Branch、depth、breadcrumbs、直接 Child 数量与列表、Fork 来源可用性以及 switch/collapse 能力
- **AND** `directChildren` MUST 只包含直接 Child；不得把它作为可修改 children 数组写回 Thread Entity

#### Scenario: 组合页面统计
- **WHEN** UI 请求 ProjectHeaderView
- **THEN** `threadCount` 与 `branchCount` MUST 从完整 Thread topology 派生，Artifact 与 Markdown 总数 MUST 从服务端 Artifact Summary 派生
- **AND** 不得使用局部 `artifactsById` 数量冒充 Project Artifact 总数

#### Scenario: 多个 Run 的 Artifact Summary 乱序到达
- **WHEN** 当前 Summary 的 `changeSequence=8`，随后收到另一个 Run 携带的 `changeSequence=7`
- **THEN** Store MUST 忽略该旧 Summary 并继续展示 sequence 8 的统计
- **AND** `changeSequence` MUST NOT 被提交给任何 Project、Thread、Message 或 Generation Command

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

第一次发送成功后，客户端 MUST 合并服务端原子返回的 Project、Root Thread、user Message、assistant Message 和 AssistantRunState，并 MUST 使用集中式路由构造器根据 `project.id` 得到目标 Project URL，再通过 `router.replace` 进入该页面。失败时 MUST 留在 `/thread-chat/new` 并保留草稿。

#### Scenario: 打开后直接离开 new 页面
- **WHEN** 用户打开 `/thread-chat/new` 但未发送任何内容便离开
- **THEN** 系统 MUST NOT 创建 Project、Thread、Message 或 MessageRun

#### Scenario: 首次发送成功
- **WHEN** 用户在 `/thread-chat/new` 发送第一条有效 Message
- **THEN** 客户端 MUST 调用创建 Project 的 Application Command，并通过 Store Action 使用服务端返回的实体初始化 Project Store
- **AND** URL MUST 被替换为客户端路由构造器根据服务端 `project.id` 生成的目标 Project URL

#### Scenario: CreationBundle 无空白帧交接
- **WHEN** `/new` 创建命令返回合法 CreationBundle
- **THEN** 客户端 MUST 先用 CreationBundle 建立 bootstrap-ready 的 seeded ProjectRuntime，再执行 `router.replace(threadChatRoutes.project(bundle.project.id))`
- **AND** 目标 ProjectProvider MUST acquire 同一个 seeded Runtime 并跳过第二次 ProjectBootstrap
- **AND** `/new` 当前页面 MUST 保持渲染到目标 Project Route 可提交，不得插入空白 Project、第二次 Bootstrap Loading 或清空后等待的 Composer 帧
- **AND** 客户端 MUST NOT 从 CreationBundle 读取页面 URL

#### Scenario: AI 事件早于目标 ProjectProvider 挂载
- **WHEN** seeded Runtime 在路由交接完成前收到 A1 的 snapshot、delta 或 terminal 事件
- **THEN** GenerationCoordinator MUST 把事件合并到该 seeded Runtime
- **AND** 目标 ProjectProvider 接管后 MUST 直接展示同一 Store 的最新状态，不得重新创建 Run 或丢弃已到达事件

#### Scenario: 首次发送失败
- **WHEN** 创建命令在服务端提交前失败
- **THEN** 客户端 MUST 保留本地输入并允许重试
- **AND** 不得向 ProjectCatalogStore 增加未确认 Project

### Requirement: 采用轻量 Bootstrap 与按 Thread 加载
进入持久化 Project 时，客户端 MUST 首先加载 ProjectBootstrap。Bootstrap MUST 包含 Project、全量轻量 Thread topology、Project Artifact Summary、Root Thread 的有效 Message 和相关 AssistantRunState，但 MUST NOT 包含所有 Branch Message、BaseContext 或 Artifact 正文。

其他 Thread 的 Message MUST 在首次打开时按 Thread 加载。MVP 客户端 MUST 支持一次合并最多 200 条按 sequence 升序排列的有效 Message，并 MUST 保留服务端返回的 `hasOlderMessages` 信息，但不要求实现复杂的树内自动分页替换。

P0 的 Markdown tool result MUST 只向客户端提供 `artifactId` 引用。只有用户打开 Artifact Drawer 时，客户端才 MUST 通过 Artifact Query 按 ID 加载正文；加载 ProjectBootstrap、ThreadMessageBundle 或 topology 不得提前下载 Markdown 正文。

客户端 MUST 使用 ProjectRuntime 级 `ThreadMessageLoader` 管理 `threadId → in-flight Promise/AbortController`。Promise、AbortController 和 in-flight Map MUST NOT 进入 Zustand；Store 只保存每个 Thread 的 `LoadState`、窗口边界和已合并实体。同一 Thread 的并发 ensure MUST 复用同一个 Promise，不同 Thread MUST 可以并行加载。

#### Scenario: 初次进入已有 Project
- **WHEN** 用户打开 `/thread-chat/{projectId}`
- **THEN** 客户端 MUST 先合并 ProjectBootstrap 并展示 Root Thread
- **AND** 不得为了渲染 topology 下载全部 Branch Message

#### Scenario: 刷新恢复多个 Branch Column
- **WHEN** Bootstrap 后恢复出的工作台 Snapshot 包含多个尚未 ready 的 Branch Thread
- **THEN** Lifecycle MUST 非阻塞地并行调用每个 Branch 的 `ensureThreadMessages`
- **AND** Root MUST 立即渲染；不得等待所有 Branch 请求完成后才展示页面
- **AND** 每个 Branch MUST 独立进入 loading、ready 或 error，一个失败不得阻塞其他列

#### Scenario: Workbench Snapshot 不是 Message Cache
- **WHEN** 页面刷新后 localStorage 存在多个 Branch Slot，但新的 ProjectRuntime 只有 Root MessageBundle
- **THEN** 客户端 MUST 使用 Snapshot 恢复列布局，并分别 ensure 每个 Branch MessageBundle
- **AND** 不得从 Snapshot 构造 Message、Run 或 ready 状态

#### Scenario: 没有 Workbench Snapshot
- **WHEN** ProjectBootstrap 成功但当前设备没有合法 Workbench Snapshot
- **THEN** 客户端 MUST 使用当前默认视图，只展示且聚焦 Root
- **AND** 不得主动加载任何未打开 Branch 的 Message

#### Scenario: ProjectRuntime 中已有 Message Cache
- **WHEN** 同一 ProjectRuntime 内某个 Branch 的 ThreadMessageWindow 已是 ready 后再次打开该 Thread
- **THEN** 客户端 MUST 直接复用已合并实体和窗口状态
- **AND** 不得重复请求该 Thread 的 MessageBundle

#### Scenario: 首次打开 Branch Thread
- **WHEN** 用户打开尚未加载 Message 的 Branch Thread
- **THEN** 客户端 MUST 只请求该 Thread 的 Message bundle 并合并结果
- **AND** 重复打开已加载 Thread 不得自动重复请求

#### Scenario: 同一 Thread 并发 ensure
- **WHEN** 两个 Lifecycle/Command Hook 在第一个请求完成前同时 ensure 同一 threadId
- **THEN** ThreadMessageLoader MUST 返回同一个 in-flight Promise
- **AND** 服务端只能收到一个对应 Message Query

#### Scenario: Slot 切换后旧 Thread 响应迟到
- **WHEN** Slot S 在 Thread A 请求期间切换到 Thread B，随后 A 的 Bundle 到达
- **THEN** Bundle MUST 只按 threadId 合并到 A 的实体索引和请求状态
- **AND** S MUST 继续展示 B；不得让迟到响应把 Slot 切回 A

#### Scenario: ProjectRuntime 销毁
- **WHEN** ProjectProvider 卸载并销毁 ProjectRuntime
- **THEN** ThreadMessageLoader MUST Abort 该 Runtime 的全部在飞 Message Query
- **AND** Abort MUST NOT 写入可重试 error，也不得影响服务端 MessageRun

#### Scenario: 关闭 Column 时请求仍在进行
- **WHEN** 用户关闭或切换正在加载的 Branch Column，但 ProjectRuntime 仍存活
- **THEN** Loader MUST 允许请求完成并按 threadId 缓存合法结果
- **AND** Column 操作不得把请求结果合并到当前 Slot 的新 Thread

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
