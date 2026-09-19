## ADDED Requirements

### Requirement: Reject unpriced paid work

系统 SHALL 在调用前验证精确渠道和服务价格，并为每轮任务冻结价格、汇率与扣额政策；未知价格 MUST NOT 被解释为免费。

#### Scenario: Missing model price
- **WHEN** 用户选择的模型没有有效定价
- **THEN** 返回 MODEL_PRICING_UNAVAILABLE 且不调用供应商

#### Scenario: Price changes during generation
- **WHEN** 管理员在任务进行中更新价格
- **THEN** 本轮按已绑定快照结算，新价格只影响之后受理的任务

### Requirement: Atomically reserve across instances

系统 SHALL 在付费请求之前原子检查并预占账户、并发和供应商预算，不仅检查 balance 大于零。

#### Scenario: Two instances compete for remaining credit
- **WHEN** 两个实例同时提交而余额只足够预占一轮
- **THEN** 只有一轮获准调用供应商，另一轮收到明确不足错误

### Requirement: Protect accepted bounded generations

系统 SHALL 以启动时的有界预算执行已受理任务，账户余额随后归零不能成为取消当前任务的理由。

#### Scenario: Another run consumes remaining balance
- **WHEN** 其他并发任务结算令可用余额归零
- **THEN** 当前已预占任务继续运行，新任务被拒绝

#### Scenario: Run reaches its planned tool boundary
- **WHEN** 继续调用工具会侵占已经预留的收尾预算
- **THEN** 不再启动新工具并输出已有证据支持的最终答复或明确限制

### Requirement: Record all attempts without double counting

系统 SHALL 分别记录实际供应商成本与用户扣额，并以互斥用量拆分避免缓存或 reasoning 重复计量。

#### Scenario: Technical retry
- **WHEN** 一个逻辑操作进行了收费的失败尝试和成功备用尝试
- **THEN** 两次供应商成本都被记录，用户不因技术重试被重复收取同一交付内容费用

#### Scenario: Missing usage
- **WHEN** 供应商未提供可靠用量
- **THEN** 标记 unknown 或明确的估算并进入对账，不记为已核实零成本

### Requirement: Settle and grant idempotently

系统 SHALL 在 Generation 终态和账务事务中保证重复处理不重复扣额，邀请欢迎额度只发一次，历史余额不被重发或清空。

#### Scenario: Finalization repeats after restart
- **WHEN** 相同 generationId 再次进入结算
- **THEN** 不新增重复扣款，只返回或推进尚未完成的对账状态

#### Scenario: Existing user activates beta
- **WHEN** 已领取初始额度的历史用户激活 Beta
- **THEN** 保留其余额且不重复赠送 ¥5

### Requirement: Recover reservations without replaying paid requests

系统 SHALL 先核对 lease 与 attempt 再处理过期预占，不为恢复记账自动重放付费模型或工具请求。

#### Scenario: Process dies after supplier response
- **WHEN** 供应商可能已收费而结算记录尚未完成
- **THEN** 进入可审计对账流程，不释放为免费且不重复调用供应商

### Requirement: Disable new payments without losing old obligations

系统 SHALL 阻止新充值创建，同时继续安全处理既有已支付回调。

#### Scenario: Checkout requested during beta
- **WHEN** 用户直接调用创建 checkout 的接口
- **THEN** 服务端拒绝，即使用户绕过隐藏的前端入口

#### Scenario: Previously paid webhook arrives
- **WHEN** 关闭新充值后收到有效且未履约的旧支付通知
- **THEN** 验签并按既有幂等规则完成对账/到账，不吞掉真实支付
