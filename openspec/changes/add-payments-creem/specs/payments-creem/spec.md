# payments-creem 收款与支付（Creem）

## ADDED Requirements

### Requirement: 充值包到 Creem 产品的映射

系统 SHALL 以 `constants/creem.ts` 中的 `TOPUP_PACKS` 定义充值包（`topup-20`/`topup-50`/`topup-100`），每个充值包 SHALL 通过环境变量（`productIdEnv` 指向的变量名，如 `CREEM_PRODUCT_TOPUP_20`）解析对应的 Creem 产品 id，不 SHALL 在代码中硬编码产品 id。到账额度 `creditMicros` SHALL 与展示价 `priceLabel` 相互独立（可含赠送，如标价 ¥50 到账 ¥55）。当某充值包对应的环境变量未配置时，该充值包 SHALL 被判定为不可购买，且不影响其余充值包的可购买性。

#### Scenario: 已配置产品 id 的充值包可购买

- **WHEN** 某充值包（如 `topup-20`）对应的环境变量已配置有效的 Creem 产品 id
- **THEN** `isTopupPackAvailable` 返回 `true`，账户页对应卡片可点击发起充值

#### Scenario: 未配置产品 id 的充值包不可购买

- **WHEN** 某充值包对应的环境变量未设置或为空
- **THEN** `topupProductId` 返回 `undefined`，`isTopupPackAvailable` 返回 `false`，账户页对应卡片渲染为禁用的「未配置」状态，其余已配置的充值包不受影响

#### Scenario: 到账额度与展示价解耦

- **WHEN** 充值包定义了 `creditMicros` 高于其标价对应的微元数（如 `topup-50` 标价 ¥50、`creditMicros` 对应 ¥55）
- **THEN** webhook 到账时按 `creditMicros` 的值原样增加余额，不按 `priceLabel` 重新计算

### Requirement: 创建 Creem checkout

系统 SHALL 提供 `POST /api/billing/checkout`：未登录请求 SHALL 返回 401；`packId` 无效或指向的充值包未配置产品 id 时 SHALL 返回 400；否则调用 Creem `createCheckout`，将当前登录用户 id 与充值包 id 通过 `metadata` 透传，成功后返回 `{ url: checkout_url }` 供前端跳转至 Creem 收银台。

#### Scenario: 未登录发起充值

- **WHEN** 未登录用户请求 `POST /api/billing/checkout`
- **THEN** 响应 401，不创建 checkout 会话

#### Scenario: 合法充值包创建 checkout

- **WHEN** 已登录用户以一个已配置产品 id 的合法 `packId` 请求
- **THEN** Creem `createCheckout` 被调用，`metadata` 中包含该用户 id 与 `packId`，响应返回可跳转的 `checkout_url`

#### Scenario: 充值包未配置产品 id

- **WHEN** 请求的 `packId` 对应的充值包未配置 Creem 产品 id
- **THEN** 响应 400，且不调用 Creem 创建 checkout

### Requirement: Webhook 签名校验

系统 SHALL 对 `POST /api/webhooks/creem` 的每个请求，使用请求头 `creem-signature` 与「原始请求体的 HMAC-SHA256（密钥为 `CREEM_WEBHOOK_SECRET`）十六进制摘要」做比较校验，比较 SHALL 使用抗时序攻击的等长比较（如 `timingSafeEqual`）。参与签名计算的 SHALL 是未经解析的原始请求体字节，而非先解析再重新序列化的结果。签名校验失败（不匹配、缺签名头、或密钥未配置）SHALL 拒绝该请求且不处理任何业务逻辑；请求体不是合法 JSON SHALL 视为独立的校验失败场景。

#### Scenario: 签名匹配

- **WHEN** 请求头 `creem-signature` 等于原始请求体的 HMAC-SHA256（密钥正确）十六进制摘要
- **THEN** 签名校验通过，继续解析事件并分发处理

#### Scenario: 签名不匹配

- **WHEN** 请求头 `creem-signature` 存在但与计算出的期望签名不一致
- **THEN** 系统 SHALL 拒绝该请求，不写入任何数据库记录，不触发到账/订阅同步/退款逻辑

#### Scenario: 缺少签名头或密钥未配置

- **WHEN** 请求未携带 `creem-signature` 头，或服务端 `CREEM_WEBHOOK_SECRET` 未配置
- **THEN** 系统 SHALL 判定为校验失败并拒绝请求，不因「无法校验」而放行

#### Scenario: 请求体不是合法 JSON

- **WHEN** 签名校验通过但请求体无法被解析为 JSON
- **THEN** 系统 SHALL 返回 400，不处理任何业务逻辑

### Requirement: 充值到账幂等

系统 SHALL 以 `payments` 表 `(provider, order_id)` 的唯一约束作为充值到账的幂等键：处理 `checkout.completed` 事件时，SHALL 在同一数据库事务内先尝试插入一行 payments 记录（发生唯一约束冲突则不插入且不报错），仅当插入成功时才原子性地为对应用户增加 `creditMicros` 额度；插入失败（订单已存在）SHALL 视为「此前已处理」，跳过到账且不视为错误。

#### Scenario: 首次收到充值完成事件

- **WHEN** `checkout.completed` webhook 携带一个此前未出现过的 `orderId`
- **THEN** 系统插入一行新的 payments 记录，并将该充值包的 `creditMicros` 原子累加到用户余额

