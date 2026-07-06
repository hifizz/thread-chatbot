# Next.js template

This is a Next.js template with shadcn/ui.

## Adding components

To add components to your app, run the following command:

```bash
npx shadcn@latest add button
```

This will place the ui components in the `components` directory.

## Using components

To use the components in your app, import them as follows:

```tsx
import { Button } from "@/components/ui/button";
```

## 附件上传与 ChatPDF

通用附件模块（Cloudflare R2）+ PDF 对话能力。调研与设计文档见 `docs/chatpdf/`：

- [01-调研报告.md](./docs/chatpdf/01-调研报告.md) — 社区实现盘点、技术路线分析与选型依据
- [02-设计方案.md](./docs/chatpdf/02-设计方案.md) — 架构、数据模型、API 约定与扩展点

### 配置步骤

1. 复制 `.env.example` 为 `.env.local`，填入 MiniMax、Postgres 与 R2 配置。
2. 在 Cloudflare 控制台创建 **私有** R2 桶（不开公开访问），生成 S3 API Token（Object Read & Write）。
3. 给桶配置 CORS（附件为浏览器 presigned PUT 直传，必须允许来源域）：

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:3000"],
       "AllowedMethods": ["PUT", "GET", "HEAD"],
       "AllowedHeaders": ["Content-Type"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

   注意：`AllowedHeaders` 必须显式包含 `Content-Type`（R2 上 `"*"` 对 PUT 预检不生效）。

4. 应用数据库迁移：`pnpm db:migrate`（新增 `attachments` 表）。
5. `pnpm dev`，在聊天输入框点加号（或拖拽）上传 PDF，即可针对文档内容提问。

### 工作原理

选中文件即直传 R2 并由服务端用 unpdf 按页提取文本入库；对话时服务端把 PDF 附件替换为带页码标记的正文注入模型（MiniMax 不支持文件输入）。图片/ZIP/视频可上传存储，但当前模型侧仅以元信息占位。支持类型与大小上限见 `constants/attachment.ts` 的策略表。

二期在此基础上增加了三项能力：

- **自动摘要 + 建议问题**：PDF 就绪后自动生成摘要与 3 个建议问题，显示在输入框上方，点击即可连同文档发送（冷启动引导）。复用现有 MiniMax 模型，无需额外配置。
- **引用溯源**：回答中引用文档内容时会带上可点击的页码徽标，点击在新标签打开原 PDF 并跳到对应页（浏览器原生 PDF 查看器 `#page=N`）。
- **RAG 向量检索（可选）**：配置 `EMBEDDINGS_*` 后，超出上下文预算的超大 PDF 会改走向量检索——只把与问题最相关的片段喂给模型，而非全文截断。单文档且体量不大时仍走全文注入（依据调研结论：小文档不必 RAG）。未配置 embeddings 时自动降级为全文截断注入。

RAG 依赖 Postgres 的 pgvector 扩展（迁移会自动 `CREATE EXTENSION vector`，需数据库允许创建扩展）。检索路线的设计取舍见 `docs/chatpdf/02-设计方案.md`。

## 深度研究（Deep Research）

输入框左下角的「深度研究」开关：开启后，模型会**联网多步检索、按需深读网页**，最终产出一份基于真实来源、带内联引用的结构化报告；检索了什么、读了哪些来源，**过程对用户可见**（渲染为检索卡片与来源链接）。

- 配置 `SEARCH_API_KEY`（默认 [Tavily](https://tavily.com)，`SEARCH_BASE_URL` 可换兼容服务）即可启用；未配置时开关会提示不可用，普通对话不受影响。
- 编排走 AI SDK v7 多步工具循环（`streamText` + `webSearch`/`readUrl` 工具 + `stopWhen` 步数上限），与现有 chat 链路同源。
- 设计与调研结论见 `docs/deep-research/设计说明.md`。
