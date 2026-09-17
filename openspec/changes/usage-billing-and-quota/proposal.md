## Why

当前已有 user_credits、usage_records、chargeUsageOnce 和 ¥5 初始额度，但缺价返回 0、按输入输出估值、启动前只查正余额不足以支撑多用户多实例 Beta。需要在已有账务上增加可审计价格、并发预占、逐调用成本及异常对账，避免另建余额系统。

## What Changes

- 在既有余额与流水上增加不可变赠额/调整账本、价格快照、供应商 attempt 用量和 Generation 预占。
- 缺失或过期未确认定价的开放模型拒绝启动；缓存/推理计量不重复相加。
- 用户扣额与供应商实际成本分开；现有 30% 毛利扣额政策保留并显式版本化，不静默改价。
- 受理后不因账户余额归零取消；任务开始前固定可完成的预算边界并预留收尾费用。
- 禁止新充值/checkout，保留历史已支付事件的幂等对账。

## Capabilities

### New Capabilities

- `beta-usage-billing`: Beta 价格、预占、计量、结算与额度审计。

### Modified Capabilities

无已归档同名 capability；增量扩展现有 add-billing-metering 实现，旧流水和余额保留，不重写已有历史成本。

## Impact

计划修改 constants/pricing.ts、lib/billing、现有 billing schema、Generation 准入/结束编排及 Admin 费用页。仅文档 PR，不更改 SQL、价格或生产开关。

## Dependencies

Git 基于 main@5731a9d。复用现有 Auth/Generation；展示与错误翻译依赖 #163。准入、搜索消费本账务契约。为避免循环，计费服务不导入 Beta 权益服务：现有服务端编排先完成授权，再调用本模块；赠额服务可被准入事务调用。

## Non-goals

不接入新支付、订阅续费、积分商城、发票或独立账务微服务；不保证任意模型下 ¥5 均达到一百万 Token。
