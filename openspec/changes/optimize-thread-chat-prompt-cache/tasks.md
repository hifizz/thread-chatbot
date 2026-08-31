## 1. 实施基线、合同冻结与 Provider 能力核验

- [ ] 1.1 记录 `codex/feat-agent-observability-evaluation@30a540a315841f78a816adc761fb6bde37fedf7a` 的 `typecheck`、`build`、Thread Chat Gate、observability tests、agent eval CI 和 OpenSpec strict validation 基线
- [ ] 1.2 在实施前冻结 Quote V1、Quote model format、Prompt Compiler、Agent Kernel、Tool Profile、Cache Profile 和 Provider Routing Policy 的初始版本常量，禁止在调用点散落版本字符串
- [ ] 1.3 在实施当日重新核对锁定版本 `ai@7.0.83`、`@ai-sdk/anthropic@4.0.44`、`@openrouter/ai-sdk-provider@3.0.0` 和 Vercel AI Gateway 的缓存类型与官方文档
- [ ] 1.4 为 Vercel Gateway、OpenRouter implicit/explicit、UMAPIS Anthropic、OpenAI/DeepSeek compatible、Ark、MiniMax 和 Cloudflare compatible 建立 probe 表，记录 marker、affinity、cache read/write usage、TTL、minimum prefix 和 retention
- [ ] 1.5 优先选定一条真实 Claude route 作为首批 `enabled` 候选；未完成 probe 的 route 保持 `probe-required`
- [ ] 1.6 增加 server-only 缓存发布配置示例，覆盖 `off/observe/enabled`、route override、affinity HMAC salt、TTL/retention、L2 开关和受控 cohort，禁止 `NEXT_PUBLIC_`

## 2. Quote 领域类型、Parts 协议与兼容解析

- [ ] 2.1 在 `lib/thread-chat/contracts/` 定义 `ThreadQuoteKind`、`ThreadQuoteSourceV1`、`ThreadQuoteDataV1`、`LegacyThreadQuoteData` 和 `ThreadQuoteData`，新写入版本为 `thread-quote-v1`
- [ ] 2.2 将 `ThreadChatDataParts.quote` 从 `{ text }` 扩展为 `ThreadQuoteData`，保持 `MessageDTO.parts` 为唯一 DTO 入口，不增加顶层 `quotes`
- [ ] 2.3 增加 Zod/runtime parser `parseThreadQuoteData()`，把 V1 和 legacy 规范化为统一只读视图；所有读取路径禁止未经解析的类型断言
- [ ] 2.4 在 `constants/thread-chat.ts` 定义 Quote 数量、单份字符、总字符和 Message Part 排序限制，并对边界值增加测试
- [ ] 2.5 定义 Quote 唯一性规则（source Message + TextAnchor），实现保序去重 helper，保证自动 branch-origin 永远位于第一项
- [ ] 2.6 增加 Quote 类型合同测试，覆盖 0/1/2/8 份、legacy、非法 schema、非法 anchor、重复项、超长和总预算超限

## 3. Quote Command DTO 与服务端来源解析

- [ ] 3.1 新增 `QuoteSelectionInput { sourceThreadId, sourceMessageId, anchor }` 及 Zod schema；客户端不得提交 `quoteId/projectId/kind/text`
- [ ] 3.2 为 `SendMessageCommand` 增加可选 `quotes`，默认空数组；为 `ForkThreadCommand.firstTurn` 增加可选 `additionalQuotes`
- [ ] 3.3 明确 `StartProjectCommand` 不接受 Quote；`EditLatestTurnCommand` 第一版不接受 Quote 变更，只保留原 Quote Parts
- [ ] 3.4 实现批量 `resolveQuoteSelections()`：验证 owner、同 Project、source Thread/Message 关系、允许引用状态、Anchor、数量和总字符，避免 N+1
- [ ] 3.5 明确来源 Message 的首阶段允许状态并增加测试；不得引用 generating/无稳定正文/无权访问的 Message
- [ ] 3.6 实现 `buildBranchOriginQuote()`，只从已经锁定验证的 Fork 数据生成 `kind=branch-origin` 的 V1 Quote
- [ ] 3.7 验证 `quote.text === quote.source.anchor.quote.exact`，Quote source 使用真实 UUID，不接受 UI 的 `main` 别名、标题或脚注作为身份
- [ ] 3.8 增加来源验证测试，覆盖跨用户、跨 Project、Message 不属于 Thread、superseded、非法 position、相同 exact 多处和重复选择

## 4. Quote 数据库语义与用户 Message 构造

