## Context

当前 fast demo 已经证明端到端链路可行：`lib/ai/search.ts` 直接调用 AnySearch Search 与 Extract，`lib/chat/research-tools.ts` 向模型暴露 `webSearch` / `readUrl`，`app/api/chat/route.ts` 负责 `answer / fetch / search / research` 四态路由、Research Planner、多步工具循环、活动 UI 和消息持久化。现状的主要约束不是“能否联网”，而是 provider 选择、故障恢复、额度与成本、安全和评测仍散落在单一 AnySearch 适配器及聊天编排中。动机与范围见 [proposal.md](./proposal.md)，行为契约见 [web-search-provider-routing spec](./specs/web-search-provider-routing/spec.md)。

该应用部署在 Next.js 默认 Node.js / Fluid Compute 运行时。函数实例会复用，但仍可能同时存在多个实例，因此内存状态适合做单实例并发保护和短期熔断，不适合作为全局日额度的唯一事实来源。项目已经使用 Drizzle 与 PostgreSQL，可以复用现有数据库承载低频聚合的 provider 用量账本，而不额外引入 Redis 或新的基础设施。

外部 provider 的价格、免费额度、计费单位和限流规则会变化；第三方 benchmark 也不能代表本项目的真实任务。选型依据记录在 `docs/deep-research/05-web-search-api-competitive-research-2026-08-19.md`，但生产默认策略必须由项目自有评测决定。

## Goals / Non-Goals

**Goals:**

- 保持模型、前端和历史消息只理解 `webSearch` / `readUrl`，将 provider 差异封装在服务端。
- 先把现有 AnySearch demo 收口到稳定 adapter/router 边界，再渐进加入高质量 Search fallback 与动态页面 Fetch fallback。
- 让每次 provider 尝试都有明确的候选资格、超时、尝试次数、成本、熔断和退出条件。
- 在多实例部署下实现可信的日/月软预算，同时保留低延迟的单实例并发与速率保护。
- 用脱敏遥测和固定评测集回答“为什么选了这个 provider、质量是否更好、代价是多少”。

**Non-Goals:**

- 不让模型或客户端直接指定 provider、key、计费模式或 fallback 顺序。
- 不在第一版同时接入全部竞品，也不实现跨 provider rank fusion、搜索结果投票或自动学习路由。
- 不引入浏览器自动化、登录态网页访问、Git 仓库克隆或通用爬虫集群。
- 不接入 OpenWebSearch 等二次 SaaS 路由层；本项目保留策略、日志、预算和数据边界的所有权。
- 不通过多账号、自动注册、key 轮换等方式规避同一 provider 的账户级配额或服务条款。
- 不把外部 benchmark 分数直接转换为生产流量权重。

## Decisions

### 1. Search 与 Fetch 使用独立 adapter 契约

建立两个最小接口，而不是一个包含所有 provider 能力的“大一统”接口：

- `SearchProviderAdapter.search(input, context)` 返回统一的查询与结果列表。
- `FetchProviderAdapter.fetch(input, context)` 返回统一的 URL、文本内容和受控元数据。
- provider descriptor 声明 `id`、支持的 operation、凭据要求、计费单位和能力标签；router 只通过 descriptor 建立候选池。
- 统一结果只保留上层真实使用的字段。provider 原始响应仅在 adapter 内解析，不进入 UIMessage、模型 tool schema 或持久化消息。

这样可以真实表达“某家只适合 Search、某家只适合 Fetch”的能力差异，也避免以后为了照顾一家的专属字段而不断扩张公共接口。

备选方案是继续在 `lib/ai/search.ts` 中用条件分支调用不同 API。该方案改动更少，但 provider 资格、错误分类、指标和测试会继续与具体实现耦合，第二家 provider 接入后即难以维护，因此不采用。

### 2. 由 server-only registry 构建候选池

新增仅服务端可导入的 registry，按环境配置实例化 adapter。registry 不读取客户端输入，也不把 credential 状态序列化给模型或浏览器。

