## Context

变更动机见 `proposal.md`，规范语言见 `specs/domain/spec.md`。

当前 Thread Chat 模型是一份持久化到 `branch_trees.state` JSONB 的 `ThreadTreeState` 对象。同一个 Fork 事实被重复保存在 `Thread.parentId`、`Thread.children`、`Thread.forkFromMsgId`、`Message.forks`、深度、脚注和锚点等字段中。根节点使用魔法注册项 `threads.main`。Message 变体存在于各 Thread 内部的父子图中，由 `activeLeafMessageId` 选择提示词路径。`branch_generations` 虽然是关系型辅助表，但它的 Thread 和 Message ID 指向 JSON 内部节点，数据库无法通过外键保护。服务端启动和终结 Generation 的仓储因此必须锁定并重写整棵树，再把辅助表结果协调合并回 JSON。

Issue #34 要求替换这套权威模型。产品讨论同时确认：Project 必须拥有一整个 Conversation，而用户看到的每一列对话都是一个 Thread。Issue #39 单独记录未来的发散与收敛行为，本变更明确不包含该能力。

仓库中仍有活跃 OpenSpec 变更描述旧 JSON 权威模型，特别是 `persist-thread-chat-generations` 和 `add-thread-chat-message-actions`。已经完成的历史行为仍然是有价值的证据，但这些文档不能继续作为目标架构的事实来源。

## Goals / Non-Goals

**目标：**

- 在提出任何持久化、接口或客户端迁移方案前，建立一套唯一的规范术语。
- 定义目标逻辑实体、所有权、身份和关系不变量。
- 收敛 Issue #34 中会改变后续数据库结构和任务顺序的决策。
- 定义模块边界，使网页界面、未来公开接口、命令行和 MCP 适配器共用同一应用层。
- 给出由多个可独立审查的小变更组成的明确依赖链。
- 把遗留 `ThreadTreeState` 隔离为迁移输入，避免旧名称继续泄漏到新模块。

**非目标：**

- 在本变更中创建规范化数据库表或迁移生产、开发数据。
- 在本变更中替换现有命令接口、Generation 流、协调合并逻辑或客户端状态存储。
- 重建 Markdown 渲染、流式展示、编辑器、画布或视觉设计。
- 实现 Project Memory、Project Instruction、Project File、分享、公开令牌、命令行或 MCP。
- 实现 Issue #39 中的 Thread 结果发布或 Conversation 收敛。
- 为不存在的外部客户端保留兼容层，或永久保留旧整树写入协议。

## Decisions

### D1. 规范聚合关系：Project → Conversation → Thread

目标包含关系为：

```text
Workspace
└── Project
    ├── ProjectInstructionVersion
    ├── MemoryItem
    ├── File
    └── Conversation
        ├── rootThreadId
        └── Thread[]
```

`Conversation` 取代 `Thread Tree`。Conversation 是用户可以整体命名、列出、归档、删除并最终分享的聚合。Thread 是 Conversation 内一条可以独立继续的对话列。

Workspace 一词专门表示租户、成员和授权边界。现有前端工作台在概念上改称“界面工作区”或“视图状态”，避免与授权聚合混淆。第一次持久化迁移是引入物理 Workspace 行，还是把当前所有者直接映射到默认 Project，由该迁移变更决定；这个实现选择不会改变本设计的包含契约。

**备选方案：Project 直接拥有 Thread。** 不采用，因为它无法稳定标识一整个分叉对话，也无法表达其标题、生命周期、加载、分享和画布投影。

**备选方案：保留 Thread Tree。** 不采用，因为它描述的是实现拓扑，而不是稳定产品资源，并且会与未来非 Fork 关系发生冲突。

### D2. Branch 是关系角色；ThreadFork 是唯一 Fork 事实

所有对话列都使用同一种 `Thread` 实体。主线和分支角色通过关系推导：

```text
主 Thread   = Conversation.rootThreadId
分支 Thread = 具有一个入向 ThreadFork 的 Thread
```

