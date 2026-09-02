# 设计：Attachment Composer 纯前端演示

## Context

本设计只实现 [`docs/composer/02-attachment-composer-demo-mvp.md`](../../../docs/composer/02-attachment-composer-demo-mvp.md) 冻结的当前 MVP，不重新打开完整 Composer 的长期范围。完整调研见 [`docs/composer/01-composer-interaction-system-research.md`](../../../docs/composer/01-composer-interaction-system-research.md)。

当前代码具备三类可复用基础：

1. `app/thread-chat/chat/composer/conversation-composer.tsx` 已提供普通 textarea、列/画布变体和发送按钮，但没有附件状态，并且发送仍是 `onSend(text)`；本变更不应修改它。
2. `components/assistant-ui/attachment.tsx` 已有 Composer 附件区、加号、独立 Tile、移除、图片展示和 `overflow-x-auto`，但这些组件依赖 assistant-ui Runtime 与 Attachment Primitive。
3. `components/ui/attachment.tsx` 是不依赖 assistant-ui Runtime 的纯展示组件，已经提供 `AttachmentGroup`、`Attachment`、标题截断、操作区、`shrink-0` 和横向滚动，恰好适合受控 Demo。

正式业务的 `lib/chat/attachment-adapter.ts` 会调用 `/api/attachments`、对象存储 PUT、ingest 和删除接口，不能进入本 Demo。

## Goals / Non-Goals

**Goals:**

- 用最小代码交付一个可以独立访问和验收的附件 Composer。
- 支持 multi-select Picker、Drop、Paste File/Image、Paste Text → synthetic File。
- 每个附件独立显示、可移除，数量多时单行横向滚动。
- 以稳定、简单的受控 `attachments/onChange` 契约向下一阶段业务代码交付。
- 尽可能复用仓库已有的附件 UI、assistant-ui 按钮/视觉语言和测试基础。
- 保证所有附件行为只发生在浏览器内，不触发正式业务请求。

**Non-Goals:**

- 不接入正式 ThreadChat Composer、Assistant Runtime 消息流或 `onSend(text)`。
- 不上传、不解析、不持久化附件。
- 不判断模型是否支持文件或图片。
- 不实现 `@Artifact`、Quote、Slash/Skill、Draft 或结构化编辑器。
- 不做文件预览编辑、拖拽排序、去重和完整移动端优化。

## Decisions

### D1：独立 Demo Route，不修改正式 Composer

**选择**：新增 `app/thread-chat/attachment-composer-demo/page.tsx`，页面位于现有 ThreadChat 区域，继承项目主题与访问门禁；可复用组件位于 `app/thread-chat/chat/composer/attachment-composer-demo.tsx`。

**理由**：用户当前只要求演示和组件契约。直接改 `ConversationComposer` 会立刻牵涉正式发送、列/画布双形态、消息协议和附件业务状态，明显超出本期。独立路由可以快速验收，也便于业务团队在下一 Feature 中决定如何接入。

**边界**：路由继承 `app/thread-chat/layout.tsx` 的登录校验不视为附件业务依赖；验收中的“零后端”指 Picker/Drop/Paste/Remove 不调用任何附件、对象存储、ingest 或消息 API。

### D2：受控 `DemoAttachment[]` 是唯一事实源

```ts
export type DemoAttachmentSource = "picker" | "drop" | "paste"

export type DemoAttachment = {
  id: string
  file: File
  source: DemoAttachmentSource
}
```

组件只读取 `attachments` 并通过 `onChange(next)` 请求父组件更新。页面使用 `useState` 接受变化并打印控制台。

**理由**：

- 业务方可以直接替换 `onChange`，不必理解 assistant-ui Runtime 内部对象。
- 不会把浏览器 `File` 误当作长期协议。
- 同一数据模型覆盖 Picker、Drop、Clipboard File、Image 和 synthetic Text。
- 受控契约使 Demo 行为和测试确定，避免本地 state 与父 state 双写。

### D3：UI 复用纯展示 Attachment 组件，不为 Demo 搭 Assistant Runtime

**选择**：

- Tray 与 Item 优先复用 `components/ui/attachment.tsx`：
  - `AttachmentGroup`
  - `Attachment`
  - `AttachmentMedia`
  - `AttachmentContent`
  - `AttachmentTitle`
  - `AttachmentDescription`
  - `AttachmentActions`
  - `AttachmentAction`
