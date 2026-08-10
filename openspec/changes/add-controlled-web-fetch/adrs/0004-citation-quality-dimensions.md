# ADR-0004：分维度评估引用质量

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D6；`grounded-web-citations` spec

## Context

ALCE 说明“生成了 citation”并不代表引用完整或正确。一个 URL 可能确实被检索过，却与附近事实无关；tag 也可能全部堆在文末，与具体主张脱节。

## Decision

对 GLM-5.2 分别评估：

- Validity：sourceId 是否来自本消息 ledger。
- Placement：tag 是否贴近被支撑的最小内容。
- Correctness：来源是否支持附近主张。
- Completeness：重要外部事实是否都有来源。

Validity/持久化/安全 link 属性做确定性测试；placement/correctness/completeness 用固定集和抽样人工评审。

## Alternatives

- 只统计引用数量：弃选，鼓励过度标注。
- 只检查 URL 在 ledger：不足以发现无关引用。
- 使用第二个 LLM 实时审核每个回答：MVP 弃选，增加延迟、费用且审核模型也会出错。

## Consequences / Review triggers

发布报告必须展示分项，不合成一个掩盖问题的总分。若自动 claim-support verifier 成熟，可作为离线辅助，不能直接替代抽样复核。
