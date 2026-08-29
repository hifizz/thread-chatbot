## 1. 实施基线与 Provider 能力核验

- [ ] 1.1 记录 `codex/feat-agent-observability-evaluation@30a540a315841f78a816adc761fb6bde37fedf7a` 的 `typecheck`、`build`、Thread Chat Gate、observability tests、agent eval CI 和 OpenSpec strict validation 基线
- [ ] 1.2 在实施当日重新核对锁定版本 `ai@7.0.83`、`@ai-sdk/anthropic@4.0.44`、`@openrouter/ai-sdk-provider@3.0.0` 和 Vercel AI Gateway 的缓存类型与官方文档，不依赖计划编写时的参数记忆
- [ ] 1.3 为 Vercel Gateway、OpenRouter implicit、OpenRouter explicit、UMAPIS Anthropic、OpenAI/DeepSeek compatible、Ark、MiniMax 和 Cloudflare compatible 建立 probe 表，记录 marker passthrough、affinity、cache read/write usage、TTL 和数据保留结论
- [ ] 1.4 明确首批 `enabled` 路由；未完成 probe 的路由保持 `probe-required`，不得在注册表中推测为 supported
- [ ] 1.5 增加 server-only 缓存发布配置示例，覆盖总模式、按 route 覆盖、affinity HMAC salt、TTL policy、L2 cache 开关和受控 cohort，禁止 `NEXT_PUBLIC_`

## 2. Prompt Segment、Canonical Hash 与 Manifest

- [ ] 2.1 在 `constants/` 定义 Prompt Compiler、Agent Kernel、Branch Genesis、Tool Profile、Cache Profile 和 Provider Routing Policy 的版本常量，禁止在调用点散落版本字符串
- [ ] 2.2 新增 Prompt Segment 类型和纯函数构造器，覆盖 `agent-kernel`、`project-contract`、`inherited-history`、`branch-genesis`、`branch-history`、`runtime-tail`
- [ ] 2.3 实现稳定 JSON 序列化与 SHA-256 helper，保留模型可见空白和数组顺序，排除 Message/Trace/request ID、时间戳与 UI metadata
- [ ] 2.4 实现 `segmentContentHash`、`forkContextHash`、`toolProfileHash` 和最终 `requestPrefixHash`，并对属性顺序、对象重建、消息顺序、空白变化、Tool Schema 变化增加合同测试
- [ ] 2.5 定义 metadata-only `PromptManifest`，包含版本、Hash、段长度、Token 估计、候选边界、首个动态段、缓存资格和 reason code，不包含 Prompt 正文
- [ ] 2.6 为附件建立稳定性分类：不可变提取文本/快照可进入稳定段，临时签名 URL、上传中内容和运行期解析结果只能进入动态段或使该段不可缓存
- [ ] 2.7 对现有 `INHERITED_CHAR_BUDGET` 与 omitted notice 建立确定性测试，证明相同冻结上下文产生相同保留集合、提示文案和 Hash

## 3. 两阶段 Thread Chat Prompt Compiler

- [ ] 3.1 将 `compileModelContext()` 拆为可测试的 `compilePromptBase()` 与 `finalizeGenerationPrompt()`，保留 owner、Project、Thread 和冻结上下文完整性校验
- [ ] 3.2 让 `compilePromptBase()` 明确分离已完成 Branch History 与当前用户 Message，不再只返回扁平 `ModelMessage[]`
- [ ] 3.3 将稳定 Agent Kernel 改为 server-owned `SystemModelMessage[]`，删除其中的 Anchor、Research plan、request ID、时间戳和其他每轮动态内容
- [ ] 3.4 将 Anchor 与分支指代规则编译为确定性 Branch Genesis Context，并保证它位于 Frozen Inherited History 之后、Branch History 之前
- [ ] 3.5 将 Research mode、Research plan、动态记忆/引用占位和运行控制编译到 Runtime Tail，并保证它们位于全部稳定历史之后
- [ ] 3.6 调整 `runGeneration` / `prepareGeneration` 调用顺序：先编译 base，再解析 route/plan 和 Tool Profile，最后完成 Prompt 并调用模型
- [ ] 3.7 保持 Main Thread、空分支、带首轮分支、Retry、Edit/Supersede、Stop 和 Attachment 的现有 Message 语义，不修改客户端 Command/DTO
- [ ] 3.8 增加请求结构测试，证明两个相同 `forkContext`、不同 Anchor 的兄弟分支拥有相同 inherited-end Prefix Hash，首次差异只出现在 Branch Genesis
- [ ] 3.9 增加同分支续聊测试，证明旧 Branch Genesis 与已完成历史保持顺序和 Hash，只在尾部追加新运行上下文和当前用户消息

## 4. 稳定 Tool Profile 与 Step Policy