- [ ] 4.1 保持 `threads` Fork 字段和 `messages.parts` JSONB 表结构不变，在设计/代码注释中固定“Fork 拓扑事实 vs Message Quote Snapshot”职责
- [ ] 4.2 将 `buildUserParts(text, files)` 重构为对象参数并接收已经验证的 `quotes`，输出顺序固定为 Quote Parts、Text Part、File Parts
- [ ] 4.3 在 `forkThread(firstTurn)` 同一事务内创建 branch-origin Quote、解析 additional Quotes，并写入 B1；校验 Thread Fork 字段与 Quote 完全一致
- [ ] 4.4 在 `sendMessage()` 识别 ForkedThread 当前有效时间线是否尚无 user Message；若是，自动注入 branch-origin Quote，再合并命令 Quotes
- [ ] 4.5 验证“弹窗直接带问”与“空分支后第一次发送”产生等价 B1 Parts 和模型输入
- [ ] 4.6 修改 `editLatestTurn()`：原顺序保留所有合法 persistent Quote Parts，只替换文本和附件；Quote 解析失败时拒绝静默丢失
- [ ] 4.7 验证 `retryMessage()` 继续使用同一 User Message Parts，不复制或重建 Quote
- [ ] 4.8 增加数据库/API 合同测试，覆盖 B1 多 Quote、idempotent command replay、Edit/Supersede、Retry、Stop、Project bootstrap 和 JSONB round-trip
- [ ] 4.9 不新增 Quote 表；在后端文档记录未来只有在反向查询、跨 Project 或独立权限需要出现时才评估派生 `message_quote_refs` 索引

## 5. Quote-to-model 协议与稳定 Agent Kernel

- [ ] 5.1 在集中模块定义 `THREAD_QUOTE_MODEL_FORMAT_VERSION` 和 `quoteTextToModelText(text)`；helper 类型上只接受正文，不能接收整个 Quote 对象
- [ ] 5.2 使用确定性可逆格式表达换行、引号、代码和 delimiter-like 内容；对相同正文保证 byte-for-byte 相同输出
- [ ] 5.3 实现 `threadQuotePartToModelText()`，先解析 V1/legacy，再只序列化 `text`
- [ ] 5.4 修改模型消息编译，使一条 Message 的全部 Quote Parts 按顺序转换为多个 Quote block，随后是当前文本和文件
- [ ] 5.5 增加测试证明 `quoteId/kind/projectId/threadId/messageId/TextAnchor/title/footnote` 永远不进入模型文本、Prefix Hash、日志或 production telemetry
- [ ] 5.6 将稳定 Quote 解释规则写入 Agent Kernel：Quote 是上下文数据，普通文本是请求，指代按 Quote 顺序解析，多 Quote 可比较/综合，Quote 指令不得提升优先级
- [ ] 5.7 删除具体 `anchorText` 的 system prompt 拼装和旧单 Quote 自然语言拼接；通过 core-answer、instruction-following 和 prompt-injection cases 验证语义
- [ ] 5.8 为历史 ForkedThread B1 缺少 Quote 的情况实现 deterministic model-only branch-origin Quote 兼容视图，不立即回写旧 Message

## 6. Cache 元素分类、Prompt Segment、Canonical Hash 与 Manifest

- [ ] 6.1 建立可执行的 Cache Stability Registry/类型，要求每个 Prompt 元素声明 `modelVisible`、`stability`、`segment` 和 `cacheImpact`
- [ ] 6.2 将 Prompt Segment 固定为 `agent-kernel`、`project-contract`、`inherited-history`、`branch-history`、`runtime-control`、`current-user`，删除 Branch Genesis Segment
- [ ] 6.3 实现稳定序列化与 SHA-256 helper，保留模型可见角色、Part 顺序和空白，排除 IDs、时间戳、UI metadata 和 Quote source metadata
- [ ] 6.4 实现 `segmentContentHash`、`forkContextHash`、`toolProfileHash`、`stableRequestPrefixHash` 和可选 `fullRequestShapeHash`
- [ ] 6.5 定义 metadata-only `PromptManifest`，加入 Compiler/Kernel/Quote Protocol/Quote Format/Profile/Route 版本、Prefix Hash、边界、长度、Token 估计、当前 Quote 数量和资格 reason
- [ ] 6.6 证明 B1 当前 Quote/text 不进入 `inherited-end` Hash；到 B2 时历史 B1 的模型可见 Quote/text 正确进入 `branch-history-end` Hash
- [ ] 6.7 为属性顺序、对象重建、Message/Part 顺序、空白、Quote metadata、Quote text、Tool Schema 和版本变化增加合同测试
- [ ] 6.8 对现有 `INHERITED_CHAR_BUDGET` 与 omitted notice 建立确定性测试；算法或文案改变必须升级 Compiler/Context Policy 版本
- [ ] 6.9 为附件建立稳定性分类：当前附件位于用户尾部；只有不可变服务端快照才能在未来进入稳定历史

