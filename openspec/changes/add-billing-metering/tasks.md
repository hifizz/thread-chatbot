# 任务拆解：计费（token 按量计费）（已实现，回填记录）

## 1. 定价常量层

- [x] 1.1 `constants/pricing.ts`：微元记账单位（`MICROS_PER_YUAN=1_000_000`）、`PROFIT_MARGIN=0.3`、`INITIAL_CREDIT_MICROS`（¥5）、`USD_TO_CNY`（默认 7.3，`process.env.USD_TO_CNY` 可覆盖，注释说明"宁高勿低"留缓冲）
- [x] 1.2 `MODEL_COST` 各模型原生币种成本表（`minimax-m2` CNY、`deepseek-chat`/`gpt-4o-mini` USD，输入/输出分别按每 100 万 token 填写）
- [x] 1.3 换算函数：`toMicros`、`usdToMicros`、`costMicros`（找不到定价返回 0）、`priceFromCost`（向上取整保利润率）、`priceMicros`、`sellPricePerMillionYuan`（选择器展示售价用）、`microsToYuan`、`formatYuan`

## 2. DB schema

- [x] 2.1 `lib/db/billing-schema.ts`：`user_credits` 表（`user_id` 主键引用 `user.id` cascade、`balance_micros bigint default 0`、`updated_at`）
- [x] 2.2 `usage_records` 表（`user_id`、`thread_id` 不加外键、`message_id`、`model`、`input_tokens`/`output_tokens`、`cost_micros`/`price_micros`、`generation_id` 可空、`cost_source` 枚举 `estimate`/`gateway` 默认 `estimate`、`created_at`），索引覆盖 `user_id`/`thread_id`/`cost_source`
- [x] 2.3 生成并应用 drizzle 迁移（`pnpm db:generate` / `pnpm db:migrate`），确认两表已建于 `thread_chat` schema

## 3. 计费核心逻辑（`lib/billing/credits.ts`）

- [x] 3.1 `ensureUserCredits`：`insert ... onConflictDoNothing`，首建时赠 `INITIAL_CREDIT_MICROS`，幂等
- [x] 3.2 `getBalanceMicros` / `hasPositiveBalance`（余额 >0 才允许发起新对话）
- [x] 3.3 `chargeUsage`：算 cost/price → `ensureUserCredits` → 同一事务内原子扣减 `balance_micros` + 插入 `usage_records`（`cost_source='estimate'`），允许扣至负数覆盖最后一条消息成本
- [x] 3.4 `addCreditsMicros`：原子累加余额，供「收款&支付」模块充值到账时调用
- [x] 3.5 `reconcilePendingCosts`：扫描 `cost_source='estimate'` 且 `generation_id` 非空的行 → 拉网关真实 USD 成本（未就绪返回 null 跳过） → 重算 cost/price → 同一事务内修正该行（翻 `cost_source='gateway'`）+ 按 delta 调整余额

## 4. chat route 集成（`app/api/chat/route.ts`）

- [x] 4.0 provider 开启流式用量回传：`lib/ai/minimax.ts` 与 `lib/ai/provider.ts` 的 `createOpenAICompatible` 均设 `includeUsage: true`（OpenAI 兼容端点默认不回 usage，不开会导致按 0 token 计费）——已 wire 层 + SDK 层实测：修复前 `usage=null`、修复后 in=43/out=60、利润率 30.00%
- [x] 4.1 发送前 `hasPositiveBalance` 拦截，余额不足返回 402「额度不足，请充值后再试」
- [x] 4.2 `streamText({ maxOutputTokens: MAX_OUTPUT_TOKENS /* 8192 */ })` 封顶单请求最大产出，收敛成本敞口
- [x] 4.3 `onFinish: async ({ usage, providerMetadata }) => chargeUsage(...)`，`generationId` 从 `providerMetadata.gateway.generationId` 取（经网关时才有）
- [x] 4.4 `after(async () => result.consumeStream())`：客户端断连时后端仍消费完整条流，保证 `onFinish`（计费）必然触发；消费过程出错时忽略（生成本身出错不计费）
- [x] 4.5 `toUIMessageStreamResponse({ messageMetadata })`：完成时把 `buildUsageMetadata(modelId, part.totalUsage)` 附到 assistant 消息 metadata

## 5. 用量元数据与查询 API

- [x] 5.1 `lib/billing/usage-meta.ts`：`buildUsageMetadata(model, usage)` 构造 model/input/output/total tokens + cost/price 微元
- [x] 5.2 `app/api/billing/summary/route.ts`：GET 返回登录用户 `balanceMicros`（顺带 `ensureUserCredits` 兼容 hook 上线前的老用户）+ 可选 `threadId` 过滤的 `usage_records` 聚合（token 总量、费用总量）+ 最近一次调用
- [x] 5.3 `app/api/billing/reconcile/route.ts`：`CRON_SECRET` 鉴权（`Authorization: Bearer` 或 `x-cron-secret` 头，未配置密钥直接拒绝），调用 `reconcilePendingCosts`；GET/POST 均可触发
- [x] 5.4 `vercel.json` 新增 cron 配置，每日 `0 3 * * *` 触发 `/api/billing/reconcile`（Hobby 套餐 cron 每天限一次，`*/15` 会致部署被拒；Pro 可改回更频繁）

## 6. 验收（已实现落地时完成，此处回填记录）

- [x] 6.1 `pnpm typecheck` 0 错误
- [x] 6.2 扣费流程验证：余额充足时发消息 → 流式结束后余额按估算价目扣减、`usage_records` 新增一行 `cost_source='estimate'`；余额耗尽后再发起 → 402 且不产生调用
- [x] 6.3 断连兜底验证：客户端在流式响应完成前主动中断请求，服务端仍完整计费（`usage_records` 正常写入，余额正常扣减）
- [x] 6.4 对账验证：手动触发 `/api/billing/reconcile`（带正确 `CRON_SECRET`），`estimate` 行按真实网关成本修正为 `gateway`、余额按 delta 调整；未携带/错误密钥请求返回 401
- [x] 6.5 用量可见性验证：assistant 消息 metadata 携带用量与费用；`GET /api/billing/summary` 返回值与 `usage_records` 聚合一致

## 7. 文档与边界

- [x] 7.1 `constants/pricing.ts`、`lib/db/billing-schema.ts`、`lib/billing/credits.ts` 内均带用途/口径注释，说明微元单位、加价公式、对账幂等约定
- [x] 7.2 与相邻模块边界在代码注释与本 change 的 proposal/design 中显式声明：初始额度发放时机属「登录注册」、`providerMetadata.gateway.generationId` 的产生属「模型&gateway」、`recordCreemTopup` 到账属「收款&支付」
