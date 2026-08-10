# ADR-0001：Fetch 工具只接受 sourceId

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D1/D2；`controlled-web-fetch` spec

## Context

当前 `readUrl({url})` 允许模型提供任意目的地。Anthropic 的 Web Fetch 明确禁止模型动态构造 URL；OWASP 指出 URL parser、redirect 和 DNS 均可能绕过单一输入校验。

## Decision

搜索结果先进入当前响应的 server-side source ledger 并获得 opaque sourceId。模型只能调用 `readSource({sourceId})`；execute 在同一请求 closure 中解析 canonical URL。未知、过期、跨响应 ID 在 provider call 前失败。URL validator 仍作为纵深防御。

## Alternatives

- 保留 raw URL + blocklist：弃选，目的地空间过大且 URL 校验不是完整安全边界。
- 固定官方域 allowlist：不足以覆盖通用 Web Search。
- 接受用户消息里的 URL：本 change 不包含；未来必须先经过独立注册与验证。

## Consequences / Review triggers

模型无法直接读取用户刚写的未注册 URL；这是有意限制。若产品需要该能力，新增“用户 URL 注册”spec，而不是放宽工具 schema。

