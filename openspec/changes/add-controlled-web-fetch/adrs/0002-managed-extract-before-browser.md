# ADR-0002：先使用托管 Extract，不引入浏览器

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D2/D3；`add-sandboxed-browser-retrieval`

## Context

Tavily `/extract` 已存在于项目，可读取大多数静态文档。Claude Web Fetch 官方也将普通全文获取与 JavaScript 浏览器能力区分，并明确其 Fetch 不支持动态 JS 页面。

## Decision

第二批将已注册来源交给托管 extraction provider，应用不直接从主 Function 网络 fetch 目标，也不运行 Chromium。限制 timeout、content type、大小、字符和每轮调用数。JS 页面缺口必须通过数据证明后进入独立 browser change。

## Alternatives

- 主 Function 直接 `fetch(url)`：弃选，增加 SSRF/DNS/redirect 责任。
- 第二批直接用 Playwright：弃选，成本、延迟、凭据和动作攻击面不成比例。
- 永远不支持 JS 页面：暂不决定，由覆盖缺口数据复审。

## Consequences / Review triggers

部分页面无法读取，但 search snippet fallback 可用。若失败明确集中在 JS 渲染且价值足够，启动第四批，而不是扩大 Extract 权限。