## 7. 两阶段 Thread Chat Prompt Compiler

- [ ] 7.1 将 `compileModelContext()` 拆为 `compilePromptBase()` 与 `finalizeGenerationPrompt()`，保留 owner、Project、Thread、Quote 和冻结上下文完整性校验
- [ ] 7.2 `compilePromptBase()` 明确分离 Frozen Inherited History、已完成 Branch History 和当前 User Message，不再只返回扁平 `ModelMessage[]`
- [ ] 7.3 Agent Kernel 改为 server-owned 稳定 `SystemModelMessage[]`，禁止 Anchor、Research plan、request ID、时间戳和每轮动态数据
- [ ] 7.4 将 Research mode、Research plan、动态记忆/引用运行控制放入 Runtime Control，并保证位于全部稳定历史之后
- [ ] 7.5 调整 `runGeneration` / `prepareGeneration` 调用顺序：编译 Base、解析 route/plan/Profile、完成 Prompt、调用模型
- [ ] 7.6 增加请求结构测试：相同 `forkContext`、不同 Quote/问题的兄弟分支拥有相同 `inherited-end` Hash，首次差异位于 Current User
- [ ] 7.7 增加同分支续聊测试：历史 B1 Quotes/问题与 BA1 进入 `branch-history-end`，当前 B2 位于其后
- [ ] 7.8 保持 Main Thread、带首轮/空分支、Retry、Edit/Supersede、Stop 和 Attachment 的现有终态语义

## 8. 稳定 Tool Profile 与 Step Policy

- [ ] 8.1 定义 `thread-answer-v1`、`thread-artifact-v1`、`thread-web-v1`、`thread-web-artifact-v1` 或经 observe 数据确认的最小 Profile 集合
- [ ] 8.2 重构 `buildGenerationTools()`，让每个 Profile 的工具名、描述、Schema 和顺序固定，动态 Message ID 只存在于 execute closure
- [ ] 8.3 同一 Profile 的所有模型 Step 保持工具定义不变；`toolChoice`/first-tool 使用单独 policy version
- [ ] 8.4 增加 Tool Profile snapshot/hash 测试，描述、Schema、顺序或权限变化必须显式升级版本
- [ ] 8.5 使用 core-answer、search-routing 和 Artifact cases 验证 Profile 收敛未增加误调用、漏调用或工具循环

## 9. Resolved Model Route、Claude 缓存与 Provider Adapter

- [ ] 9.1 将 `resolveChatModel()` 扩展为 `ResolvedChatModel`，包含模型、Adapter、Gateway、上游模型、route ID、routing policy 和 cache capability
- [ ] 9.2 建立集中能力注册表，支持 `implicit`、`explicit-breakpoint`、`gateway-auto`、`unsupported`、`probe-required`，记录 affinity、usage、TTL、minimum prefix、breakpoint 和 retention
- [ ] 9.3 为当前全部模型注册项增加 route capability 解析测试；同一 app model 通过不同 Gateway/代理可获得不同策略
- [ ] 9.4 Vercel AI Gateway route 接入经类型验证的自动缓存 option，并记录实际 Gateway/Provider metadata
- [ ] 9.5 OpenRouter route 接入服务端 HMAC session affinity，作用域为用户 + Project + upstream model + Cache Profile；兄弟相同，跨用户/Project/模型不同
- [ ] 9.6 对已验证的 Claude explicit route，在 `inherited-end`/`branch-history-end` 应用锁定版本支持的 cache control
- [ ] 9.7 对 UMAPIS、Ark、MiniMax、Cloudflare compatible 和其他 proxy 只在 probe 通过后启用；未验证时不得发送专属字段
- [ ] 9.8 Provider 拒绝 cache/affinity/TTL 时安全降级为普通请求并记录诊断，不改变流式和 Message 终态
- [ ] 9.9 将 ZDR/region/provider allowlist/retention 纳入能力选择；extended caching 默认关闭

## 10. Breakpoint、资格、冷启动与成本语义

- [ ] 10.1 在 Manifest 中生成 `kernel-end`、`inherited-end`、`branch-history-end` 边界和长度/Token 估计
- [ ] 10.2 实现 deterministic breakpoint selection，优先 inherited 与 branch history，并服从 minimum prefix、max breakpoints、TTL 和 retention
- [ ] 10.3 对 implicit/Gateway auto route 保持边界与 Hash，但不伪造 marker
- [ ] 10.4 定义 reason code：eligible、below-minimum、cold-start、partial-warm、prefix-changed、tool-profile-changed、route-changed、ttl-expired/unknown、retention-disabled、unsupported、usage-unavailable
- [ ] 10.5 增加“从最新 assistant 立即分叉”与“warm-up 后兄弟分支”对比测试，不把合法 cold-start 计为架构失败
- [ ] 10.6 对短 TTL 与 extended TTL 建立能力/配置/保留测试；未完成会话停顿和 cache write/read 摊销前不得全局启用 extended
- [ ] 10.7 优先使用 Provider/Gateway 真实 cost metadata计算 Claude 输入成本变化；缺少真实价格时只报告 Token

