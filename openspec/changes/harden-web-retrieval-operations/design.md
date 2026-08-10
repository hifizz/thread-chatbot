## Context

The first two changes intentionally use Tavily-specific endpoints to validate product value quickly. `SEARCH_BASE_URL` does not make the current parser provider-neutral: request and response fields remain Tavily-shaped. Production traffic adds different concerns—provider incidents and quality drift, repeated identical queries, concurrent budget races across Fluid Compute instances, cost spikes, sensitive query retention, and regressions when GLM-5.2, prompts or upstream search ranking changes.

This change starts only after search/fetch telemetry demonstrates enough usage and answer improvement to justify an operations layer. Marketplace discovery previously surfaced Exa as the leading search candidate and Browserbase for automation, but provider selection must be rerun with the then-current Vercel CLI and judged by this project's programming benchmark, not catalog position alone.

## Research / ADR Index

- Marketplace/provider/缓存/配额/观测调研：[research/README.md](research/README.md)
- 架构决策记录：[adrs/README.md](adrs/README.md)
- Marketplace 快照只代表 2026-08-03 的 discovery 结果，apply 时必须重新获取。

## Goals / Non-Goals

**Goals:**

- Define an explicit normalized search/extract adapter contract and select providers with evidence.
- Keep latency and cost bounded during provider failure, retries, concurrency and abuse.
- Reduce safe duplicate work with privacy-aware caching and request coalescing.
- Make quality, citation, latency, availability and cost regressions observable and reversible.
- Establish GLM-5.2 release gates for model, prompt, provider and budget changes.

**Non-Goals:**

- No browser automation; it remains a separate optional change.
- No simultaneous fan-out to multiple providers for every user query.
- No vector database or persistent RAG corpus.
- No automatic provider switch based only on marketing claims or Marketplace rank.

## Decisions

### D1. Normalize capabilities, not vendor wire formats

Define server-only adapters for `search` and `extract` that return common result, error and billing metadata. Provider-specific request options and response parsing stay inside each adapter; the model tools receive only normalized sources. Capability flags indicate whether an adapter supports extract, domain filters, freshness or billing units.

This replaces the misleading “change base URL” abstraction. It does not try to find a lowest-common-denominator SDK for every provider. Tavily remains the baseline adapter; Exa or another Marketplace integration is added only after provisioning and benchmark validation.

### D2. Provider choice follows a recorded bake-off

Use the fixed programming set plus sampled production queries stripped of user identity. Compare relevance, primary-source rate, freshness, citation support, p50/p95 latency, errors and normalized cost. A candidate becomes primary only if it meets quality gates without violating cost/latency budgets. The previous primary remains a rollback target.

Do not run dual-provider queries in normal traffic. Shadow or A/B runs use explicit small cohorts and their extra cost is tagged as experiment spend, not silently charged to users unless disclosed.

### D3. Retry and fallback share one response budget

Each response owns an external request/credit/deadline budget inherited by search, extract, retry and fallback. At most one retry is allowed for retryable transport/429/5xx errors when remaining deadline and budget permit. Optional fallback can occur only after a primary failure, never merely because results are low-confidence, and cannot exceed the original user-visible max charge. Non-retryable validation/auth/quota errors fail fast.

A circuit breaker uses rolling provider health to stop sending normal traffic during sustained failure. The feature flag can disable a provider or all retrieval immediately. No retry/fallback path may bypass the request-local hard call caps defined in prior changes.

### D4. Cache only normalized public retrieval data

Use a short TTL server-side cache keyed by provider/version, operation, normalized query or canonical public URL, search options and locale. Identical in-flight requests are coalesced. Cache values contain normalized public results/content, never user IDs, conversation context, auth headers or provider secrets.

Queries detected as containing secrets, personal identifiers, private URLs or user-marked sensitive content bypass cache. Cache hits are recorded, do not incur provider cost, and are either free to users or priced by an explicit policy—never charged as a provider call. Provider terms and freshness requirements set TTL ceilings; current/latest queries use shorter TTL or bypass.

### D5. Distributed quotas live in Postgres, hard response caps remain local

Request-local counters stop a single model loop immediately. Postgres-backed atomic windows add per-user, per-minute/day, per-conversation and global spend limits that work across reused and concurrent Function instances. The admission check includes reserved external cost so simultaneous requests cannot all pass against the same remaining allowance.

Rate-limit rejection occurs before provider access and returns a structured status the UI can explain. Admin emergency caps can reduce or disable retrieval without deployment.

### D6. Observability is event-based with privacy-minimized payloads

Every external operation emits a correlated event with response/tool call IDs, provider/adapter version, mode, status/error class, cache/fallback/retry flags, latency, billable units, result count, source-domain categories and costs. Full query/page text is not in default logs; use salted fingerprints and bounded redacted samples only under documented access and retention.

Dashboards track search trigger rate, calls per response, zero-result rate, primary-source ratio, citation validity/completeness samples, p50/p95 latency, provider errors, circuit state, cache hit rate, cost per searched answer and user feedback. Alerts couple availability and spend so a “successful but expensive” regression is visible.

### D7. Evals are versioned release artifacts

Store dataset version, model ID (`glm-5.2` required), prompt hash, tool schema version, provider adapter/version, budget config and results for each run. Deterministic tests cover policy, URL filtering, budgets, metering and citations; live runs measure search quality; sampled human review covers source support and answer usefulness.

Any change to GLM-5.2 endpoint/model version, system prompt, tool description/schema, provider, ranking parameters, cache policy or budgets runs the relevant regression suite. Rollout requires no safety/cap regression, no statistically meaningful quality drop, and cost/latency within declared thresholds.

## Risks / Trade-offs

- **[Abstraction hides useful provider features]** → keep capability flags and vendor logic inside adapters instead of forcing identical options.
- **[Fallback doubles cost during outages]** → one shared budget, single retry, fallback only on classified failure and never concurrent by default.
- **[Cache serves stale current facts]** → short/bypassed TTL for freshness queries, provider/version in key, visible retrieval timestamp.
- **[Cache leaks sensitive queries]** → public normalized data only, sensitivity bypass, no user context in keys/values, documented retention.
- **[Distributed limiter adds DB latency]** → retain local hard caps, use compact atomic counters and only reserve at provider admission points.
- **[Metrics look healthy while citations are poor]** → keep citation validity/correctness/completeness and user usefulness separate from availability.

## Migration Plan

1. Upgrade the Vercel CLI to the current release, rerun Marketplace discovery and provision the candidate integration with user authorization; pull environment variables without printing secrets.
2. Introduce the adapter contract behind the existing Tavily path and prove byte-for-byte normalized behavior with fixtures.
3. Add event schema/dashboards and distributed quota checks before adding another provider.
4. Run offline/live bake-off; enable candidate only in shadow or small A/B cohort, tagging experiment cost.
5. Add conservative cache/coalescing, then retry/fallback/circuit breaker with fault-injection tests.
6. Promote a primary only after gates pass. Rollback flips provider/feature flags and leaves the normalized model/UI contract unchanged.

## Open Questions

- Provider promotion thresholds should be filled with baseline p50/p95 and relevance data collected from the first two changes; inventing absolute numbers now would create false precision.
- Whether cache hits are free or carry a small platform fee is a product pricing decision, but the implementation must distinguish them from billable provider calls.
