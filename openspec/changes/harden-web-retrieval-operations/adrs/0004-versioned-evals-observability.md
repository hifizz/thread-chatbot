# ADR-0004：版本化 Evals、观测与最小留存

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D6/D7；`web-retrieval-evaluation` spec

## Context

Search ranking、模型、prompt、工具 schema、provider 和成本都会漂移。仅看 HTTP success 无法发现来源低质、引用错误或费用上涨；记录完整 query/page 又会扩大隐私风险。

## Decision

每次 eval 记录 dataset/model upstream ID/prompt hash/tool schema/adapter/parameters/budgets。生产事件记录关联 ID、状态、时延、units、cost、source category、cache/retry/fallback，但默认不记完整 query/page；使用 salted fingerprint 与受控 redacted sample。发布 gate 同时覆盖安全、质量、延迟、可靠性和成本。

## Alternatives

- 只看 provider dashboard：弃选，无法关联回答/引用和用户收费。
- 全量保存 query/page 便于调试：弃选，违反最小化原则。
- 只做离线 eval：弃选，无法检测线上 ranking/cost drift。

## Consequences / Review triggers

需要明确保留期、访问权限和删除流程。若调试信息不足，先增加受控采样，不默认扩大内容留存。
