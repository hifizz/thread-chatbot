# 任务拆解：收款与支付（Creem 充值/订阅 + 网关成本查询）（已实现，回填记录）

## 1. 常量与数据层

- [x] 1.1 `constants/creem.ts`：`TopupPack` 类型 + `TOPUP_PACKS`（`topup-20`/`topup-50`/`topup-100`，产品 id 走环境变量、`creditMicros` 与 `priceLabel` 解耦）、`getTopupPack`/`topupProductId`/`isTopupPackAvailable`、订阅套餐名映射 `subscriptionPlanName`
- [x] 1.2 `lib/db/payment-schema.ts`：`payments` 表（`(provider, order_id)` 唯一索引）、`subscriptions` 表（`subscription_id` 唯一），经 `lib/db/schema.ts` re-export；对应 drizzle 迁移已生成并应用

## 2. Creem 客户端

- [x] 2.1 `lib/payments/creem.ts`：`isCreemConfigured()`、`createCheckout(input)`（`POST {API_URL}/checkouts`，头 `x-api-key`，透传 `metadata`，失败抛错）
- [x] 2.2 `verifyWebhookSignature(rawBody, signature)`：HMAC-SHA256(原始请求体, `CREEM_WEBHOOK_SECRET`) 十六进制，`timingSafeEqual` 比较，长度不等或未配置 secret 判失败
- [x] 2.3 `parseWebhookEvent` 及防御式读取器 `readMetadata`/`readOrderId`/`readProductId`/`readCheckoutId`/`readSubscription`（应对不同事件字段层级差异）

## 3. 到账逻辑

- [x] 3.1 `lib/billing/credits.ts` 新增 `recordCreemTopup(input)`：事务内 `insert payments ... onConflictDoNothing({target:[provider, orderId]})`，未插入则 `granted:false` 跳过，插入成功则原子累加 `user_credits.balance_micros`、`granted:true`——`(provider, orderId)` 幂等只到账一次

## 4. API 路由

- [x] 4.1 `app/api/billing/checkout/route.ts`：POST，`getCurrentUserId` 校验（未登录 401）、`isCreemConfigured` 校验、`getTopupPack(packId)` 校验、`topupProductId(pack)` 缺失校验，`createCheckout({product_id, success_url: /account?topup=success, metadata:{userId, packId}})`，返回 `{ url }`
- [x] 4.2 `app/api/webhooks/creem/route.ts`：读原始请求体 `req.text()` → `verifyWebhookSignature`（`creem-signature` 头，失败 401）→ `JSON.parse`（非法 400）→ `parseWebhookEvent`（无法识别事件类型返回 200 忽略）
- [x] 4.3 `checkout.completed` 分支：读 metadata 的 `userId`/`packId`、`readOrderId`/`readCheckoutId`/`readProductId`，调用 `recordCreemTopup` 到账；`pack`/`orderId` 缺失时跳过不报错
- [x] 4.4 `subscription.active|paid|trialing|update|past_due|scheduled_cancel|paused|canceled|expired` 分支：`readSubscription` 取 id/status/currentPeriodEnd，`insert subscriptions ... onConflictDoUpdate({target: subscriptionId, set: {status, currentPeriodEnd, updatedAt, raw}})`
- [x] 4.5 `refund.created` 分支：事务内把匹配 `orderId` 且当前 `status='paid'` 的 payment 置为 `refunded`（幂等：非 paid 状态不会重复命中），命中则从对应用户余额扣回 `creditMicros`
- [x] 4.6 未识别事件类型（`default` 分支）与解析不出 `eventType` 的载荷均返回 200；已识别事件处理中抛异常返回 500（允许 Creem 按其策略重试）

## 5. 账户页 UI

- [x] 5.1 `app/account/page.tsx`：充值/订阅信息展示区（余额、订阅状态标签映射 `SUB_STATUS`、支付状态标签映射 `PAYMENT_STATUS`），`isCreemConfigured()` 未配置时的降级提示
- [x] 5.2 `components/account/topup-packs.tsx`：充值包卡片列表，点击 `POST /api/billing/checkout` 拿到 `url` 后 `window.location.href` 跳转 Creem 收银台；未配置产品的包禁用
- [x] 5.3 `components/account/topup-result-toast.tsx`：支付回跳 `/account?topup=success` 后一次性 toast 提示并 `router.replace` 清理 URL 参数

## 6. 网关成本查询能力

- [x] 6.1 `lib/payments/vercel-gateway.ts`：`isVercelGatewayConfigured()`（`AI_GATEWAY_API_KEY`）、`getGenerationCostUsd(generationId)`（`gateway.getGenerationInfo({id}).totalCost`，异常/未就绪返回 `null`）、`AI_GATEWAY_BASE_URL` 可覆盖网关地址
- [x] 6.2 与「计费」模块（`add-billing-metering`）的边界确认：本模块只导出查询原语，`reconcilePendingCosts` 等消费方逻辑不在本模块范围

## 7. 验收（已在实现落地时完成）

- [x] 7.1 `pnpm typecheck` 0 错误；`pnpm lint` 0 报错
- [x] 7.2 signature 冒烟：合法签名 200 通过、错误签名 401、缺签名头 401、非 JSON body 400
- [x] 7.3 幂等冒烟：同一 `(provider, orderId)` 的 `checkout.completed` webhook 投递两次，`user_credits.balance_micros` 只增加一次
- [x] 7.4 订阅镜像冒烟：同一 `subscriptionId` 连续投递 `subscription.trialing` → `subscription.active` → `subscription.canceled`，`subscriptions` 表最终只有一行且 `status` 为最后一次投递的值
- [x] 7.5 退款冒烟：对已 `paid` 的订单投递 `refund.created`，`payments.status` 变为 `refunded` 且用户余额扣回对应 `creditMicros`；重复投递不二次扣回
- [x] 7.6 未知事件冒烟：投递一个未处理的 `eventType`，响应 200，不写任何表
- [x] 7.7 充值包不可购买路径：清空某档位对应环境变量后请求 `/api/billing/checkout`，返回 400 且账户页对应卡片渲染为不可点击的「未配置」
- [x] 7.8 网关成本查询冒烟：`AI_GATEWAY_API_KEY` 未配置时 `isVercelGatewayConfigured()` 为 false；已配置但 `generationId` 未就绪时 `getGenerationCostUsd` 返回 `null` 而非抛错

## 8. 文档与收尾

- [x] 8.1 本 OpenSpec change（proposal/design/tasks/spec）补记为设计留痕
- [x] 8.2 `pnpm openspec:validate` 通过；prettier 格式化本次改动文件（提交前统一跑）
