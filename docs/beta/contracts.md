# Beta 公共契约所有权

本文件约束八个方案的边界，不要求实现通用框架。以下类型均为设计，复用现有代码优先。

| 契约 | 唯一所有者 | 消费方 |
| --- | --- | --- |
| Locale、LocalePreference | internationalization / constants/i18n.ts | 邮件、隐私、设置、分析 |
| UserEntitlement、AccountStatus | private-beta-access / lib/beta | 模型菜单、计费准入、Admin |
| CnyMicros、PricingSnapshot、UsageLine、RunReservation | usage-billing-and-quota / lib/billing | LLM、搜索、Admin、评测 |
| SearchProviderAdapter、FetchProviderAdapter | 既有 add-web-search-provider-routing | webSearch/readUrl，不暴露供应商给模型 |
| ConsentSnapshot、DataPurpose | cookie-consent-and-privacy / lib/privacy | 浏览器及服务端可选分析 |
| 关联上下文 | 扩展现有 ObservabilityContext | Generation、attempt、日志、反馈 |
| ProductEvent、DailyMetrics | product-analytics-and-observability | 事件发送与 Admin |
| MessageFeedback | 复用 lib/thread-chat/contracts/dto | 反馈扩展、Langfuse |
| AgentCase、EvaluationScore | 复用 evals/agent | 发布门禁，不新建 runner |

## 身份与错误

Generation 名称、主键和状态复用现有实现；不要新建平行 MessageRun 表。产品口头说 Run 与存储不是两个实体。日志关联保留 requestId/userId/projectId/threadId/generationId/assistantMessageId/traceId/release/environment；只在生命周期确实存在时要求对应字段，邀请不伪造 generationId。

```ts
// 设计约定：在既有 contracts 目录按领域合并，不强制新建公共包。
type CnyMicros = number; // 入库/运算必须是安全整数；大额或乘法中间值用十进制定点。
type PublicError = {
  code: string; // 各领域定义字面量并由中央映射穷尽检查。
  requestId: string;
  retryAfterSeconds?: number;
};
```

准入错误：BETA_ACCESS_REQUIRED、ACCOUNT_SUSPENDED、MODEL_NOT_ALLOWED。账务错误：MODEL_PRICING_UNAVAILABLE、CREDIT_EXHAUSTED、RUN_RESERVATION_INSUFFICIENT、TOO_MANY_ACTIVE_RUNS。搜索错误：SEARCH_TEMPORARILY_UNAVAILABLE。容量错误：CAPACITY_UNAVAILABLE。原始 provider response 不作为公开 message；有内部诊断时按隐私政策控制正文采集，不随意复制到 analytics。

## 不变量

- 账户身份、订阅权益、额度和生成状态分别存储；Pro 不绕过价格、预算或并发。
- 业务数据库是准入/账务/反馈/状态事实源；PostHog、Langfuse、Axiom 故障不改变账务事实。
- generation 结束与 provider attempt 结束不是同一个计费粒度；供应商成本和用户扣额分别保存。
- 事务内只做数据库操作；网络副作用通过可恢复记录投递。复用已有 feedback_score_outbox，不强制迁入新通用队列。
- 同意前/拒绝期间的可选事件不收集、不排队、不补传。服务日志和最小业务聚合必须分别说明用途，不能借服务端绕过拒绝。
- 文档批准不等于服务采购、法律审核、迁移、真实调用或浏览器验收已经完成。
