## Purpose

为 Thread Chat 建立缓存友好、Provider-aware、可观测且可评测的 Prompt 编译与运行契约，使冻结祖先上下文能够在兄弟分支和后续轮次中尽可能复用，同时保证 Quote Draft、工具权限、隐私边界、回答正确性和数据库事实源不被缓存优化破坏。

## ADDED Requirements

### Requirement: Prompt compilation classifies every input element

系统 MUST 将所有可能进入模型请求的元素分类为 `stable-prefix`、`dynamic-tail`、`non-model-metadata` 或 `intentional-partition`。任何新元素在进入 System、Tools 或 Messages 前 MUST 声明模型是否需要看到、变化频率、位置、失效范围和观测方式。

#### Scenario: A new runtime field is introduced
- **WHEN** 新能力希望把时间、计划、记忆、来源或控制信息加入 Prompt
- **THEN** 它必须先进入缓存稳定性矩阵；不得直接拼到 System 或共同历史前部

#### Scenario: An identifier is only needed by the product
- **WHEN** Quote ID、Thread ID、Message ID、Artifact ID、TextAnchor、标题、脚注或列位置只用于产品导航
- **THEN** 它被分类为 non-model-metadata，完全不发送给模型

#### Scenario: Model or permission changes
- **WHEN** 实际模型线路、Tool Profile、Kernel 版本或保留政策变化
- **THEN** 系统将其记录为 intentional partition，而不是伪装成可共享缓存

### Requirement: Prompt compilation exposes ordered stable and dynamic segments

系统 MUST 通过版本化 Prompt Compiler 生成以下有序 Segment：Agent Kernel、可选 Project Contract、Frozen Inherited History、Stable Branch History、Runtime Control 和 Current User。正式模型调用 MUST 使用编译结果，不得在调用点独立拼接 System、Messages、Tools 和缓存参数。

```text
Tool Profile
System: Agent Kernel + optional Project Contract
Messages: Frozen Inherited History + Stable Branch History + Runtime Control + Current User
```

#### Scenario: A normalized generation is prepared
- **WHEN** 已提交 assistant Message 开始生成
- **THEN** 系统生成包含 Segment、Tool Profile、Route 和候选边界的 Prompt Manifest，并由同一个结果构造 `streamText` 请求

#### Scenario: Project Contract is absent
- **WHEN** 当前 Project 尚无 Contract
- **THEN** 对应 Segment 为空，不插入随机占位、时间戳或每轮变化文本

### Requirement: Sibling forks preserve an identical inherited prefix

对于相同有效模型 Route、Compiler/Kernel/Project/Tool Profile 与相同冻结 `forkContext` 的兄弟 Thread，系统 MUST 在 Current User Quote 出现之前产生相同的 Provider-visible 前缀。具体 `anchorText`、Quote/comment、Thread ID、Research plan 和当前问题 MUST NOT 出现在 inherited prefix 中。

#### Scenario: Two forks select different text from the same source
- **WHEN** 两个兄弟分支拥有相同 `forkContext`，但 branch-origin Quote 不同
- **THEN** 两次请求的 `inherited-end` Prefix Hash 相同，首次差异只出现在各自 Current User

#### Scenario: Empty branch is created without a question
- **WHEN** 用户只创建 ForkedThread 并让 Quote Block 进入 Composer
- **THEN** 不产生模型请求，因此不会创建、读取或破坏 Provider Cache

#### Scenario: UI metadata changes
- **WHEN** 分支标题、脚注、列位置、Draft ID 或 Quote Block 样式变化
- **THEN** Provider-visible prefix、Token 和缓存资格不变化

#### Scenario: Parent source is later superseded
- **WHEN** 父 Thread 来源 Message 后续被 Edit/Retry 替代
- **THEN** 既有子 Thread 继续使用创建时冻结的历史和 Quote Snapshot，不重算 inherited prefix

### Requirement: Quote, comment, current question, and runtime controls stay in the dynamic tail

当前用户的 Quote 正文、Quote comment、总问题、附件、Research mode/plan、动态记忆和运行控制 MUST 位于全部稳定历史之后。Quote 来源元信息 MUST 完全排除。多 Quote 的添加、删除、排序和 comment 修改在发送前 MUST 只改变当前动态尾部。

#### Scenario: User adds fifty quote blocks before sending
- **WHEN** Composer Draft 中逐步增加 Quote
- **THEN** 已完成历史的 Prefix Hash 不变，因为 Draft 尚未进入模型请求

#### Scenario: User reorders current quotes
- **WHEN** 当前 Draft 的 Quote 顺序变化
- **THEN** 只有 Current User 尾部变化；`inherited-end` 与发送前的 `branch-history-end` Hash 不变化

