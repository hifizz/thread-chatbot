# ADR-0003：消息来源账本与 Inline Source Tag

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D5；`grounded-web-citations` spec

## Context

用户要求在回答段落、实体词或指定位置显示信息源 tag，并点击新 tab 打开原始页面。普通 Markdown URL 不能证明它来自工具，也不能稳定绑定到消息来源元数据。

## Decision

每条 web-grounded assistant message 持久化 compact source ledger；模型在最小可支撑内容后输出 `[[cite:<sourceId>]]`。Renderer 将合法 ID 转成编号 tag，hover/focus 显示来源信息，点击以 `target="_blank" rel="noopener noreferrer"` 打开 canonical URL。未知 ID 显示不可验证且不可点击。全文不持久化。

Placement：事实句末为默认；实体级只用于精确版本/日期/值/身份；段末只在同一来源集合支撑整段主要事实时使用。

## Alternatives

- 只有回答末尾 Sources：弃选，支撑关系太远。
- 直接把实体文字做 URL hyperlink：弃选，容易混淆普通导航链接与检索证据。
- 只存 URL、不存 marker：弃选，reload 后无法保留精确位置。

## Consequences / Review triggers

Markdown renderer 需要安全解析自定义 marker，并保留无障碍与旧消息 fallback。若未来使用原生 structured citation span，可新增 ADR supersede marker wire format，但 source ledger 不变。

