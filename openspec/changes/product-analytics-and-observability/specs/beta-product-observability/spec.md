## ADDED Requirements

### Requirement: Separate business truth from analytics

系统 SHALL 以自有数据库作为权限、账务、Generation、反馈与审计事实源，第三方平台故障不能改变这些事实。

#### Scenario: Analytics provider unavailable
- **WHEN** PostHog 或 Langfuse 投递失败
- **THEN** 聊天与幂等账务正常执行，投递状态和积压独立可见

### Requirement: Emit typed and consented product events

系统 SHALL 只发送通过 schema 验证且具有当前有效同意的可选事件，成功事件必须来自已提交事实，并按稳定 ID 去重。

#### Scenario: Retry event delivery
- **WHEN** 同一业务状态重复投递
- **THEN** 不重复计数成功任务或活跃用户

#### Scenario: Consent revoked while queued
- **WHEN** 事件尚未发送而用户撤回
- **THEN** 丢弃对应可选事件，不补传

### Requirement: Preserve trace and feedback identity across migration

系统 SHALL 为新 Generation 保存稳定 traceId/映射版本、采用 thread Session，并保留历史 message-scope 反馈解析。

#### Scenario: Historical feedback replay
- **WHEN** 旧 feedback outbox 在新版本中重试
- **THEN** 仍关联原输出的 Trace，不关联新的 regenerate 输出

#### Scenario: New generation traced
- **WHEN** 新生成包含多个模型/搜索 attempt
- **THEN** 每个 attempt、费用和反馈可按已保存 Generation Trace 关联到同一轮

### Requirement: Publish explicit metric populations and coverage

系统 SHALL 为指标显示时区、统计时间、样本/人群和费用覆盖，不混合未观察完成 cohort 与已完成 cohort。

#### Scenario: D7 window not complete
- **WHEN** 用户注册尚不足完整 7 日窗口
- **THEN** 不把该用户计为 D7 流失

#### Scenario: Some attempts lack cost
- **WHEN** 一部分用量仍 unknown
- **THEN** 成本面板标记 partial/unknown 数量，不宣称精确总成本

#### Scenario: PostHog retention
- **WHEN** 图表只包含 consented 用户
- **THEN** 明确标注同意人群，不能称为全部用户留存

### Requirement: Provide authorized operational user views

系统 SHALL 提供受 Admin 权限保护的用户准入、计划、用量、任务、反馈和数据请求状态视图。

#### Scenario: Non-admin requests user overview
- **WHEN** 普通用户请求其他用户的运营详情
- **THEN** 被拒绝且不泄露用户数据

### Requirement: Verify actionable alerts

系统 SHALL 为可用性、供应商错误、卡住任务、待结算/投递积压和预算配置有窗口、阈值、去重及处置入口的通知，并实际演练送达。

#### Scenario: Application outage
- **WHEN** 应用无法执行自身告警代码
- **THEN** 外部可用性探测仍能通知指定接收渠道

#### Scenario: Alert configured but untested
- **WHEN** 只有规则配置且没有送达证据
- **THEN** 发布清单不得把告警项标为完成