初始注册顺序为：

1. AnySearch Search 与 Extract：默认启用；`ANYSEARCH_API_KEY` 存在时鉴权，不存在时允许匿名模式，除非操作员显式关闭匿名访问。
2. Parallel Basic Search：首个高质量 Search fallback，通过独立 feature flag 启用，凭据缺失时不注册。
3. Firecrawl Fetch：首个动态页面 Fetch fallback，通过独立 feature flag 启用，凭据缺失时不注册。
4. Exa、Valyu、Brave Search、Serper：只预留 descriptor 和路由能力标签，在各自 adapter、合同测试和项目评测完成后逐个启用。

第一批 adapter 优先使用薄 HTTP client，而不是同时安装多家 SDK。理由是当前只需要稳定的 Search/Fetch 子集，薄 adapter 更容易统一超时、AbortSignal、错误分类、响应上限和依赖体积。若某个 provider 的官方 SDK 后续提供平台原生鉴权、可靠流式协议或无法合理复刻的能力，再单独评估替换。

### 3. 保留两层路由，provider router 不重新判断用户意图

现有聊天路由继续决定 `answer / fetch / search / research`，并决定是否暴露和强制 `webSearch` / `readUrl`。provider router 只在某个 operation 已经确定后选择底层 provider。两者之间传递结构化 `SearchExecutionContext`，包含 execution mode、意图标签、freshness、质量档、截止时间和预算，而不是原始聊天历史。

初始策略：

- 普通 `search`：AnySearch Search 优先；发生可 fallback 的失败时尝试已启用的 Parallel Basic。
- `research`：默认仍从 AnySearch 开始；只有 Research Planner 明确给出高质量档、复杂多源研究标签且 Parallel 已通过项目评测时，才允许 Parallel 成为首选。Exa 后续作为语义检索候选，而不是与 Parallel 同时默认启用。
- `fetch`：AnySearch Extract 优先；只有 Extract 失败、内容不可用或页面被识别为支持的动态页面场景时，才尝试已启用的 Firecrawl。
- 垂直领域：Valyu 等 provider 必须同时满足领域分类、配置、评测和预算条件；未满足时回落到普通 Search 策略。
- 精确 SERP：Brave 或 Serper 只服务明确需要传统结果排序、地域/语言或独立索引的策略，不作为所有请求的通用 fallback。

备选方案是把 provider 名称暴露成模型 tool 参数，让模型自行挑选。模型无法可靠掌握实时额度、健康、价格和服务条款，而且会污染 UI 与历史消息契约，因此不采用。

### 4. 以 Attempt Engine 统一错误分类、重试和 fallback

router 调用统一 Attempt Engine 执行有序候选列表。每次尝试都携带同一个请求级 deadline 与 cost budget，并产生结构化 attempt outcome。

错误分为：

- `invalid_input` / `policy_blocked`：URL、协议或安全策略错误，立即停止，不调用 fallback。
- `misconfigured` / `auth_failed`：当前 provider 退出候选，并报告配置类指标；不会用重复请求消耗额度。
- `capacity_limited`：本地预算、429 或 provider 配额限制；记录并尝试下一个候选。
- `transient`：网络中断、超时、5xx；同一 provider 最多进行一次带抖动的安全重试，且必须仍在总 deadline 内，之后再 fallback。
- `unusable`：空 Search、明显不完整或低于 Fetch 可用阈值的内容；允许 operation-specific fallback。
- `permanent_provider_error`：不符合重试条件的 provider 错误；跳过当前 provider。

总尝试次数、单次超时、总 deadline 和估算成本都由 operation policy 给出；任何一个预算耗尽即停止。取消上游 chat 请求时，AbortSignal 必须向所有在途 provider 调用传播。

备选方案是让各 adapter 自己实现 retry。那会造成重复重试、总时长不可控和成本放大，也无法统一故障注入测试，因此不采用。

### 5. 分离“瞬时保护”和“跨实例用量账本”

