# ADR-0003：公共 Retrieval 缓存与 Postgres 配额

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D4/D5；`web-retrieval-operations` spec

## Context

重复公共文档查询适合缓存，但 query 可能包含 secrets/PII/private URL。请求内计数也不能约束并发 Function 实例的总花费。

## Decision

缓存仅存 normalized public search/content，以 provider/version/options/locale/freshness 为 key，使用短 TTL 与 in-flight coalescing；敏感查询 bypass。Cache hit 不伪装成 provider call。共享 quota/cost reservation 使用 Postgres 原子窗口，覆盖用户、会话、时间窗和全局；请求内 hard cap 保留。

## Alternatives

- 缓存所有 query：弃选，隐私和串数据风险。
- 只用进程内限流：弃选，跨实例无效。
- 引入独立 Redis：MVP 后的本 change 仍先复用现有 Postgres；只有 DB 压力数据证明必要时再 ADR。

## Consequences / Review triggers

增加 DB admission 延迟和 cache invalidation 复杂度。current/latest 查询需更短 TTL 或 bypass；provider 条款变化时复审内容缓存。

