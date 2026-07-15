# 设计：收款与支付（Creem 充值/订阅 + 网关成本查询）

## Context

- 「计费」模块（`add-billing-metering`）已经把「余额从哪来、每次调用扣多少」的闭环记下：`lib/billing/credits.ts` 里的 `ensureUserCredits`/`chargeUsage`/`addCreditsMicros`/`reconcilePendingCosts`，以及微元记账口径（`constants/pricing.ts`，1 元 = 1_000_000 微元）。那条链路解决了「扣钱」，没解决「收钱」——余额要靠真实支付充值进来，这正是本模块的范围。
- Creem 是 MoR（Merchant of Record）支付服务：由 Creem 作为法律意义上的卖方，代收货款、处理税务与合规、再结算给我方，我方只对接一个 REST API + webhook，不直接触碰卡组织/银行渠道。
- 仓库已有完整 Drizzle + Postgres 基建（`lib/db/index.ts`、`lib/db/schema.ts` re-export 各业务 schema 文件、`pnpm db:generate|migrate`），支付相关表放在独立文件 `lib/db/payment-schema.ts`，与计费表（`billing-schema.ts`）、认证表（`auth-schema.ts`）并列，统一挂在 `thread_chat` Postgres schema 下。
- webhook 是本模块唯一的「不可信输入面」：Creem 服务端主动 POST 到我方公网地址，理论上任何人都能伪造请求体打这个端点，且 Creem 自身的重试策略可能造成同一事件被投递多次——签名校验与幂等到账是本模块设计的核心矛盾，其余（充值包映射、订阅镜像、退款）都是在这个前提下的常规 CRUD。

## Goals / Non-Goals

**Goals:**

- 用户能从账户页选一个充值包、跳转 Creem 收银台完成支付、支付成功后额度自动到账，无需人工介入。
- webhook 端点拒绝一切签名不匹配的请求；重复投递/重放同一事件绝不会重复到账。
- 订阅状态（生效/试用/逾期/取消等）以 Creem 为准，通过 webhook 保持镜像同步，供账户页展示。
- 提供 Vercel AI 网关的真实生成成本查询能力，供「计费」模块的对账逻辑消费。

**Non-Goals:**

- 真实成本对账的账务逻辑（差额修正、`usage_records.cost_source` 翻转）——那是「计费」模块的职责，本模块只提供 `getGenerationCostUsd` 查询原语。
- 订阅生效后的权益判定/扣费路由（订阅是否替代按量扣费）——现阶段订阅仅做状态展示，扣费统一走额度体系，权益判定留待后续变更。
- 多支付渠道抽象（本模块只对接 Creem，不预先设计 provider 插件层；`payments.provider`/`subscriptions.provider` 留了字符串字段但当前只有 `"creem"` 一个值）。
- 发票/税务细节——MoR 模式下这些由 Creem 承担，我方不生成发票。

## Decisions

### D1：用 Creem（MoR）而非直连 Stripe/自建收单；直连其 REST API 而非 better-auth 的 Creem 插件

**选择**：`lib/payments/creem.ts` 直接调用 Creem 的 REST API（`POST /checkouts` 创建收银会话、订阅 webhook 事件），不经 better-auth 生态里可能存在的 Creem 插件封装。

**理由**：MoR 把合规、税务申报、发票、跨境收单的复杂度整体转移给 Creem，个人开发者/小项目要快速验证付费意愿，这条路径比直连卡组织（Stripe Connect 等需要自己处理税务主体）成本低得多。直接对接 REST API 而非用现成插件，是因为本项目的额度体系是自定义的「微元」单位、`creditMicros` 与 `priceLabel` 解耦（D5）、到账要写进自己的 `payments`/`user_credits` 表并保证幂等——插件封装的抽象层大概率假设了一套通用的「产品-订单-会员」模型，会计单位、幂等键、到账时机都要按插件的形状迁就，不如直接摸 REST API + webhook 三个原语（`createCheckout`/`verifyWebhookSignature`/`parseWebhookEvent`）来得可控，代码量也没有更大。