#### Scenario: 同一订单事件被重复投递

- **WHEN** 同一 `orderId` 的 `checkout.completed` webhook 被投递第二次（Creem 重试或重放）
- **THEN** 系统 SHALL 不插入新的 payments 行、不重复增加用户余额，处理结果视为成功（不报错）

#### Scenario: metadata 缺失用户或充值包信息

- **WHEN** `checkout.completed` 事件的 metadata 中缺少 `userId` 或 `packId` 无法解析为已知充值包，或事件中读不到订单 id
- **THEN** 系统 SHALL 跳过到账处理且不报错，响应仍为 200

### Requirement: 订阅状态镜像

系统 SHALL 通过 webhook 的订阅相关事件（`subscription.active`/`paid`/`trialing`/`update`/`past_due`/`scheduled_cancel`/`paused`/`canceled`/`expired`）以 `subscriptionId` 为唯一键，将订阅的 `status`/`currentPeriodEnd`/原始负载 upsert 到 `subscriptions` 表，作为 Creem 侧订阅状态的本地镜像。

#### Scenario: 首次收到订阅事件

- **WHEN** 某 `subscriptionId` 此前从未出现过，收到其任一订阅事件
- **THEN** 系统插入一行新的 subscriptions 记录，`status`/`currentPeriodEnd` 取自该事件

#### Scenario: 同一订阅的后续状态变化

- **WHEN** 已存在的 `subscriptionId` 收到新的订阅事件（如从 `trialing` 变为 `active`，或后续变为 `canceled`）
- **THEN** 系统原地更新该行的 `status`/`currentPeriodEnd`/`updatedAt`/原始负载，不产生新行

### Requirement: 退款处理

系统 SHALL 在收到 `refund.created` 事件时，将订单 id 匹配且当前状态为 `paid` 的 payments 记录状态更新为 `refunded`，并从对应用户余额中扣回该笔记录的 `creditMicros`；该操作 SHALL 具备幂等性（同一订单的退款事件重复投递不会重复扣回额度）。

#### Scenario: 对已到账订单执行退款

- **WHEN** `refund.created` 事件的订单 id 对应一条状态为 `paid` 的 payments 记录
- **THEN** 该记录状态置为 `refunded`，用户余额扣回对应的 `creditMicros`

#### Scenario: 退款事件重复投递

- **WHEN** 同一订单的 `refund.created` 事件被投递第二次
- **THEN** 由于该 payments 记录已不再是 `paid` 状态，系统 SHALL 不二次匹配、不二次扣回额度

#### Scenario: 退款指向不存在或未支付的订单

- **WHEN** `refund.created` 事件的订单 id 不存在，或对应记录状态不是 `paid`
- **THEN** 系统 SHALL 不做任何变更，响应仍为 200

### Requirement: 未知事件与处理异常的响应策略

系统对无法识别 `eventType`、或 `eventType` 已识别但未被业务逻辑处理的 webhook 事件，SHALL 返回 HTTP 200 并忽略，不 SHALL 因未处理事件而返回错误状态码（避免触发发送方的无谓重试）。已识别事件在处理过程中若发生异常（如数据库故障），SHALL 返回 5xx 以允许发送方按其策略重试。

#### Scenario: 完全无法识别事件类型

- **WHEN** webhook 载荷中解析不出任何 `eventType`
- **THEN** 系统返回 200，不处理任何业务逻辑

#### Scenario: 已知但未被处理的事件类型

- **WHEN** `eventType` 是一个合法字符串但不属于系统当前处理的任何分支（`checkout.completed`/订阅系列/`refund.created`）
- **THEN** 系统返回 200，不写入任何数据库记录

#### Scenario: 已识别事件处理中发生异常

- **WHEN** 系统正在处理一个已识别的事件类型（如 `checkout.completed`）时数据库操作抛出异常
- **THEN** 系统返回 5xx，供发送方重试；由于到账/退款等操作具备幂等性（见前述 Requirement），重试是安全的

### Requirement: 网关真实成本查询能力

系统 SHALL 提供按 `generationId` 查询 Vercel AI 网关真实生成成本（美元）的能力：已配置 `AI_GATEWAY_API_KEY` 且该 generation 的成本信息已就绪时返回具体数值；未配置、成本尚未就绪（如查询过早）或查询出错时 SHALL 返回 `null`，不 SHALL 抛出异常中断调用方。该能力仅提供查询原语；基于查询结果修正估算成本、调整用户余额等账务对账逻辑 SHALL 属于「计费」模块的职责，不在本能力范围内。

#### Scenario: 网关已配置且成本已就绪

- **WHEN** `AI_GATEWAY_API_KEY` 已配置，且指定 `generationId` 的成本信息已可查询
- **THEN** 返回该次生成的真实成本（美元数值）

#### Scenario: 网关未配置

- **WHEN** `AI_GATEWAY_API_KEY` 未配置
- **THEN** `isVercelGatewayConfigured()` 返回 `false`；即便调用查询函数也不 SHALL 抛出异常，而是返回 `null`

#### Scenario: 成本尚未就绪或查询出错

- **WHEN** 已配置网关但指定 `generationId` 的成本信息尚不可查（如刚生成不久）或请求出错
- **THEN** 系统 SHALL 返回 `null`，交由调用方（计费模块的对账逻辑）稍后重试，不 SHALL 抛出异常
