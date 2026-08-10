# ADR Index：主动 Web Search

这些 ADR 已随本 change 的实施批准标记为 `Accepted`。若设计改变，应新增 ADR supersede 旧记录，不直接抹去历史理由。

| ADR | 决策 |
|---|---|
| [0001](0001-default-auto-search.md) | 默认 `auto`，用户可 `always/off`，日期和政策由服务端所有 |
| [0002](0002-search-only-bounded-mvp.md) | MVP 只做有硬预算的轻量 Search |
| [0003](0003-tavily-baseline-provider.md) | 复用 Tavily 作基线，不承诺永久 provider |
| [0004](0004-meter-external-usage.md) | Search/Fetch/Browser 外部调用独立计量和收费 |
| [0005](0005-glm52-evaluation-gate.md) | GLM-5.2 通过固定质量/成本 gate 后灰度 |
| [0006](0006-server-force-always-and-serialize-search.md) | 实测后改为服务端确定性执行 always，并限制同一步最多一次搜索 |
| [0007](0007-enforce-source-url-provenance.md) | 服务端限制可点击来源 URL，并把来源有效性与答案正确性分开验收 |
| [0008](0008-aggregate-search-activity.md) | 按消息显示最终聚合状态，不暴露冗余 tool call 失败 |
| [0009](0009-anchor-aggregate-activity-to-stream-order.md) | 聚合卡按真实 SSE 顺序插入，替代固定放在正文之后 |
| [0010](0010-nonproduction-high-search-budget.md) | 仅非生产可显式提高 serial search 上限以评测 GLM-5.2 |
| [0011](0011-compact-and-deduplicate-source-ui.md) | 来源使用短名胶囊，并仅在无可信引用时追加 fallback footer |
| [0012](0012-persist-terminal-search-activity.md) | 终态搜索聚合卡及其流位置随消息持久化，进行中状态仍剥离 |
