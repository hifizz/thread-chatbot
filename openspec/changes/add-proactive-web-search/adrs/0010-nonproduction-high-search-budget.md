# ADR-0010：只在非生产环境提高搜索预算以评测 GLM-5.2

- Status: Accepted
- Date: 2026-08-10
- Related: design D4；`proactive-web-search` spec；GLM-5.2 评测

## Context

生产 MVP 将每轮 provider 搜索硬限制为 2 次，以控制成本、延迟与异常循环。但这一约束也会掩盖 GLM-5.2 在 `auto` 模式下自然决定检索、细化查询与停止的行为，无法用于评估较宽松的工具循环效果。

仅提高请求预算仍不足：Thread Chat 原有 5 个工具 step 会使实际串行搜索至多发生 5 次，而且最后一次搜索后不一定有机会生成基于证据的回答。

## Decision

- 增加仅非生产环境读取的 `AUTO_WEB_SEARCH_TEST_MAX_CALLS`；必须显式设置，允许值限制为 2–10。
- 测试环境将 tool-loop step 数设为 `max(5, 搜索次数 + 1)`，最高 11，为最后一个 tool result 后的自然回答保留一个 step。
- 每个 step 仍最多启动一次 provider 请求；`always` 保持服务端预搜一次，不因测试覆盖获得额外调用。
- 生产环境无条件忽略此变量，继续使用每轮最多 2 次搜索与 5 个 step 的发布边界。

## Consequences

该开关适合短时间、受监控的 GLM-5.2 内部评测，最大仅搜索侧理论成本为 10 个 Tavily Basic credits（按 PAYG 上限约 $0.08），不适合生产灰度。测试结束后应移除本地环境变量或恢复为 2，再记录调用分布、质量、延迟和成本。