**弃选**：better-auth Creem 插件（若存在）——控制力让位于封装契约，与「微元额度体系」的自定义程度不匹配；自建收单直连卡组织——合规/税务成本对个人项目不成比例。

### D2：webhook 幂等用 `payments(provider, order_id)` 唯一索引 + `onConflictDoNothing` + 事务

**选择**：`recordCreemTopup` 在一个数据库事务内先 `insert payments ... onConflictDoNothing({target: [payments.provider, payments.orderId]})`；若 `.returning()` 未返回行（说明该 `(provider, orderId)` 组合已存在），直接判定「此前已处理」，跳过到账、返回 `granted: false`；若插入成功，同一事务内原子累加 `user_credits.balance_micros`，返回 `granted: true`。

**理由**：webhook 重放/Creem 重试/网络层重复投递是常态而非异常，到账逻辑必须对「同一订单被处理 N 次」天然免疫。数据库唯一约束是这里唯一靠得住的并发原语——`INSERT ... ON CONFLICT DO NOTHING` 在并发请求下由数据库保证只有一个事务能成功插入，「插入成功」与「该给这个订单加钱」在逻辑上被绑定为同一件事，不存在「先查后插」之间的竞态窗口。

**弃选**：仅在应用层先 `SELECT` 判断订单是否存在、不存在再 `INSERT`——两个并发 webhook 请求可能都在 `SELECT` 时看到「不存在」，都执行到账，产生并发竞态下的重复加钱；只能用于単实例无并发保证的玩具实现，生产 webhook 端点必须假设并发投递。

### D3：签名校验用 HMAC-SHA256 + `timingSafeEqual`，且必须用原始请求体

**选择**：`verifyWebhookSignature(rawBody, signature)`——`rawBody` 是 `await req.text()` 得到的原始字符串（未经 `JSON.parse`），用 `createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex")` 算出期望签名，与请求头 `creem-signature` 逐字节用 `timingSafeEqual` 比较；长度不等时提前返回 `false`（`timingSafeEqual` 要求等长输入，不能直接喂两个不同长度的 buffer）；未配置 `CREEM_WEBHOOK_SECRET` 时一律判失败（拒绝优先，不放行未配置场景）。

**理由**：HMAC 签名的正确性依赖「服务端算签名用的字节」与「Creem 算签名用的字节」完全一致——如果先 `JSON.parse(rawBody)` 再 `JSON.stringify` 回去参与签名计算，字段顺序、空格、转义等任何字节级差异都会让签名对不上（这是 webhook 验签最常见的坑），所以必须在请求体被解析前先取原始文本参与 HMAC。用 `timingSafeEqual` 而非 `===` 比较两个签名字符串，是为了避免逐字节比较时因「提前在第一个不匹配字节返回」造成的响应时间差被用来做时序攻击、猜出正确签名。

**弃选**：先 `JSON.parse` 再重新序列化参与签名——字节不保真，会导致合法请求也验签失败；用 `===`/`Buffer.equals` 直接比较——存在时序侧信道。

### D4：充值包「产品 id 从环境变量读」而非硬编码；`priceLabel` 仅展示、`creditMicros` 到账额度自定义

**选择**：`TopupPack.productIdEnv` 只存环境变量名（如 `CREEM_PRODUCT_TOPUP_20`），`topupProductId(pack)` 运行时读 `process.env[pack.productIdEnv]`；缺失返回 `undefined`，账户页据此把该包渲染为「未配置」不可点击（`isTopupPackAvailable`）。`priceLabel` 只是给用户看的展示价（真实收款价格由 Creem 后台该产品的定价决定，需要人工保证一致），`creditMicros` 是我方在 webhook 成功后要加的额度，两者是两个独立字段。

**理由**：Creem 产品 id 是账号相关的运行时配置（不同环境/不同 Creem 账号下 id 不同），硬编码进代码会导致换账号/换环境要改代码重新部署；环境变量读取 + 缺失优雅降级（该包不可购买而非整个页面报错）符合「一个包没配好不该拖垮其它包」的容错原则。

