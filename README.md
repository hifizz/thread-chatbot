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

## 用户系统与按 token 计费

基于 [better-auth](https://better-auth.com) 的邮箱注册/登录，配合 Cloudflare AI 网关接入多家大模型，并按 token 用量对用户计费（利润率 ≥ 30%）。

### 配置步骤

1. 复制 `.env.example` 为 `.env.local`，至少填写：
   - `DATABASE_URL`
   - `BETTER_AUTH_SECRET`（`openssl rand -base64 32`）、`BETTER_AUTH_URL`（本地 `http://localhost:3000`）
   - 任一可用模型的凭据（`MINIMAX_API_KEY` 直连，或 `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` 经网关）。
2. `pnpm db:migrate`（新增 `user/session/account/verification` 与 `user_credits/usage_records` 表，并给 `threads` 加 `user_id`）。
3. `pnpm dev`，访问首页会被重定向到 `/sign-in`；注册后即赠送初始额度（默认 ¥5，见 `constants/pricing.ts`）。

### 大模型与 Cloudflare AI 网关

- 模型注册表在 `constants/model.ts`（id、供应商、上游模型名、网关标识、定价 key 的单一事实来源）。输入框的模型选择器与计费单价都由它派生。
- 配置 `CF_AI_GATEWAY_ACCOUNT_ID` + `CF_AI_GATEWAY_ID` 后，DeepSeek / OpenAI 走 CF AI 网关的 OpenAI 兼容 `compat` 端点（`https://gateway.ai.cloudflare.com/v1/{账号}/{网关}/compat`，模型标识 `provider/model`）；网关开启鉴权时再配 `CF_AI_GATEWAY_TOKEN`。未配置网关则回退各供应商直连（可用 `DEEPSEEK_BASE_URL`/`OPENAI_BASE_URL` 覆盖地址）。
- **MiniMax 不在 CF 网关支持列表**，故始终直连；其余供应商优先经网关，便于在网关侧统一观测/缓存/限流。

### 计费口径

- 金额统一用「微元」整数存储（1 元 = 1_000_000 微元），避免浮点误差。
- 售价 = 供应商成本 ÷ (1 − 利润率)，`PROFIT_MARGIN=0.3` 时利润率恰为 30%，微元向上取整保证不低于目标。各模型成本价见 `constants/pricing.ts` 的 `MODEL_COST`（**业务数字，请按供应商实际计费页核对**；只要此处成本 ≥ 真实成本，加价即保证 ≥30% 利润）。
- 每轮对话结束后（`app/api/chat/route.ts` 的 `onFinish`）按 token 用量扣减余额并写入 `usage_records` 流水；本次用量与费用同时附到 assistant 消息 metadata。余额不足会在发起对话前拦截（HTTP 402）。
- 输入框右下角实时显示「本次 token / 累计 token / 余额」，数据来自 `/api/billing/summary`。

> 支付充值（Creem）为后续接入项：现阶段靠注册赠额跑通计费闭环，充值到位后把入账写进 `user_credits.balance_micros` 即可无缝衔接。

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
