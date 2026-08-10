# ADR-0005：GLM-5.2 评测 gate 与渐进式发布

- Status: Accepted
- Date: 2026-08-03
- Related: design D8；`web-search-metering` spec

## Context

小样本 A/B 显示 GLM-5.2 能调用工具，但样本不足以证明生产稳定性。Search 会同时改变正确率、引用、延迟、请求数与费用，不能只看最终文本是否“像是更好”。

## Decision

GLM-5.2 是 MVP 必过模型：至少 60 条中英路由样例和 20 条真实版本敏感编程问题；分别记录 must-search/no-search、来源有效性、回答质量、调用上限、p50/p95 延迟和成本。先内部 flag，再按比例灰度，任何硬 cap/安全 gate 失败都阻止发布。

## Alternatives

- 只做人工 spot check：弃选，不可重复。
- 所有模型同时作为 blocker：MVP 弃选，违背重点跑通 GLM-5.2 的目标。
- 直接全量发布后看投诉：弃选，可能产生不可控费用和错误引用。

## Consequences / Review triggers

需要版本化 dataset、prompt hash、模型 upstream ID 和评测报告。模型、prompt 或工具 schema 改动时重跑对应 gate。
