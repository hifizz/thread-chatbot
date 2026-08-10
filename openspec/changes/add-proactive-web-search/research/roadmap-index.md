# Web Retrieval Roadmap：Research / ADR 总索引

本文件是四批 Web Retrieval change 的证据入口。它不替代各 change 的 proposal/design/spec/tasks。

| Phase | Change | Research | ADR Index | Normative Specs | 当前结论 |
|---|---|---|---|---|---|
| 1 | `add-proactive-web-search` | [主动搜索、项目实测、成本](README.md) | [ADRs](../adrs/README.md) | `proactive-web-search`、`web-search-transparency`、`web-search-metering` | 优先实施的 MVP |
| 2 | `add-controlled-web-fetch` | [Fetch、SSRF、引用 Tag](../../add-controlled-web-fetch/research/README.md) | [ADRs](../../add-controlled-web-fetch/adrs/README.md) | `controlled-web-fetch`、`grounded-web-citations` | Phase 1 验收后实施 |
| 3 | `harden-web-retrieval-operations` | [Provider、缓存、配额、观测](../../harden-web-retrieval-operations/research/README.md) | [ADRs](../../harden-web-retrieval-operations/adrs/README.md) | `web-retrieval-operations`、`web-retrieval-evaluation` | 有真实流量后实施 |
| 4 | `add-sandboxed-browser-retrieval` | [Browser、Sandbox、威胁模型](../../add-sandboxed-browser-retrieval/research/README.md) | [ADRs](../../add-sandboxed-browser-retrieval/adrs/README.md) | `sandboxed-browser-retrieval` | 仅在量化 JS 覆盖缺口后实施 |

## 维护规则

1. Research 新增资料时记录访问日期、来源类型、查到的事实、局限和影响的 ADR。
2. ADR 不直接删除或重写历史决定；改变方向时新增 ADR，并用 `Supersedes/Superseded by` 连接。
3. OpenSpec 未批准前 ADR 为 `Proposed`；批准实施后为 `Accepted`；放弃时为 `Rejected`；已替代时为 `Superseded`。
4. 规范性变化必须同步 spec；只更新 Research/ADR 不能偷偷改变系统要求。
5. Provider 价格、Marketplace 排名、模型行为和安全能力均为时变信息，apply 与发布前必须复查。

