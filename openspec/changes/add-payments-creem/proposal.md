# 收款与支付：Creem 充值/订阅 + 网关成本查询

## Why

对话产品要活下去，光有「计费扣费」（把用量记成钱）不够，还得有钱能真的进账——用户需要一条从「点击充值」到「余额到账」的完整链路：选充值包、跳去付钱、Creem 异步回调、我方据此加余额。个人开发者独立运营，直接对接卡组织/银行的合规与税务成本远超收益，MoR（Merchant of Record，代收商）模式把这些甩给 Creem，换来「几乎零合规负担」起步。同时 webhook 是不可信输入（可伪造、可重放、可乱序到达），必须有签名校验与幂等到账兜底，否则一次重放就是一次白送额度。本变更把这条链路（充值包定义→创建 checkout→webhook 验签→到账/订阅镜像/退款→网关成本查询能力）落地并记录为设计文档。

## What Changes

- 新增充值包常量 `constants/creem.ts`：`TopupPack` 类型 + `TOPUP_PACKS`（`topup-20`/`topup-50`/`topup-100` 三档），Creem 产品 id 从环境变量读取（`CREEM_PRODUCT_TOPUP_20/50/100`，账号相关不硬编码），`topupProductId(pack)` 缺失返回 `undefined`（该包不可购买）；到账额度 `creditMicros` 与展示价 `priceLabel` 解耦，后者仅展示、真实收款价以 Creem 后台产品定价为准。附带订阅套餐名映射 `subscriptionPlanName`（按 `CREEM_SUBSCRIPTION_PRODUCTS` 环境变量声明，供账户页展示订阅名）。
- 新增 Creem 客户端 `lib/payments/creem.ts`：`isCreemConfigured()`；`createCheckout(input)`（`POST {CREEM_API_URL}/checkouts`，头 `x-api-key`，透传 `metadata`，失败抛错）；`verifyWebhookSignature(rawBody, signature)`（`creem-signature` 头 = HMAC-SHA256(原始请求体, `CREEM_WEBHOOK_SECRET`) 十六进制，`timingSafeEqual` 防时序攻击，未配置 secret 一律判失败）；`parseWebhookEvent` 及一组防御式读取器（`readMetadata`/`readOrderId`/`readProductId`/`readCheckoutId`/`readSubscription`）应对不同事件里字段层级不一致。
- 新增 Postgres 表（`lib/db/payment-schema.ts`，`thread_chat` schema）：`payments`（充值/订阅流水，`(provider, order_id)` 唯一索引作 webhook 幂等键）、`subscriptions`（订阅状态镜像，`subscription_id` 唯一）。
- 新增到账逻辑 `recordCreemTopup`（`lib/billing/credits.ts`，与计费模块共享同一文件，见下方「不含」）：事务内 `insert payments ... onConflictDoNothing({target:[provider, orderId]})`，未插入（订单已存在）则 `granted: false` 直接跳过，插入成功则原子累加余额、`granted: true`——保证 webhook 重复投递/重放只到账一次。
- 新增 API 路由：`app/api/billing/checkout/route.ts`（POST，登录校验、充值包与产品 id 校验、创建 checkout 返回 `checkout_url`）；`app/api/webhooks/creem/route.ts`（POST，读原始请求体验签→解析事件→分发 `checkout.completed`/`subscription.*`/`refund.created`/未知事件）。
- 新增账户页收款相关 UI：`app/account/page.tsx` 的充值/订阅展示区、`components/account/topup-packs.tsx`（充值包卡片，点击发起 checkout 并跳转）、`components/account/topup-result-toast.tsx`（支付回跳 `/account?topup=success` 后的一次性提示并清 URL）。
- 新增网关成本查询 `lib/payments/vercel-gateway.ts`：`isVercelGatewayConfigured()`（`AI_GATEWAY_API_KEY`）、`getGenerationCostUsd(generationId)`（`gateway.getGenerationInfo({id}).totalCost`，未就绪/出错返回 `null` 交上层重试），`AI_GATEWAY_BASE_URL` 可覆盖网关地址。这条能力放在本模块是因为它是「外部计费/资金接口」的查询层，与 Creem 客户端同属一类基础设施；但**消费**这条查询结果做真实成本对账、修正估算扣费差额的账务逻辑（`reconcilePendingCosts`）属于「计费」模块（`add-billing-metering`），本变更只提供查询能力，不展开对账账务设计。
- 范围明确**不含**：`lib/billing/credits.ts` 中与充值到账无关的部分（`ensureUserCredits`/`chargeUsage`/`addCreditsMicros`/`reconcilePendingCosts` 等按量计费与对账逻辑）——那是「计费」模块（`add-billing-metering`）的职责，本变更只新增/涵盖同文件内的 `recordCreemTopup`；`vercel-gateway.ts` 查询结果的账务消费方（对账修正、`usage_records.cost_source` 翻转）同理不展开；订阅生效后的**扣费/权益判定**（订阅用户是否仍走微元余额、还是走订阅额度）不在本变更——现阶段订阅仅做状态镜像展示，扣费仍统一走额度体系（`add-billing-metering` 范围）。

## Capabilities

### New Capabilities

- `payments-creem`：收款与支付的完整闭环——充值包到 Creem 产品的映射、创建 checkout、webhook 签名校验、充值到账幂等、订阅状态镜像、退款处理、未知事件的容错响应、网关真实成本查询能力。

### Modified Capabilities

（无——`openspec/specs/` 目前为空，本仓库尚无既有 spec；本变更不修改任何既有能力的需求级行为。）

## Impact

- **常量**：新增 `constants/creem.ts`（充值包、订阅套餐名映射）。
- **DB**：新增 `lib/db/payment-schema.ts`（`payments`、`subscriptions` 两表，`thread_chat` schema 下，经 `lib/db/schema.ts` re-export）+ 对应 drizzle 迁移。
- **支付客户端**：新增 `lib/payments/creem.ts`（checkout 创建、签名校验、事件解析）、`lib/payments/vercel-gateway.ts`（网关成本查询）。
- **到账逻辑**：`lib/billing/credits.ts` 新增 `recordCreemTopup`（与计费模块的其余函数共处一个文件，职责边界见「不含」）。
- **API**：新增 `app/api/billing/checkout/route.ts`、`app/api/webhooks/creem/route.ts`。
- **前端**：`app/account/page.tsx` 及 `components/account/topup-packs.tsx`、`components/account/topup-result-toast.tsx`。
- **不改**：`lib/billing/credits.ts` 中 `ensureUserCredits`/`chargeUsage`/`addCreditsMicros`/`reconcilePendingCosts`（`add-billing-metering` 范围）；`app/api/billing/summary/route.ts`、`app/api/billing/reconcile/route.ts`（同属计费模块，本变更不涉及）。