- [ ] 4.1 定义 `thread-answer-v1`、`thread-artifact-v1`、`thread-web-v1`、`thread-web-artifact-v1` 或经基线观测确认的最小 Profile 集合
- [ ] 4.2 重构 `buildGenerationTools()`，让每个 Profile 的工具名、描述、Schema 和顺序固定，动态 Message ID 只存在于 execute closure，不进入 Provider-visible Schema
- [ ] 4.3 让同一 Profile 的所有模型 Step 保持工具定义不变；`toolChoice`/first-tool 行为使用单独 policy version，并验证不会意外扩大 active tool 权限
- [ ] 4.4 增加 Tool Profile snapshot/hash 测试，任何描述、Schema、顺序或能力面变化都必须显式升级 Profile version
- [ ] 4.5 使用现有 core-answer、search-routing 和 Artifact case 验证 Profile 收敛未增加误调用、漏调用或工具循环

## 5. Resolved Model Route 与缓存能力注册

- [ ] 5.1 将 `resolveChatModel()` 的返回值扩展为 `ResolvedChatModel`，包含裸模型、Adapter、Gateway、上游模型、route ID、routing policy 和 cache capability
- [ ] 5.2 建立集中缓存能力注册表，支持 `implicit`、`explicit-breakpoint`、`gateway-auto`、`unsupported`、`probe-required`，并记录 affinity、usage、TTL、breakpoint 和 retention 能力
- [ ] 5.3 为当前所有模型注册表条目增加 route capability 解析测试，保证同一模型通过不同 Gateway/代理时可以获得不同策略
- [ ] 5.4 Vercel AI Gateway route 接入经类型验证的自动缓存 provider option，并记录实际 Gateway/Provider metadata
- [ ] 5.5 OpenRouter route 接入服务端 HMAC `session_id` 或 `x-session-id`，作用域为用户 + Project + 上游模型 + Cache Profile，验证兄弟 Thread 相同、跨用户/Project/模型不同且不暴露原始 ID
- [ ] 5.6 对 OpenRouter explicit 模型使用锁定 Provider 版本支持的 `providerOptions.openrouter.cacheControl` 或等价类型安全路径设置 breakpoint
- [ ] 5.7 对 UMAPIS、Ark、MiniMax、Cloudflare compatible 和其他 proxy 只在 probe 通过后启用；未验证时不得发送专属字段
- [ ] 5.8 当 Provider 拒绝缓存字段、affinity 或 TTL 时安全降级为普通模型请求并记录诊断，不改变回答、流式和终态
- [ ] 5.9 将 ZDR/region/provider allowlist/retention policy 纳入能力选择，extended caching 默认关闭且不能绕过数据政策

## 6. Breakpoint、资格与冷启动语义

- [ ] 6.1 在 Manifest 中生成 `kernel-end`、`inherited-end`、`thread-stable-end` 候选边界和长度/Token 估计
- [ ] 6.2 实现 Provider adapter 的 deterministic breakpoint selection，优先 inherited-end 与 thread-stable-end，并服从最小长度、最大 breakpoint 和 TTL 能力
- [ ] 6.3 对 implicit/Gateway auto route 保持同一候选边界与 Hash，但不伪造显式 marker
- [ ] 6.4 定义缓存资格 reason code，至少覆盖 eligible、below-minimum、cold-start、partial-warm、prefix-changed、tool-profile-changed、route-changed、ttl-expired/unknown、retention-disabled、unsupported、usage-unavailable
- [ ] 6.5 增加“从最新 assistant 立即分叉”测试，明确该输出此前可能未作为输入缓存，并与 warm-up 后的兄弟分支场景分开计分
- [ ] 6.6 对 5 分钟默认 TTL 和 1 小时 extended TTL 建立配置/能力测试；未完成会话停顿与成本评估前不得全局启用 extended TTL

## 7. Model Attempt、Cache Usage 与 Trace 扩展

- [ ] 7.1 在 `constants/observability.ts` 和 attribute allowlist 增加 Prompt Compiler、Kernel、Cache Profile、Tool Profile、Prefix/Fork Hash、route ID、资格和 routing policy 字段
- [ ] 7.2 实现 `PromptCacheUsage` 归一化器，按 AI SDK input token details、Provider metadata、Gateway metadata 顺序取证，并保留 source/complete；缺失字段使用 `undefined`
- [ ] 7.3 新增与 Search collector 平行的 `ModelAttemptEvent` / run collector，记录每个 Step 的 purpose、route、模型、usage、cache read/write、finish reason、耗时和安全枚举
- [ ] 7.4 将正式回答的 `onStepFinish` 或等价生命周期接入 collector，覆盖多步工具循环，不只记录最后一步
- [ ] 7.5 在 root Trace 和 assistant Message finalization 前生成运行级 cache summary，但不覆盖现有 raw `providerUsage` 或计费逻辑
- [ ] 7.6 保持 production metadata-only：日志、Langfuse 和 eval summary 只能收到 Hash、版本、Token 和枚举，禁止 Prompt、Anchor、Message、query、附件或网页正文
- [ ] 7.7 增加 usage adapter 测试，覆盖标准字段、OpenRouter metadata、Gateway metadata、部分字段、冲突字段、多 Step 聚合和完全 unavailable
- [ ] 7.8 增加 telemetry failure 测试，证明 collector、Hash、usage parsing 或 exporter 异常不能让成功生成变成 failed

