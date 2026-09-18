## Context

更新 main@5731a9d 已有 change。现有 lib/ai/search.ts 使用 AnySearch，constants/research.ts 提供 Exa 正文备用和 24/64 尝试边界；这些不证明账号付费容量已就绪。原方案未落地部分在本次按 Beta 收敛，历史 demo 完成记录保留。

## Goals / Non-Goals

搜索可购买扩容、可归账、可降级、可评测；模型和 UI 不感知 provider。只实现一个主服务和一个备用，复用现有执行器、日志、评测，不建立新服务或新 runner。

## Decisions

### 1. 模块与供应商政策

| 模块 | 输入 → 输出 | 边界 |
| --- | --- | --- |
| registry | 已批准配置 → Search/Fetch 候选 | 未采购/缺价/无 key 不可用 |
| adapters | 统一输入 → provider response 归一化 | 不自行无限重试 |
| router | operation/context → 有序候选 | 不重做用户意图分类 |
| attempt-engine | 有序候选/预算 → 结果与 attempt | 统一超时、失败分类、计量 |
| url-guard | URL/redirect → 允许或拒绝 | 不信任网页指令 |
| 现有 web-access snapshot | 文本/游标 → 有界读取 | 不重复调用同页收费 |

继续薄 HTTP adapter，只有明确必要时引入 SDK。开发模式可保留 AnySearch 匿名；生产模式必须有服务账号、采购确认、定价、quota/rate limit、权限/数据政策及项目评测。未配置默认不启用，不能用 isSearchConfigured() 恒真证明准备完成。

候选先比较 Parallel Search/Extract 和 Exa Search/Contents，结果达标才配置主备；不在代码里把尚未验证候选写成生产承诺。AnySearch 生产资格需同等证据。Firecrawl 动态页等单独后续立项。

### 2. 类型与 DTO

```ts
type SearchRequest = {
  query: string;
  locale: 'zh-CN' | 'en'; // 实现时 import Locale
  maxResults: number;
  freshness: 'default' | 'latest';
};
type FetchRequest = { url: string; maxChars: number; cursor?: string };
type ProviderUsage = {
  unit: 'request' | 'page' | 'credit' | 'retrieval' | 'task_run';
  quantity: number;
  evidence: 'reported' | 'estimated' | 'unknown';
  providerRequestId?: string;
};
type SearchResult = { title: string; url: string; snippet: string; publishedAt?: string };
type SearchResponse = { results: SearchResult[]; usage: ProviderUsage[] };
type FetchResponse = {
  url: string;
  text: string;
  hasMore: boolean;
  cursor?: string;
  usage: ProviderUsage[];
};
type SearchExecutionContext = {
  generationId: string;
  operationId: string;
  requestId: string;
  traceId: string;
  mode: 'fetch' | 'search' | 'research';
  reservationId: string;
  effectiveDeadlineAt: number;
  policyVersion: string;
  signal: AbortSignal;
};
type ProviderErrorCategory = 'invalid_input' | 'policy_blocked' | 'misconfigured'
  | 'auth_failed' | 'capacity_limited' | 'transient' | 'unusable' | 'permanent_provider_error';
type AttemptResult<T> =
  | { ok: true; data: T; attemptId: string; usage: ProviderUsage[] }
  | { ok: false; category: ProviderErrorCategory; attemptId: string; usage: ProviderUsage[] };
interface SearchProviderAdapter {
  id: string;
  search(input: SearchRequest, context: SearchExecutionContext): Promise<AttemptResult<SearchResponse>>;
}
interface FetchProviderAdapter {
  id: string;
  fetch(input: FetchRequest, context: SearchExecutionContext): Promise<AttemptResult<FetchResponse>>;
}
```

实际顶层 tool 结果适配到当前 results/readUrl schema，不为上述内部 usage 扩展客户端历史结构。上下文合并现有 ObservabilityContext，不造第二套 trace。失败也可以有 usage；捕获网络异常仍产生 unknown/estimated attempt。若接口层与 data 都有 usage，只保留一个计量入口，不能重复记账。Zod 验证工具输入与 provider 输出上限，不把任意 provider/key/mode 参数暴露给模型。

### 3. 错误、取消与 deadline

invalid_input/policy_blocked 立即停止，不 fallback。misconfigured/auth_failed 停用该候选并告警，不重试认证错误。capacity_limited 可换备用；transient 在总预算内最多一次带抖动重试，尊重 Retry-After；unusable 允许按 operation fallback。备用失败不回到主服务形成循环。

Generation 启动时统一生成 effectiveDeadlineAt，工具、模型循环、lease、drain 和错误提示消费同一有效边界。审计现有研究 15 分钟与 Generation 5 分钟配置：不能只改 research 常量、留下更短上层取消。单 attempt 超时不延长整轮 deadline；收尾时间和费用预先保留。