`ThreadFork` 是独立关系：

```text
ThreadFork
├── id
├── conversationId
├── parentThreadId
├── sourceMessageId
├── childThreadId       # 唯一
├── anchor              # 可选 TextAnchor 值对象
├── createdBy
└── createdAt
```

必须满足以下约束：

1. 上游 Thread、下游 Thread 和来源 Message 都能在同一 Conversation 中解析；
2. 来源 Message 属于上游 Thread；
3. 下游 Thread 最多只有一个入向 ThreadFork；
4. 根 Thread 没有入向 ThreadFork；
5. 每个非根 Thread 恰好有一个入向 ThreadFork；
6. Fork 有向关系不得形成环；
7. 派生子 Thread、深度、脚注标签和分支数量都不是可写事实。

锚点继续作为 ThreadFork 拥有的值对象。它没有独立权限或生命周期，因此不能仅仅为了形式上的规范化而拆成独立实体表。

`forkThread` 必须是一个应用命令和一个数据库事务。它创建下游 Thread 与 ThreadFork，推进最小必要版本边界并记录事务事件箱事件。客户端不能分别创建再关联这些对象。

**备选方案：在下游 Thread 保存 `parentThreadId + forkFromMessageId`。** 不采用，因为 Fork 自身具有来源、锚点、审计和未来展示语义。独立关系能够清楚表达唯一事实，又不会让 Thread 承担无关字段。

**备选方案：为快速读取保留上游 children 和 Message forks 数组。** 不允许作为权威状态。可以存在等价索引或读取模型，但它们必须可以丢弃并重建。

### D3. 使用显式 Turn 约束回复变体

目标对话图分离四类问题：

```text
Thread 来源关系：   Thread ──ThreadFork──> Thread
Turn 顺序：         Thread ──> Turn ──> Turn
Message 变体：      Turn ──> Message 变体
执行尝试：          Generation ──> 输入/输出 Message
```

逻辑实体为：

```text
Thread
├── id
├── conversationId
├── modelId / 模型设置
├── 生命周期
├── revision
└── Turn[]

Turn
├── id
├── threadId
├── 前序/顺序
├── activeUserMessageId
├── activeAssistantMessageId
└── revision

Message
├── id
├── threadId
├── turnId
├── 角色
├── 内容/结构化片段
├── 状态
├── 变体来源（可选）
└── createdAt

Generation
├── id
├── threadId
├── turnId
├── inputMessageId
├── outputMessageId
├── sourceAssistantMessageId（仅重新生成）
├── 意图/状态/模型
├── 心跳/停止
├── 用量/计费
└── 幂等身份
```

Turn 为回复变体提供显式稳定键，因此选择器和约束不再通过任意父子链推断“同一个回复位置”。Message 内容可以继续使用带版本的 JSON 或结构化片段值，因为工具片段不会仅仅由于结构化就拥有独立所有权。

对于当前已经支持的行为，编辑最后一条用户输入或重新生成最后一条助手输出，会在同一个 Turn 内创建 Message 变体。未来若支持编辑任意历史位置，可以创建新 Thread，而不是静默重写所有后续 Turn；该选择不属于本变更。

复合外键或事务检查必须保证 Turn、Message 和 Generation 的 Thread ID 一致。如果普通单列外键仍允许 Generation 组合来自不同 Thread 的 Message，就不足以保护这个不变量。

**备选方案：只保留 Message 有向无环图。** 不采用，因为当前错误类型正是由系统反复根据图位置推断 Turn 和变体归属，再把推断结果与另一张 Thread Fork 图组合造成的。

**备选方案：把一组用户和助手消息压成一行。** 不采用，因为 Message 需要稳定 ID，以支持分享、反馈、Artifact、Generation 来源和未来公开接口。

### D4. 当前有效变体是持久化领域状态

当前有效的用户或助手回复变体会决定：

- 下一次提示词上下文；
- 后续 Turn 跟随哪一个回答；
- ThreadFork 使用的确定来源版本；
- 当前可见的 Message 所属 Artifact 和反馈操作。

