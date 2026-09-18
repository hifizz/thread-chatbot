## Context

现有 lib/observability、Axiom、Langfuse、反馈评分与 feedback_score_outbox 已存在。当前 ThreadChat sessionId 使用 projectId，反馈绑定现有 assistantMessageTraceId；迁移必须兼容，不可只改 sessionId 然后丢掉旧反馈关联。

## Goals / Non-Goals

能从用户问题找到生成/调用/费用，能按可靠定义观察产品价值，能在故障时收到通知。账务和权限只依赖自有 DB；第三方分析不可成为聊天正常运行前置。

## Decisions

### 1. 模块和数据所有权

| 所有者 | 数据/职责 | 不负责 |
| --- | --- | --- |
| 既有业务 DB | 用户、权益、余额、Generation、反馈、审计 | 无限细粒度追踪 |
| lib/analytics/events | 事件字典、schema 与去重 ID | 自行决定隐私授权 |
| lib/analytics/posthog | 授权后的产品漏斗/行为事件 | 账务事实 |
| lib/observability | Generation/attempt 与 Langfuse、Axiom 关联 | 改变扣费结果 |
| admin/metrics | 核心聚合及人群/时区/覆盖声明 | 重做分析平台 |
| monitoring/alerts | 阈值、去重、投递、处置链接 | 无人确认的无限通知 |

组件：AdminOverview、AdminUserDetail、CostBreakdown、HealthSummary、TraceLinks，复用现有 Admin layout、表格、卡片和 Dialog。详情必须 admin guard，普通用户只能看到自己的费用与反馈；数据请求/导出不可借 metrics 旁路权限。

### 2. 事件、关联和类型

```ts
type ProductEventPayloads = {
  'generation.started': { generationId: string; modelId: string };
  'generation.completed': { generationId: string; durationMs: number };
  'generation.failed': { generationId: string; errorCode: string };
  'branch.created': { threadId: string; parentThreadId: string };
  'artifact.updated': { artifactId: string; revisionId: string };
  'core_flow.completed': { projectId: string; threadId: string };
  'credit.exhausted': { generationId: string | null };
};
type ProductEvent<K extends keyof ProductEventPayloads> = {
  id: string;
  name: K;
  schemaVersion: 1;
  occurredAt: string;
  userId: string;
  release: string;
  environment: 'development' | 'evaluation' | 'staging' | 'production';
  payload: ProductEventPayloads[K];
};
type DailyMetrics = {
  date: string;
  timezone: string;
  asOf: string;
  serviceActiveUsers: number;
  analyticsConsentedUsers: number;
  acceptedGenerations: number;
  completedGenerations: number;
  failedGenerations: number;
  stoppedGenerations: number;
  providerCostMicros: number;
  customerChargeMicros: number;
  unknownCostAttempts: number;
  costCoverage: 'complete' | 'estimated' | 'partial';
};
type UserActivitySummary = {
  userId: string;
  registeredAt: string;
  lastServiceActionAt: string | null;
  plan: 'beta' | 'pro';
  accountStatus: 'active' | 'suspended';
  pendingInvitations: number;
  activeGenerations: number;
  pendingBilling: number;
  openDataRequests: number;
};
type AlertPolicy = {
  id: string;
  windowSeconds: number;
  minimumSamples: number;
  threshold: number;
  cooldownSeconds: number;
  runbookPath: string;
};
```

实现时 CnyMicros、plan/status、ObservabilityContext 均 import 对应所有者，不复制枚举。事件通过 Zod 验证白名单属性；ProductEvent 禁止原始邮件、聊天内容、query/URL、provider response 或密钥。业务批准/注册/反馈事实仍在各自表，不因它们具有统计价值就无授权发送。

拟议 GET /api/admin/metrics 和 /api/admin/users/:id/activity 采用已有 admin guard、时间范围/分页上限，响应明确 timezone/asOf/coverage；不能返回任意 SQL 或原始用户内容。事件服务端真实状态提交后产生，按钮点击只算明确命名的客户端交互，不冒充成功。

### 3. 可靠发送与去重

唯一 eventId 由事实记录 ID/版本生成，不以每次 retry 随机 UUID 重新计数。状态型事实提交后再投递；重要终态/账务告警可用 DB 待发送记录，小型 dispatcher 按已有 outbox 领取/租约/退避约定执行，不重写反馈队列。

