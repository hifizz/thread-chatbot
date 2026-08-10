# ADR-0001：默认主动 Auto Search

- Status: Accepted
- Date: 2026-08-03
- Related: design D1/D2；`proactive-web-search` spec

## Context

OpenAI、Claude、Gemini 均让模型在工具可用时决定是否搜索；Self-RAG 也指出无差别固定检索可能降低回答质量。GLM-5.2 小样本测试能区分版本敏感问题与稳定概念，但缺少当前日期会生成旧年份查询。

## Decision

Thread Chat 新会话默认 `auto`，GLM-5.2 用 `toolChoice:auto` 主动判断；用户可用 `always` 强制首步搜索或用 `off` 禁用。当前日期、搜索政策、来源优先级和不可信结果规则由服务端 system prompt 注入，客户端不得覆盖。

## Alternatives

- 所有问题强制搜索：弃选，费用/延迟高且可能引入无关证据。
- 完全由用户手动打开：弃选，无法实现“像 Claude 一样主动核验”的产品目标。
- 增加独立分类模型：MVP 弃选，增加一次请求、费用和故障点；只有路由评测不达标时复审。

## Consequences / Review triggers

需要用户开关、路由评测和误触发监控。若 must-search recall 或 no-search precision 低于 gate，复审 prompt、工具描述或独立分类器。
