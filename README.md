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

### 工作原理（一期）

选中文件即直传 R2 并由服务端用 unpdf 按页提取文本入库；对话时服务端把 PDF 附件替换为带页码标记的全文注入模型（MiniMax 不支持文件输入）。图片/ZIP/视频可上传存储，但当前模型侧仅以元信息占位。支持类型与大小上限见 `constants/attachment.ts` 的策略表。