**弃选**：把产品 id 直接写进 `TOPUP_PACKS` 常量——账号迁移/多环境（测试 Creem 账号 vs 生产账号）时需要改代码；缺失时抛错阻塞整个页面渲染——一个包的配置缺失不该影响其它包的可购买性。

### D5：到账额度与充值价解耦（`creditMicros` 独立于 `priceLabel`）

**选择**：`TOPUP_PACKS` 里 `creditMicros` 不是从 `priceLabel` 换算出来的，是直接写死的数值——`topup-50` 标价 ¥50 但 `creditMicros` 对应 ¥55（送 ¥5），`topup-100` 标价 ¥100 到账 ¥115（送 ¥15）。

**理由**：把「收多少钱」和「给多少额度」拆成两个独立字段，运营/营销层面可以自由设计阶梯赠送（充得越多送得越多）而不需要改支付链路的任何代码——改一个数字常量就是一次营销活动，不涉及 Creem 产品配置、不涉及 webhook 逻辑。

**弃选**：额度 = 价格 × 固定汇率——赠送策略要做阶梯或活动时无法表达，且把「营销决策」和「汇率换算」耦合在一个公式里，改一处影响全部档位。

### D6：未处理的 webhook 事件回 200 忽略；订阅表按 `subscriptionId` upsert 做状态镜像

**选择**：`switch (eventType)` 的 `default` 分支只 `break`，函数末尾统一 `return Response.json({ ok: true })`（HTTP 200）；`parseWebhookEvent` 连事件类型都解析不出时同样返回 200（`{ ok: true, ignored: "no-event-type" }`）。已识别但处理过程中抛异常（如数据库故障）则返回 500。订阅相关的 9 种事件类型（`active`/`paid`/`trialing`/`update`/`past_due`/`scheduled_cancel`/`paused`/`canceled`/`expired`）统一走同一段逻辑：`insert subscriptions ... onConflictDoUpdate({target: subscriptions.subscriptionId, set: {status, currentPeriodEnd, updatedAt, raw}})`。

**理由**：Creem（以及几乎所有 webhook 提供方）对非 2xx 响应会按其重试策略反复重投；我方目前只关心三类事件（充值完成、订阅状态变化、退款），如果对「未订阅关心的事件类型」也返回非 200，会造成无意义的重试风暴，且这类事件永远不会被处理成功（代码里本来就没写处理逻辑），重试没有任何价值。反过来，已识别事件在处理过程中真的失败（如数据库瞬时不可用）时返回 500 是有意义的——这类失败重试后可能成功，值得让 Creem 重投。订阅状态用 upsert 而非「区分首次插入与更新走不同代码路径」，是因为 9 种事件里任何一种都可能是我方第一次见到这个 `subscriptionId`（比如遗漏了更早的事件），upsert 天然兼容乱序到达。

**弃选**：未处理事件也返回非 200——触发无意义重试风暴；区分订阅事件的插入/更新路径——徒增分支，upsert 已经是更简单且行为等价的方案。

### D7：`metadata` 透传 `userId`/`packId` 到 webhook

**选择**：`createCheckout` 的 `metadata: { userId, packId }` 会被 Creem 原样保存并在后续 webhook 事件里回传（`readMetadata` 从事件 object 的 `metadata`/`checkout.metadata`/`order.metadata` 几个可能层级里防御式读取）；`checkout.completed` 事件处理时直接从 metadata 拿到 `userId` 定位到账账户、`packId` 反查 `constants/creem.ts` 里的充值包定义（拿到应到账的 `creditMicros`）。