因此，系统必须在 Turn 边界持久化该选择，并通过携带预期版本的幂等命令更新。不能根据数组顺序或仅存在于浏览器的叶节点推断它。

纯界面状态保持分离：

```text
界面工作区/视图状态
├── visibleColumns
├── foldedColumns
├── selectedThreadId
├── canvasViewport
├── openPanels
└── 临时草稿与乐观状态
```

初始单所有者模型只有一份规范有效选择。如果未来多人协作需要每位成员拥有个人阅读选择，可以用独立提案增加用户级选择，而不改变 Message 身份或 ThreadFork 来源。

**备选方案：当前有效变体完全保留在客户端。** 不采用，因为刷新、服务端提示词组装和多客户端命令会产生分歧。

### D5. 每个实体只有一个事实来源；快照只是读取模型

规范化写模型拥有实体身份和关系。服务端可以返回为首次加载优化的 `ConversationSnapshot`，但该快照必须由规范实体组装，不能作为整包写入数据被接受。

```text
写入路径：
客户端命令
  → 传输校验
  → 应用命令
  → 领域不变量
  → 仓储事务
  → 规范实体增量 + 事务事件箱

读取路径：
仓储/读取模型
  → ConversationSnapshot
  → 客户端规范化
  → 按 ID 定位的选择器
```

`branch_trees.state` 可以在迁移期暂时作为迁移输入或非权威导出、缓存。任何缓存都必须可丢弃、带版本，并可从规范数据行重建。它不能参与冲突处理，也不能覆盖规范数据行。

**备选方案：继续让 JSONB 作为权威来源，再增加更多辅助表。** 不采用，因为辅助表 ID 仍然无法强制保证 Thread/Message 归属，每个新功能也都会增加一条协调合并路径。

### D6. 稳定公开身份先于分享、接口、命令行和 MCP

Workspace、Project、Conversation、Thread、Turn、Message、Generation 和 File 使用不携带角色语义的不透明稳定 ID。公开适配器不得暴露内存数组下标、`main`、树内局部计数器或浏览器复合键作为资源身份。

授权包含关系与 Fork 来源关系保持分离：

```text
授权包含关系：
Workspace → Project → Conversation → Thread → Message

Conversation 来源关系：
上游 Thread + 来源 Message → ThreadFork → 下游 Thread

执行关系：
Generation → Turn / Message / 用量
```

未来 REST、命令行和 MCP 适配器调用与网页界面相同的应用命令和查询。它们不能直接查询数据库表，也不能再实现一套所有权规则。分享和令牌权限范围属于独立提案，但本设计确保每个未来分享目标都具有可寻址实体。

### D7. Project 资产拥有可跨 Conversation 使用的持久内容

Project 不只是 Conversation 文件夹。目标扩展点为：

```text
ProjectInstructionVersion
├── projectId
├── version/content
└── 审计元数据

MemoryItem
├── projectId
├── content/status/version
└── 来源记录

File
├── projectId
├── FileVersion[]
└── 来源与引用关系
```

Message 或 Generation 记录自己创建或使用了某个资产，但不能拥有一份可复用 File 的唯一副本。搜索切块、向量和摘要是派生索引，不是规范 File 或 MemoryItem。

本变更只定义所有权和术语，不增加这些产品能力，也不强迫现有 Markdown Artifact 在专门的 Project 资产变更之前迁移。

**备选方案：所有输出只保存在 Message JSON 内。** 对需要持久复用的文件不采用，因为删除或归档一个 Thread 不应控制无关 Project 资产的生命周期。

### D8. 模块边界服从策略，不服从框架目录

目标依赖方向为：

```text
界面组件
      ↓
客户端应用/状态存储 ──→ 传输契约
                             ↓
                        应用命令/查询
                             ↓
                          领域模型
                             ↑
                        持久化实现
```

规则如下。

#### 领域层