#### Scenario: Sent quote message becomes history
- **WHEN** 多 Quote Message 已发送并完成一轮回答，用户继续提问
- **THEN** 该 Message 的 Quote/comment/Text 按原 Parts 顺序进入 Stable Branch History，成为后续轮次可复用前缀的一部分

#### Scenario: Research mode changes
- **WHEN** 相同稳定历史的请求分别选择 answer 和 research
- **THEN** 差异只出现在 Runtime Control 或 Tool Profile 分区，不重写 Frozen/Branch History

### Requirement: Quote protocol and model format are deterministic

Quote-to-model helper MUST 只发送 Quote 正文与用户 comment，使用版本化、确定性的编码。Quote Protocol Version、Quote Model Format Version 和 Quote Budget Policy Version MUST 进入 Prompt Manifest 和 candidate fingerprint。

#### Scenario: Quote source metadata changes
- **WHEN** 来源标题、UI 状态或 Anchor 辅助字段变化，但 Quote 正文/comment 不变
- **THEN** 模型文本和当前 User Shape Hash 保持相同

#### Scenario: Quote format changes
- **WHEN** `<thread_quote>` 编码或 JSON 字段变化
- **THEN** 必须升级 Quote Model Format Version，并记录为预期冷启动

### Requirement: Quote count and route-aware budget are enforced before paid calls

每条 Message 最多支持 50 份 Quote，但系统 MUST 使用模型 Route 相关的 Quote Prompt Budget Policy 预估当前 Quote Token 与总输入 Token。超预算 MUST 在正式回答模型调用前失败，不能静默截断或自动摘要。

#### Scenario: Fifty short comments fit
- **WHEN** 50 份短 Quote/comment 在当前 Route 预算内
- **THEN** 请求可以进入 Prompt Compiler 和模型调用

#### Scenario: A smaller number of long quotes is too expensive
- **WHEN** Quote 数量未超过 50，但 Token 估算超过 Route Budget
- **THEN** 系统返回明确预算错误，不发起付费模型回答

#### Scenario: Budget preflight fails
- **WHEN** Tokenizer 或预算计算异常
- **THEN** 系统采用安全失败或保守上限，不得无上限绕过预算

### Requirement: Tool definitions use explicit stable profiles

系统 MUST 使用有限、版本化的 Tool Profile 构造 Provider-visible 工具集合。一个 Profile 内的工具名、描述、JSON Schema 和顺序 MUST 稳定；Message ID、route reason、query 和运行状态不得进入工具 Schema。不同权限面 MAY 形成有意缓存分区，但不得为了缓存扩大工具权限。

#### Scenario: Sibling requests use the same capabilities
- **WHEN** 两次请求选择相同 Tool Profile
- **THEN** 工具 Schema、顺序、`toolProfileId` 和 `toolProfileHash` 相同

#### Scenario: Web capability is added
- **WHEN** 请求从 answer Profile 切到 Web Profile
- **THEN** 系统记录 `tool-profile-changed` 的有意分区，不归因于随机前缀漂移

#### Scenario: Tool execution needs a message ID
- **WHEN** Artifact 工具 execute 需要当前 assistant Message ID
- **THEN** 该 ID 只存在于服务端闭包，不改变 Provider-visible Schema

### Requirement: Model resolution exposes actual route and cache capability

模型解析 MUST 返回 `LanguageModel`、Adapter、Gateway、上游模型、Route ID、Routing Policy 和 Cache Capability。缓存策略 MUST 由实际 Route 决定，而不是只看产品 Model ID。未验证 compatible endpoint MUST 保持 `probe-required` 或 `unsupported`。

#### Scenario: Same model uses different gateways
- **WHEN** 同一产品模型经不同 Gateway/Proxy 调用
- **THEN** 两次解析可以得到不同 Route ID、Cache Strategy、Affinity 与 Usage 能力

#### Scenario: Compatible proxy is unverified
- **WHEN** Proxy 能完成普通调用，但缓存字段透传、TTL 和 Usage 未验证
- **THEN** 请求不发送猜测的 Provider 专属参数，也不声称已启用缓存

#### Scenario: Cache option is rejected upstream
- **WHEN** Provider 拒绝 marker、affinity 或 TTL
- **THEN** 系统安全降级到普通请求并记录诊断；普通请求成功时 Message 仍完成

### Requirement: Current Claude route is probed first and not assumed capable

当前代码中 Thread Chat Claude 模型通过 UMAPIS Claude 组提供。首批 Claude 缓存验证 MUST 先对实际使用的 UMAPIS Route 运行 Probe。若不能证明 marker/option 透传和 cache Usage，则该 Route MUST 保持未启用，并使用直接 Anthropic 参考 Route 区分“Prompt 结构问题”和“代理不支持问题”。

