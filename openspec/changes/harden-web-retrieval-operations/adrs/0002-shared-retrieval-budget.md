# ADR-0002：Retrieval Retry/Fallback 共享预算

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D3；`web-retrieval-operations` spec

## Context

Search、Extract、retry、fallback 若各自拥有局部上限，provider 故障时会突破用户看到的费用和时延上限。同一步并行调用也可能绕过 model-step 限制。

## Decision

每个 response 创建共同 deadline、request units 与 maximum-price budget。所有 primary/retry/fallback/search/extract 在发请求前 reserve；retry 最多一次且只针对可重试错误；fallback 只在 primary 分类故障且剩余预算足够时执行，不默认并发。

## Alternatives

- 各 adapter 自己 retry：弃选，全局不可见。
- 不 retry/fallback：可靠性不足，但可作为紧急 kill-switch 行为。
- hedged concurrent requests：默认弃选，除非未来数据证明尾延迟收益大于成本。

## Consequences / Review triggers

预算对象必须与外部 usage ledger 同一关联 ID。任何优化不得提高已声明的用户最高价。

