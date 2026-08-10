# ADR-0002：MVP 只做有硬预算的轻量 Search

- Status: Accepted
- Date: 2026-08-03
- Related: design D3–D5；`proactive-web-search` spec

## Context

当前 Deep Research 最多 12 个模型 step，但同一步可并行多个工具调用，step 限制不是 provider-call 限制。真实实测产生 3 次 GLM + 3 次 Advanced Search，共 6 个上游请求，成本与延迟不适合默认开启。

## Decision

MVP 仅暴露轻量 Search：Tavily Basic、最多 3 个结果、关闭 provider answer、限制 snippet；请求内预算在 provider call 前占用，最多 2 次 Search，目标均值 1–1.5。Fetch、任意 URL、浏览器和既有 Deep Research 不进入默认路径。

## Alternatives

- 直接复用 Deep Research：弃选，成本和语义都过重。
- 只用 `isStepCount`：弃选，无法阻止同一步并行调用。
- MVP 同时实现 Search + Fetch + Browser：弃选，验证面和攻击面过大。

## Consequences / Review triggers

部分复杂问题只能给搜索快照级答案；第二批通过 `readSource` 补足。若 2 次 Search 仍经常不足，先评估查询质量，不直接提高上限。