- 加号可复用 `components/assistant-ui/tooltip-icon-button.tsx` 的按钮视觉，或使用同一 Button/Tooltip 组合。
- Composer 外壳沿用 `components/assistant-ui/thread.tsx` 中的圆角、边框、背景、间距和 dragging 状态语言，但不复制完整 Thread 组件。

**不选择**：为 Demo 新建 `AssistantRuntimeProvider + useLocalRuntime + AttachmentAdapter`，或直接使用 `ComposerPrimitive.Attachments` / `AttachmentPrimitive.Remove`。

**理由**：Runtime Primitive 的状态来源是 assistant-ui Composer，而当前冻结契约的状态来源是 `DemoAttachment[]`。为了一个不发送消息的 Demo 搭建 Runtime、模型 Adapter 和双向同步，会增加不必要的状态层。纯 UI 组件已经提供横向滚动、截断和操作区，可在不复制业务逻辑的前提下获得相同视觉语言。

### D4：所有入口先归一化，再一次性 `emitChange`

建议在 `attachment-composer-demo-model.ts` 中提供纯函数：

```ts
createDemoAttachments(files, source): DemoAttachment[]
createPastedTextAttachment(text, now?): DemoAttachment | null
appendDemoAttachments(current, added): DemoAttachment[]
removeDemoAttachment(current, id): DemoAttachment[]
```

组件内部只保留一个更新入口：

```ts
const emitChange = (next: DemoAttachment[]) => onChange(next)
```

一次 Picker/Drop/Paste 即使包含多个文件，也只生成一个 `next` 并调用一次 `onChange`。

### D5：ID、重复与文件名

- 每一次附件出现都调用 `crypto.randomUUID()`。
- 默认允许同名文件和同一个文件重复出现，不去重。
- 浏览器提供空文件名时，展示层使用 `Untitled attachment` 或按来源生成的可识别回退名称；不修改原始 File。
- synthetic 文本 File 使用 `pasted-text-{timestamp}.txt`、`text/plain`，File 内容必须保留原始文本，包括换行和首尾空格；只用 `trim()` 判断是否为空。

### D6：Clipboard 使用“文件优先”确定规则

```text
paste
→ 收集所有 kind === "file" 且 getAsFile() 非空的项
→ 若至少一个文件：preventDefault + 一次性追加文件，结束
→ 否则读取 text/plain
→ trim 非空：preventDefault + 创建一个 synthetic .txt，追加
→ 空白：不处理
```

**理由**：浏览器和应用经常同时提供 File、HTML 和 plain text。文件优先可以避免粘贴一张截图时同时生成图片和重复文本附件；本期不读取 HTML。

Paste Handler 挂在 Composer 外壳的可冒泡范围或 textarea 上，保证 textarea 聚焦时可捕获。

### D7：Picker 与 Drop 使用浏览器原生能力

**Picker:**

- 隐藏 `<input type="file" multiple>`；不设置 `accept`。
- `+` 点击调用 `inputRef.current?.click()`。
- `change` 后读取 `Array.from(files ?? [])`，追加后执行 `input.value = ""`。

**Drop:**

- `dragover/drop` 调用 `preventDefault()`。
- 读取 `Array.from(dataTransfer.files)`，为空时不调用 `onChange`。
- 使用 `dragDepthRef` 或等价的 relatedTarget 判断，避免跨子节点移动时 dragging 状态闪烁。
- Drop/真正离开后清除 dragging 状态。
- 不解析目录和 `DataTransferItem.webkitGetAsEntry()`。

### D8：Composer 与附件布局

组件结构：

```text
AttachmentComposerDemo
└── Dropzone / Shell
    ├── AttachmentGroup（为空时不渲染）
    │   └── Attachment Item × N
    ├── textarea
    └── action row
        ├── hidden multiple file input
        ├── + button
        └── optional disabled/no-op send visual
```

布局使用现有 `AttachmentGroup` 的横向滚动能力，并额外保证：

