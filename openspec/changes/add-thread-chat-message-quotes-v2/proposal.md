## Why

本 change 以 `codex/feat-agent-observability-evaluation@2f3024747ddb72e1e69aa916cb45addb7140f6ab` 为基准，只收敛 Quote/Fork 的基础模型和引用导致的缓存问题，不复用 PR #49 的实现。

当前 Fork 把具体 `anchorText` 放进早于继承历史的 System，并对 Child 的继承历史单独执行 6000 字符截断。前者让兄弟分支过早出现不同输入，后者让 Child 与 Parent 的共同历史不再一致。与此同时，如果把 Fork 来源 Quote 设计成 Child 第一轮的必需内容，就会把两件不同的事绑死：Thread 已经分叉，不代表用户最终一定要把划选内容发给模型。用户可以删除预填 Quote；未来也会支持从某条 Message 直接创建不带 Quote 的 Child Thread。

## What Changes

- Quote 只作为 User Message `parts` 中零到多份有序 `data-quote` Part；不建 Quote 表，也不增加顶层 `quotes` 字段。
- 一次“划选后开分支”可以给 Child Composer 预填一份 Quote。它只是草稿初始内容，用户在发送前或编辑已发送 User Message 时都可以删除。
- Child 的父子关系、分叉来源与继承历史继续由现有 Thread 字段和冻结的 `forkContext` 保存，不依赖 Quote。删除 Quote 不修改 Child，也不修改 `forkContext`。
- Message Parts 是 Quote 是否存在的唯一依据。服务端发送路径和 Prompt 编译路径都不得根据 `forkAnchor`、`anchorText` 或其他 Thread 字段自动补 Quote。
- Quote 保存发送时的文本快照、可选局部批注以及最小来源定位信息。Schema 不含 `required`、Quote 自身 ID、创建入口类型、Project ID 或 Thread ID。
- 普通 Quote 仍只允许来自当前 Thread 的 `completed` Message，或由该 Message 产生的 Markdown Artifact。划选后开分支是窄例外：预填 Quote 来自 Parent 的分叉来源 Message。
- 模型只接收 Quote 的 `text` 和可选 `comment`；版本、Message/Artifact ID 与 Anchor 永不进入模型输入。
- 编辑时回显现存 Quote，并允许删除、排序和修改局部批注；保存继续使用现有 `replacesMessageId` / `supersededAt`，不建立另一套消息版本机制。
- 空 Fork 仍只创建 Child Thread；只有 Quote 或文件、但没有非空总体问题文本时，也不创建 Message、不调用模型。Quote 是问题上下文，不单独充当问题。
- Quote/Fork MVP 移除 Child 专属 6000 字符截断，按原顺序继承完整冻结历史，直到真正达到所选模型的上下文限制。
- Provider 或中转站已经支持的缓存可以启用；缓存不得改变 Prompt 语义、工具权限、强制工具行为或推理设置。
- 联网/研究/Artifact 模式、研究计划位置、历史 PDF 检索、长上下文压缩和完整观测留在 `docs/prompt-cache/roadmap.md` 分阶段处理。

## Capabilities

### New Capabilities

- `thread-chat-message-quotes`：定义 User Message 内嵌 Quote 的 Schema、来源边界、Fork 预填与删除、编辑回显、模型转换及缓存友好的历史顺序。

### Modified Capabilities

无。现有 Thread、Message、Artifact 和消息替换字段继续承担原职责。

## Impact

- **本 PR**：只新增 OpenSpec 和缓存后续路线图，不修改运行代码、数据库或现有 OpenSpec。
- **后续 Quote MVP**：影响 Composer 草稿、Fork/Send/Edit 命令、`ThreadChatDataParts`、Message Parts Builder、模型消息转换和 Fork 历史编译。
- **数据库**：Quote 继续存入 `messages.parts` JSONB；MVP 不新增表、不要求迁移。
- **兼容边界**：历史 `{ text: string }` Quote 可以继续读取，也可以在 Edit 中原样保留、排序或删除；没有 Quote 的历史 B1 必须保持没有 Quote，不能被推断成漏写数据。
- **未来直接分叉**：现有 Base 仍要求 Fork 提供 `forkAnchor/anchorText`。从 Message 直接分叉但不划选的命令与数据库约束将在独立 change 中设计，本 change 只保证 Quote 模型不会阻挡它。