**理由**：webhook 处理是无状态的——Creem 服务器主动推事件过来，我方不能假设自己还记得「刚才是哪个用户在下单」（请求可能几秒后才到，也可能是异步重试）。让 Creem 把定位用户所需的信息原样带回来，比反过来在我方维护一张「checkout id → 用户」的映射表更简单：少一张表、少一次查询，且天然对 Creem 侧的 checkout 生命周期无感知（不需要在 `createCheckout` 成功后额外写一行「待处理」记录）。`packId` 也走 metadata 而非从 Creem 返回的 `productId` 反查，是因为 `productId → packId` 的反查需要额外维护一个反向映射，而下单时我方本来就知道是哪个 `packId`，原样透传更直接。

**弃选**：checkout 创建时在我方 DB 写一行「待处理订单」、webhook 到达后按 checkout id 关联查询——多一张表、多一次往返，且要处理「webhook 先于本地写入落盘到达」的时序问题（本方案不存在这个问题，metadata 随 webhook 一起到达）。

## Risks / Trade-offs

- **[metadata 可被篡改的信任边界]** → metadata 由我方在 `createCheckout` 时设置、随 checkout 会话绑定，Creem 侧不允许用户在支付流程中修改 metadata 内容；真正的信任锚点是签名校验（D3）——只要 HMAC 校验通过，就确认整个 payload（含 metadata）确实来自 Creem 未被篡改，metadata 里的 `userId` 才可信。
- **[`packId` 在 webhook 到达时已从 `TOPUP_PACKS` 移除（下架充值包）]** → `getTopupPack(metadata.packId)` 返回 `undefined`，`checkout.completed` 分支 `if (!pack || !orderId) break`，直接跳过、不到账、也不报错（回 200）。这意味着「下架一个充值包」不会导致老订单的 webhook 处理报错重试，但也意味着此时用户已付款却不会到账——v1 接受该风险（下架前应保证在途订单已清空），真出现需人工核对 `payments` 表补偿。
- **[Creem API/Webhook 契约字段层级不稳定]** → 用一组防御式读取器（`readMetadata`/`readOrderId`/`readProductId`/`readCheckoutId`/`readSubscription`）多层兜底（先取 `object.xxx`，再取 `object.checkout.xxx`/`object.order.xxx`/`object.subscription.xxx`）而非假设单一固定层级，降低 Creem 一侧字段结构调整时的破坏性。
- **[退款会扣回额度，但若用户已把额度花掉]** → `refund.created` 处理会无条件从余额扣回 `creditMicros`（见 `app/api/webhooks/creem/route.ts` 的 `refund.created` 分支），若用户在退款前已用掉这笔额度，余额会被扣至负数——与「计费」模块 `chargeUsage` 允许扣至负数的既有设计一致（负余额会阻断后续新对话，见 `hasPositiveBalance` 拦截），v1 接受这个结果作为退款场景的自然结算，不做特殊挽留逻辑。
- **[`AI_GATEWAY_API_KEY` 未配置时网关成本查询整体不可用]** → `isVercelGatewayConfigured()` 为 false 时，`getGenerationCostUsd` 调用方（「计费」模块的对账任务）会跳过对账、保持估算成本，不阻塞主链路——网关成本查询是增强而非硬依赖。

## Migration Plan

1. `lib/db/payment-schema.ts` 的 `payments`/`subscriptions` 两表迁移已随实现落地并应用；本变更不引入新的 schema 改动，纯粹是把既有实现补记为设计文档。
2. 若未来要回滚本模块：`DROP TABLE payments, subscriptions`（`payments`/`subscriptions` 均有 `user_id` 外键 `references user.id`，回滚前需确认无下游依赖）；`recordCreemTopup` 从 `lib/billing/credits.ts` 移除；API 路由与账户页 UI 一并移除。
3. 无数据回填需求（回填的是设计文档本身，不改变已在生产运行的行为）。

## Open Questions

- 订阅生效后是否替代按量扣费（走订阅额度而非微元余额）——现阶段订阅仅做状态镜像展示，扣费路由留待订阅正式作为计费方式上线时再设计，不阻塞当前充值链路。
- 下架充值包时在途订单的处理（见 Risks）——目前依赖人工核对，未来量大后可能需要一张「已下架但仍需兑现」的例外表。