- 只包含纯 TypeScript 实体、ID、值对象、不变量和派生规则。
- 不导入 React、DOM、Next.js 请求、Drizzle 数据表或 HTTP 状态。
- TextAnchor 可以继续作为领域值对象，即使某个适配器会在 Markdown DOM 中解析它。

#### 应用层

- 包含命令、查询、所有者与权限策略、事务边界、幂等和冲突结果。
- 依赖仓储、时钟、ID、事件和模型执行端口。
- `forkThread`、`createTurn`、`regenerate`、`selectVariant`、`archiveConversation`、`stopGeneration` 在概念上属于此层。

#### 持久化层

- 包含 Drizzle 结构、SQL 约束、仓储适配器、迁移和事务事件箱。
- 实现应用层端口；不得把数据库行形状泄漏到组件或路由。

#### 接口与传输层

- 负责身份认证与会话提取、请求结构、错误与状态映射、响应序列化。
- 不得在路由局部分支中重复实现领域校验。

#### 客户端状态层

- 保存规范化的规范实体、可丢弃派生索引和乐观命令状态。
- 应用服务端返回的规范增量；不得自行修改实体关系。

#### 界面组件层

- 消费按 ID 定位的选择器和命令。
- 列、画布和 Message 操作组件不能写入 `children`、Fork 反向链接或 Message 所有权。

即使物理目录按阶段迁移，也必须遵守这条依赖分离原则。

### D9. 隔离遗留术语，不提供永久全局别名

迁移期间，专用适配器可以执行以下映射：

```text
遗留模型                        规范模型
ThreadTreeState                 ConversationSnapshot / 遗留导入数据
branch_trees.id                 Conversation ID 候选值
threads.main                    Conversation.rootThreadId 目标
Thread.parentId                 ThreadFork.parentThreadId
Thread.forkFromMsgId            ThreadFork.sourceMessageId
Thread.children                 派生 ThreadFork 索引
Message.forks                   派生 ThreadFork 索引
Thread.activeLeafMessageId      Turn 有效选择/读取投影
branch_generations.* IDs        Generation 外键
```

遗留名称可以保留在名称明确的迁移、导入模块和历史迁移文件中。新的领域层、应用层和接口层代码不能引入 `type Conversation = ThreadTreeState` 一类别名；这种做法只是改名，没有改变所有权。

已归档的 OpenSpec 变更继续作为历史记录。依赖旧权威模型的活跃变更必须标记为被替代、受阻或依赖后续迁移，不能通过修改文档假装已完成任务已经符合新模型。

### D10. 变更依赖链

工作按架构接缝拆分，而不是按任意文件数量拆分：

```text
define-conversation-domain-model        （本变更）
        │
        ▼
normalize-conversation-persistence      （实体、约束、仓储、
        │                                迁移与读取快照）
        ▼
migrate-generation-lifecycle            （基于真实 Thread/Turn/Message 外键的
        │                                启动、停止、恢复、用量和计费）
        ▼
add-conversation-command-api            （实体命令、增量、错误与幂等契约；
        │                                退出整树 PUT）
        ▼
normalize-conversation-client-state     （实体缓存、选择器、列、画布和
        │                                Message 操作）
        ▼
retire-thread-tree-authority             （切换、审计、删除遗留写入、
                                         适配器和重复事实）
```

基础模型完成后可以并行开展：

```text
normalize-conversation-persistence
        ├── project-context-assets       （未来独立提案）
        └── public-data-access           （未来接口、令牌、命令行、MCP 提案）

retire-thread-tree-authority
        └── conversation-convergence     （Issue #39，未来提案）
```

每个后续变更只负责一个权威边界，并拥有独立验证目标：

1. 持久化变更证明数据库不变量和规范快照读取正确；
2. Generation 变更证明生命周期和财务语义不再依赖 JSON 协调合并；
3. 接口变更证明只有服务端可以执行变更，并保证幂等；
4. 客户端变更证明规范接口能够产生正确投影；
5. 清理变更证明系统中不再存在遗留权威路径。

