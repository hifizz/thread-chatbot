## Why

ThreadChat 已经具备规范化的 Project、Thread、Message 和 Artifact，并能在一个 Project 内持续分叉对话；但当前 Project 仍主要是“对话树容器”：它没有明确的项目目标和长期指令，用户上传的 Attachment 只属于某条消息而不是 Project 资料库，已有 Artifact 也缺少一个覆盖全部 Thread 的统一入口。

这导致三个直接问题：

1. 用户必须在不同 Thread 中反复说明项目目标、技术约束和工作方式；
2. 作为长期资料上传的文件无法被清晰地管理，也不能稳定地服务于 Project 中所有后续 Thread；
3. 深层 Thread 生成的 Markdown 等成果虽然已经归属 Project，却不容易被用户再次找到、查看来源或作为后续工作的资产管理。

本变更实现冻结后的最小 Project Workspace：先把 Project 的方向、原始资料和已生成成果组织清楚，再根据真实使用情况决定是否增加 `@Artifact`、`@Message`、`@Thread`、Memory、Outcome 审批和 Artifact Revision。

## What Changes

- 为 Project 增加当前值形式的 `target` 和 `instructions`，通过显式保存进行原子更新；不建设 Contract 历史版本，但使用递增并发版本防止旧页面静默覆盖新设置。
- 将 Project Contract 作为服务端拥有的项目上下文注入所有未来模型生成；Contract 更新影响更新后的请求，不改写历史 Message、冻结分支上下文或已经启动的生成。
- 新增 Project Files 资料区，在现有 Attachment/R2 上传与解析链路之上保存 Project 与 Attachment 的成员关系；每次上传都是独立原始文件，不做覆盖、逻辑 File 身份或 File Version。
- 让可用的 Project Files 对同一 Project 中所有 Thread 的未来生成可用：显式消息附件优先，Project 文件内容在统一预算内按当前问题检索或截断；不支持内容解析的类型只提供文件元信息。
- 允许用户从 Project Files 资料区移除文件成员关系；移除不删除历史消息中的附件，也不改写已经完成的回复。
- 将现有 Project Artifacts 提升为全 Project 资源列表：展示所有 Thread 产生的持久化 Artifact、来源 Thread/Message、来源状态和创建时间，并复用现有 Artifact 预览与来源定位能力。
- 增加统一的 Project Panel，提供 Contract、Files、Artifacts 三个区域；不改变现有列视图、画布和 Thread 分叉模型。
- 扩展 Project DTO、Bootstrap、幂等 Command、API、数据库迁移、客户端 store 和上下文编译链路，并补充权限、恢复、评测和端到端验收。
- 现有 Project 无需人工迁移：Contract 默认为空，Files 列表为空，既有 Artifact 自动进入 Project Artifacts 列表。

## Capabilities

### New Capabilities

- `project-workspace`: 定义 Project Contract、Project Files、Project Artifacts、Project Panel、模型上下文装配、权限隔离和兼容迁移的完整 MVP 行为。

### Modified Capabilities

（无——当前 `openspec/specs/` 中没有覆盖规范化 ThreadChat Project Workspace 的既有 capability。）

## Impact

- 数据库：扩展 `projects`；新增 Project 与 Attachment 的成员关系表和迁移。
- 领域契约：扩展 `ProjectDTO`、`ProjectBootstrapDTO`，新增 Project File DTO 与 Contract/File Commands。
- 服务端：Project handlers、queries、mutations、repositories、Attachment 归属校验和 generation initialization。
- 模型上下文：`compileModelContext`、`run-generation.ts`、`generation-plan.ts`、Project Contract 序列化、Project File 内容选择与预算。
- 客户端：Conversation store、HTTP client/commands、Topbar、Workspace overlays、统一 Project Panel、文件上传状态和 Artifact 列表。
- 复用：现有 `/api/attachments`、R2、PDF 解析/RAG、Artifact 持久化、`ArtifactDrawer`、`MarkdownBody` 和来源定位。
- 测试与评测：Contract 作用域、File grounding、跨 Project 隔离、归档只读、历史稳定、Artifact 全项目可发现性。
- 明确无影响：不增加 `@` 引用、Pinned Memory 自动化、Outcome 专用工具、Approval Card、Artifact Revision、Operation/Activity、依赖图、汇总对象或完整 Event Sourcing。
