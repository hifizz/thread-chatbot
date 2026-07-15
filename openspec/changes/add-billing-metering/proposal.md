# 计费（token 按量计费）

## Why

对话调用的模型（MiniMax 直连、以及经由网关可达的 DeepSeek/OpenAI 等）都是按 token 向供应商付费的真实成本，应用层如果没有计费闭环，就是在用自己的钱无限供大家白嫖——必须有「余额从哪来、每次调用扣多少、扣得对不对」这一整条链路。同时，浮点记账在货币场景下天然不安全（累加误差、四舍五入分歧），且供应商真实成本往往要过一段时间才能通过网关拉取到，不能让用户体验等这个延迟。本变更把这条链路（定价常量→余额与流水表→即时估算扣费→断连兜底→真实成本对账→用量可视化）补齐并落盘为设计记录。

## What Changes

- 新增「微元」整数记账单位与统一定价口径 `constants/pricing.ts`：`PROFIT_MARGIN=0.3` 的加价公式（售价 = ceil(成本 / (1 - 0.3))，向上取整保证利润率 ≥30%）、`MICROS_PER_YUAN`、`INITIAL_CREDIT_MICROS`（¥5 初始额度）、`USD_TO_CNY` 汇率（环境变量可覆盖）、`MODEL_COST` 各模型原生币种成本表，以及 `toMicros`/`usdToMicros`/`costMicros`/`priceFromCost`/`priceMicros`/`sellPricePerMillionYuan`/`microsToYuan`/`formatYuan` 一组换算函数。
- 新增 Postgres 表 `user_credits`（用户余额）与 `usage_records`（逐次调用用量与费用流水，含成本口径 `estimate`/`gateway` 标记与可选的网关 `generation_id`），定义在 `lib/db/billing-schema.ts`（`thread_chat` schema 下）。
- 新增计费核心逻辑 `lib/billing/credits.ts`：`ensureUserCredits`（幂等赠初始额度）、`getBalanceMicros`/`hasPositiveBalance`、`chargeUsage`（事务内原子扣费+写流水）、`addCreditsMicros`（供充值到账调用）、`reconcilePendingCosts`（按网关真实成本对账修正估算差额，幂等）。
- `app/api/chat/route.ts` 集成计费：发送前 `hasPositiveBalance` 拦截（余额不足返回 402）；`streamText` 设 `maxOutputTokens` 封顶单请求成本敞口；`onFinish` 按价目表估算即时扣费并写流水；`after(consumeStream)` 保证客户端断连时后端仍把流消费完，onFinish（计费）必然触发；`toUIMessageStreamResponse({ messageMetadata })` 把本次用量与费用附到 assistant 消息 metadata，随消息持久化。
- 新增账户汇总 API `app/api/billing/summary/route.ts`（余额 + 按 threadId 可选的用量/费用聚合 + 最近一次调用）与对账定时任务 `app/api/billing/reconcile/route.ts`（`CRON_SECRET` 鉴权），`vercel.json` 配置每 15 分钟触发一次 cron。
- 范围明确**不含**：初始额度的**发放时机**（在哪个注册/登录环节调用 `ensureUserCredits`）——那是「登录注册」模块的职责，本变更只约束金额与幂等性；模型/网关的可用性判定与 provider 解析——那是「模型&gateway」模块的职责，本变更只消费其产出的 `providerMetadata.gateway.generationId`；实际收款、支付渠道 webhook、充值到账（`recordCreemTopup`）——那是「收款&支付」模块的职责，本变更只提供其到账时要调用的 `addCreditsMicros` 原子接口。

## Capabilities

### New Capabilities

- `billing-metering`：token 按量计费的完整闭环——微元记账与加价公式、初始额度发放的幂等约束、发送前余额拦截与流式结束后的即时估算扣费、断连兜底计费、单请求输出封顶、基于网关真实成本的定期对账、消息级用量元数据与账户汇总查询。

### Modified Capabilities

（无——`openspec/specs/` 目前为空，本仓库尚无既有 spec；本变更不修改任何既有能力的需求级行为。）

## Impact

- **常量**：新增 `constants/pricing.ts`（金额单位、加价公式、模型成本表、换算函数）。
- **DB**：新增 `lib/db/billing-schema.ts`（`user_credits`、`usage_records` 两表）+ 对应 drizzle 迁移。
- **计费逻辑**：新增 `lib/billing/credits.ts`（额度/扣费/对账）、`lib/billing/usage-meta.ts`（消息级用量元数据构造）。
- **API**：`app/api/chat/route.ts` 接入计费拦截/扣费/断连兜底/用量元数据；新增 `app/api/billing/summary/route.ts`、`app/api/billing/reconcile/route.ts`。
- **部署**：`vercel.json` 新增 cron 配置（`*/15 * * * *` 触发对账）；`CRON_SECRET` 环境变量为对账端点的必需前置。
- **不改**：`recordCreemTopup`（收款到账）虽同处 `lib/billing/credits.ts` 一个文件，但属于「收款&支付」模块的落地位置，本 change 只在边界处提及、不展开其设计；模型注册表与 provider 解析（`constants/model.ts`、`lib/ai/provider.ts`）不属于本变更范围。
