## Why

AnySearch fast demo 已经验证 REST Search、MCP Extract、AI SDK 多步工具循环、联网活动 UI 与消息持久化的主链路可行，但这些结果目前只存在于实现和 `docs/deep-research/` 状态文档中，尚未形成可执行、可验收的 OpenSpec 契约。现在需要把 AnySearch 固化为默认联网层，并为后续高质量搜索、动态网页抓取、垂直数据源、额度管理和供应商故障恢复建立统一边界，避免继续在单一 provider 适配器上堆叠特例。

## What Changes

- 将模型可见的联网能力固定为两个 provider-neutral 语义工具：`webSearch` 与 `readUrl`；模型不得直接选择、提交或感知 provider 凭据和底层参数。
- 将 AnySearch 定义为默认 Search 与 Extract provider：支持匿名额度和可选 `ANYSEARCH_API_KEY`，并保持当前已验证的搜索结果与 Markdown 抽取契约。
- 在服务端引入统一 provider router 与 adapter 边界，为 Search 和 Fetch 分别选择已配置且健康的 provider，并将各家响应归一化为稳定内部结构。
- 建立分阶段 provider 策略：优先接入一家具备独立基准支撑的高质量搜索 fallback（Parallel Basic 或 Exa Auto），再为动态网页增加 Firecrawl fetch fallback；Valyu、Brave、Serper 等仅在对应领域和配置存在时启用。
- 增加 provider 级额度、限流、超时、重试预算、熔断、fallback、查询/URL 去重、缓存与成本单位记录；禁止通过多个账号或多个 key 绕过同一服务商的账户聚合限制。
- 增加服务端可观测性：开发环境输出本次工具调用实际选择的 provider 和 operation；生产环境记录脱敏的结构化指标，不记录 API key、完整查询、完整 URL 或网页正文。
- 建立项目自有 Search/Fetch 评测集，按路由正确率、答案与引用正确性、p50/p95 延迟、错误率、空结果率、工具调用次数和任务总成本验收，而不是直接照搬厂商自测或第三方榜单排名。
- 保持 `answer / fetch / search / research` 四态路由、Research Planner、工具活动 UI 与持久化协议兼容；provider 路由不得改变现有前端事件和历史消息结构。

## Capabilities

### New Capabilities

- `web-search-provider-routing`: 规定统一 Search/Fetch 工具契约、AnySearch 默认行为、provider 选择与 fallback、额度和可靠性控制、可观测性、安全边界及项目级验收指标。

### Modified Capabilities

（无——`openspec/specs/` 中当前没有已发布的 Web Search 或 Deep Research capability；现有行为只记录在实现与 `docs/deep-research/` 中。）

## Impact

- 服务端搜索适配与工具层：`lib/ai/search.ts`、`lib/chat/research-tools.ts`、`constants/research.ts` 及新增 provider adapter/router 模块。
- Chat 编排：`app/api/chat/route.ts` 的四态联网路由、工具最小暴露、超时与步骤预算保持兼容，但改为消费统一 router。
- 配置：保留 `ANYSEARCH_API_KEY`，未来按实际接入增加单一服务商的环境变量；未配置的 provider 不得进入候选池。
- 可观测性：服务端开发日志、结构化 provider 指标、额度账本与脱敏错误信息。
- UI 与持久化：继续只处理 `webSearch` / `readUrl` 及统一来源结构，不增加 provider 专属工具卡片或历史消息 schema。
- 文档与验收：以 `docs/deep-research/05-web-search-api-competitive-research-2026-08-19.md` 为选型依据，补充 provider router 单元测试、故障注入测试与 Search/Fetch 固定评测集。
- 本 change 不引入浏览器自动化、登录态网页访问、Git 仓库克隆、复杂 rank fusion、OpenWebSearch SaaS 中间层或多账号额度规避。
