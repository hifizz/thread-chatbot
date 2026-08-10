# ADR-0009：将聚合搜索状态锚定到真实流顺序

- Status: Accepted
- Date: 2026-08-05
- Supersedes: ADR-0008 中“卡片保持在正文之后”的展示位置决定
- Related: design D6；`web-search-transparency` spec；Thread Chat SSE 消费器

## Context

ADR-0008 正确地决定了内部多次 tool call 应聚合为一张消息级状态卡，但将卡片固定在正文之后。用户指出这仍不符合实际对话顺序：搜索可能发生在生成前、生成中或生成后，位置不应由 UI 预设。

Thread Chat 将文本 delta 合帧以降低重渲染。若工具事件到达时不先 flush 缓冲文本，记录的位置也会落后于真实 SSE 顺序。

## Decision

- 第一个 `webSearch` 生命周期事件到达时，客户端先 flush 已缓冲的文本，再记录该 assistant 消息已输出文本的字符 offset。
- 一张消息级聚合卡插入这个 offset；后续内部 tool call 只更新同一张卡，不能改变其位置。
- 因此搜索发生在开头时卡片在正文前，发生在中途时位于前后文本之间，发生在末尾时位于正文后。位置由真实流事件决定，不能硬编码为首位或尾部。
- 默认 UI 继续隐藏预算、无效参数及单次失败原因。开发构建可显示灰色小字的内部调用总数与有效结果批次数，用于低成本调试，但不暴露失败详情。
- offset 是 transient state，与活动数据一同在持久化和 reload 时剥离。

## Consequences / Review triggers

Markdown 可能在流中被工具边界切分；MVP 以两个独立渲染片段保持事件顺序，并在有分段时暂不绘制跨整条消息的文本锚点。若未来需要在复杂 Markdown 中保留精确跨片段锚点，应把消息改为持久化的结构化 content parts，而不是继续依赖字符 offset。
