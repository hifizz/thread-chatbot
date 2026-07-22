## 1. 类型、参数与纯函数契约

- [x] 1.1 在共享模块定义 `MARKDOWN_ARTIFACT_TOOL_NAME`、标题/内容长度常量、`markdownArtifactInputSchema`、`MarkdownArtifactInput`、轻量工具结果和外层 fence 归一化函数，并用纯函数测试锁定空值、长度与内部代码 fence 行为
- [x] 1.2 扩展 `ArtifactKind` 为 `code | note | markdown`，定义 `MarkdownArtifactStreamEvent`、`ToolInputAvailableChunk`、更新后的 `UIStreamHandlers` 和 store `attachArtifactToMessage` 签名，确保类型定义集中且 `pnpm typecheck` 可单独通过
- [x] 1.3 定义并测试 `validArtifactsOfMessage`、`hasRenderableAssistantOutput`、`serializeMessageForModel`，使正文与 Artifact-only 输出共享同一套判定/序列化契约
- [x] 1.4 定义中英文高置信显式 Markdown 交付意图 helper 及正反例语料：生成/输出/整理/改写 `.md` 为正例，解释 Markdown/语法问答/普通 Markdown 排版为反例

## 2. 服务端 Markdown 工具与语义选择

- [x] 2.1 在 `app/api/chat/route.ts` 定义并仅为 ThreadChat 模式挂载 `createMarkdownArtifact`，使用共享 Zod schema，`execute` 返回轻量成功结果且不重复回传正文
- [x] 2.2 编写中英文 tool description 与 ThreadChat system instruction：按独立 Markdown 交付物的语义触发、兼容中英文/混合及等价表达，明确反例、原始 Markdown 参数和单回复最多一次
- [x] 2.3 用 AI SDK v7 `prepareStep` 对高置信显式交付请求仅在 step 0 强制 Markdown 工具，后续 step 禁用该工具；普通与低置信请求保持 auto，验证不会循环创建

## 3. UI stream、controller 与 store

- [x] 3.1 扩展 `consumeUIMessageStream` 解析完整 `tool-input-available`，仅转发通过类型守卫的 `createMarkdownArtifact`，并按 `toolCallId` 去重、忽略未知/损坏/半成品工具事件
- [x] 3.2 实现 `attachArtifactToMessage` 原子 mutator：校验 thread/assistant message 后一次性更新 registry、order 和 `message.artifactIds`，失败时零部分写入
- [x] 3.3 更新 chat-controller 的输出进度与终态裁决：成功绑定的 Artifact 计为有效输出，tool-only finish/abort 不报空回复，瞬时 error 语义保持兼容
- [x] 3.4 更新 `resetAssistantMessage`：重试前从 registry/order 清除该消息所有旧 Artifact 并清空关联，验证重试只保留新版且无孤儿项

## 4. Markdown 消息卡片与 Artifact panel

- [x] 4.1 从列视图抽取共享 `MarkdownArtifactCard`，使用 Markdown 图标、标题、`MARKDOWN` 类型和打开预览文案，并保持来源会话深度色
- [x] 4.2 在 Artifact drawer 为 `markdown` kind 复用 `MarkdownBody` 渲染 GFM，统一顶栏、drawer、empty state、help 与 canvas count 的用户可见 Markdown 文案，同时兼容旧 code/note 数据
- [x] 4.3 调整 ChatView：pending 时保留 typing；Artifact 完整后 tool-only 消息隐藏空 bubble、显示卡片，text + Artifact 时两者按正文后卡片顺序显示
- [x] 4.4 扩展 `ThreadCanvasProps`/`CanvasActions` 的 `openArtifact` 接口，在 CanvasExpand 渲染同一共享卡片并打开全局 drawer，不创建 Artifact React Flow 节点

## 5. 持久化、标题与上下文回放

- [x] 5.1 更新 `sanitizeLoadedState`：pending/streaming 消息有正文或有效 Artifact 即恢复为 done，两者皆空才删除，并过滤坏引用及无消息引用的孤儿 registry/order 项
- [x] 5.2 更新分支标题生成选择器，允许 Artifact-only 首答，以 Artifact 标题和内容摘要构造 title API 的 answer
- [x] 5.3 在当前 thread 和 inherited history 中统一使用 `serializeMessageForModel`，让 Artifact-only 消息进入后续请求，并让继承字符预算按组合后的正文计算
- [x] 5.4 验证现有 `branch_trees.state` 整树 PUT/GET 可无 SQL migration 持久化 `markdown` kind、消息关联、来源 thread 与 tab 顺序

## 6. 自动化与真实链路验收

- [x] 6.1 增加纯函数和 stream/store 测试：双语意图正反例、schema/fence、工具 chunk 损坏与去重、原子绑定、tool-only 终态、retry、sanitize、上下文序列化
- [x] 6.2 扩展列视图和画布 e2e：Markdown 卡片插入、无空气泡、点击 drawer、GFM 结构、列/画布一致、停止与重试语义
- [x] 6.3 扩展持久化 e2e：生成后防抖保存、刷新/新 context 恢复、Artifact-only interrupted snapshot 收敛、孤儿状态容错、后续修改请求包含旧文档
- [x] 6.4 用中文、英文和未照抄 description 的等价表达跑默认 MiniMax 真实调用，并覆盖“Markdown 是什么？”反例；对其他已配置模型执行同一最小语料集
- [ ] 6.5 运行 `pnpm typecheck`、目标 ESLint、`pnpm build`、全部既有 ThreadChat e2e 与 `pnpm openspec:validate`，更新 README/CLAUDE 中 ThreadChat 工具与 Markdown Artifact 契约

## 7. Markdown 生成进度反馈

- [x] 7.1 定义 `MarkdownGenerationProgress`、start/delta chunk、progress event 与 handler 接口；使用 AI SDK `parsePartialJson` 按 `toolCallId` 解析局部参数
- [x] 7.2 在 `tool-input-start` 时立即插入列/画布共用的不可点击进度卡，delta 合帧展示真实字符数、行数、局部标题和最近章节；空白正文不显示裸 caret
- [x] 7.3 用 `hasToolCall(createMarkdownArtifact)` 在工具完成后终止模型 loop，移除第二轮重复说明
- [x] 7.4 将进度限制为临时消息态，完整 Artifact、finish、fail、abort、retry 时清理，存盘前剥离并在加载时防御性 sanitize
- [x] 7.5 增加进度解析、流事件顺序、store 原子替换、持久化剥离和恢复测试，并保存调研证据与结论文档