明确用户 Stop/安全取消向模型与所有 tool 传播。浏览器断连/刷新不等于用户取消，沿用已有服务端 Generation 运行与轮询恢复，不能把请求 socket AbortSignal 直接当作业务取消。

### 4. 账务、容量与数据

Billing 是金额事实源，Search 输出原始 ProviderUsage 和 price snapshot 关联。原单位 retrieval/task_run 不能静默映射成普通 request；当启用此类 provider 时扩展 billing 受支持单位并验证，Beta 候选未使用的单位不启用。

每次真实付费请求有独立 attemptId，同一逻辑工具有 operationId；batch 按真实 query/page/credit 计量，失败及备用也保留成本。缓存/同快照续读不生成新 provider attempt，不向用户伪报又搜索一次。给 LLM 的内容预算与 provider 计费单位分开。

四层控制：attempt 安全与时间 → Generation 已预占成本/步骤 → 用户账户/并发 → provider account 日/月金额及 QPS。跨实例预算复用 billing 的锁定预算桶；search_provider_usage_daily 只保留派生运营汇总，不成为另一套硬扣费/金额真相。单实例 semaphore/circuit breaker 只是局部保护；严格账户 QPS 采用共享数据库短窗口/租约限流，不能用两台机器各自配满额度。

预算和供应商真实余额不同：记录 asOf、估算/报告来源与同步失败，不虚构实时剩余额度。达到全球预算时停止新受理，已预占任务保留空间；provider 自行断供作为外部故障明确收尾。禁止账户/key 轮换规避上游限制。

### 5. 去重、快照、安全与隐私

请求内 query/URL + operation + locale + freshness + policyVersion 去重；公开短期缓存只是优化，命中不是功能前提。最新事实绕过过期缓存。不随意删除有语义的 query 参数以免把不同页面误并。

多实例下 readUrl cursor 必须绑定 owner/generation/snapshot/expiry 并可校验。需要跨请求续读的正文快照存现有共享存储或数据库 TTL 记录，不能只存第一台机器内存；跨用户不可读取。缓存文本不进入成本账或普通日志，过期清理有上限。

URL 只允许 http/https，拒绝明文凭据、localhost、环回/私网/链路本地/保留地址。每次 redirect 重校验；自有 fetch 需防 DNS 重绑定并固定已验证解析目标，第三方抓取需选择能落实 redirect/目标约束的接口，否则不提供该路径。限制内容类型、字节量、解析文本、重定向次数与超时。网页作为不可信证据，不能改系统指令或泄漏密钥。

### 6. UI、观测与采购

保留已有联网活动/来源组件，不加 provider 专属卡。无证据时说明无法核实，不把搜索失败说成目标不存在；有足够其他证据时正常回答，不输出内部预算流水。后台每 attempt 记录 provider/operation/routeReason/outcome/duration/usage/estimate/generationId/traceId/release；成本进入自有数据库，日志进 Axiom，调用进 Langfuse，未经许可不把 query/URL/正文进入普通 analytics。

采购清单每个候选记录：官方价格/合同链接及核查时间、Search/Extract 单位、每请求结果/页面条件、数据用途和保留、账户总 QPS、预付/后付、低余额通知、提额方式、备用演练结果。未核验项保持 unavailable。成本预算用“用户×轮次×联网占比×search/fetch 次数×原单位价格”计算，附失败/备用余量；不把之前估算当真实账单。

### 7. 评测与阈值

复用 evals/agent manifest/production executor，不新建 runner。覆盖中英文技术/通用/最新事实、直接 URL、长文续读、answer 不误联网、空结果/429/timeout/SSRF、双实例预算和快照。固定同题比较质量、引用支持、正文可用率、p50/p95、任务成功率、总成本与计量覆盖；HTTP 200 不等于质量通过。

新 provider 在合约测试、故障测试、实际额度验证、live case 和备用演练完成前保持非生产；没有达到预先写明阈值时不自动按榜单切换。评测集与候选配置冻结版本，成本/时效波动单独标注。

## Migration Plan

先固化 AnySearch demo 测试；将 adapter/registry/attempt 收口但开发行为保留。再接入 billing 计量和共享预算，新增付费候选但 flag 关闭，测试后按小批次放量。只在 develop 集成生成迁移；本 PR 不改 drizzle。回滚切回上一套已核验付费策略或关闭新联网请求，不能自动回退到生产匿名无限假设。历史 UIMessage 不迁移供应商结构。

## Risks / Trade-offs

预占和 QPS 数据库写入存在热点，先短事务和容量测试再考虑 Redis；不能用异步聚合替代硬预算。备用增加费用和时延，故限定两个候选。共享正文有隐私成本，因此最短必要 TTL、权限校验和清理为验收项。

## Open Questions

主/备供应商、账户实际价格/限额、模式预算、TTL、熔断阈值和默认开关需同题评测及采购证据。参数未确认时保持对应生产功能关闭；本方案不授权采购，也不证明已得到 SLA。