瞬时保护使用进程内状态：

- provider + operation 维度的并发 semaphore/token bucket，限制单实例突发流量。
- 按错误类别维护短期 circuit breaker；连续超时、429 或 5xx 达阈值后暂时 open，冷却后 half-open 探测。
- 这些状态只用于快速保护，不宣称跨实例全局精确。

跨实例日/月软预算使用现有 PostgreSQL：新增聚合表 `search_provider_usage_daily`，以日期、provider、operation、billing unit 为组合键，原子累加请求数、原始单位数量和估算微美元成本。月预算由日聚合求和，不保存 query、完整 URL、响应正文或 credential。provider 的官方额度仍是最终硬边界；本地账本用于提前停止、告警和路由决策。

所有计费必须保留原始单位（request、credit、page、retrieval、task run 等），不能把不同单位伪装成“搜索次数”。provider 未返回准确 usage 时使用明确标记为 estimate 的静态计量规则。

备选方案一是只使用内存计数，无法覆盖并发实例和部署重启。备选方案二是立即引入新 Redis/限流服务，会为当前规模增加不必要基础设施。现有 PostgreSQL 聚合 upsert 是更合适的第一阶段。

### 6. 去重先做请求级，缓存保持短时、可绕过

Research Planner 和工具执行层先以规范化 query/URL + operation + freshness policy 形成 fingerprint，在同一请求内复用已完成或在途 Promise，避免同一研究计划重复调用。

跨请求只允许短 TTL、容量受限的服务端缓存，cache key 使用规范化输入的哈希，并包含 operation、provider policy version、locale、freshness 和影响结果的参数。明确要求最新数据时绕过缓存。Fetch 内容仅在内容类型、大小和数据政策允许时缓存；不把网页正文写入 provider 用量账本或普通日志。

第一阶段不依赖共享缓存：Fluid 实例内缓存只是优化，命中率和正确性不能成为功能前提。如果评测证明跨实例重复成本显著，再单独提案选择共享缓存。

### 7. 开发日志与生产遥测使用同一个 attempt event

Attempt Engine 在开始和结束时生成内部事件，字段至少包括 request/tool correlation id、provider、operation、route reason、attempt index、outcome、duration、fallback count、billing unit/quantity、estimate 标记和脱敏错误类别。

- 开发环境通过 `console.info` 输出简洁的 `provider` 与 `operation`；这沿用已经验证的日志行为。
- 生产环境输出结构化事件供部署日志/后续观测平台采集，不默认记录完整 query、完整 URL、正文、Authorization、API key、原始响应或模型 chain-of-thought。
- 如果需要关联输入，只记录不可逆 fingerprint、域名级别或预定义 query category。

路由理由属于 server-side 运维信息，不进入模型 tool result、前端 activity schema 或持久化 UIMessage，避免历史消息与 provider 绑定。

### 8. 在 provider 调用前后实施 Web 安全边界

`readUrl` 的公共输入解析在 router 之前完成：只允许 `http` / `https`，拒绝带明文 credential 的 URL，并阻止 localhost、环回、链路本地、私网和保留地址目标。所有重定向目的地重复校验，避免通过 redirect 绕过。

adapter/Attempt Engine 统一限制重定向次数、单次和总超时、响应体大小、允许的内容类型以及返回模型的最大文本长度。provider 托管抓取不能取代本地输入校验；即使请求由第三方抓取，也不应允许任意内部 URL 被传给它。

提取结果在进入模型上下文时明确标为不可信外部证据。网页中的指令不能更改系统/开发者指令、provider 策略或 credential 处理。

### 9. 以固定评测门禁决定 provider 是否成为默认路径

建立版本化评测集，覆盖：

- `answer` 不应误触发联网。
- 单 URL `fetch`、普通 `search`、复杂 `research` 的路由正确性。
- 最新事实、语义检索、精确 SERP、动态页面和垂直领域样本。
- 429、超时、5xx、空结果、无凭据、额度耗尽和取消请求等故障注入。

