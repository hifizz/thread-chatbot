# Conversation 领域术语与迁移边界

本文是 Issue #34 迁移链的开发者术语入口。需求级规范仍以 `openspec/specs/domain/spec.md` 及其已应用增量为唯一正式来源；本文解释代码命名、所有权和遗留字段如何迁移。新设计不得继续把遗留 `ThreadTreeState` 当成最终架构。

## 规范聚合关系

```text
Workspace
└── Project
    ├── ProjectInstructionVersion
    ├── MemoryItem
    ├── ProjectFile
    └── Conversation
        ├── Thread（rootThreadId 指向主 Thread）
        │   └── Turn
        │       ├── Message（user，可有同 Turn 变体）
        │       └── Message（assistant，可有同 Turn 变体）
        │           └── Generation（一次服务端执行尝试）
        └── ThreadFork（父 Thread + 来源 Message → 子 Thread）
            └── Thread（界面上扮演 branch 角色）
```

`ConversationSnapshot` 是由规范实体组装的只读读取模型，不是整包写入载荷。界面显示成树，不代表数据库应保存一棵可变 JSON 树。

## 术语定义

| 术语 | 唯一职责与身份 |
| --- | --- |
| Workspace | 顶层租户与授权边界，拥有 Project。 |
| Project | 工作上下文，拥有 Conversation、版本化 ProjectInstruction、MemoryItem 与 ProjectFile；它不只是 Conversation 文件夹。 |
| Conversation | 一整个可命名、列出、归档并最终分享的分叉对话聚合，使用稳定 `ConversationId`，通过 `rootThreadId` 指定主 Thread。 |
| Thread | 用户看到的一列、可独立继续的线性对话。主线和分支使用同一实体；“branch”只是相对于某条 `ThreadFork` 的角色。 |
| ThreadFork | 唯一的分叉事实，记录父 Thread、来源 Message 和子 Thread；一个非根 Thread 恰有一个入向 Fork。 |
| Turn | 同一 Thread 内一个逻辑问答位置，约束 user/assistant Message 变体，并分别选择当前有效变体。 |
| Message | 持久内容记录，拥有稳定 ID、Thread/Turn 归属、角色、可版本化内容片段和内容状态。 |
| Generation | 一次服务端模型执行尝试，绑定真实 Thread、Turn、输入 Message 与输出 Message；停止、恢复、用量和计费属于它。 |
| Artifact | 从 Message 产出的交付物；来源 Thread 与 Message 必须可验证。后续是否提升为 ProjectFile 由独立变更决定。 |
| ProjectFile | Project 可跨 Conversation 使用的持久文件，可保留来源 Message/Generation。 |
| MemoryItem | Project 范围内可演进、可取代和归档的记忆条目。 |
| ProjectInstructionVersion | Project 指令的不可变版本记录。 |

## 不变量

- ID 是不携带角色含义的不透明稳定身份；`main`、数组下标、局部计数器和浏览器复合键不是公开资源 ID。
- `Conversation.rootThreadId` 决定主 Thread；根 Thread 不重复保存 Conversation 导航标题。
- `ThreadFork` 是唯一 Fork 事实。不得同时把可写 `parentId`、`children`、`Message.forks` 当作权威关系。
- 当前 Message 变体属于领域状态，由 Turn 的版本化选择决定；可见列、折叠、画布视口属于客户端 UI workspace。
- Generation 输入输出必须与同一 Thread/Turn 对齐，不能通过 JSON 内部 ID 猜测归属。

## 遗留模型 → 规范模型

| 遗留字段或概念 | 规范目标 | 迁移规则 |
| --- | --- | --- |
| `ThreadTreeState` / `branch_trees.state` | 规范实体 + `ConversationSnapshot` 读取模型 | 只允许作为迁移输入；禁止规范模型反向写回整树。 |
| `branch_trees.id` | `ConversationId` 候选来源 | 数据迁移决定是否保留值；不能继续等同于整树存储身份。 |
| `threads.main` | `Conversation.rootThreadId` | 把 `main` 角色解析成一个普通稳定 `ThreadId`；规范 ID 构造器拒绝字面值 `main`。 |
| `Thread.parentId` / `children` | `ThreadFork.parentThreadId` / `childThreadId` | 仅迁移适配器读取；规范写模型只写一条 Fork 关系。 |
| `forkFromMsgId` / `Message.forks` | `ThreadFork.sourceMessageId` | 合并并核验为同一来源 Message；重复或错配立即失败。 |
| `depth` / `footnote` | 派生索引或 UI 展示 | 从 Fork 图重建，不作为领域事实持久化。 |
| `activeLeafMessageId` | `Turn.activeUserMessageId` + `activeAssistantMessageId` | 按同 Thread/Turn 的活动路径投影，选择更新使用 Turn revision。 |
| Message 父子图 | `Turn` + Message 变体 | user 编辑和 assistant 重生成保留为同 Turn 的独立 Message；不能跨 Thread/Turn。 |
| Artifact registry 的 `sourceThreadId/sourceMessageId` | `ConversationArtifactProvenance` | 转换为稳定实体 ID，并校验来源 Message 属于来源 Thread。 |
| `branch_generations` 指向 JSON 内部 ID | `Generation` 的真实外键 | 后续生命周期变更迁移；本 change 只定义契约与校验。 |
| localStorage 的列、折叠、画布状态 | `ConversationUiWorkspace` | 永远保持在客户端界面状态层，不进入领域实体。 |

当前唯一单向投影入口是 `lib/thread-chat/legacy/project-thread-tree.ts`。允许继续读取旧字段的领域/应用文件由 `scripts/thread-tree-legacy-allowlist.mjs` 明示，`pnpm audit:conversation-domain` 会阻止新引用越界。

## 模块边界

- `lib/thread-chat/domain/conversation-*.ts`：纯领域 ID、实体、不变量、标题与变体选择；不依赖 React、Next.js、HTTP 或 Drizzle。
- `lib/thread-chat/legacy/`：只读迁移、审计与固定样例；不得提供规范模型写回遗留树的函数。
- `lib/thread-chat/application/`：后续承载带事务语义的命令编排，不拥有数据库形状或 UI workspace。
- `lib/thread-chat/client/`：可见列、折叠、画布视口和临时交互选择。
- 持久化、HTTP 和 React 边界分别实现领域协议，不在领域层反向定义实体。