可选行为在产生时没有有效 consent 就不收集、不入队；发送前重新检查当前 revision，撤回后丢弃。Product analytics 失效不阻断聊天。业务 DB 的最小状态事实仍可用于服务排障，但用途/保留经过 #165 批准，不能拿来重建被拒绝的细粒度行为分析。

投递失败/积压单独计量，Admin 不显示“事件已排队”等于“远端已收到”。采样不能用于用户账务、余额、Generation 终态或硬错误事实；内容诊断/可选分析按政策采样并注明覆盖。

### 4. Trace 迁移与反馈兼容

新 Session 使用 threadId，projectId 保留 metadata。每次 Generation 需要稳定且可回查的 Trace；当前 helper 的 message-scope 逻辑作为 v1 保留。新写入采用 generation-scope v2 的确定性 ID（复用既有 hash/salt 工具，输入加入 generationId），并把 traceId/traceMappingVersion 与 Generation 保存。

反馈更新不重算猜测 Trace：从被反馈的实际 assistant message / Generation 关联读取，v1 历史继续使用旧 helper，v2 使用已保存 ID。regenerate 或 message 替换时不把旧评分静默关联新输出；延迟 outbox 使用提交时的目标与版本。迁移不重写历史 Session/Trace，不双重发送同一用量。

共享关联字段包括 requestId、userId、projectId、threadId、generationId、assistantMessageId、traceId、providerAttemptId、environment、release。只要求事件确实具有的实体；invitation 不伪造 Generation。release 由 CI 的 commit SHA 自动注入，不让运营手填 production 字符串当版本。

### 5. 指标的固定定义

所有时间 UTC 存储，第一版统计桶固定 UTC 并在页面显示，前端不偷偷转成另一日期再计算。每项指标排除 evaluation/staging、标记的 Owner 内部测试与机器人，保留筛选版本。

| 指标 | 定义 |
| --- | --- |
| 服务 DAU | 桶内至少一次真实受理生成、成功分支或 Artifact 编辑的去重用户；只使用已批准必要用途事实 |
| 首次成功回答率 | 完成一次有效回答的注册用户 / 该注册 cohort 用户 |
| 核心激活率 | 完成回答后创建分支并在分支获得有效回答的用户比例，另看回主线/文档采纳 |
| D1/D7 | 按注册和激活 cohort 分开，完整观察窗口后判断回访，不把未满 7 天算流失 |
| 终态分布 | accepted/completed/failed/stopped/superseded/running 分列，进行中不算失败 |
| 技术成功率 | completed / (completed + failed)，必须同时展示主动停止等排除项 |
| 成功任务成本 | 所有相应供应商费用含失败 / completed 数量，unknown 时标部分而非精确总数 |
| 体验 | TTFT、总时长 p50/p95 和样本数，模型/搜索分别切分 |

PostHog 漏斗/行为留存覆盖明确同意的人群，不能展示成全体留存。若采用最小必要事实聚合的全体服务留存，需单独标目的与口径；不能把两种分母混合。样本小和 incomplete window 显示不足，不编百分比。

每用户详情展示准入/账号/计划、最近真实使用、余额/预占/累计费用、活跃/失败/待对账生成、分支/Artifact 使用和反馈。不同状态分别显示，不设计一个万能 user_status。

### 6. 告警与运营闭环

至少覆盖外部探测不可达、模型/搜索连续 401/429、异常失败率、Generation 超 lease、pending billing、邮件/反馈 outbox 积压、预算/供应商低额度、数据库连接/内存压力。

每条规则保存窗口、最小样本、阈值、冷却、负责人、渠道与 runbook；初始阈值在 staging 故障演练后冻结。外部可用性通知不能只依赖已经宕机的应用自行发送。重复告警合并，恢复单独通知；低额度信息注明最后同步时间，不能虚称实时。

## Migration Plan

先定义事件和指标字典，接好 #165 gate 后才加载 PostHog。添加 trace mapping v2 与历史兼容测试，再灰度新数据；不回填未经同意的历史分析。用户统计先只读聚合，必要 schema 由 develop 统一 migration。回滚关闭可选采集，继续业务事实和错误日志，保留 v1/v2 读取兼容。

## Risks / Trade-offs

平台数量虽为三家，但各自职责固定；不用新 BI 平台。聚合不足时显示部分/估算，比假精确更重要。trace ID 更换必须同时迁移反馈读取，不能单改 Session 的一行。

## Open Questions

开放前确认 PostHog 处理区域、保留/费用，外部探测与通知接收人，并通过真实送达演练。参数/渠道未配置不能标监控完成。
