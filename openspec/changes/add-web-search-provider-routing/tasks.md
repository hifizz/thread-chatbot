## 1. 已验证的 Fast Demo 基线

- [x] 1.1 接入 AnySearch REST Search 与 MCP Extract，并将结果归一化为现有 Search/Fetch 返回结构
- [x] 1.2 通过 `webSearch` / `readUrl` 接入四态路由、Research Planner、多步工具循环、联网活动 UI 与消息持久化
- [x] 1.3 在开发环境的 AnySearch Search/Extract 请求前输出实际 provider 与 operation，且不记录 credential 或正文
- [x] 1.4 将 demo 状态、智能路由状态和 2026-08-19 provider 竞品调研记录到 `docs/deep-research/`

## 2. Provider 契约与 AnySearch 收口

- [ ] 2.1 定义 Search/Fetch 规范化输入输出、`SearchExecutionContext`、provider descriptor、billing unit、attempt outcome 与错误类别类型
- [ ] 2.2 建立仅服务端可导入的 provider registry，按 operation、feature flag、credential、健康和预算状态构造候选池
- [ ] 2.3 将现有 AnySearch Search/Extract 实现迁入独立 adapter，保留无 key 匿名模式与 `ANYSEARCH_API_KEY` 鉴权模式
- [ ] 2.4 实现 provider-neutral Search/Fetch router 入口，并让 `webSearch` / `readUrl` 只调用该入口
- [ ] 2.5 从现有四态路由向 provider router 传递 execution mode、quality、freshness、deadline 与预算上下文，不传递完整聊天历史
- [ ] 2.6 增加 AnySearch adapter 与 registry 合同测试，覆盖有 key、无 key、缺失可选 provider 凭据、operation 不匹配和无候选 provider
- [ ] 2.7 增加兼容性测试，证明 model tool schema、Web research activity、source link 与已持久化 UIMessage 不包含 provider 专属结构

## 3. Attempt Engine 与可靠性控制

- [ ] 3.1 将 Search/Fetch 的单次超时、总 deadline、最大尝试数、单 provider 重试数和成本预算集中到可测试的 server-side policy
- [ ] 3.2 实现统一 Attempt Engine，按有序候选执行 provider 调用并将上游 AbortSignal 传播给重试和 fallback
- [ ] 3.3 实现 `invalid_input`、`policy_blocked`、`misconfigured`、`auth_failed`、`capacity_limited`、`transient`、`unusable` 与 `permanent_provider_error` 分类
- [ ] 3.4 为 transient 错误实现最多一次、受总 deadline 约束且带抖动的安全重试，并禁止 invalid/policy 错误触发额外调用
- [ ] 3.5 实现 provider + operation 维度的进程内并发保护与 open/half-open/closed circuit breaker
- [ ] 3.6 为 Search 空结果、Fetch 空白/过短/超限内容实现可配置 usability 判定，并据此触发 operation-specific fallback
- [ ] 3.7 增加故障注入单元测试，覆盖 timeout、429、5xx、空结果、auth failure、circuit open、总预算耗尽和请求取消

## 4. URL 安全、内容边界与去重

- [ ] 4.1 实现共享 URL Guard，只接受 `http`/`https`，拒绝 URL credential、localhost、环回、链路本地、私网与保留地址
- [ ] 4.2 为 Fetch 实现有界 redirect 预检或等价的 provider redirect 控制，并对每一跳重新执行 URL/DNS 安全校验
- [ ] 4.3 在 adapter/Attempt Engine 统一限制 redirect、content type、响应体大小、提取文本长度、单次超时和总超时
- [ ] 4.4 将 Fetch 内容包装为不可信外部证据，验证网页指令不能更改系统指令、provider policy 或 credential 处理
- [ ] 4.5 以规范化 query/URL、operation、locale、freshness 与 policy version 生成不可逆 fingerprint，并在单次 research 请求内复用完成或在途结果
- [ ] 4.6 实现容量受限的短 TTL 实例缓存，支持显式 freshness bypass，且不把 query、完整 URL 或网页正文写入用量账本和普通日志
- [ ] 4.7 增加 URL、redirect、响应上限、prompt injection framing、重复 query 和 freshness bypass 测试

## 5. Provider 用量与预算账本

- [ ] 5.1 在 Drizzle schema 中新增 `search_provider_usage_daily` 聚合表，包含日期、provider、operation、原始 billing unit、quantity、request count、估算微美元成本和 estimate 标记
- [ ] 5.2 生成并审查仅涉及 provider 用量表的数据库 migration，确认不会修改现有 thread、message、auth 或 billing 数据
- [ ] 5.3 实现 provider attempt 成功/失败后的原子日聚合 upsert，以及按 provider/operation 查询日/月用量的 repository
- [ ] 5.4 实现日额度、月额度、成本与并发软预算检查，并在候选构建时排除本地已超预算 provider
- [ ] 5.5 为不同 provider 保留 request、credit、page、retrieval、task run 等原始单位；缺少精确 usage 时明确记录为 estimate
- [ ] 5.6 增加并发 upsert、跨日/月汇总、单位不混算、预算重置和超预算候选排除测试
- [ ] 5.7 增加隐私断言，证明用量表不保存 query、URL、网页正文、Authorization 或 API key