#### Scenario: UMAPIS returns reliable cache usage
- **WHEN** Probe 证明同前缀请求可创建并读取缓存，且 Usage 字段稳定
- **THEN** 该具体 Route 可以进入 staging `enabled` 候选

#### Scenario: UMAPIS accepts calls but hides cache evidence
- **WHEN** 普通 Claude 调用成功，但 marker/Usage 无法验证
- **THEN** Route 保持 `probe-required`，不能把 Prefix Hash 相同当作 Provider 命中

#### Scenario: Direct Anthropic reference succeeds
- **WHEN** 相同 Prompt 结构在直接 Anthropic Route 命中，而 UMAPIS 不命中
- **THEN** 结论优先指向代理能力或路由问题，而不是推翻 Prompt Compiler

### Requirement: Cache retention defaults to short duration

第一阶段 MUST 使用 Provider 默认短时缓存；支持明确 TTL 时按约 5 分钟验证。1 小时 Extended TTL MUST 默认关闭，只有会话停顿、真实 read/write 成本、数据保留、ZDR、region 和 Provider 政策均通过评估后，才能按 Route 单独启用。

#### Scenario: First staging rollout
- **WHEN** 某个 Route 首次进入 enabled
- **THEN** 使用短时缓存，不启用 Extended TTL

#### Scenario: User returns after a long pause
- **WHEN** 请求超出短时 TTL
- **THEN** 系统允许正常冷启动，不把它归因于 Prompt 结构错误

#### Scenario: Extended TTL is considered
- **WHEN** 数据证明短 TTL 无法覆盖主要会话间隔
- **THEN** 只有完成成本摊销和数据政策审查后才能小范围开启 1 小时缓存

### Requirement: Cache boundaries are deterministic

Prompt Manifest MUST 声明 `kernel-end`、`inherited-end` 和 `branch-history-end`。显式缓存 Adapter MUST 根据 Route 能力、最小长度、Breakpoint 上限和短时 TTL policy 确定性选择 marker，优先保护兄弟分支祖先历史和同分支已完成历史。隐式/自动缓存 Route MUST 保留边界用于诊断，但不得伪造 marker。

#### Scenario: Long inherited context uses explicit cache
- **WHEN** `inherited-end` 达到 Route 最小长度且有可用 Breakpoint
- **THEN** Adapter 在该边界设置确定性 marker

#### Scenario: Same branch continues
- **WHEN** 已完成 Branch History 足够长
- **THEN** Adapter 优先利用 `branch-history-end` 支持下一轮增量复用

#### Scenario: Prompt is below provider minimum
- **WHEN** 稳定前缀短于已知最小长度
- **THEN** 请求正常执行，资格标记为 `below-minimum`，不宣称已创建缓存

### Requirement: Eligibility, warmth, and provider evidence are distinct

系统 MUST 区分应用前缀资格、缓存冷暖状态和 Provider 返回的 cache read 证据。相同 Prefix Hash MUST NOT 被表述为已经命中。

#### Scenario: Branch is created from latest assistant output
- **WHEN** 来源 assistant 内容此前尚未作为后续输入提交
- **THEN** 系统标记 cold-start 或 partial-warm，并允许只复用更早共同前缀

#### Scenario: Warm-up precedes sibling request
- **WHEN** 相同 eligible prefix 已在短 TTL 内经同一路线作为输入提交，后续请求返回非零 cache read
- **THEN** 系统记录 provider-hit 与 read Token

#### Scenario: Usage is absent
- **WHEN** Prefix Hash 相同但 Provider 不返回可靠 cache 字段
- **THEN** 状态为 usage-unavailable，而不是 hit 或 zero-read miss

#### Scenario: Provider fallback changes endpoint
- **WHEN** 原路线失败并回退到另一实际 Endpoint
- **THEN** 系统记录 route drift/fallback，不把合法冷缓存完全归因于 Prompt 结构

### Requirement: Cache usage is normalized per model attempt

系统 MUST 对每个模型 Step 采集 Model Attempt，并 best-effort 归一化 input、cache read、cache write、uncached input、output、finish reason、耗时和实际 Route。缺失字段 MUST 保持 unknown；原始 provider usage 和现有计费链路保持权威。

#### Scenario: AI SDK returns standard details
- **WHEN** Step Usage 包含标准 cache read/write 字段
- **THEN** Model Attempt 使用这些字段并标记来源

#### Scenario: Provider metadata is the only source
- **WHEN** 标准 Usage 缺失但 allowlisted Provider/Gateway metadata 有合法字段
- **THEN** 归一化器使用该来源并保留原始 Usage

#### Scenario: Multi-step tool loop completes
- **WHEN** 一次回答包含多个模型 Step
- **THEN** 每个 Step 都有独立 Model Attempt，运行摘要由全部 Step 聚合

