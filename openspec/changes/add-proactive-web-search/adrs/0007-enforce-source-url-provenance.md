# ADR-0007：服务端强制来源 URL 溯源并保持质量门禁独立

- Status: Accepted
- Date: 2026-08-05
- Related: design D2/D3/D6/D8；`web-search-transparency` spec；GLM-5.2 20-case live eval

## Context

首轮 20 条真实编程问题评测中，GLM-5.2 能使用搜索片段生成答案，但会自行缩短、改写或补造 URL，也会把示例 URL 当成事实来源。未经约束的原始答案只有 80% 样例满足“回答中的来源 URL 都来自工具结果”。另一方面，即使搜索结果来自官方站点，模型仍可能对版本状态作出超出 snippet 的推断；“链接真实”不能替代“结论被证据支持”。

用户需要在答案和搜索活动中看到可点击的信息源标签，并在新标签页打开。MVP 尚未建立 message-owned source ledger 和逐段 inline citation schema，因此不能可靠地让模型自由生成任意位置的富引用对象。

## Decision

- 服务端只把本轮成功 Web Search 的规范化公开 HTTP(S) URL 加入来源白名单；流式回答中其它外部 URL 被替换为不可点击的阻断标记。
- 在 assistant 正文结束前，由服务端追加基于真实工具结果生成的 `信息源` Markdown 标签。UI 只允许安全 HTTP(S) 外链，并使用新标签页及 `noopener noreferrer` 打开；内部 hash anchor 保持站内行为。
- Search activity card 同样只展示规范化结果的来源标签，不渲染 provider 原始 payload。
- 对已知编程技术，仅当 query 明确匹配时向 Tavily 提供对应官方域名提示；通用查询不使用全局固定 allowlist。官方域名提示是检索质量优化，不是事实正确性证明。
- 来源溯源 gate 与答案正确性 gate 分开。URL 白名单能把来源有效率确定性提升到 100%，但任何“有官方链接却过度推断”的样例仍阻止生产灰度。
- 逐段/实体级结构化 citation 和消息级 source ledger 留给 `add-controlled-web-fetch`，本 change 不用脆弱的 Markdown 后处理伪装成精确 inline attribution。

## Alternatives

- 只依赖 system prompt 要求模型引用真实 URL：实测只有 80% 来源有效率，弃选。
- 删除模型输出中的所有 URL：安全但损失用户可核验性，弃选。
- 在 MVP 中实现完整 inline citation parser/ledger：会扩大协议、持久化与迁移范围，留给已规划的后续 change。
- 所有编程查询固定只搜官方域：会漏掉库生态、issue、论文和社区故障信息，弃选。

## Consequences / Review triggers

MVP 的来源标签位于回答末尾及搜索活动卡，不保证每个段落或实体都有精确映射。流式 URL guard 必须覆盖跨 chunk URL，并确保来源 footer 在 finish 事件前输出。后续引入结构化 source ledger 时，可以用新 ADR supersede footer 方案，但仍须保留服务端 provenance allowlist 和独立正确性 gate。
