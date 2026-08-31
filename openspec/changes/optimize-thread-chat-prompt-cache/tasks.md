## 1. 最新基线与实施前校准

- [ ] 1.1 以 `codex/feat-agent-observability-evaluation@2f3024747ddb72e1e69aa916cb45addb7140f6ab` 记录 `typecheck`、`build`、Thread Chat Gate、observability tests、agent eval CI 和 OpenSpec strict validation 基线
- [ ] 1.2 冻结 Quote Protocol、Quote Model Format、Prompt Compiler、Agent Kernel、Tool Profile、Cache Profile 和 Provider Routing Policy 的初始版本常量
- [ ] 1.3 核对锁定版本 `ai@7.0.83`、`@ai-sdk/anthropic@4.0.44`、`@openrouter/ai-sdk-provider@3.0.0` 和 Vercel AI Gateway 的缓存类型与官方文档
- [ ] 1.4 为 Vercel Gateway、OpenRouter implicit/explicit、UMAPIS Anthropic、Private Relay、OpenAI/DeepSeek compatible、Ark、MiniMax 和 Cloudflare compatible 建立 route probe 表
- [ ] 1.5 Probe 表至少记录 marker 透传、affinity、cache read/write Usage、TTL、minimum prefix、breakpoint 上限、错误降级和 retention/ZDR
- [ ] 1.6 选择一条真实 Claude route 作为首批候选；未验证 route 保持 `probe-required`
- [ ] 1.7 增加 server-only 缓存发布配置，覆盖 `off/observe/enabled`、route override、affinity HMAC salt、TTL/retention 和受控 cohort

## 2. Quote V1 类型、Parts 协议与兼容解析

- [ ] 2.1 定义 `THREAD_QUOTE_SCHEMA_VERSION`、`ThreadQuoteKind`、`ThreadQuoteSourceV1`、`ThreadQuoteDataV1`、`LegacyThreadQuoteData` 和 `ThreadQuoteData`
- [ ] 2.2 将 `ThreadChatDataParts.quote` 从 `{ text }` 扩展为 `ThreadQuoteData`
- [ ] 2.3 保持 `MessageDTO.parts` 为唯一 Quote DTO 入口，不增加顶层 `quotes`
- [ ] 2.4 实现 Zod/runtime `parseThreadQuoteData()`，把 V1 与 legacy 转成统一 `NormalizedThreadQuote`
- [ ] 2.5 所有数据库、UI 投影和模型编译读取 Quote 时先经过 parser，禁止未经验证的类型断言
- [ ] 2.6 在 `constants/thread-chat.ts` 定义 Quote 数量、单份字符、总字符和 Part 顺序限制
- [ ] 2.7 实现 source Message + TextAnchor 的保序去重 helper
- [ ] 2.8 增加 0、1、2、8 份 Quote、legacy、非法 schema、非法 anchor、重复、单份超长和总预算超限测试

## 3. Command DTO 与服务端 Quote 来源解析

- [ ] 3.1 定义 `QuoteSelectionInput { sourceThreadId, sourceMessageId, anchor }` 及 Zod schema
- [ ] 3.2 为 `SendMessageCommand` 增加 `quotes: QuoteSelectionInput[]`，默认空数组
- [ ] 3.3 为 `ForkThreadCommand.firstTurn` 增加 `additionalQuotes`，自动 branch-origin 不占客户端输入
- [ ] 3.4 明确 `StartProjectCommand` 不接受 Quote；`EditLatestTurnCommand` v1 不接受 Quote 增删
- [ ] 3.5 实现批量 `resolveQuoteSelections()`，验证 owner、同 Project、Thread/Message 关系、来源状态、Anchor、数量和总字符，避免 N+1
- [ ] 3.6 在实施校准中决定 stopped assistant Message 是否允许引用，并用常量/策略表达
- [ ] 3.7 实现 `buildBranchOriginQuote()`，只从已锁定验证的 Fork 数据生成
- [ ] 3.8 服务端生成 `quoteId/projectId/kind/text`；客户端不得直接写入这些字段
- [ ] 3.9 验证 `quote.text === quote.source.anchor.quote.exact`
- [ ] 3.10 增加跨用户、跨 Project、Message 不属于 Thread、superseded/generating/failed、非法 position 和重复 selection 测试

