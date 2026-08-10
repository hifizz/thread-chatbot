# ADR-0004：外部检索调用独立计量和收费

- Status: Accepted
- Date: 2026-08-03
- Related: design D7；`web-search-metering` spec

## Context

现有 `usage_records` 只记录模型 token。Tavily Basic/Advanced Search 分别消耗 1/2 credits；免费额度耗尽后仍会产生 PAYG 成本。真实重型测试中 Search 成本约 ¥0.3504，而当前账单不会向用户收取。

## Decision

Search、Extract、Browser 使用独立 external-usage ledger，记录 provider operation、attempt/status、units、成本、售价、延迟和关联 ID。成功计费与流水同事务；免费 credits 也记录 shadow cost；用户总价聚合模型和外部调用但不混淆原始单位。

## Alternatives

- 把 Search 换算成虚拟 token：弃选，无法对账 provider credits。
- 将成本吸收到模型售价：弃选，搜索触发率不均会交叉补贴且不可审计。
- 免费额度期间不记录：弃选，会在额度耗尽时产生不可见成本跳变。

## Consequences / Review triggers

需要 migration、幂等键和消息级费用汇总。套餐折扣变化时更新成本口径，但历史流水不得重写。
