# ADR-0011：来源使用短名胶囊并消除重复 footer

- Status: Accepted
- Date: 2026-08-11
- Supersedes: ADR-0007 中“无条件追加末尾信息源标签”的展示决定
- Related: design D6；`web-search-transparency` spec；Thread Chat Markdown renderer

## Context

真实 GLM-5.2 回答可能自行生成内联“来源”链接或末尾“参考来源”列表。ADR-0007 又要求服务端无条件追加一行 `信息源`，导致同一 URL 在答案末尾出现两次。页面标题直接作为链接文案也可能很长，例如 `IBM Think — What Is Loop Engineering?`，在正文和活动卡中都造成噪声或横向溢出。

## Decision

- 继续由服务端 URL allowlist 决定哪些链接可信，但在流中记录是否已有至少一个可信 URL。
- 正文已有可信 URL 时不追加 footer；完全没有可信引用时，才追加一次 fallback `信息源`。
- assistant 正文和活动卡将可信外链展示为发布者/站点短名胶囊，例如 `IBM Think`；完整标题或 URL 保留在 hover title 与真实 href 中。
- 活动卡所有 grid/flex 边界显式设置 `min-width: 0`、`max-width: 100%` 与必要的 overflow，查询文本继续单行省略。
- Markdown Artifact 保持普通链接排版；紧凑胶囊只用于 assistant 对话正文。

## Consequences

回答不再同时出现“参考来源”和“信息源”两组相同链接；没有主动引用的回答仍保留可核验来源兜底。短名可能无法完整表达页面标题，因此完整标题继续通过 title 属性提供，且点击目标不变。