## 4. 数据库职责与 Message Parts 写入

- [ ] 4.1 保持 `threads` Fork 字段和 `messages.parts` JSONB 表结构不变，不生成数据库迁移
- [ ] 4.2 在代码注释和架构文档中固定：Thread Fork 是拓扑事实，Message Quote 是消息快照
- [ ] 4.3 将 `buildUserParts(text, files)` 改为对象参数并接收已验证 `quotes`
- [ ] 4.4 固定输出顺序为 `data-quote* -> text -> file*`
- [ ] 4.5 在 `forkThread(firstTurn)` 同一事务内创建 branch-origin Quote、额外 Quotes、B1 和 assistant placeholder
- [ ] 4.6 在 `sendMessage()` 检测 ForkedThread 是否尚无有效 user Message；如果是，自动注入 branch-origin Quote
- [ ] 4.7 对自动 origin 与 additional/command Quotes 统一去重，自动 origin 始终第一
- [ ] 4.8 验证“弹窗直接带问”和“空分支后首问”的 B1 Parts、DTO 和模型视图等价
- [ ] 4.9 增加 Project bootstrap、JSONB round-trip 和幂等 command replay 测试
- [ ] 4.10 记录未来反向引用索引表的触发条件，不在本 change 新增 `message_quote_refs`

## 5. Edit、Retry 与历史兼容

- [ ] 5.1 修改 `editLatestTurn()`，原顺序保留来源 User Message 的所有合法 persistent Quote Parts，只替换 Text/File
- [ ] 5.2 Quote ID、正文、来源和 Anchor 在普通文本编辑中保持不变
- [ ] 5.3 遇到非法持久化 Quote 时报告数据冲突，不得静默删除
- [ ] 5.4 验证 `retryMessage()` 继续使用同一 User Message，不复制或重建 Quote
- [ ] 5.5 历史 `{ text }` Quote 继续展示和送模，但来源导航不可用
- [ ] 5.6 对历史 ForkedThread 的第一条 User Message 缺少 Quote 的情况生成 deterministic model-only branch-origin Quote
- [ ] 5.7 新写入一律使用 V1，不继续产生 legacy payload

## 6. Quote-to-model 工具函数与稳定 Kernel

- [ ] 6.1 定义 `THREAD_QUOTE_MODEL_FORMAT_VERSION`
- [ ] 6.2 实现 `quoteTextToModelText(text)`，类型上只接受正文，禁止整个 Quote 对象被序列化
- [ ] 6.3 使用确定性可逆编码支持换行、引号、代码和 `</thread_quote>` 等 delimiter-like 正文
- [ ] 6.4 实现 `threadQuotePartToModelText(data)`，先 parser，再只序列化 `text`
- [ ] 6.5 修改模型上下文编译，按 Message Parts 顺序转换全部 Quote，随后转换 Text/File
- [ ] 6.6 增加测试证明 quoteId、kind、Project/Thread/Message ID、TextAnchor、标题、脚注和 UI/Trace 元信息永不进入模型文本
- [ ] 6.7 把稳定 Quote 规则写入 Agent Kernel，删除具体 `anchorText` 的 system 拼装
- [ ] 6.8 增加 Quote 中命令式文本、单 Quote 指代、多 Quote 比较、冲突和显式转移话题的质量测试

## 7. Cache Stability Registry、Segment 与 Hash

- [ ] 7.1 定义每个 Prompt 元素必须声明的 `modelVisible/stability/segment/cacheImpact` 合同
- [ ] 7.2 Prompt Segment 固定为 `agent-kernel/project-contract/inherited-history/branch-history/runtime-control/current-user`
- [ ] 7.3 删除原 Branch Genesis Segment；具体 Quote 只存在于 User Message
- [ ] 7.4 实现稳定序列化与 SHA-256 helper，保留模型可见 role、Part 顺序和空白，排除内部元信息
- [ ] 7.5 实现 `segmentContentHash`、`forkContextHash`、`toolProfileHash`、`stableRequestPrefixHash` 和可选 `fullRequestShapeHash`
- [ ] 7.6 定义 `PromptManifest`，包含 Compiler/Kernel/Quote Protocol/Quote Format/Profile/Route 版本、边界、长度、Token 估计、当前 Quote 数量和资格 reason
- [ ] 7.7 证明 B1 不进入 `inherited-end` Hash；到 B2 时历史 B1 Quote/Text 正确进入 `branch-history-end`
- [ ] 7.8 对属性顺序、对象重建、Message/Part 顺序、空白、Quote metadata、Quote text、Tool Schema 和版本变化增加合同测试
- [ ] 7.9 对 `INHERITED_CHAR_BUDGET` 和 omitted notice 建立确定性测试；改变算法或文案必须升级版本
- [ ] 7.10 为当前附件、签名 URL、不可变附件快照定义稳定性分类