## 11. Model Attempt、Cache Usage、Trace 与 Agent Eval

- [ ] 11.1 扩展 observability allowlist：Compiler、Kernel、Quote Protocol/Format、Cache/Profile、Tool Profile、Prefix/Fork Hash、route、资格和 Quote count
- [ ] 11.2 实现 `PromptCacheUsage` 归一化器，按 AI SDK、Provider metadata、Gateway metadata 顺序取证，保留 source/complete，缺失为 `undefined`
- [ ] 11.3 新增与 Search collector 平行的 `ModelAttemptEvent` / run collector，覆盖每个 Step 的 route、model、usage、cache read/write、finish reason、TTFT、duration 和安全枚举
- [ ] 11.4 将正式回答的 `onStepFinish` 或等价生命周期接入 collector，覆盖多步工具循环
- [ ] 11.5 在 root Trace 和 eval result 生成 run-level cache summary，但不覆盖 raw `providerUsage` 或计费逻辑
- [ ] 11.6 保持 production metadata-only：禁止 Prompt、Quote text/source/Anchor、Message、query、附件、网页正文和隐藏推理
- [ ] 11.7 扩展 Agent case/result/fingerprint，新增 Quote-aware `prompt-cache` cases、`modelAttempts` 和 cache summary
- [ ] 11.8 建立 deterministic fixtures：多 Quote、metadata exclusion、两条 B1 创建路径、Edit 保留、legacy fallback、sibling prefix、同分支续聊、Tool/route/TTL 变化
- [ ] 11.9 Scheduled/release 对批准 Claude route执行 warm-up + sibling/continuation live probe，使用 Provider Usage 证明 read
- [ ] 11.10 任何安全、隔离、正确性、工具或终态 hard regression 阻断缓存启用，即使成本改善

## 12. 分级缓存、渐进发布与后端验收

- [ ] 12.1 实现 server-only `off`、`observe`、`enabled`；`observe` 只影子生成 Quote model view、Manifest/Hash/资格，不改变发送 Prompt
- [ ] 12.2 在 staging 统计旧动态 system、Tool Profile、Prefix 长度、Quote 数量、eligible 比例和 route 变化，形成首批启用证据
- [ ] 12.3 先对一个已验证 Claude route 小范围启用 L1，执行普通续聊、兄弟分支、多 Quote、Search、Artifact、Stop、Retry、错误和 fallback 验证
- [ ] 12.4 建立 route 级一键回到 `off` 的步骤；Kernel/Quote Format/Compiler/Profile 升级视为预期冷启动
- [ ] 12.5 定义 `CompiledSegmentCache` 接口、tenant HMAC、Key、TTL、容量和安全合同，先提供 noop/fake adapter
- [ ] 12.6 只有观测证明编译/DB 成为瓶颈后才实现有界进程 LRU；跨实例收益和数据审查完成后才评估分布式 L2
- [ ] 12.7 明确禁止普通聊天 Exact Response Cache；长期摘要和反向 Quote 索引另立 change
- [ ] 12.8 运行 `pnpm typecheck`、`pnpm lint`、`pnpm build`、全部 Thread Chat Gate、`pnpm test:observability`、`pnpm test:agent-evals` 和 `pnpm openspec:validate`
- [ ] 12.9 保存不含用户正文的 staging 验收证据：B1 Parts、模型文本、Prefix Hash、marker、Provider Usage、TTFT、成本、质量和 fallback

## 13. 前端阶段交接（本 change 不实施）

- [ ] 13.1 输出前端合同说明：Composer Draft 如何携带 `QuoteSelectionInput[]`、DTO 如何读取重复 `data-quote`、Quote ID 和来源字段的稳定语义
- [ ] 13.2 记录下一阶段需要调研的组件：多引用 Composer、Quote Pill、顺序/删除、来源选择、点击打开 Thread、定位 Message、Anchor 高亮和失败降级
- [ ] 13.3 明确前端不得自行构造持久化 V1 Quote，不得把标题/脚注当身份，不得把屏幕坐标或 DOM 路径写入后端
- [ ] 13.4 在后端合同通过评审前不实现新的 Composer，避免 UI 与数据协议并行漂移