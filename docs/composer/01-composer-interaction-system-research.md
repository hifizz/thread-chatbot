# ThreadChat Composer Interaction System 完整调研与交接文档

> 调研日期：2026-09-01  
> 关联需求：[Issue #68 — Composer Interaction & Command System](https://github.com/hifizz/thread-chatbot/issues/68)  
> 代码基线：`codex/research-project-workspace-design`  
> 基线提交：`d4025739348d8b22f47e12d60ce455bb290da23b`（`ci(project): lint legacy panel adapter too`）  
> 文档性质：Research Phase D 交接文档。本文保留完整的长期方案、技术调研、已确认决策和实验结论，但**不代表所有能力都进入当前实现**。  
> 当前 MVP 的冻结范围与下一阶段 Spec 输入：[Attachment Composer Frontend Demo MVP](./02-attachment-composer-demo-mvp.md)

---

## 0. 30 秒结论

ThreadChat 的 Composer 长期不应只是一个 `textarea`，而应成为用户为一次 Agent Run 组装以下内容的统一入口：

```text
Text Intent
+ Explicit Context References
+ Commands / Skills
+ Attachments / Multimodal Inputs
+ Run Configuration
```

完整能力需要稳定的领域协议、统一 Suggestion Engine、Attachment 生命周期、Draft、Message Parts 和 Context Compiler，而不是把 `@Artifact`、`/Skill`、Quote、文件全部降级成隐藏字符串。

但是，经过多轮复杂度收缩，本期不实现完整 Composer，也不更换编辑器 Core。本期只交付一个可独立验收的**纯前端 Attachment Composer Demo**：

```text
文件选择（支持 multi-select）
+ 文件拖拽
+ 文件/图片粘贴
+ 纯文本粘贴转虚拟文本附件
→ 每个附件独立显示在 Composer 顶部
→ 超出宽度时横向滚动
→ 通过 onChange 输出附件数组
→ 不调用后端
```

本期应优先复用仓库已有的 assistant-ui Composer/Attachment 视觉和 Primitive，但不能复用会实际调用 R2、ingest 和删除 API 的业务 Attachment Adapter。

长期技术结论仍然保留：

1. assistant-ui Elements Composer 是优秀的 Shell/UI 参考，但其示例输入仍是普通 `<input>`。
2. assistant-ui 真正的结构化输入路径是 `@assistant-ui/react-lexical`；它验证了 Lexical 的 Plain Text + 原子节点路线。
3. 当 ThreadChat 未来真的需要 Quote、`@Reference` 与文本任意有序混排时，优先直接采用 Lexical Core，并由 ThreadChat 自己维护编辑器与领域协议之间的薄适配层。
4. 当前 MVP 没有行内结构化节点需求，因此继续使用普通 textarea/input，避免提前引入 Lexical、Tiptap 或 ProseMirror。
5. Multi-quote 后续可以先做成一个 Quote Bundle 胶囊：Hover/Click 后显示按顺序排列的“引用 + 局部问题/补充”列表，不必立即把 Composer 建成富文本编辑器。
6. Selection Quote 的长期数据模型复用用户已确认的 `threadQuoteSourceV1Schema` / `threadQuoteDataV1Schema`，不再创建平行的 Selection Reference 模型。

---

## 一、需求问题空间

### 1.1 原始问题

Issue #68 最初承载的是一个完整 Composer 系统：

- `@Artifact`、`@File`、`@Message`、`@Thread` 等显式 Context Reference；
- `/Command` 与 Skill 选择；
- 图片、PDF、Office、Markdown、代码等多模态输入；
- Selection Quote 与 Multi-quote；
- Draft、发送协议、Message Parts、Context Compiler；
- Edit、Retry、Regenerate、Fork 的生命周期；
- 权限、缓存、可观测性和评测。

这些需求共用输入框、候选菜单、附件区和发送边界。如果分别开发，容易形成多套互相冲突的语法、状态和协议。

### 1.2 长期产品定义

长期 Composer 可定义为：

> 用户为一次 Agent Run 组装意图、上下文、命令、附件和运行配置的交互式入口。

理想端到端链路：

```text
用户打字 / 划选 / @ / / / Paste / Drop
                ↓
           Composer Draft
                ↓
      Structured Run Request
                ↓
服务端权限检查、资源解析与确定性编译
                ↓
        Message / Run Persistence
                ↓
         Agent Runtime / Model
```

### 1.3 当前 MVP 的产品定义

当前实施目标主动收缩为：

> 验证一个无后端依赖、能够通过选择、拖拽和粘贴收集多个附件，并在 Composer 顶部逐项回显的 assistant-ui 风格前端组件。

它只验证前端交互与组件契约，不验证真实上传、解析、消息发送或模型上下文。

---

## 二、当前代码基线审计

### 2.1 ThreadChat 自定义 Composer

当前主 ThreadChat Composer 位于：

- [`app/thread-chat/chat/composer/conversation-composer.tsx`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/app/thread-chat/chat/composer/conversation-composer.tsx)
- [`app/thread-chat/chat/composer/conversation-composer-logic.ts`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/app/thread-chat/chat/composer/conversation-composer-logic.ts)
- [`app/thread-chat/chat/composer/thread-model-selector.tsx`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/app/thread-chat/chat/composer/thread-model-selector.tsx)

现状：

- 使用非受控原生 `<textarea>`；
- 支持列模式和画布模式；
- 支持自动增高；
- 支持 Enter 发送、Shift+Enter 换行；
- 已处理 `isComposing` 与 `keyCode === 229`；
- 支持 Model Selector；
- `onSend` 仍只接收 `text: string`；
- `doSend()` 会在调用 `onSend` 前清空 textarea；
- 没有 Attachment Tray、Paste/Drop 文件入口或 Composer Draft。

这套实现适合轻量纯文本输入，但不适合直接承担复杂行内 Reference。对当前纯附件 Demo 而言，可以继续保留 textarea，不需要更换 Editor Core。

### 2.2 仓库已有 assistant-ui Attachment UI

已有可复用实现：

- [`components/assistant-ui/attachment.tsx`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/components/assistant-ui/attachment.tsx)
- [`components/assistant-ui/thread.tsx`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/components/assistant-ui/thread.tsx)

其中已经具备：

- `ComposerPrimitive.AttachmentDropzone`；
- `ComposerPrimitive.AddAttachment` 加号入口；
- `ComposerPrimitive.Attachments`；
- `AttachmentPrimitive.Remove`；
- 图片预览、文件 fallback 图标；
- 上传中和失败状态；
- 每个附件单独显示；
- `ComposerAttachments` 使用 `overflow-x-auto` 横向滚动；
- Composer 顶部附件、正文输入、底部操作区的布局。

因此当前 MVP 不需要从零设计 Attachment UI。最短路径是复用这些 Primitive、组件结构和视觉 token，并为 Demo 提供一个本地、无网络的附件数据源或 Adapter。

### 2.3 真实业务 Attachment Adapter 不属于 Demo

现有业务 Adapter：

- [`lib/chat/attachment-adapter.ts`](https://github.com/hifizz/thread-chatbot/blob/d4025739348d8b22f47e12d60ce455bb290da23b/lib/chat/attachment-adapter.ts)

它会执行：

```text
POST /api/attachments
→ PUT presigned URL 到 R2
→ POST /api/attachments/:id/ingest
→ 发送时解析 server attachment id
→ remove 时删除服务端资源
```

它还应用真实 MIME 白名单、大小限制、进度和错误处理。

本期是纯前端 Demo，因此不得把它挂到 Demo 上。否则 Demo 会依赖 R2、数据库、CORS、ingest 和后端路由，直接违背当前 scope。

### 2.4 当前依赖环境

代码基线已包含：

```text
@assistant-ui/react          ^0.14.26
@assistant-ui/core           ^0.2.20
@assistant-ui/react-lexical  ^0.2.4
React                        19.2.8
Next.js                      16.3.1
```

当前 MVP 不需要新增依赖，也不需要升级 assistant-ui 或 `@assistant-ui/react-lexical`。

---

## 三、assistant-ui Composer 深度结论

### 3.1 Elements Composer：优秀的 Shell，不是结构化 Editor

直接源码：

- [Elements Composer component](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/packages/ui/src/components/react/assistant-ui/elements/composer.tsx)
- [Elements Composer demo](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/apps/docs/components/demo/elements/composer.tsx)

其价值主要在：

- Composer / Bar / Toolbar / Actions 的拆分；
- Attachment Chip；
- Model Trigger；
- Command/Person Menu；
- Voice、Context Usage、Send/Stop；
- 紧凑、轻量、接近现代 Agent 产品的布局。

但是示例中的 `ComposerInput` 本质上是普通 React `<input>`：

- Slash 搜索主要基于 `value.startsWith("/")`；
- Mention 主要基于尾部正则；
- 选择后仍然是字符串替换；
- 不提供原子 Reference Node 或结构化 Document。

因此它适合当前 Attachment Demo 的 UI 参考，也适合作为长期 Shell，但不能独立解决 Multi-quote 或行内 `@Reference`。

### 3.2 assistant-ui 的结构化 Composer 使用 Lexical

直接源码：

- [`LexicalComposerInput.tsx`](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/packages/react-lexical/src/LexicalComposerInput.tsx)
- [`DirectiveNode.tsx`](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/packages/react-lexical/src/nodes/DirectiveNode.tsx)
- [`DirectivePlugin.tsx`](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/packages/react-lexical/src/plugins/DirectivePlugin.tsx)
- [`SyncPlugin.tsx`](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/packages/react-lexical/src/plugins/SyncPlugin.tsx)
- [`@assistant-ui/react-lexical` README](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/packages/react-lexical/README.md)

其核心组合是：

```text
LexicalComposer
+ ContentEditable
+ PlainTextPlugin
+ HistoryPlugin
+ Directive DecoratorNode
+ Trigger Plugin
+ Keyboard Plugin
+ Runtime Sync
```

`DirectiveNode` 提供 inline、isolated、keyboard-selectable、`contentEditable=false` 的原子节点；`DirectivePlugin` 负责 Trigger 匹配、替换触发文本和整体删除。这证明 Lexical 能很好地实现“普通 Prompt 文本 + 少量原子节点”。

### 3.3 为什么长期不建议直接把 react-lexical Runtime 当领域协议

assistant-ui 的 `SyncPlugin` 会在 Lexical Node 与带 Directive 语法的 Runtime 字符串之间双向转换：

```text
Lexical Nodes
↔ Directive String
↔ assistant-ui Composer Runtime
```

ThreadChat 长期需要的是：

```text
Lexical Nodes
↔ ThreadChat Composer Document
↔ Ordered Message Parts
```

Message、Fork、Artifact Reference 和历史数据不应依赖某个编辑器包的内部 JSON 或隐藏字符串格式。

同时，ThreadChat 当前锁定的 `@assistant-ui/react-lexical@0.2.4` 相比后续版本缺少若干改进，包括自定义 Plugin children、移动端/forward delete 原子删除、Tab 委托、Thread 切换 stale draft 修复、formatter 重新解析和自定义 Trigger matcher。若未来进入结构化 Composer，应重新评估版本，并优先直接使用 Lexical Core，而不是为了 Composer 强制迁移整个 assistant-ui Runtime。

---

## 四、编辑器 Core 对比

### 4.1 候选

| 方案 | 主要优势 | 主要代价 | 当前结论 |
|---|---|---|---|
| 原生 textarea + 外部附件 | 最简单、浏览器行为稳定、IME 成本低 | 无法自然混排行内原子 Reference | **当前 MVP 采用** |
| textarea + 高亮 Overlay | 保留 textarea，同时模拟 token | 光标、换行、删除、滚动和样式对齐逐渐变成自研编辑器 | 不建议作为长期方案 |
| 裸 contenteditable | 可显示任意 DOM | Selection、Paste、Undo、IME、空节点、移动端均需自行维护 | 排除 |
| Lexical Core | Plain Text + DecoratorNode 与 Agent Composer 高度匹配；History、Selection、Typeahead 成熟 | 需要 ThreadChat Node 与 Serializer 适配层 | **长期首选** |
| Tiptap / ProseMirror | 社区大、Mention/Suggestion/Schema 成熟 | 更容易自然膨胀为完整文档编辑器 | 长期备选 |
| 原生 ProseMirror | 控制力最大 | 实现与调试成本高于 Tiptap | 无必要直接采用 |
| Slate / Plate | React 生态成熟 | 对本项目没有明显优于 Lexical/Tiptap 的收益 | 不进入决赛 |

调研时的公开仓库快照约为：Tiptap 3.8 万 Stars、Lexical 2.4 万 Stars、assistant-ui 1.2 万 Stars；三者都属于高热度开源项目。最终选择应由产品形态决定，而不是只看 Stars。

### 4.2 长期选择 Lexical 的原因

当以下需求重新进入 scope 时：

- Quote 与 Text 任意有序混排；
- `@Reference` 成为可整体选中和删除的行内 Node；
- Undo/Redo 必须覆盖 Reference；
- Copy/Paste 需要结构化 round-trip；
- Edit 恢复完整 Composer Document；

推荐采用：

```text
LexicalComposer
PlainTextPlugin
HistoryPlugin
ThreadQuoteNode
ContextReferenceNode
LexicalTypeaheadMenuPlugin
Paste Normalization Plugin
ThreadChat Domain Serializer
```

不启用 Heading、List、Table、Formatting Toolbar 和富 HTML import，避免把 Prompt Composer 做成通用文档编辑器。

### 4.3 当前 MVP 为什么不使用 Lexical

当前 MVP 所有附件都位于 textarea 外部：

```text
Attachment Tray
普通 Textarea
Controls
```

没有任何内容需要与光标混排，因此引入 Lexical 不会增加当前用户价值，只会增加初始化、Selection、序列化和测试面。

---

## 五、11 个开源 AI/ADE 输入组件源码审计

以下 URL 均固定到调研时的具体 commit，可直接打开输入组件源码。

| 项目 | 直接组件源码 | 实现方式与发现 |
|---|---|---|
| assistant-ui | [Elements Composer](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/packages/ui/src/components/react/assistant-ui/elements/composer.tsx) / [Lexical Composer](https://github.com/assistant-ui/assistant-ui/blob/07fed430ca6b1c07782abd36f5c7f91a7bf5256c/packages/react-lexical/src/LexicalComposerInput.tsx) | UI Shell 使用普通 input；结构化能力单独使用 Lexical。Shell 与 Core 解耦。 |
| Vercel Chatbot | [`multimodal-input.tsx`](https://github.com/vercel/chatbot/blob/c2f8235e1f3ea903ad8b7f61447c4f74164b5c58/components/chat/multimodal-input.tsx) | textarea、localStorage Draft、字符串 Slash、外置附件、图片粘贴。适合 Text + File。 |
| Open WebUI | [`MessageInput.svelte`](https://github.com/open-webui/open-webui/blob/2a960a59fe1dbbd35282f0556b3666d81102e781/src/lib/components/chat/MessageInput.svelte) / [`RichTextInput.svelte`](https://github.com/open-webui/open-webui/blob/2a960a59fe1dbbd35282f0556b3666d81102e781/src/lib/components/common/RichTextInput.svelte) | Tiptap/ProseMirror，含 Markdown↔HTML、Mention、Table、FileHandler、Code 与大量转换 workaround。 |
| LibreChat | [`ChatForm.tsx`](https://github.com/danny-avila/LibreChat/blob/cdfe54c3498818b21b33fb609fee02f2742b37ea/client/src/components/Chat/Input/ChatForm.tsx) | TextareaAutosize；Quote、Skill、File 作为外置 pending chip；有 autosave 与完整 submission context。 |
| LobeChat / LobeEditor | [`ChatInput.tsx`](https://github.com/lobehub/lobe-editor/blob/6a3f8365acde6979eaad5ba91e959ba81bae338f/src/react/ChatInput/ChatInput.tsx) / [Lexical Kernel](https://github.com/lobehub/lobe-editor/blob/6a3f8365acde6979eaad5ba91e959ba81bae338f/src/editor-kernel/react/react-editor.tsx) | Composer Shell 与独立 Lexical Editor Kernel 分离。 |
| Chatbot UI | [`chat-input.tsx`](https://github.com/mckaywrigley/chatbot-ui/blob/81328b61d2a4ab597a7a057be70e785cf756d9f8/components/chat/chat-input.tsx) | TextareaAutosize、Command Picker、文件/工具外置、图片粘贴。 |
| Dify | [`chat-input-area/index.tsx`](https://github.com/langgenius/dify/blob/27c2f058febe50cb5c6a54375ef392bf20cd53d4/web/app/components/base/chat/chat/chat-input-area/index.tsx) | textarea、File Store、IME、拖放和粘贴；异步 `onSend` 接受后才清理已提交值。 |
| AnythingLLM | [`PromptInput/index.jsx`](https://github.com/Mintplex-Labs/anything-llm/blob/20f6d3546c1938bfea1ad304f58a592dddcc5948/frontend/src/components/WorkspaceChat/ChatContainer/PromptInput/index.jsx) | textarea、按 Thread localStorage、手工 Undo/Redo、Slash Tools、图片/文件/文本粘贴。 |
| OpenHands | [`chat-input-field.tsx`](https://github.com/OpenHands/OpenHands/blob/50144692e3695c84000577cddf3e848f8c8d9647/src/components/features/chat/components/chat-input-field.tsx) / [`use-chat-input-events.ts`](https://github.com/OpenHands/OpenHands/blob/50144692e3695c84000577cddf3e848f8c8d9647/src/hooks/chat/use-chat-input-events.ts) | 裸 contenteditable，手工处理 plain-text paste、文件、IME 和移动端。 |
| Cline | [`ChatTextArea.tsx`](https://github.com/cline/cline/blob/8eb5f3d57f3eb87f21262f6ec2326ce460445dea/apps/vscode/webview-ui/src/components/chat/ChatTextArea.tsx) | textarea + 高亮 Overlay + Mention/Slash 正则；需维护大量光标、删除和菜单状态。 |
| Continue | [`TipTapEditor.tsx`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/components/mainInput/TipTapEditor/TipTapEditor.tsx) / [`Mention.ts`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/components/mainInput/TipTapEditor/extensions/Mention.ts) / [`SlashCommand.ts`](https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/gui/src/components/mainInput/TipTapEditor/extensions/SlashCommand.ts) | Tiptap JSON、原子 Mention、Slash、Code/Prompt Block、图片和 Context Provider；最接近完整 ADE Composer。 |

### 5.1 社区规律

只有 Text + Attachment 的产品通常仍使用：

```text
textarea
+ attachment tray
+ slash/mention popup
```

需要结构化 Context 的 ADE 更倾向：

```text
Lexical / Tiptap
+ atomic node
+ suggestion provider
```

在 textarea 上模拟 token 的产品，随着能力增加，最终都需要自行处理光标、Overlay、删除、Undo、Selection、IME、Paste 和 History，长期成本接近自研编辑器。

当前 MVP 明确属于第一类，因此普通 textarea + Attachment Tray 是正确的复杂度。

---

## 六、Attachment、Paste 与 Drop

### 6.1 长期概念边界

长期需要区分：

```text
Attachment UI Item
→ 用户在本轮 Composer 中选择的输入资源

Uploaded Attachment
→ 具有服务端 ID、状态、存储和处理生命周期

Project File
→ 项目长期资产，可跨 Thread 复用

Context Reference
→ 指向已有 Artifact/File/Message/Thread 的显式引用
```

UI 可以使用相似 Chip，但领域语义不能完全合并。

### 6.2 当前 MVP 的统一归一化

本期所有外部输入统一归一化为浏览器 `File`：

```ts
type DemoAttachmentSource = "picker" | "drop" | "paste"

type DemoAttachment = {
  id: string
  file: File
  source: DemoAttachmentSource
}
```

纯文本粘贴转换成合成文件：

```ts
new File([pastedText], `pasted-text-${Date.now()}.txt`, {
  type: "text/plain",
})
```

这样 Picker File、Drop File、Clipboard Image、Clipboard File 和 Pasted Text 可以使用同一条展示与 `onChange` 链路。

### 6.3 当前 MVP 的 Paste 规则

```text
正常键盘输入
→ 进入 textarea

Paste 中包含一个或多个 file item
→ 每个 item 创建一个 DemoAttachment

Paste 只有 text/plain
→ preventDefault
→ 创建一个 synthetic .txt attachment
→ 不把文本插入 textarea

Paste 同时包含文件和文本
→ 优先保留所有文件；是否同时生成文本附件由 Spec 按“可预测优先”处理
```

为避免同一次浏览器复制同时提供 HTML、plain text 和 file item 而产生重复，推荐规则是：

1. 有 file item 时，只消费 file item；
2. 没有 file item 时，消费 `text/plain`；
3. 不消费 HTML 样式；
4. 空白文本不创建附件。

### 6.4 当前 MVP 的展示规则

每个附件必须是独立可操作的 Item：

```text
[需求文档.pdf ×] [截图.png ×] [pasted-text-...txt ×] →
```

必要规则：

- 单行；
- 不换行；
- 每个 Item 不被压缩到不可读；
- 超出宽度后横向滚动；
- 移除单个附件会触发新的 `onChange`；
- exact tile/pill 形态不作为验收阻塞，优先沿用 assistant-ui 已有 Attachment Tile。

### 6.5 当前 MVP 不做真实 Attachment 业务

明确不做：

- MIME 白名单；
- 文件大小限制；
- R2/S3 上传；
- Presigned URL；
- ingest；
- OCR；
- PDF/Office/代码解析；
- 上传进度；
- server attachment id；
- 数据库；
- Message Parts；
- 模型能力检查；
- 发送后生命周期。

---

## 七、Quote 与 Multi-quote 的长期结论

> 本章是长期设计资产，不进入当前 Attachment Demo MVP。

### 7.1 复用已确认的 Quote 数据模型

用户已确认，Selection Quote 使用 `threadQuoteSourceV1Schema` / `threadQuoteDataV1Schema`，不再创建另一套 Selection Reference。

核心约束：

- Message Selection 与 Artifact Selection 使用 discriminated union；
- `TextAnchor` 包含 `quote.exact/prefix/suffix` 与可选 `position.start/end`；
- 输入模型只提交最小 Source ID + Anchor；
- 服务端持久化模型补全 Project、Thread、Message、Artifact 来源；
- `text` 必须等于 `source.anchor.quote.exact`；
- `branch-origin` 只能来自 `message-selection`；
- Legacy `{ text }` 只读兼容，不再新增；
- `quoteId` 表示一次 Quote 出现；
- `quoteSourceKey()` 用于来源读取/缓存去重，不能替代 Quote occurrence identity。

### 7.2 用户确认的 Schema

以下代码作为未来 Quote Spec 的确认输入保留；当前 MVP 不实现：

```ts
import { z } from "zod"
import {
  THREAD_QUOTE_MAX_COMMENT_CHARS,
  THREAD_QUOTE_MAX_TEXT_CHARS,
  THREAD_QUOTE_SCHEMA_VERSION,
} from "@/constants/thread-chat"
import type { TextAnchor } from "@/lib/thread-chat/domain/text-anchor"

const entityIdSchema = z.uuid()

export const textAnchorSchema = z
  .object({
    quote: z
      .object({
        exact: z.string().min(1).max(THREAD_QUOTE_MAX_TEXT_CHARS),
        prefix: z.string(),
        suffix: z.string(),
      })
      .strict(),
    position: z
      .object({
        start: z.number().int().min(0),
        end: z.number().int().min(0),
      })
      .strict()
      .refine((position) => position.end > position.start, {
        message: "position.end 必须大于 position.start",
      })
      .optional(),
  })
  .strict()

export const messageSelectionInputSchema = z
  .object({
    type: z.literal("message-selection"),
    sourceMessageId: entityIdSchema,
    anchor: textAnchorSchema,
  })
  .strict()

export const artifactSelectionInputSchema = z
  .object({
    type: z.literal("artifact-selection"),
    artifactId: entityIdSchema,
    anchor: textAnchorSchema,
  })
  .strict()

export const quoteSourceInputSchema = z.discriminatedUnion("type", [
  messageSelectionInputSchema,
  artifactSelectionInputSchema,
])

const quoteCommentSchema = z
  .string()
  .trim()
  .min(1)
  .max(THREAD_QUOTE_MAX_COMMENT_CHARS)
  .optional()

export const quoteSelectionInputSchema = z
  .object({
    source: quoteSourceInputSchema,
    comment: quoteCommentSchema,
  })
  .strict()

const messageQuoteSourceSchema = z
  .object({
    type: z.literal("message-selection"),
    projectId: entityIdSchema,
    threadId: entityIdSchema,
    messageId: entityIdSchema,
    anchor: textAnchorSchema,
  })
  .strict()

const artifactQuoteSourceSchema = z
  .object({
    type: z.literal("artifact-selection"),
    projectId: entityIdSchema,
    threadId: entityIdSchema,
    sourceMessageId: entityIdSchema,
    artifactId: entityIdSchema,
    anchor: textAnchorSchema,
  })
  .strict()

export const threadQuoteSourceV1Schema = z.discriminatedUnion("type", [
  messageQuoteSourceSchema,
  artifactQuoteSourceSchema,
])

export const threadQuoteDataV1Schema = z
  .object({
    schemaVersion: z.literal(THREAD_QUOTE_SCHEMA_VERSION),
    quoteId: entityIdSchema,
    kind: z.enum(["branch-origin", "selection"]),
    text: z.string().min(1).max(THREAD_QUOTE_MAX_TEXT_CHARS),
    comment: quoteCommentSchema,
    source: threadQuoteSourceV1Schema,
  })
  .strict()
  .superRefine((quote, context) => {
    if (quote.text !== quote.source.anchor.quote.exact) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Quote text 必须等于 source.anchor.quote.exact",
      })
    }
    if (
      quote.kind === "branch-origin" &&
      quote.source.type !== "message-selection"
    ) {
      context.addIssue({
        code: "custom",
        path: ["source", "type"],
        message: "branch-origin 只能来自 Message selection",
      })
    }
  })

export const legacyThreadQuoteDataSchema = z
  .object({
    text: z.string().min(1).max(THREAD_QUOTE_MAX_TEXT_CHARS),
  })
  .strict()

export type MessageSelectionInput = z.infer<
  typeof messageSelectionInputSchema
>
export type ArtifactSelectionInput = z.infer<
  typeof artifactSelectionInputSchema
>
export type QuoteSourceInput = z.infer<typeof quoteSourceInputSchema>
export type QuoteSelectionInput = z.infer<typeof quoteSelectionInputSchema>
export type MessageQuoteSourceV1 = z.infer<typeof messageQuoteSourceSchema>
export type ArtifactQuoteSourceV1 = z.infer<typeof artifactQuoteSourceSchema>
export type ThreadQuoteSourceV1 = z.infer<typeof threadQuoteSourceV1Schema>
export type ThreadQuoteDataV1 = z.infer<typeof threadQuoteDataV1Schema>
export type LegacyThreadQuoteData = z.infer<
  typeof legacyThreadQuoteDataSchema
>
export type ThreadQuoteData = ThreadQuoteDataV1 | LegacyThreadQuoteData
export type ThreadQuoteKind = ThreadQuoteDataV1["kind"]

export type NormalizedThreadQuote =
  | {
      schemaVersion: typeof THREAD_QUOTE_SCHEMA_VERSION
      quoteId: string
      kind: ThreadQuoteKind
      text: string
      comment?: string
      source: ThreadQuoteSourceV1
    }
  | {
      schemaVersion: "legacy"
      quoteId: null
      kind: "legacy"
      text: string
      source: null
    }

export function parseThreadQuoteData(value: unknown): NormalizedThreadQuote {
  const versioned = threadQuoteDataV1Schema.safeParse(value)
  if (versioned.success) return versioned.data

  const legacy = legacyThreadQuoteDataSchema.safeParse(value)
  if (legacy.success) {
    return {
      schemaVersion: "legacy",
      quoteId: null,
      kind: "legacy",
      text: legacy.data.text,
      source: null,
    }
  }

  throw new Error("INVALID_THREAD_QUOTE_DATA", { cause: versioned.error })
}

export function isThreadQuoteDataV1(
  value: unknown
): value is ThreadQuoteDataV1 {
  return threadQuoteDataV1Schema.safeParse(value).success
}

export function quoteSelectionKey(selection: QuoteSelectionInput): string {
  const source = selection.source
  const anchor = source.anchor
  const sourceId =
    source.type === "message-selection"
      ? `message:${source.sourceMessageId}`
      : `artifact:${source.artifactId}`
  return [
    sourceId,
    anchor.position?.start ?? "",
    anchor.position?.end ?? "",
    anchor.quote.exact,
    anchor.quote.prefix,
    anchor.quote.suffix,
  ].join("\u001f")
}

export function quoteSourceKey(source: ThreadQuoteSourceV1): string {
  const sourceId =
    source.type === "message-selection"
      ? `message:${source.messageId}`
      : `artifact:${source.artifactId}`
  const anchor = source.anchor
  return [
    sourceId,
    anchor.position?.start ?? "",
    anchor.position?.end ?? "",
    anchor.quote.exact,
    anchor.quote.prefix,
    anchor.quote.suffix,
  ].join("\u001f")
}

export function textAnchorExact(anchor: TextAnchor): string {
  return anchor.quote.exact
}
```

### 7.3 Multi-quote 的复杂度收缩

最初方案要求 Quote 与 Text 任意混排，会立即触发结构化编辑器需求。用户后来确认，MVP 前可以先将 Multi-quote 表示为一个类似 Attachment 的 Quote Bundle：

```text
[已添加 3 条引用]
        ↓ hover/click
┌──────────────────────────────┐
│ 引用 1                       │
│ 原文……                       │
│ 问题/Comment：核查这个数字   │
├──────────────────────────────┤
│ 用户补充                     │
│ 这里与上一段一起比较         │
├──────────────────────────────┤
│ 引用 2                       │
│ 原文……                       │
└──────────────────────────────┘
```

Quote Bundle 内部保留有序 List，但 Composer 只显示一个胶囊。这样可以：

- 保留多引用顺序；
- 保留 Quote + Comment；
- 继续使用确认的 Quote Schema；
- 不要求 Quote 与光标混排；
- 暂不引入 Lexical。

该方案是未来 Quote MVP 的优先简化路径，但当前 Attachment Demo 仍不实现 Quote Bundle。

---

## 八、`@Reference` 与 `/Skill` 的长期结论

> 本章不进入当前 Attachment Demo MVP。

### 8.1 `@Reference`

长期应统一为 Context Reference：

```text
Context Reference
├── Whole-entity Reference
│   ├── Artifact
│   ├── File
│   ├── Message
│   └── Thread Snapshot
└── Selection Reference
    ├── Message Selection + TextAnchor
    └── Artifact Selection + TextAnchor
```

Whole-entity Reference 不应伪造成“全文 Selection”，因为它没有 TextAnchor，预算、版本和生命周期也不同。

第一步若重新启动 `@Artifact` Feature，可先做纯前端两个假数据的候选面板；真实搜索、权限、Artifact 内容读取和 Context Compiler 应拆成后续独立 Spec。

### 8.2 `/Command` 与 Skill

`/` 是发现和触发机制，不应直接成为持久化隐藏字符串。长期至少需要区分：

```text
client-only action
composer transformation
context modifier
skill activation
tool/workflow activation
run configuration
```

Skill 属于 Run Configuration，不属于正文 Document。即便 UI 显示为 `[Research ×]` Chip，底层也应保存结构化 Skill Selection State。

### 8.3 统一 Suggestion Engine

`@` 与 `/` 可以共享：

- Trigger query；
- 异步 Provider；
- Loading/Empty/Error；
- Arrow/Enter/Tab/Escape；
- Popover；
- Accessibility；
- 请求取消与乱序保护。

但 Commit 行为不同：

```text
@Artifact
→ 插入 Context Reference 或外置 Context Chip

/Research
→ 删除触发 token
→ 更新外部 Skill Selection State
```

若未来采用 Lexical，可优先使用官方 `LexicalTypeaheadMenuPlugin`，避免自研光标锚定和基础菜单生命周期。

---

## 九、Draft、Message Parts 与 Context Compiler 的长期结论

> 本章不进入当前 Attachment Demo MVP。

### 9.1 三层协议必须解耦

```text
Editor State
→ 编辑器内部实现

Composer Draft / Document
→ 用户尚未提交的应用状态

UIMessage Parts
→ 已发送消息的持久化事实

ModelMessage
→ 模型调用前的编译产物
```

不能把 Lexical JSON、Tiptap JSON 或隐藏 Directive String 直接当长期消息协议。

### 9.2 Draft

完整 Draft 需要按目标 Thread 隔离：

```text
ComposerDraft
├── schemaVersion
├── revision
├── document
├── attachments
├── skillSelection
├── runConfig
├── updatedAt
└── submission snapshot
```

发送应采用：

```text
Freeze Draft Snapshot
→ 服务端接受
→ 仅在当前 Draft 仍等于已提交 Snapshot 时清除
```

这样迟到成功响应不会删除用户等待期间输入的新内容。Dify 的当前实现也采用“只清除仍等于已提交值的 query/files”这一安全模式。

### 9.3 Ordered Message Parts

若未来支持 Quote/Reference，有序关系必须保留：

```text
Quote A
Text A
Quote B
Text B
```

不能退化成：

```ts
{
  text: string,
  references: Reference[]
}
```

否则会失去用户表达顺序。

### 9.4 Context Compiler

服务端应统一执行：

```text
Schema Validation
→ Project/Owner Permission
→ Source Resolution
→ Anchor Verification
→ Version/Outdated Check
→ Resource Read Deduplication
→ Preserve Part Order
→ Budget / Truncate
→ Deterministic ModelMessage
```

客户端只提交标识和用户输入，不能提前把引用内容拼成 Prompt。

---

## 十、关键实验与结论

### 10.1 Quote / Ordered Parts 协议 PoC

验证目标：

- `ThreadQuoteDataV1` 能否作为 Composer Quote 与 Message data part；
- Text/Quote 顺序是否可以无损 round-trip；
- Schema 不变量是否能拒绝错误数据；
- 迟到提交是否会误清新 Draft。

结果：10 项断言通过，覆盖：

- Quote/Text 顺序一致；
- 相邻 Text 可合并但不能跨 Quote 重排；
- Message/Artifact Source Key 可区分；
- `text !== anchor.quote.exact` 被拒绝；
- Artifact `branch-origin` 被拒绝；
- 稳定摘要不受对象字段顺序影响；
- 迟到接受不清除新 Draft；
- 未变化 Draft 可清除；
- Comment 保留；
- Quote occurrence 与 source identity 分离。

影响：确认 Quote 不需要平行数据模型，未来可以直接围绕 `ThreadQuoteDataV1` 建设。

### 10.2 `@` / `/` Trigger PoC

验证目标：共享 Trigger Matcher，同时保持 Reference 与 Skill 不同提交语义。

结果：12 项断言通过，覆盖：

- `@` 起始与空格后匹配；
- email 中 `@` 不触发；
- token 结束后关闭；
- `/` 只在第一个非空白 token 匹配；
- IME 和 keyCode 229 不处理；
- Reference 插入 Document；
- Skill 删除 token 并更新外部状态。

影响：长期可共享 Suggestion Infrastructure，但不应共享后端语义。

### 10.3 实验边界

上述实验是协议级最小 PoC，不是完整浏览器实现，也没有在当前 ThreadChat 页面运行 Lexical/Tiptap。它们用于验证数据和状态方向，不应被误解为当前 MVP 已实现这些能力。

---

## 十一、关键决策记录

| 阶段 | 决策 | 原因 |
|---|---|---|
| 初始 | 将 `@Reference`、Slash、Skill、Attachment、Quote 视为完整 Composer 系统 | 避免分别开发互相冲突的状态与协议 |
| Phase B | Lexical-first，Tiptap 作为对照 | Plain Text + 原子节点更贴近 Agent Composer |
| Phase C | Selection Quote 复用 `ThreadQuoteDataV1` | 避免 Fork Quote、Composer Quote、Message Quote 三套模型 |
| 收缩 1 | Multi-quote 可先做 Quote Bundle 胶囊 + Popover List | 保留顺序，不强迫输入框变成富文本 |
| 收缩 2 | 当前 Spec 曾考虑 Attachment + 纯前端 `@Artifact` Demo | 先验证 UI 能力，不接后端 |
| 最终收缩 | 当前 Spec 只做 Attachment Composer Frontend Demo | 更快可用；数据边界清楚；业务团队后续自行接上传和消息链路 |
| 最终 | 当前 MVP 不使用 Lexical/Tiptap | 没有行内结构化节点需求，引入 Core 没有即时收益 |
| 最终 | 尽可能复用 assistant-ui，但不接真实 R2 Adapter | 最大化现有 UI 复用，同时保持 Demo 无后端依赖 |

---

## 十二、当前进入 Spec 的唯一 Scope

当前 Spec 只消费：[Attachment Composer Frontend Demo MVP](./02-attachment-composer-demo-mvp.md)。

### 12.1 本期包含

```text
+ 按钮
→ 系统文件选择器
→ multiple multi-select

Drag & Drop
→ 一个或多个 File

Paste
→ Clipboard File/Image
→ 或 text/plain 转 synthetic .txt File

Attachment Tray
→ 每个文件一个独立 Item
→ 单行
→ 横向滚动
→ 单项移除

State Contract
→ DemoAttachment[]
→ onChange(nextAttachments)
→ Demo 中 console.log
```

### 12.2 本期不包含

- `@Artifact`；
- `@File`、`@Message`、`@Thread`；
- Multi-quote 或 Quote Bundle；
- Lexical、Tiptap、ProseMirror；
- Slash、Skill；
- 后端上传；
- R2/S3；
- ingest、OCR、解析；
- MIME/大小业务校验；
- Message send payload；
- 数据库和持久化；
- Draft 恢复；
- Context Compiler；
- Edit/Retry/Regenerate/Fork；
- 完整 UX、美观度和动画打磨。

---

## 十三、路线图

### V1：当前 Attachment Demo

目标是给下一阶段和业务开发者一个可见、可操作、可复用的前端附件入口与 `onChange` 契约。

### V2：真实 Attachment 业务

在独立 Spec 中接入：

- MIME/size policy；
- 真实 Attachment Adapter；
- 上传进度与失败重试；
- R2/ingest；
- Message Parts；
- 发送门禁；
- Draft 恢复；
- 模型原生能力与解析 fallback。

### V2：独立 `@Artifact` Feature

在 Project/Artifact 能力稳定后单独实现：

- 候选搜索 API；
- Project permission；
- Artifact/Revision identity；
- 选择回显；
- Message Part；
- Context Compiler；
- outdated/deleted 状态。

### V2：Quote Bundle

以一个 Composer 胶囊承载有序 Quote/Comment List，复用已确认 Quote Schema，不要求行内混排。

### V3：Structured Composer

只有在明确需要任意 Text/Reference 混排时才进入：

- Direct Lexical Core；
- ThreadQuoteNode / ContextReferenceNode；
- Unified Suggestion Engine；
- Structured Draft；
- Ordered Message Parts；
- Edit/Retry/Regenerate/Fork 完整生命周期；
- Browser IME、Selection、Copy/Paste 与 Accessibility 矩阵。

---

## 十四、风险与偏差预期

### 14.1 Demo 被误接为生产上传

风险：开发者直接复用真实 `r2AttachmentAdapter`，使 Demo 依赖后端。

纠偏：MVP 文档明确要求 local/no-network adapter 或受控本地数组；通过 Network 面板确认无请求。

### 14.2 Paste 行为重复创建附件

风险：同一个剪贴板同时提供 HTML、plain text 和 file item。

纠偏：有 file item 时只消费 file；无 file 时再消费 `text/plain`。

### 14.3 同名文件被错误去重

风险：使用文件名作为 key。

纠偏：每次添加使用独立 `crypto.randomUUID()`；Demo 默认允许同名文件共存。

### 14.4 误把 Demo 数据模型当生产协议

风险：`DemoAttachment { id, file, source }` 被直接持久化到服务端。

纠偏：该模型只用于浏览器 Demo。真实业务仍需 server attachment id、状态、权限和版本协议。

### 14.5 长期研究内容污染当前 Spec

风险：Spec 阶段顺手加入 `@Artifact`、Quote、Lexical、上传或 Draft。

纠偏：当前 Spec 只引用 MVP 文档的冻结范围；本文其他章节均标注为后续路线。

---

## 十五、Spec 阶段建议起点

1. 首先阅读并冻结 [`02-attachment-composer-demo-mvp.md`](./02-attachment-composer-demo-mvp.md)。
2. 不为本期新增编辑器依赖。
3. 优先使用已有 assistant-ui Attachment Primitive、Dropzone、AddAttachment 与横向列表视觉。
4. 创建一个本地、无请求的 Demo Attachment 数据源。
5. 先完成四种输入归一化：Picker、Drop、Clipboard File/Image、Clipboard Text。
6. 再完成单项移除、横向滚动与 `onChange`。
7. 最后以浏览器 Network 面板确认没有上传/API 请求，并按 MVP 验收清单测试。
8. Research 文档经用户确认后，再进入 OpenSpec/Design；不要在本 PR 中写实现代码。

---

## 十六、最终交接状态

Research 已完成：

- 项目代码审计；
- assistant-ui Elements 与 Lexical 路径追踪；
- 编辑器技术对比；
- 11 个开源 AI/ADE Composer 源码审计；
- Quote 模型确认；
- Suggestion 与 Draft 协议 PoC；
- 完整长期路线；
- 当前 MVP 的主动复杂度收缩。

下一检查点：用户审阅本 Research 文档及 MVP 文档。确认后，Research 阶段结束，进入 Spec。