## 8. 两阶段 Prompt Compiler

- [ ] 8.1 将 `compileModelContext()` 拆为 `compilePromptBase()` 与 `finalizeGenerationPrompt()`
- [ ] 8.2 `compilePromptBase()` 分离 Frozen Inherited History、Stable Branch History 和 Current User
- [ ] 8.3 保留 owner、Project、Thread、Quote、附件和冻结上下文完整性校验
- [ ] 8.4 Agent Kernel 改为稳定 server-owned `SystemModelMessage[]`
- [ ] 8.5 Research mode/plan、动态记忆和当前运行控制进入 Runtime Control，位于稳定历史之后
- [ ] 8.6 调整 `runGeneration/prepareGeneration` 顺序：Base -> route/plan/profile -> finalize -> streamText
- [ ] 8.7 正式 `streamText()` 只能消费编译结果，不再自行拼 system/messages/tools/cache 参数
- [ ] 8.8 增加兄弟分支请求结构测试：相同 `forkContext`、不同 Quote/问题得到相同 `inherited-end` Hash
- [ ] 8.9 增加同分支续聊测试：B1/BA1 进入 `branch-history-end`，B2 位于尾部
- [ ] 8.10 保持 Main Thread、Fork、Edit/Retry/Stop、附件和终态语义不变

## 9. Tool Profile 与 Step Policy

- [ ] 9.1 定义 `thread-answer-v1`、`thread-artifact-v1`、`thread-web-v1`、`thread-web-artifact-v1` 或 observe 后确认的最小集合
- [ ] 9.2 让每个 Profile 的工具名、描述、Schema 和顺序固定
- [ ] 9.3 Message ID、route reason、query 和当前实体 ID 只进入 execute closure，不进 Provider-visible Schema
- [ ] 9.4 同一 Profile 的全部模型 Step 保持工具定义一致；`toolChoice` policy 单独版本化
- [ ] 9.5 Tool 描述、Schema、顺序或权限变化必须升级 Profile version
- [ ] 9.6 使用 core-answer、search-routing 和 Artifact cases 验证误调用、漏调用和工具循环

## 10. Resolved Model Route 与 Provider Cache Capability

- [ ] 10.1 将 `resolveChatModel()` 扩展为 `ResolvedChatModel`
- [ ] 10.2 `ResolvedChatModel.route.adapter` 支持 Gateway、OpenRouter、Anthropic、OpenAI-compatible、Private Relay、Ark 和 MiniMax
- [ ] 10.3 能力注册表支持 `implicit/explicit-breakpoint/gateway-auto/unsupported/probe-required`
- [ ] 10.4 能力记录 affinity、read/write Usage、TTL、minimum prefix、max breakpoints 和 retention class
- [ ] 10.5 同一 app model 经不同 Gateway/代理时必须得到不同 route ID 和能力
- [ ] 10.6 Vercel Gateway 接入类型验证后的自动缓存 option
- [ ] 10.7 OpenRouter 接入服务端 HMAC affinity；同 Project/模型兄弟相同，跨用户/Project/模型不同
- [ ] 10.8 对已验证 Claude route 在 `inherited-end/branch-history-end` 应用 explicit cache control
- [ ] 10.9 UMAPIS 与 Private Relay 即使上游为 Claude，也必须分别 probe marker、Usage、TTL 和降级
- [ ] 10.10 Ark、MiniMax、Cloudflare compatible 和其他 proxy 未验证时不发送专属缓存字段
- [ ] 10.11 Provider 拒绝缓存参数时降级普通请求，不改变 Message 终态
- [ ] 10.12 ZDR、region、Provider allowlist 和 retention 纳入能力选择，extended TTL 默认关闭

