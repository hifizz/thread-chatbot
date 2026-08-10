# ADR-0012：持久化终态搜索聚合卡及其流位置

- Status: Accepted
- Date: 2026-08-11
- Supersedes: design D6、ADR-0009 中“活动与 offset 全部为 transient state”的决定
- Related: `web-search-transparency` spec；branch tree 保存/加载清理边界

## Context

最初为了避免刷新后复活“正在搜索”状态，保存和加载边界删除了整组 `webSearchActivities` 与 `webSearchActivityTextOffset`。这同时删除了已经完成的聚合卡，导致正文和来源仍在，但用户刷新后看不到回答曾使用联网搜索，也丢失了卡片在真实生成顺序中的位置。

聚合卡并不是单纯的进度动画：完成后它表达本条 assistant 消息使用过的查询、来源和结果状态，属于消息级可解释性信息。需要临时化的是连接仍在推进的生命周期，而不是已经收敛的结果。

## Decision

- `completed` 与 `failed` Web Search activity 随 assistant 消息写入 branch tree。
- 第一个搜索事件对应的正文字符 offset 与终态 activity 一同持久化，刷新后仍在原始流顺序位置渲染聚合卡。
- `starting` 与 `searching` 不写入持久化快照；若快照或旧数据含有这些状态，加载时防御性删除。
- 只有存在至少一个终态 activity 时才保留 offset；offset 必须是有限非负整数，并限制在当前正文长度内。
- 重试继续清空上一轮的 activity 与 offset，避免旧证据混入新回答。

## Consequences / Review triggers

branch tree JSON 会增加少量搜索摘要数据，但每轮调用和结果已有硬上限，体积可控。当前仍以字符 offset 表示位置；若未来消息改为结构化 content parts，应迁移为持久化 part 顺序并删除 offset 兼容层。
