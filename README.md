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
import { Button } from "@/components/ui/button"
```

## 用户系统与按 token 计费

基于 [better-auth](https://better-auth.com) 的邮箱注册/登录，配合 Cloudflare AI 网关接入多家大模型，并按 token 用量对用户计费（利润率 ≥ 30%）。

### 配置步骤

1. 复制 `.env.example` 为 `.env.local`，至少填写：
   - `DATABASE_URL`
   - `BETTER_AUTH_SECRET`（`openssl rand -base64 32`）、`BETTER_AUTH_URL`（本地 `http://localhost:3000`）
   - 任一可用模型的凭据（`MINIMAX_API_KEY` 直连，或 `DEEPSEEK_API_KEY`/`OPENAI_API_KEY` 经网关）。
2. `pnpm db:migrate`（在独立 schema `thread_chat` 下建全部表）。
3. `pnpm dev`，访问首页 `/` 是公开落地页；点击「开始聊天」进入旗舰 `/thread-chat` 时，若未登录才会被重定向到 `/sign-in`（登录后回到旗舰）。

### ThreadChat Markdown 交付物

`/thread-chat` 是独立的树形分支对话界面。用户用中文、英文或等价表达要求“生成、输出、整理成 Markdown/.md 文档”时，服务端会调用 `createMarkdownArtifact`；完成后的 Markdown 卡片直接插入产生它的 assistant 消息，点击后在右侧 Markdown 面板通过现有 GFM renderer 预览。仅询问“Markdown 是什么/语法怎么用”不会创建交付物。

Markdown 与消息关联、来源 thread 和 tab 顺序均保存在 `branch_trees.state` 的整树 JSON 中，不需要额外数据库迁移；刷新恢复、重试替换、Canvas 节点内打开和后续“修改刚才的 Markdown”均复用同一份 Artifact 数据。

生成长文时，客户端从 AI SDK 的 `tool-input-start` 起就在最终位置显示不可点击的 Markdown 进度卡，并在 `tool-input-delta` 阶段展示局部标题、真实字符数/行数和最近章节；完整输入到达后原子替换为可点击卡片。该进度是当前页面临时态，不写入整树 JSON。Markdown 工具完成即结束本轮模型 loop，不再追加重复的“已生成/文档包含”说明。

### 数据库 / Supabase（独立 schema + 连接池）

本项目所有表都建在独立 Postgres schema **`thread_chat`**（`lib/db/pg-schema.ts` 的 `dbSchema`）下，与同一个数据库里其他 project 的表隔离——适合多项目共用一个 Supabase 库。查询全程 schema 限定，无需依赖 `search_path`。

- **连接串**：`DATABASE_URL` 用 Supabase「事务连接池」(6543)，代码已设 `prepare:false`（事务池不支持预处理语句）；`DIRECT_URL` 用「直连」(5432) 供 `pnpm db:migrate` 跑 DDL。
- **pgvector（可选 RAG）**：在 Supabase 后台启用 `vector` 扩展（通常装在 `extensions` schema）。迁移会 `CREATE EXTENSION IF NOT EXISTS vector` 兜底；连接的 `search_path` 已含 `extensions` 以便向量类型/运算符解析。
- **改 schema 名**：改 `lib/db/pg-schema.ts` 的 `DB_SCHEMA`，删掉 `drizzle/` 迁移与 `meta/` 后 `pnpm db:generate` 重建即可。
- 迁移的 `0000` 已手动补上 `CREATE SCHEMA IF NOT EXISTS "thread_chat"` 与 `CREATE EXTENSION`（drizzle-kit 不总会生成）。

### 邮箱验证 / 找回密码 / 防白嫖

免费初始额度 + 无门槛注册 = 容易被批量注册薅走。为此接了 **Resend**（邮件）+ **Cloudflare Turnstile**（人机验证），三道闸都**按环境变量门控，未配置则自动降级**：

- **邮箱验证（Resend）**：配了 `RESEND_API_KEY` 后，注册**必须验证邮箱**才能登录；验证/找回密码邮件由 Resend 发送（`lib/email/*`）。未配置则降级为「注册即用」（开发友好）。
- **初始额度改到「验证后」发放**：关键防薅——`emailVerification.afterEmailVerification` 里才 `ensureUserCredits`（默认 ¥5）。未验证的账号拿不到额度，逼真实邮箱。（未启用邮件时退回「注册即赠」。）
- **人机验证（Turnstile）**：配了 `TURNSTILE_SECRET_KEY` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` 后，注册/登录接口要求通过 Turnstile（token 走 `x-captcha-response` 头）。
- **找回密码**：`/forgot-password` 发重置邮件 → `/reset-password?token=...` 设新密码。

上线建议三者都开。本地开发可都不配，流程仍可跑通（注册即用、无验证码）。

### Google 登录（可选）

同时配齐 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` 即启用（登录/注册页自动出现「使用 Google 登录」，无需额外开关）。Google Cloud Console 的 OAuth 客户端需把重定向 URI 设为 `{站点}/api/auth/callback/google`——其中域名由 `BETTER_AUTH_URL` 决定，务必与 Google 后台一致。因 Google 邮箱默认已验证，社交登录用户在**创建时即发放初始额度**（不走邮箱验证钩子；`ensureUserCredits` 幂等，与邮箱验证路径不重复发放）。

### 大模型与 Cloudflare AI 网关

