## Why

单一 Tavily 接入可以验证产品价值，但不能回答生产运行中的 provider 质量漂移、故障切换、重复查询成本、租户滥用和版本升级回归。只有在搜索与受控深读的实际数据证明值得继续投入后，才应增加这层运营复杂度。

## What Changes

- 在前两批验收后，把当前「可改 base URL、实际只兼容 Tavily 响应」的实现收敛为显式 provider adapter 契约。
- 通过 Vercel Marketplace 的实时 discovery 与小规模基准选择主 provider；Tavily 作为已验证基线，Exa 等候选必须用同一评测集比较后才能切换或成为 fallback。
- 增加可配置的 provider 路由、超时、熔断和受控降级；禁止一次用户请求因 provider 重试而突破搜索/抓取总预算。
- 对规范化查询与公共搜索结果增加短 TTL 缓存和请求合并，缓存键不得混入用户私密上下文，私有或敏感查询默认不缓存。
- 增加按用户、会话、时间窗口和全局的调用/费用限额，覆盖并发请求，防止后付费竞态与工具循环放大成本。
- 建立生产观测：触发率、每轮调用数、命中率、结果域质量、引用覆盖、延迟、provider 错误、缓存命中、成本与用户反馈。
- 建立固定 GLM-5.2 回归集、定期抽样评审和灰度/回滚门槛，任何 prompt、模型、provider 或预算变更都必须可比较。
- 明确查询日志、页面内容和来源元数据的最小化留存、脱敏、删除与访问权限。

## Capabilities

### New Capabilities

- `web-retrieval-operations`：provider adapter、路由/熔断/降级、缓存、配额、隐私和生产观测。
- `web-retrieval-evaluation`：GLM-5.2 的离线/在线质量、引用、时延和成本回归体系及发布门槛。

### Modified Capabilities

（无——本 change 依赖前两批新能力，当前 canonical specs 不存在需要修改的对应能力。）

## Impact

- **依赖**：必须先积累 `add-proactive-web-search` 与 `add-controlled-web-fetch` 的真实指标；不得为了“provider agnostic”提前阻塞 MVP。
- **集成**：Vercel Marketplace 搜索/agent 集成、环境变量与供应商账单；实施时需使用当时最新 CLI 重新 discovery，再由用户完成需要的账号授权。
- **服务端**：搜索/提取 adapter、预算协调器、缓存、限流、熔断与错误分类。
- **数据/观测**：调用流水、聚合指标、评测结果与隐私保留策略；可能新增 migration 和内部运维 API。
- **发布**：feature flag、按比例灰度、provider 回滚和成本告警。

