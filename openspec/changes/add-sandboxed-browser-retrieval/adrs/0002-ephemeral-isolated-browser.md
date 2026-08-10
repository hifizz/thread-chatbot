# ADR-0002：浏览器运行在 Ephemeral 隔离环境

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D2/D4/D5；`sandboxed-browser-retrieval` spec

## Context

主 Chat Function 拥有应用环境和网络权限；直接在其中运行 Playwright 会让恶意页面接近 DB/auth/provider secrets。Marketplace 有 Browserbase 等托管候选；Vercel Sandbox 提供 ephemeral Firecracker microVM 与 browser snapshot 路径。

## Decision

使用经安全/成本评审的托管浏览器，或 Vercel Sandbox 中的自管 Chrome。Session 每次 fresh、无用户 cookies/storage、无主应用 env/filesystem，结束/错误/超时/取消都销毁。主 Function 只创建任务并接收净化结果。

## Alternatives

- 在 `/api/chat` 进程启动 Chromium：弃选，隔离和资源边界不足。
- 长期复用带登录态 browser profile：弃选，跨用户泄露风险。
- 只用容器但注入完整应用 env：弃选，容器不是秘密最小化策略。

## Consequences / Review triggers

需要 provider integration、额外计费、session cleanup 和 network policy。若自管启动过慢，可用 Sandbox snapshot，但 snapshot 不能包含 secrets。

