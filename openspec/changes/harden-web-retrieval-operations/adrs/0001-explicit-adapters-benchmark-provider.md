# ADR-0001：显式 Provider Adapter 与基准晋升

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D1/D2；`web-retrieval-operations` spec

## Context

当前实现只是 Tavily schema + 可变 base URL。Marketplace discovery 首位是 Exa，Exa 官方支持 Search/Contents 和成本字段，但没有项目内质量对比。

## Decision

为 Search/Extract 定义 server-only normalized adapter，vendor wire format 留在 adapter 内；用 capability flags 表达差异。候选 provider 必须在同一 GLM-5.2 编程集上比较 relevance、primary sources、freshness、citation support、latency、errors 和 cost，再通过 flag 灰度晋升；保留 rollback provider。

## Alternatives

- 根据 Marketplace 排名直接选：弃选，排名不是项目质量证据。
- 继续用可变 base URL：弃选，schema/鉴权/计费不兼容。
- 默认每次双 provider：弃选，费用和延迟翻倍。

## Consequences / Review triggers

Adapter 不能把 vendor 所有能力压成最低公分母。Marketplace、价格或目标问题集变化时重跑 bake-off。

