# ADR-0001：浏览器能力由量化覆盖缺口触发

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D1；`sandboxed-browser-retrieval` spec

## Context

浏览器能读取 JS 页面，但比 Search/Extract 增加显著安全、延迟和费用。当前尚无生产数据证明目标编程问题有足够多的 JS-only 缺口。

## Decision

浏览器不进入 Web Search MVP，也不由 `auto` 搜索自动获得权限。只有前三批报告证明某个 approved public source class 因 JS/安全展开稳定失败且用户价值足够，才开启独立 flag、allowlist cohort 和 kill switch。

## Alternatives

- 从第一批就启用：弃选，验证成本和风险过大。
- 永久不支持：暂不选择，可能错过高价值文档。
- 只要 Extract 失败就自动升级：弃选，恶意/付费/登录页面会放大风险。

## Consequences / Review triggers

需要 coverage-gap 报告作为任务 1.1 的硬门槛；未达标则 change 保持未实施，而不是为了完成 Roadmap 强行上线。