## 8. Agent Eval、Scorer 与回归门禁

- [ ] 8.1 扩展 case schema，增加明确的 `prompt-cache` suite 或等价受控场景字段，保持旧 case 向后兼容或显式升级 schema version
- [ ] 8.2 扩展 `AgentExperimentResult`，加入 `modelAttempts` 和 run-level `cache` summary；更新 Langfuse adapter、fixture executor、baseline 和 compare
- [ ] 8.3 将 Prompt Compiler、Kernel、Cache Profile、Tool Profile、Provider route/routing policy 加入 candidate fingerprint，禁止不同缓存配置共用同一 candidate identity
- [ ] 8.4 建立 deterministic sibling-fork fixtures，断言 shared prefix、差异位置、breakpoint、Tool Profile、affinity key 和资格 reason
- [ ] 8.5 建立同分支多轮、Research mode 切换、Tool Profile 切换、模型切换、Provider fallback、TTL 和 unknown proxy fixtures
- [ ] 8.6 实现 cache diagnostic scorer：prefix equality、marker placement、eligible hit、read ratio、usage availability、route drift 和 TTFT；首阶段不覆盖质量/安全 hard score
- [ ] 8.7 在 scheduled/release 模式增加批准的 live provider probe：先 warm-up，再发送兄弟分支或同前缀请求，使用 Provider usage 证明 read；CI 不依赖外部缓存或网络
- [ ] 8.8 比较 baseline/candidate 的回答质量、Search route、工具行为、终态、cache usage 和 TTFT；任何安全、隔离或正确性 hard regression 阻断启用
- [ ] 8.9 收集足够样本并确认 Provider usage 稳定后，再为 eligible warm case 设置命中率或 TTFT 性能门禁

## 9. 分级缓存与运行期发布

- [ ] 9.1 实现 server-only `off`、`observe`、`enabled` 三态；`observe` 只生成候选 Manifest/Hash，不改变发送 Prompt 或 Provider 选项
- [ ] 9.2 在 staging 运行 `observe`，统计动态 system 变体、Tool Profile 分布、Prefix 长度、eligible 比例和 route 变化，形成首批启用证据
- [ ] 9.3 先对一个已验证 route 小范围启用 L1 Provider Cache，执行普通续聊、兄弟分支、Search、Artifact、Stop、Retry、错误和 fallback 验证
- [ ] 9.4 建立一键按 route 回到 `off` 的回滚步骤；Prompt Kernel/Compiler/Profile 升级必须视为预期冷启动并记录 release
- [ ] 9.5 定义 `CompiledSegmentCache` 接口、Key、租户 HMAC、TTL、容量和安全合同，先提供 noop/fake adapter 供测试
- [ ] 9.6 只有观测证明编译或数据库读取成为瓶颈后，才实现有界进程 LRU；记录命中、序列化成本、内存上限和失效行为
- [ ] 9.7 只有跨实例收益明确且完成 TLS、服务端鉴权、租户隔离、删除策略和数据审查后，才评估分布式 L2 Cache
- [ ] 9.8 明确禁止普通聊天 Exact Response Cache；未来需要时另立 change

## 10. 最终验证与文档

- [ ] 10.1 运行 `pnpm typecheck`、`pnpm lint`、`pnpm build`、全部 Thread Chat Gate、`pnpm test:observability`、`pnpm test:agent-evals` 和 `pnpm openspec:validate`
- [ ] 10.2 更新架构/运维文档，解释稳定前缀、冷启动、TTL、Provider route、Tool Profile、usage source、ZDR/retention 和回滚，不宣传无法保证的 100% 命中
- [ ] 10.3 记录每个已启用 route 的 probe 日期、包版本、官方能力、最小缓存长度、TTL、usage 字段和已知限制
- [ ] 10.4 在 staging 保存不含用户正文的验收证据：Trace/attempt 结构、Prefix Hash、Provider usage、质量对比、TTFT 和 fallback 行为
- [ ] 10.5 在 production cohort 验证 eligible fork hit rate、cache read ratio、真实成本 metadata、TTFT 和质量指标后再扩大启用范围