- 模型注册表在 `constants/model.ts`（id、供应商、上游模型名、网关标识、定价 key 的单一事实来源）。输入框的模型选择器与计费单价都由它派生。
- 配置 `CF_AI_GATEWAY_ACCOUNT_ID` + `CF_AI_GATEWAY_ID` 后，DeepSeek / OpenAI 走 CF AI 网关的 OpenAI 兼容 `compat` 端点（`https://gateway.ai.cloudflare.com/v1/{账号}/{网关}/compat`，模型标识 `provider/model`）；网关开启鉴权时再配 `CF_AI_GATEWAY_TOKEN`。未配置网关则回退各供应商直连（可用 `DEEPSEEK_BASE_URL`/`OPENAI_BASE_URL` 覆盖地址）。
- **MiniMax 不在 CF 网关支持列表**，故始终直连；其余供应商优先经网关，便于在网关侧统一观测/缓存/限流。

### 计费口径

- 金额统一用「微元」整数存储（1 元 = 1_000_000 微元），避免浮点误差。
- 售价 = 供应商成本 ÷ (1 − 利润率)，`PROFIT_MARGIN=0.3` 时利润率恰为 30%，微元向上取整保证不低于目标。
- 成本价按模型**原生币种**填在 `constants/pricing.ts` 的 `MODEL_COST`（MiniMax 用 CNY，DeepSeek/OpenAI 用 USD），美元价由 `USD_TO_CNY` 汇率折算——不用再手动近似（**仍是业务数字，请按供应商计费页核对；汇率建议留缓冲**）。
- 每轮对话结束（`app/api/chat/route.ts` 的 `onFinish`）按 token 即时扣费并写 `usage_records`（`cost_source='estimate'`）；本次用量/费用同时附到 assistant 消息 metadata。余额不足在发起前拦截（HTTP 402）。
- 输入框右下角实时显示「本次 token / 累计 token / 余额」，数据来自 `/api/billing/summary`。

**健壮性（并发 / 幂等 / 断连）**：

- 所有「余额变动 + 流水」用数据库事务包成原子（`chargeUsage` / 充值到账 / 退款 / 对账修正），不会扣了钱没记账或反之。
- `after(result.consumeStream())`：即使客户端中途断连，服务端也会消费完整条流、触发 `onFinish` 计费，避免「已产生供应商成本却漏计费」。
- `MAX_OUTPUT_TOKENS` 封顶单请求输出，收敛「后付费并发竞态」下的最大超支敞口，并防异常长输出打爆供应商账单。
- 余额采用**后付费**：发起前 `balance > 0` 拦截、允许最后一条扣至小额负数；高并发下的超支被单请求成本上限约束（非分布式锁，Serverless 友好）。

### 真实成本对账（Vercel AI 网关，可选，两段式计费）

痛点：手填价目表会过时、跟不上供应商调价。解决：配置 **Vercel AI 网关**（`AI_GATEWAY_API_KEY`）后，非 MiniMax 模型经其转发，响应带 `providerMetadata.gateway.generationId`。

- **即时段**：`onFinish` 先用价目表估算扣费（保证响应，不阻塞），并把 `generationId` 记入 `usage_records`。
- **对账段**：`/api/billing/reconcile`（`CRON_SECRET` 鉴权，`vercel.json` 已配 15 分钟一次的 Cron）用 `generationId` 调网关 `getGenerationInfo` 取**真实成本(USD)** → 按 `USD_TO_CNY` 折微元 → 按 ≥30% 利润重算售价 → **按差额修正用户余额**，并把该行标记为 `cost_source='gateway'`。
- **幂等**：只处理 `estimate` 行，处理后翻成 `gateway`，重复触发不会重复扣。
- 未配 Vercel 网关时，此机制休眠，计费仍走币种精确的价目表。路由优先级：Vercel 网关 → Cloudflare 网关 → 供应商直连。

### Creem 支付（充值 / 订阅）与账户页

充值走 [Creem](https://creem.io)（Merchant of Record，托管支付页 + webhook）。用户在 `/account` 页选择充值包，支付成功后由 webhook 幂等到账。

配置步骤：

1. 在 Creem 后台为每个充值包创建「一次性产品」，把产品 id 填到 `.env.local` 的 `CREEM_PRODUCT_TOPUP_20/50/100`（价格需与 `constants/creem.ts` 里各包的展示价一致；到账额度 `creditMicros` 也在该文件配置）。
2. 填 `CREEM_API_KEY`（测试期把 `CREEM_API_URL` 指向 `https://test-api.creem.io/v1`）。
3. 在 Creem 后台 Developers → Webhook 配置回调地址 `https://你的域名/api/webhooks/creem`，把签名密钥填到 `CREEM_WEBHOOK_SECRET`。
4. `pnpm db:migrate`（新增 `payments`、`subscriptions` 表）。

流程与要点：

- **发起充值**：`/account` 点充值包 → `POST /api/billing/checkout` 创建 Creem checkout（metadata 透传 `userId`/`packId`）→ 前端跳转 Creem 托管支付页。
- **到账**：`POST /api/webhooks/creem` 先用 `creem-signature`（HMAC-SHA256 原始请求体）校验签名，再处理 `checkout.completed` → 按 `(provider, order_id)` **幂等**增加 `user_credits.balance_micros` 并写 `payments` 流水；`refund.created` 扣回额度；`subscription.*` 同步订阅状态到 `subscriptions`。
- **账户页 `/account`**：余额、累计充值/消耗、充值包购买、订阅状态、充值记录与按 token 计费的消耗记录。侧栏底部账户区点击进入。
- 说明：本项目直接对接 Creem REST（对 `user_credits` 微元额度体系控制更直接）；如需订阅态用户会话，也可改用 better-auth 的 Creem 插件。

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