每次候选 provider 或策略变更记录答案/引用正确性、p50/p95 时延、错误率、空结果率、工具调用次数、fallback 率、原始计费单位和任务总估算成本。Parallel Basic 是第一家实现的高质量 Search fallback，但只有在固定评测中达到门槛后才开启生产默认 fallback；Firecrawl 同理。

第三方榜单只用于缩小候选范围。它们的 query 集、时效和成本口径与本项目不同，不能代替上线门禁。

## Risks / Trade-offs

- [多 provider 架构比单一 AnySearch demo 更复杂] → 分阶段迁移，先以 AnySearch-only registry 保持行为不变，再逐个启用 adapter；每个阶段都可回滚。
- [fallback 会放大延迟和成本] → 使用共享 deadline、最大尝试数、原始计费单位和任务成本预算；只对明确错误类别 fallback。
- [外部价格、免费额度和 API 契约会变化] → 将价格视为可配置估算和带日期的运营数据，不把调研数字写死为业务语义；合同测试监控响应契约。
- [PostgreSQL 每次 provider 调用写入可能形成热点] → 使用按日聚合 upsert、异步/批量可行时聚合，并只保存最小计量字段；上线前压测写入量。
- [进程内 circuit breaker 无法跨实例共享] → 接受其作为第一阶段的快速保护；用结构化指标观察是否需要后续共享健康状态，不把它当全局正确性条件。
- [错误分类过宽会掩盖真实问题，过窄会降低可用性] → 为每家 adapter 建立错误映射合同测试，并在遥测中保留脱敏的 provider status/category 供校准。
- [缓存会返回过时结果或保存敏感内容] → 默认短 TTL、哈希 key、显式 freshness bypass、容量上限和 Fetch 内容政策；第一阶段功能不依赖跨实例缓存。
- [第三方抓取仍可能带来 SSRF、prompt injection 或恶意内容] → 调用前校验所有 URL/redirect，限制响应，并把网页内容固定为不可信证据。
- [AnySearch 匿名容量的实际可用性可能波动] → 支持配置 key、记录 429/配额指标，并通过有界 fallback 保持可用；不将匿名额度当 SLA。

## Migration Plan

1. 固化当前 demo 的合同测试与评测基线，记录 AnySearch-only 的质量、时延、错误率和成本单位。
2. 引入公共类型、provider descriptor、server-only registry 和 Attempt Engine；只注册 AnySearch adapter，使生产行为保持不变。
3. 将现有 `lib/ai/search.ts` 的 Search/Extract 调用迁入 AnySearch adapter，`webSearch` / `readUrl` 改为调用 router；确认 UI、消息和四态路由无 schema 变化。
4. 加入 URL 安全、deadline、错误分类、并发保护、circuit breaker、请求级去重、结构化 attempt event 和 PostgreSQL 日用量账本。
5. 实现 Parallel Basic adapter 和故障合同测试，保持 feature flag 关闭；运行固定评测后只在达标环境逐步开启 Search fallback。
6. 实现 Firecrawl Fetch adapter 和动态页面用例，保持 feature flag 关闭；评测达标后开启有条件 Fetch fallback。
7. 根据实际缺口逐个评估 Exa、Valyu、Brave 或 Serper，不批量启用；每家重复合同测试、成本配置、故障注入和评测门禁。
8. 部署后按 provider/operation 观察 p95、错误、fallback 和成本；如果异常，立即把策略切回 AnySearch-only。新增用量表可保留，不影响回滚后的请求路径。

## Open Questions

- 各 operation 的最终 deadline、熔断阈值、短 TTL 和评测通过线，需要基于 AnySearch-only 基线与首轮 fault test 校准；实现时先集中为可测试的 server-side policy 常量，不散落在 adapter 中。
- 生产结构化 attempt event 初期进入 Vercel 日志即可；当数据量足以证明需要长期聚合时，再决定接入哪一个观测后端。该选择不改变事件 schema 或路由架构。