## 6. 统一可观测性

- [ ] 6.1 定义 provider attempt event schema，包含 correlation id、provider、operation、route reason、attempt index、outcome、duration、fallback count、usage 与脱敏错误类别
- [ ] 6.2 将现有 AnySearch 开发日志迁移到统一 event emitter，保持每次实际尝试可见而非只记录初始候选
- [ ] 6.3 在生产环境输出结构化 attempt event，并仅记录 query fingerprint、域名级信息或预定义类别
- [ ] 6.4 增加日志脱敏测试，覆盖 API key、Authorization、完整 query、完整 URL、原始 response、网页正文和模型内部推理不泄漏
- [ ] 6.5 增加 fallback 链路测试，证明每个 attempt 的 provider、operation、route reason、outcome、duration 和 usage 可关联到同一请求

## 7. Parallel Basic Search Fallback

- [ ] 7.1 实现薄 Parallel Basic Search adapter，支持 AbortSignal、统一响应上限、错误分类、原始计费单位与规范化 SearchResult
- [ ] 7.2 增加 `PARALLEL_API_KEY` 和独立 server-side enable flag；无 key 或 flag 关闭时不得注册 Parallel
- [ ] 7.3 实现普通 Search 的 `AnySearch -> Parallel Basic` fallback 策略，并保持默认生产 flag 关闭
- [ ] 7.4 为通过评测后的复杂 research 增加显式 high-quality policy，使 Parallel 可成为首选但不改变 `webSearch` tool schema
- [ ] 7.5 增加 Parallel 合同和故障测试，覆盖响应归一化、429、timeout、5xx、空结果、用量单位和 fallback budget

## 8. Firecrawl Fetch Fallback

- [ ] 8.1 实现薄 Firecrawl Fetch adapter，支持 AbortSignal、动态页面提取、内容上限、错误分类、原始计费单位与规范化 FetchResult
- [ ] 8.2 增加 `FIRECRAWL_API_KEY` 和独立 server-side enable flag；无 key 或 flag 关闭时不得注册 Firecrawl
- [ ] 8.3 实现 `AnySearch Extract -> Firecrawl` 的有条件 fallback，仅在失败、内容不可用或受支持的动态页面策略命中时触发
- [ ] 8.4 增加 Firecrawl 合同和故障测试，覆盖响应归一化、动态页面、429、timeout、5xx、超限内容、用量单位和 fallback budget

## 9. 后续 Provider 扩展边界

- [ ] 9.1 为 Exa、Valyu、Brave Search 与 Serper 定义不含凭据的 capability descriptor 和候选标签，不注册未实现的 adapter
- [ ] 9.2 编写 provider onboarding 检查表，要求每家新增 provider 提供合同测试、错误映射、计费单位、限流/预算、数据政策、feature flag、评测证据与回滚方式
- [ ] 9.3 增加测试，证明客户端或模型提交 provider 名称、key、计费模式或 fallback 顺序时无法覆盖 server-side policy
- [ ] 9.4 在配置与文档中明确禁止同 provider 的多账号/key 轮换和自动注册额度规避

## 10. 项目评测与分阶段发布

- [ ] 10.1 建立版本化固定评测集，覆盖不联网 answer、单 URL fetch、普通 search、复杂 research、最新事实、语义检索、精确 SERP、动态页面和垂直领域
- [ ] 10.2 实现可重复的评测 runner，采集路由正确率、答案/引用正确性、p50/p95、错误率、空结果率、工具调用数、fallback 率、原始单位与任务总估算成本
- [ ] 10.3 运行并保存 AnySearch-only 基线，用实际数据校准 deadline、熔断、usability、缓存 TTL 和上线门槛
- [ ] 10.4 在相同评测集运行 Parallel fallback，对比质量、延迟、可靠性和成本；未达门槛时保持 flag 关闭并记录原因
- [ ] 10.5 在 Fetch 子集运行 Firecrawl fallback，对比动态页面成功率、延迟和成本；未达门槛时保持 flag 关闭并记录原因
- [ ] 10.6 增加 AnySearch-only 一键回滚配置，并验证关闭所有可选 flag 后无需数据库或消息 schema 回滚
- [ ] 10.7 更新环境变量、额度单位、feature flag、故障处置、日志查询、评测和回滚运维文档

## 11. 完整验收

- [ ] 11.1 运行 provider router、adapter、URL Guard、Attempt Engine、账本、脱敏、兼容性和故障注入测试并修复本 change 引入的问题
- [ ] 11.2 运行项目 lint、typecheck 与相关 build；若工作树存在与本 change 无关的既有失败，单独记录基线证据且不掩盖新增失败
- [ ] 11.3 执行 `git diff --check` 和 `openspec validate add-web-search-provider-routing --strict`，确认实现与 capability scenarios 一致
- [ ] 11.4 在本地开发模式分别触发 Search 与 Fetch，确认服务端日志显示实际 provider/operation，客户端和持久化消息不出现 provider credential 或专属 schema