## 11. Breakpoint、冷启动、Usage 与成本

- [ ] 11.1 Manifest 生成 `kernel-end/inherited-end/branch-history-end` 边界和长度/Token 估计
- [ ] 11.2 实现 deterministic breakpoint selection，优先 inherited 和 branch history
- [ ] 11.3 服从 minimum prefix、max breakpoints、TTL 和 retention
- [ ] 11.4 Implicit/Gateway auto route 保留边界与 Hash，但不伪造 marker
- [ ] 11.5 定义 eligibility/outcome reason：eligible、below-minimum、cold-start、partial-warm、prefix-changed、tool-profile-changed、route-changed、ttl-expired/unknown、retention-disabled、unsupported、usage-unavailable
- [ ] 11.6 对“最新 assistant 立即分叉”和“warm-up 后兄弟分支”建立对照测试
- [ ] 11.7 实现 `PromptCacheUsage`，按 AI SDK、Provider metadata、Gateway metadata 顺序取证
- [ ] 11.8 缺失值保持 `undefined`；多来源冲突标记 `complete=false`
- [ ] 11.9 每个模型 Step 产生 `ModelAttemptEvent`，覆盖多步工具循环
- [ ] 11.10 优先使用真实 Provider/Gateway cost metadata 计算 Claude 成本变化；无真实价格只报告 Token

## 12. Observability、Agent Eval 与渐进发布

- [ ] 12.1 扩展 observability allowlist：Compiler、Kernel、Quote Protocol/Format、Cache/Profile、Tool Profile、Prefix/Fork Hash、route、资格和 Quote count
- [ ] 12.2 保持 production metadata-only，禁止 Prompt、Quote text/source/Anchor、Message、query、附件、网页正文和隐藏推理
- [ ] 12.3 扩展 Agent case/result/fingerprint，增加 Quote-aware prompt-cache cases、modelAttempts 和 run-level cache summary
- [ ] 12.4 建立 deterministic fixtures：多 Quote、metadata exclusion、两条 B1 路径、Edit 保留、legacy fallback、siblings、续聊、Tool/route/TTL 变化
- [ ] 12.5 Scheduled/release 对批准 Claude route 执行 warm-up + sibling/continuation live probe
- [ ] 12.6 比较 cache read/write、TTFT、真实成本和回答质量；安全、隔离、工具、正确性或终态 hard regression 一律阻断
- [ ] 12.7 实现 server-only `off/observe/enabled`；observe 不改变实际请求
- [ ] 12.8 staging 统计动态 system、Tool Profile、Prefix 长度、Quote 数量、eligible 比例和 route drift
- [ ] 12.9 首先只对一条已验证 Claude route 小 cohort 启用
- [ ] 12.10 建立 route 级一键回到 `off` 的步骤；版本升级记录预期冷启动

## 13. L2 边界、最终验收与前端交接

- [ ] 13.1 定义 `CompiledSegmentCache`、tenant HMAC Key、TTL、容量和安全合同，默认 noop
- [ ] 13.2 只有观测证明应用编译/DB 成为瓶颈后才实现有界进程 LRU
- [ ] 13.3 跨实例收益和 TLS/鉴权/租户隔离/删除策略完成后才评估分布式 KV
- [ ] 13.4 明确禁止普通聊天 Exact Response Cache；长期摘要与反向 Quote 索引另立 change
- [ ] 13.5 运行 `pnpm typecheck`、`pnpm lint`、`pnpm build`、全部 Thread Chat Gate、`pnpm test:observability`、`pnpm test:agent-evals` 和 `pnpm openspec:validate`
- [ ] 13.6 保存不含正文的 staging 验收证据：B1 Parts、模型文本结构、Prefix Hash、marker、Provider Usage、TTFT、成本、质量和 fallback
- [ ] 13.7 输出前端合同：Composer Draft 使用 `QuoteSelectionInput[]`，DTO 读取重复 `data-quote`，Quote ID/source/Anchor 的稳定语义
- [ ] 13.8 记录下一阶段前端调研模块：多引用 Composer、Quote Pill、排序/删除、来源选择、点击打开 Thread、Message 定位、Anchor 高亮和失败降级
- [ ] 13.9 后端合同评审通过前不实现新 Composer，避免 UI 与数据协议并行漂移