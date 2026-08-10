# ADR-0003：Tavily 作为验证基线而非永久 provider

- Status: Accepted
- Date: 2026-08-03
- Related: design D3/D8；`harden-web-retrieval-operations`

## Context

项目已经配置 Tavily 并有 `/search`、`/extract` 代码，最快能验证价值。Vercel Marketplace 2026-08-03 的 `searching` discovery 首位是 Exa；Exa 官方 API 同时提供 Search/Contents 与 cost metadata。但当前项目没有同集对比数据。

## Decision

第一批复用 Tavily，显式承认实现是 Tavily adapter，不宣称只改 base URL 就 provider-neutral。第三批使用固定编程评测集比较 Tavily、Exa 等候选后才能切换主 provider 或配置 fallback。

## Alternatives

- MVP 先换 Exa：弃选，会把 provider 迁移与产品价值验证混在一起。
- 一开始做通用多 provider 抽象：弃选，容易产生最低公分母和未验证复杂度。
- 永久锁定 Tavily：弃选，缺乏质量/成本/可用性数据。

## Consequences / Review triggers

MVP 的接口可以偏 Tavily，但 normalized tool output 不得泄漏 vendor wire format。积累真实指标后必须执行第三批 bake-off。