#### Scenario: Fields conflict or are incomplete
- **WHEN** 多来源冲突或无法证明完整拆分
- **THEN** 保留可证明字段、标记 `complete=false`，不得补造数值

### Requirement: Cache telemetry remains metadata-only and reuses existing traces

Prompt Cache MUST 扩展现有 assistant Message Trace、AI SDK Observations 和 Eval Envelope，不得创建第二套生成身份。生产环境只导出版本、Hash、Route、数值、资格和 reason code，不导出 Prompt、Quote、comment、来源 ID、Anchor、网页、附件或隐藏推理。

#### Scenario: Cached generation completes in production
- **WHEN** metadata-only 策略下 Provider 返回 cache Usage
- **THEN** Trace 可分析 Route、Profile、Token、命中和成本，而不包含用户正文

#### Scenario: Telemetry fails
- **WHEN** Hash、collector、Usage parser 或 exporter 异常
- **THEN** Agent 继续生成并按数据库事实完成 Message，只产生有界安全诊断

### Requirement: Prompt cache behavior is evaluated deterministically and live

Agent Eval MUST 能表达 Quote Draft、Quote Parts、Prompt Cache、Model Attempt 和运行级 Cache Summary。CI 使用 Fake Provider 验证结构与 Hash；Scheduled/Release 对批准 Route 运行 warm-up + reuse live probe，并以 Provider Usage 作为命中证据。

#### Scenario: CI evaluates sibling forks
- **WHEN** 两个 Fixture 拥有相同冻结祖先、不同 Quote
- **THEN** `inherited-end` Hash 相同，差异位置正确，不依赖外部缓存

#### Scenario: CI evaluates empty branch draft
- **WHEN** 用户留空创建分支
- **THEN** 断言没有 assistant Message、模型调用或 cache event

#### Scenario: CI evaluates fifty annotations
- **WHEN** Draft 包含 50 个短 Artifact Quote/comment
- **THEN** 断言顺序、一次 Message、一次 assistant attempt 和预算行为正确

#### Scenario: Live Claude probe runs
- **WHEN** Scheduled 对 UMAPIS 或直接 Anthropic 先 warm-up 再发送同前缀请求
- **THEN** Result 保存 Route、Model Attempts、cache evidence、TTFT 与真实成本字段，不把私有正文写入仓库

#### Scenario: Cache improves but quality regresses
- **WHEN** cache metrics 改善但安全、隔离、终态、工具或回答质量 hard score 回归
- **THEN** Candidate 不得通过发布门禁

### Requirement: Cache rollout is reversible and route-scoped

系统 MUST 提供 server-only `off / observe / enabled`，并允许按环境、Route 和受控 cohort 覆盖。`observe` 发送旧 Prompt，仅影子生成新 Manifest、Quote Budget 和资格；`enabled` 只对已 Probe Route 发送新 Prompt 与缓存控制。

#### Scenario: Observe mode is enabled
- **WHEN** staging 使用 observe
- **THEN** 用户仍走旧请求路径，运维可看到候选前缀、Quote 数量、Budget、Tool Profile 和 Route 分布

#### Scenario: One Claude route passes probe
- **WHEN** 只有某一条 UMAPIS 或直接 Anthropic Route 通过
- **THEN** 只启用该 Route，其他 Route 继续普通请求与观测

#### Scenario: Kernel or quote format upgrades
- **WHEN** Kernel、Compiler、Tool Profile 或 Quote Model Format 版本变化
- **THEN** 系统记录预期冷启动，旧 Provider KV 自然过期，无需迁移 Message

#### Scenario: Regression is detected
- **WHEN** cohort 或 Eval 发现质量、权限或终态回归
- **THEN** 受影响 Route 可以切回 off，数据库会话无需迁移

### Requirement: Application-level compiled caching is optional and isolated

系统 SHALL 定义 Compiled Segment Cache 接口，但首阶段默认 Noop。启用的 L2 Cache MUST 使用租户隔离 Key、版本、TTL、容量和服务端访问控制。L2 只能优化数据库读取和 Prompt 编译，不能被当作 Provider cache hit 或会话事实源。普通聊天 MUST NOT使用 Exact Response Cache。

#### Scenario: L2 is disabled
- **WHEN** 尚无编译瓶颈证据
- **THEN** Prompt 每次从权威数据库构造，L1 Provider Cache 独立工作

#### Scenario: L2 hits
- **WHEN** 相同 Tenant、Compiler Version 和 source hash 的稳定 Segment 再次编译
- **THEN** 系统可以复用编译结果，但必须重新完成当前权限、动态尾部、Quote Budget 和 Provider Control

#### Scenario: Different tenant has identical text
- **WHEN** 不同用户或 Project 内容相同
- **THEN** Tenant HMAC 防止互相读取 L2 Value
