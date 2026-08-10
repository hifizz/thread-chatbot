## 1. 启动门槛与 Marketplace

- [ ] 1.1 汇总前两批的搜索/提取触发率、质量、错误、p50/p95、调用数和成本，形成是否进入运营硬化的 go/no-go 记录
- [ ] 1.2 将 Vercel CLI 从 58.4.0 升级到当时最新版本，重新运行 search/agents 类 Marketplace discovery 并记录候选顺序与能力
- [ ] 1.3 经用户完成候选 integration 的安装/授权并安全拉取环境变量；不得输出 secrets 或用 mock integration 替代

## 2. Provider adapter 与基准

- [ ] 2.1 定义 search/extract adapter 的 normalized source、capabilities、error、timing 和 billing contract
- [ ] 2.2 把现有 Tavily 实现迁入 baseline adapter，并用 fixtures 证明工具/UI 输出保持兼容
- [ ] 2.3 为已开通候选 provider 实现独立 adapter 与契约测试，不把 vendor options 泄漏到 model tool schema
- [ ] 2.4 在同一版本化编程集上比较 relevance、primary-source、freshness、citation support、latency、errors 和 normalized cost，形成 provider 决策记录

## 3. 统一预算、重试与熔断

- [ ] 3.1 建立跨 search/extract/primary/retry/fallback 的 response deadline、unit 和 maximum-price budget
- [ ] 3.2 实现错误分类与最多一次有预算重试；validation/auth/quota 等 non-retryable 错误立即失败
- [ ] 3.3 实现只在 primary 分类故障时启用的可选 fallback，禁止默认双 provider fan-out，验证用户最高费用不变
- [ ] 3.4 实现 provider rolling circuit、受控 probe、per-provider/global kill switch 和故障注入测试

## 4. 隐私安全缓存

- [ ] 4.1 定义 provider/version/options/locale/freshness-aware cache key 和短 TTL 策略
- [ ] 4.2 实现 normalized public result/content cache 与 in-flight coalescing，cache hit 不生成 provider 费用
- [ ] 4.3 实现 secret/PII/private URL/用户敏感标记 bypass，并验证 key/value/log 不含用户上下文或凭据
- [ ] 4.4 覆盖 latest/current 的短 TTL 或 bypass、provider 版本失效、并发合并和过期回源测试

## 5. 分布式配额与成本预留

- [ ] 5.1 设计 Postgres 原子窗口/预留数据结构及 migration，覆盖 user/conversation/time-window/global retrieval limit
- [ ] 5.2 在 provider admission 前实现 atomic reserve/settle/release，并保持请求内硬 cap 作为第一道限制
- [ ] 5.3 增加并发竞态、余额/配额临界值、拒绝不访问 provider 和管理员紧急降额测试

## 6. 观测与隐私留存

- [ ] 6.1 统一 external operation event，记录关联 ID、adapter version、mode、cache/retry/fallback、错误、latency、units/results/cost，默认不记全文
- [ ] 6.2 建立质量/可靠性/延迟/成本 dashboard 和 alert，覆盖成功但昂贵、成功但低质、circuit open 与 spend spike
- [ ] 6.3 文档化查询指纹、redacted sample 的访问权限、保留期、删除流程与 provider 数据处理约束

## 7. GLM-5.2 回归与发布

- [ ] 7.1 将 dataset/model upstream ID/prompt hash/tool schema/adapter version/parameters/budgets 固化为每次 eval 的元数据
- [ ] 7.2 为 prompt、tool、provider、cache、retry/fallback、quota 变更建立对应的 deterministic/live/human-review gate
- [ ] 7.3 运行 shadow/小比例 A/B，将额外调用标记为 experiment spend 且不静默向用户收费
- [ ] 7.4 运行 `pnpm typecheck`、`pnpm lint`、故障/并发/隐私相关测试、`pnpm build` 和 `openspec validate harden-web-retrieval-operations --strict`
- [ ] 7.5 仅在所有 gate 通过后提升 primary/扩大灰度，并演练 provider 与全局 retrieval kill switch 回滚

## 8. Research 与 ADR 维护

- [ ] 8.1 将 apply 时最新 Marketplace discovery、provider bake-off、缓存/配额负载和成本数据追加到 `research/README.md`，保留 2026-08-03 基线
- [ ] 8.2 记录最终 provider 晋升/回滚、retry/fallback、cache 与 retention 决策的 ADR 状态；策略变化用 superseding ADR 追踪
