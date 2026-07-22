## Why

ThreadChat 已经能把普通 assistant 正文渲染成 Markdown，也保留了 Artifact registry、消息卡片和右侧抽屉，但真实对话链路不挂 Artifact 工具且会丢弃所有工具流事件，因此用户无法要求模型生成一份可独立打开、持久化和继续修改的 Markdown 文档。现在需要接通这条链路，让中英文及等价自然语言表达的 Markdown 交付请求稳定落成消息流内的 Markdown 卡片。

## What Changes

- 为 ThreadChat 增加服务端 `createMarkdownArtifact` 工具，接收文档标题和原始 Markdown 内容；工具 description 与 system 规则覆盖中文、英文及等价语义表达，并区分“生成 Markdown 交付物”和“讨论 Markdown 概念”。
- 扩展 AI SDK v7 UI Message Stream 消费器，识别完整、已校验的 Markdown 工具输入，并将产物原子地登记到树状态、绑定到当前 assistant 消息。
- 为显式且高置信的 Markdown 交付请求提供首步工具强制选择；其他等价语义由模型基于双语工具描述自动选择，避免只依赖固定关键词。
- 将消息流内既有 Artifact block 改为 Markdown 卡片；点击后打开现有右侧 Artifact drawer，并复用 `MarkdownBody` 渲染 GFM 内容。
- 让 Artifact-only 回复成为合法消息终态，补齐停止、重试、刷新恢复、分支标题、画布消息流与后续上下文序列化语义。
- 保留内部通用 Artifact registry，但新增明确的 `markdown` kind；用户可见的标题、图标、空态和计数统一使用 Markdown 文案。
- 不新增数据库表或列；Markdown 文档及消息关联继续随 `ThreadTreeState` 整树 JSON 持久化。
- 增加 Markdown 生成进度反馈：工具输入开始时立即显示不可点击的原位占位卡，输入增量阶段展示真实字符数、行数和最近章节，完整输入到达后原子替换为可点击 Artifact；临时进度不持久化。
- Markdown 工具调用作为该轮最终交付，调用完成后停止模型 loop，不再生成重复的“已生成/包含哪些内容”说明。

## Capabilities

### New Capabilities

- `markdown-artifacts`: 定义 Markdown 交付意图识别、工具调用、消息绑定、卡片/面板渲染、生命周期、持久化和上下文回放的完整行为。

### Modified Capabilities

（无——`openspec/specs/` 当前没有既有 capability；相关既有行为仅存在于已完成 change 的历史 delta spec 中。）

## Impact

- 服务端聊天编排：`app/api/chat/route.ts`、ThreadChat system prompt 与 Markdown 意图判定。
- 客户端流与状态：`app/thread-chat/net/ui-stream.ts`、`chat-controller.ts`、`core/types.ts`、`core/store.ts`、`net/prompt.ts`、`net/persist.ts`。
- 消息与面板 UI：列视图、画布展开面板、Artifact drawer、顶栏和画布统计文案。
- 测试：新增工具事件/意图识别纯函数测试，并扩展真实模型、消息流、重试和持久化端到端验收。
- 依赖与数据库：复用现有 `ai`、`zod`、`react-markdown`、`remark-gfm` 和 `branch_trees.state`，无新增依赖、无 SQL migration。
