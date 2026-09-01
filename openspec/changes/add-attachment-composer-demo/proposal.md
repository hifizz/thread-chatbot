# Attachment Composer 纯前端演示

## Why

Issue #68 的完整 Research 已确认：ThreadChat 长期需要统一处理附件、引用、命令和运行配置，但当前产品阶段不适合一次性建设结构化 Composer。用户已将本轮范围明确收缩为一个可以快速验收和交接的纯前端附件演示，完整边界见：

- [`docs/composer/01-composer-interaction-system-research.md`](../../../docs/composer/01-composer-interaction-system-research.md)
- [`docs/composer/02-attachment-composer-demo-mvp.md`](../../../docs/composer/02-attachment-composer-demo-mvp.md)

当前 `ConversationComposer` 仍是普通 textarea，只接受文本；仓库已有 assistant-ui 的附件展示和加号入口，但其正式附件链路会通过 `r2AttachmentAdapter` 调用 `/api/attachments`、对象存储和 ingest。直接复用这条业务链路会违背“只做 Demo、零上传、由业务后续接管”的目标。

本变更需要把已冻结的 Research 结论转换成可实施的组件契约和验收标准：先验证文件选择、拖拽、粘贴、顶部回显、横向滚动、删除和 `onChange`，不触碰正式消息发送、数据库或后端附件协议。

## What Changes

- 新增一个独立的 Attachment Composer Demo 页面，不改正式 ThreadChat Composer 和发送链路。
- 新增受控组件 `AttachmentComposerDemo`：父组件持有 `DemoAttachment[]`，所有增删变化统一通过 `onChange(nextAttachments)` 发出。
- 冻结 Demo 数据模型：
  - `DemoAttachmentSource = "picker" | "drop" | "paste"`
  - `DemoAttachment = { id, file, source }`
- 支持四类输入：
  - 左下角 `+` 打开隐藏的多选文件输入；
  - 一次拖入多个文件；
  - 粘贴剪贴板文件或图片；
  - 没有文件项时，将非空 `text/plain` 包装为 synthetic `.txt` File。
- 每个附件在 Composer 顶部显示为独立 Item，可单独移除；附件过多时保持单行并横向滚动。
- Demo 页面在 `onChange` 中更新本地状态并执行 `console.log("attachments changed", nextAttachments)`。
- 复用仓库现有 assistant-ui 的视觉组件、按钮和样式语言；不接入正式 Assistant Runtime 附件状态，也不调用 `r2AttachmentAdapter`。
- 增加最小的纯函数测试、浏览器验收脚本或等价验证，并运行 TypeScript、Lint、Build 和 OpenSpec 校验。

本变更明确不包括：真实上传、R2/S3、ingest、文件解析、发送消息、持久化、`@Artifact`、Quote、Slash/Skill、Lexical/Tiptap、拖拽排序、去重和完整移动端优化。

## Capabilities

### New Capabilities

- `attachment-composer-demo`：一个受控、纯前端的附件输入演示能力，覆盖 multi-select 文件选择、拖拽、粘贴、synthetic 文本附件、独立附件 Item、横向滚动、删除和 `onChange`。

### Modified Capabilities

（无。正式 ThreadChat Composer、附件上传和消息协议保持不变。）

## Impact

预计新增或修改以下文件：

- `app/thread-chat/attachment-composer-demo/page.tsx`：独立 Demo 页面，本地持有附件状态并打印 `onChange`。
- `app/thread-chat/chat/composer/attachment-composer-demo.tsx`：可复用受控组件。
- `app/thread-chat/chat/composer/attachment-composer-demo-model.ts`：Demo 类型与文件归一化、文本转 File、追加和删除等纯函数。
- `e2e/thread-chat/attachment-composer-demo-model.test.mjs`：纯函数与不变量测试。
- `e2e/thread-chat/verify-attachment-composer-demo.mjs`：浏览器行为验收；若现有环境无法可靠构造系统级 Clipboard/File Picker，则保留等价的 DOM 事件测试并补充手工清单。
- `package.json`：仅在需要可重复运行命令时增加 Demo 验证脚本；不新增运行时依赖。

明确不修改：

- `app/thread-chat/chat/composer/conversation-composer.tsx`
- `lib/chat/attachment-adapter.ts`
- `/api/attachments/**`
- `/api/chat`
- 数据库 Schema 与迁移
- Message Parts、Context Compiler 和 Project File 逻辑
