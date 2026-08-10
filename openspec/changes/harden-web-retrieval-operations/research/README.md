# Research：Provider、缓存、配额与生产运营

- 调研日期：2026-08-03
- 前置：主动 Search 与受控 Fetch 已产生真实流量数据
- 性质：非规范性证据记录；provider 排名和价格会变化，apply 时必须复查

## 1. Marketplace Discovery 快照

使用本机 Vercel CLI 58.4.0 执行只读命令：

```bash
vercel integration discover --category searching --format=json
vercel integration discover --category agents --format=json
vercel integration discover --category web-automation --format=json
```

2026-08-03 返回顺序：

- `searching`：Exa Search API、Algolia、Parallel、Mixedbread…
- `agents`：Exa Search API、Browserbase、AgentMail、AssistLoop…；Parallel、Kernel、Firecrawl 也在列表。
- `web-automation`：Browserbase、Kernel、Firecrawl。

此次只 discovery，没有安装或开通 integration。CLI 同时提示 58.4.0 已落后 58.4.4；实施时要升级到当时最新版本再 discovery，当前排序不能永久写死。

## 2. Provider 官方能力

### 2.1 Tavily 基线

- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search) 支持显式 `search_depth=basic`、`max_results`、`include_answer=false`、domain filters 和 usage metadata。
- 官方说明自动参数可能把 search depth 提升到 advanced 并消耗 2 credits；若要避免额外成本，应显式指定 basic。
- [Tavily Pricing](https://docs.tavily.com/documentation/api-credits) 提供清晰的 Search/Extract credit 口径。

### 2.2 Exa 候选

- [Exa Search](https://exa.ai/docs/reference/search) 可同时返回结果与 text/highlights，支持 include/exclude domains、发布日期、fast/instant/auto/deep 等模式，并返回 costDollars 元数据。
- [Exa Contents](https://exa.ai/docs/reference/get-contents) 可按 URL 读取 text/highlights/summary，返回每 URL status 和成本信息。

**结论**：Exa 功能契合搜索与正文读取，且 Marketplace 排名靠前，但这不是切换依据；必须用本项目的 GLM-5.2 编程问题比较 source quality、primary-source rate、时延和真实成本。

## 3. 当前项目为何需要显式 Adapter

`lib/ai/search.ts` 虽允许 `SEARCH_BASE_URL`，请求字段和响应解析仍是 Tavily：`search_depth`、`include_answer`、`results[].content`、`raw_content`。这不是 provider-neutral contract。

如果直接把 Exa URL 填进 `SEARCH_BASE_URL`：

- 鉴权 header 不同。
- request/response schema 不同。
- Search 与 Contents 的能力/计费 metadata 不同。
- 错误分类和 usage 口径不同。

**结论**：Adapter 应规范化 tool 需要的结果、错误和 billing metadata，同时保留 capability flags；不做“所有 vendor option 都相同”的假抽象。

## 4. Retry、Fallback 和预算

第一批已经证明模型 step 数不等于 provider calls。加入 provider retry/fallback 后，如果每层各自有上限，故障时费用会成倍放大。

需要一个 response-scoped budget 同时覆盖：

```text
Search + Extract + primary attempt + retry + fallback
          ↓
共同 deadline / request units / maximum price
```

Retry 只针对短暂 transport/429/5xx，最多一次且要有剩余预算；validation/auth/quota fail fast。Fallback 只处理分类故障，不因“结果看起来一般”就默认双查。Shadow/A-B 费用属于实验成本，不能静默计入用户账单。

## 5. 缓存与隐私

Web Search 查询可能含用户代码、错误信息、内部 URL、token 或个人数据。缓存若直接使用完整 query：

- cache key/log 可能泄密；
- 不同用户的私密上下文可能串用；
- “latest/current” 查询可能得到过期结果。

**结论**：只缓存 normalized public retrieval data；key 含 provider/version/options/locale/freshness；secret/PII/private URL/用户敏感标记 bypass；current 查询短 TTL 或 bypass；cache hit 与 provider billable call 分开计量。

## 6. 分布式配额

Vercel Fluid Compute 会复用并并发处理实例，但请求内内存计数无法约束多个实例/请求合计费用。项目已有 Postgres 与微元余额，因此共享配额和成本预留应使用原子数据库状态；请求内 hard cap 仍作为最快第一道限制。

需要覆盖：user/conversation/time-window/global、并发 reserve/settle/release、管理员紧急降额。拒绝必须发生在 provider call 之前。

## 7. 可观测和评测

“HTTP 200”不能代表成功：provider 可能返回低质来源、引用可能不支撑结论、成本可能上涨。生产 dashboard 必须分开观察：

- 触发率、calls/response、zero-result、primary-source ratio。
- citation validity/placement/correctness/completeness 抽样。
- p50/p95 latency、error class、retry/fallback/circuit。
- cache hit、provider cost、user price、cost per grounded answer。
- dataset/model/prompt/tool/adapter/budget 版本。

## 8. 决策追踪

| Research 结论 | ADR | Spec |
|---|---|---|
| Provider 选择必须 adapter + bake-off | [ADR-0001](../adrs/0001-explicit-adapters-benchmark-provider.md) | `web-retrieval-operations` |
| Retry/fallback 共享预算 | [ADR-0002](../adrs/0002-shared-retrieval-budget.md) | `web-retrieval-operations` |
| 只缓存公共标准化数据 | [ADR-0003](../adrs/0003-public-data-cache-distributed-quotas.md) | `web-retrieval-operations` |
| 评测与隐私是发布契约 | [ADR-0004](../adrs/0004-versioned-evals-observability.md) | `web-retrieval-evaluation` |

## 9. 资料清单

- [Vercel Marketplace](https://vercel.com/marketplace)
- [Vercel Integrations Docs](https://vercel.com/docs/integrations)
- [Exa Search](https://exa.ai/docs/reference/search)
- [Exa Contents](https://exa.ai/docs/reference/get-contents)
- [Tavily Search API](https://docs.tavily.com/documentation/api-reference/endpoint/search)
- [Tavily Credits & Pricing](https://docs.tavily.com/documentation/api-credits)
- 当前仓库：`lib/ai/search.ts`、`lib/chat/research-tools.ts`、`lib/billing/credits.ts`

