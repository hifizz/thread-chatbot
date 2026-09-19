## 1. 现状与数据

- [ ] 1.1 对齐现有 Generation/UsageInput/chargeUsageOnce 和旧支付路径，冻结唯一扣款写入者。
- [ ] 1.2 增加价格快照、ledger、reservation、usage line 的 schema 源码及唯一约束；只用独立库 db:push。
- [ ] 1.3 制定 opening_balance、历史赠额标记与旧 usage 保留方案；不重扣历史费用。

## 2. 核心账务

- [ ] 2.1 实现缺价拒绝、定点计算、缓存拆分、汇率及扣额政策版本。
- [ ] 2.2 实现短事务账户/供应商预算锁、预占和并发准入；覆盖两个实例。
- [ ] 2.3 实现完整 attempt 与辅助调用计量、幂等结算、退款/调整及 unknown 对账。
- [ ] 2.4 将开户与欢迎赠额分开，为邀请事务提供 grantWelcomeOnce，迁移旧用户不重发。
- [ ] 2.5 禁用新充值前后端；验收历史已支付 webhook。

## 3. 执行与体验

- [ ] 3.1 在既有编排接入授权后的预占及终态结算，预留最后答复预算。
- [ ] 3.2 接入余额、预占、明细和管理员审计 UI，使用 internationalization 错误契约。
- [ ] 3.3 增加卡住结算、差异、未知用量和预算告警，遥测不参与扣款决策。

## 4. 验收与发布

- [ ] 4.1 测试最后余额竞态、重复结算/赠额、价格变化、stop/complete、崩溃和负余额。
- [ ] 4.2 使用实际渠道核验开放模型 usage/缓存价格，不把估值当真实账单。
- [ ] 4.3 develop 集成任务生成并验证迁移；运行 typecheck、相关测试和灰度对账。
- [ ] 4.4 运行 pnpm exec openspec validate usage-billing-and-quota --strict，记录切换/回滚证据。

本次仅方案，所有实现任务未完成。