- `w-full min-w-0`，防止 flex 子项撑开父容器；
- Item `shrink-0`；
- Item 设置合理 `max-w`；
- 标题由 `AttachmentTitle` 截断；
- Remove 使用 `type="button"`、明确 `aria-label`，并阻止冒泡；
- + 使用 `type="button"`、`aria-label="Add attachment"`；
- 不渲染图片缩略图，避免本期引入 Object URL 生命周期；统一文件图标即可。

普通 textarea 使用受控或本地文本状态均可，但其文本不是本变更的输出契约。发送按钮可以省略；若为了外观保留，必须禁用或 no-op，不能调用 `/api/chat`。

### D9：测试策略不新增测试框架

项目没有通用测试框架，但已有 Node `assert`、`tsx` 和 `playwright-core` 的 e2e 模式。本变更不引入 Vitest/Jest/React Testing Library。

**纯函数测试：**

`e2e/thread-chat/attachment-composer-demo-model.test.mjs` 覆盖：

- 多 File 顺序归一化；
- 每次生成唯一 ID；
- append 不修改原数组；
- remove 只删除目标 ID；
- synthetic File MIME、文件名和内容；
- 空白文本返回 null；
- 同名文件不去重。

**浏览器验证：**

`e2e/thread-chat/verify-attachment-composer-demo.mjs` 复用现有 Playwright 启动方式，覆盖：

- `setInputFiles` 一次选择多个文件；
- 再次选择同一个文件；
- 构造 DataTransfer Drop 多文件；
- 构造 ClipboardEvent 验证 file 优先和 text → `.txt`；
- Remove；
- 普通打字；
- 10+ Item 时 `scrollWidth > clientWidth`；
- 捕获请求并断言不存在 `/api/attachments`、ingest、对象存储 PUT 和 `/api/chat`。

若目标 Chromium 不允许通过构造器注入 `clipboardData`，该用例改为页面内调用同一事件归一化函数，不因此引入新的测试依赖；同时保留浏览器手工 Paste 清单。

### D10：无迁移、可直接回滚

本变更只新增 Demo 文件、测试和可选的 package script：

- 无数据库迁移；
- 无 API 兼容问题；
- 无现有消息数据变化；
- 回滚时删除 Demo route、组件、model 和测试即可。

## File Plan

```text
app/thread-chat/attachment-composer-demo/page.tsx
app/thread-chat/chat/composer/attachment-composer-demo.tsx
app/thread-chat/chat/composer/attachment-composer-demo-model.ts
e2e/thread-chat/attachment-composer-demo-model.test.mjs
e2e/thread-chat/verify-attachment-composer-demo.mjs
package.json                                      # 仅添加可重复运行命令时
```

职责：

| 文件 | 职责 |
|---|---|
| `page.tsx` | 本地 state、`onChange`、console.log、页面说明 |
| `attachment-composer-demo.tsx` | UI、Picker/Drop/Paste/Remove 事件与受控契约 |
| `attachment-composer-demo-model.ts` | 类型与纯归一化函数，不含 React、DOM 请求和网络 |
| model test | 数据不变量与 pure function 行为 |
| browser verify | 可见交互、布局与零业务请求 |

## Risks / Trade-offs

- **Clipboard 浏览器差异**：系统粘贴能力由浏览器暴露的 `ClipboardItem` 决定；无法读取的本地文件不是 Demo 缺陷。通过 file 优先规则、Chromium 自动验证和手工截图/文本 Paste 验收发现问题。
- **assistant-ui 复用程度有限**：为了保持 `DemoAttachment[]` 单一事实源，本期复用其视觉语言和项目纯 Attachment UI，而不是 Runtime Primitive。代价是后续接正式 Runtime 时需要新 Bridge；收益是当前实现短、无隐藏上传和无双状态。
- **受控父组件未同步**：若业务方的 `onChange` 不更新 `attachments`，UI不会变化，这是标准受控组件语义，Demo 页面会正确同步。
- **大文件内存**：组件只持有浏览器 File 引用，不读取文件内容；只有 pasted text 创建内存 Blob。本期不限制大小，真实业务必须在后续 Spec 中增加策略。
- **公开可发现性**：Demo 不加入产品导航；路由位于登录后的 ThreadChat 区域，仅用于评审和开发交接。

## Open Questions

（无。UI 细节允许实现阶段在不改变受控契约、输入规则和验收标准的前提下就近决定。）