PR #30 保持 Draft；在 Generation 迁移解决其对 #34 的依赖前，不能视为符合最终架构。已经正确的流式行为可以保留，但 JSON 与辅助表之间的协调机制不是目标契约。

## Risks / Trade-offs

- **[风险] 术语变更影响大量活跃文档，可能产生改了一半的模型。** → 把 `domain` 规范设为唯一正式词汇表，发布遗留映射，并禁止在迁移范围之外新增 `ThreadTree` 术语。
- **[风险] 显式 Turn 增加一个实体和一组约束。** → 它可以消除重复运行时推断，并把重新生成和编辑不变量限制在局部；Message 内容继续使用灵活 JSON，避免过度拆分结构化片段。
- **[风险] Conversation 与 Thread 标题可能成为重复事实。** → Conversation 拥有聚合与导航标题。非根 Thread 可以拥有本地列标题；根列使用 Conversation 标题，除非未来产品需求证明必须存在独立根标题。
- **[风险] 引入 Project 和 Workspace 扩大 #34。** → 本变更只定义包含关系。物理 Workspace、Memory、Instruction、File 和分享能力继续使用独立提案。
- **[风险] 分阶段迁移会暂时同时存在遗留表示和规范表示。** → 每个阶段只允许一个写入权威，把转换隔离在一个适配器中，增加一致性与审计检查，并设立强制清理变更。
- **[风险] 前后端一次性切换可能遗留运行中的 Generation。** → 在接口和客户端切换前先迁移生命周期；切换前要求没有活跃 Generation 或具备兼容排空规则，并在每个阶段保留回滚边界。
- **[风险] 现有 OpenSpec 变更依据已被替代的假设宣称任务完成。** → 明确记录依赖和被替代范围；不静默保留错误声明，也不重写已归档历史。
- **[风险] 稳定公开 ID 被误认为已经具备授权。** → 在应用命令中保留包含关系和权限检查；来源关系本身永远不授予访问权限。

## Migration Plan

本文定义迁移计划，实际执行由 D10 中的后续变更完成。

1. **落地术语与架构决策。** 应用修改后的 `domain` 规范，更新当前架构和术语引用，发布遗留映射，并把冲突的活跃变更标记为依赖本变更或已被替代。
2. **在读取路径后方引入规范化持久化。** 创建规范数据行和约束；检查真实数据后决定重置还是一次性迁移；生成 `ConversationSnapshot` 读取模型。在一致性检查通过前，不启用规范写入。
3. **迁移 Generation 所有权。** 把执行尝试、Message 输出、停止与恢复、用量和计费绑定到真实外键，并解决 PR #30 审查中已知的结算、部分结果和过期收敛语义。
4. **迁移写入命令。** 启用具有幂等和版本冲突语义的规范实体命令。已经迁移的 Conversation 不再接受整棵 Conversation 写入。
5. **迁移客户端。** 规范化快照，迁移选择器和界面命令，再从浏览器删除防抖保存和协调合并行为。
6. **切换并清理。** 审计数据、排空活跃 Generation、禁用遗留写入、删除重复事实，最终按照已批准的持久化方案删除 `branch_trees.state` 或将其降级为非权威数据。

回滚按阶段进行：

- 启用规范生产写入前，可以关闭新的读取模型和数据表，继续使用未改变的遗留权威；
- 一旦规范模型接受生产写入，不得把数据反向导出到 ThreadTree 后恢复旧权威；应保持规范数据库，通过回滚兼容客户端/应用、进入只读、恢复规范备份或前滚修复处理；
- 只有当命令接口仍兼容且不会丢失仅存在于规范模型的变更时，才能回滚客户端；
- 破坏性删除遗留列必须最后执行，并以已验证备份和审计报告为前提。

目前没有会改变本提案规范、实体选择或任务顺序的未决问题。`normalize-conversation-persistence` 负责取得真实数据审计证据；数据重置还是一次性导入及其部署批次由 `retire-thread-tree-authority` 在目标环境测量后以 ADR 决定。
