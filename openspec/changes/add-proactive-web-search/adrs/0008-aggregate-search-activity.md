# ADR-0008：以消息最终状态聚合 Web Search 活动

- Status: Accepted
- Date: 2026-08-05
- Related: design D6；`web-search-transparency` spec；GLM-5.2 手动 UI 验证

## Context

实际 GLM-5.2 流式对话会在同一 assistant 消息中发出多个 `webSearch` tool call：首次或后续调用可能成功，之后还可能产生预算拒绝或无效参数。原始 MVP UI 将每个 call 按内部 `toolCallId` 单独渲染，导致用户同时看到“已查到 3 个信息源”“联网搜索未完成”“已达到上限”。这把模型内部的纠错与预算控制泄露成了相互矛盾的产品状态。

当搜索预算耗尽时，如果彻底移除工具 schema，GLM-5.2 仍可能输出 `webSearch`，AI SDK 会产生 `AI_NoSuchToolError` 并中断流。该调用没有访问 provider，却不应成为用户可见失败。

## Decision

- UI 按 assistant 消息聚合 Web Search 活动，只显示一张最终状态卡，而不显示每个内部 tool call。
- 只要本消息至少有一个成功的规范化来源，最终状态为成功；预算拒绝、无效参数和其它冗余调用不显示为用户可见失败。来源按 URL 去重，查询和耗时聚合。
- 只有没有任何成功来源时才展示单一失败状态。原始 call 继续在服务端外部用量流水和当前页临时态中保留，供计费、审计和调试使用。
- 展示位置保持 assistant 正文之后，表示本条回答最终使用的联网状态，而非试图复刻内部 token/tool chunk 的首位顺序。
- 一旦本轮已出现 `webSearch`，后续 step 保留其 schema；额度耗尽时工具返回结构化 `budget_exhausted` 而非发起 provider 请求或抛 `NoSuchToolError`。`off` 模式仍绝不暴露该工具。

## Consequences / Review triggers

用户看到的是稳定、可解释的消息级结果，代价是不会看到每个被拒绝的内部 tool call。若未来需要高级调试视图，应单独提供仅内部可见的 trace，不应改变默认聊天 UI。后续若引入结构化 message parts，可把聚合卡持久化为受控摘要；本 MVP 仍保持其为 transient state。
