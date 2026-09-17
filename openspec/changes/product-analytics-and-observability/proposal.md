## Why

Beta 需要知道用户是否真正体验分支能力、何处失败、每次成功任务花多少成本。现有 Axiom/Langfuse/反馈基础继续使用，但需要统一事实、指标定义、隐私门控和可实际送达的告警，而不是重建统计平台。

## What Changes

- 新增有类型的最小产品事件与 PostHog 分析接入，遵守 #165 的同意边界。
- 自有数据库提供用户、准入、Generation、账务、反馈及 Admin 审计事实；Admin 展示核心指标与每用户状态。
- 新数据按 Thread Session / Generation 关联 Trace 组织，保留旧映射并兼容已有反馈镜像。
- 配置活跃、激活、留存、成功任务成本、用量覆盖和可靠性指标口径。
- 增加外部可用性、供应商、卡住任务、待结算、投递积压与预算告警及演练。

## Capabilities

### New Capabilities

- `beta-product-observability`: 产品事件、用户状态视图、指标、追踪兼容和运营告警。

### Modified Capabilities

无。复用现有 observability 和 feedback_score_outbox 实现，不建立平行追踪系统。

## Impact

计划扩展 lib/observability 与已有 Axiom 模块，增加 lib/analytics、Admin metrics 和设置链接。仅文档，不在本次启用采集。

## Dependencies

Git 父分支 spec/beta-03-consent-privacy（#165，包含 #163）。账务事件依赖 #164，准入依赖 #166，搜索依赖 #167；这些是事件集成依赖，不是本 PR Git 历史。08 发布门禁消费本指标和告警证据。

## Non-goals

不自建 PostHog/Langfuse，不开 session replay，不保存全部点击流，不把安装 SDK 当作完成运营观测。
