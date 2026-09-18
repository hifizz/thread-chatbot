## Why

现有 AnySearch demo 已验证搜索/正文读取与 UI 主链路，也已有此 change。对外 Beta 需要付费可扩容容量、真实计量和可靠主备，不能将匿名访问等同生产就绪。本次更新原 change，不建立第二套路由。

## What Changes

- 保持模型工具 webSearch/readUrl、四态路由、来源与历史消息协议不变，服务端 Search/Fetch adapter 与统一 Attempt Engine 收口。
- 区分开发 AnySearch 兼容策略和生产已采购策略；生产无有效凭据/价格/额度/评测证据时不进入候选池。
- Beta 只接一个付费主供应商与一个备用。先同题评测 Parallel Search/Extract 与 Exa，采购及达标后才能确定默认；AnySearch 可保留开发及比测。
- 对接 #164 的逐 attempt 用量、价格快照、账户预算与预占，不新建平行扣费系统。
- 统一 Generation/工具 deadline、失败分类、安全重试、游标快照及跨实例读取；使用已有 Axiom/Langfuse 和 evals/agent。
- Firecrawl/Valyu/Brave/Serper 留作有实证需求时的后续扩展，不作为本轮 Beta 必须实现项。

## Capabilities

### New Capabilities

- `web-search-provider-routing`: 原 capability 延续，补充生产采购准入与账务/容量契约。

### Modified Capabilities

无已发布的同名 capability；修改的是当前未归档 change 的 proposal/design/specs/tasks。

## Impact

计划修改 lib/ai/search.ts、lib/chat/research-tools.ts、constants/research.ts、provider registry/adapters、现有计量与评测。本文取代旧版本“生产默认 AnySearch + 必须新增 Firecrawl”的策略，不保留两个互相冲突默认值。本 PR 仅文档，不改变线上 provider。

## Dependencies

直接 Git 父分支 spec/beta-02-billing-quota（#164）；消费 PricingSnapshot/UsageLine/RunReservation，不能另建用户余额。双语错误依赖 #163；观测和发布分别与 06/08 集成。既有历史完成任务 1.1–1.4 保持完成记录。

## Non-goals

不新增搜索微服务、多供应商投票、智能自动比价、浏览器自动化、登录态抓取或多账户/key 绕过额度。报价只能进入带日期的采购记录，不是架构常量。
