## Purpose

为 Thread Chat 建立缓存友好、Provider-aware、可观测且可评测的 Prompt 编译与运行契约，使冻结祖先上下文能够在兄弟分支和后续轮次中尽可能复用，同时保证缓存优化不改变会话事实源、工具权限、隐私边界或回答正确性。

## ADDED Requirements

### Requirement: Prompt compilation exposes ordered stable and dynamic segments

系统 MUST 通过一个版本化 Prompt Compiler 把正式回答请求编译为有序 Segment，至少区分 Agent Kernel、可选 Project Contract、Frozen Inherited History、可选 Branch Genesis、Stable Branch History 和 Runtime Tail。每个 Segment MUST 声明 kind、cache scope、版本、长度摘要和 content hash。正式模型调用 MUST 使用编译结果，而不是在调用点独立拼接 system、messages、tools 和缓存参数。

#### Scenario: A normalized Thread Chat generation is prepared
- **WHEN** 一个已提交 assistant Message 开始正式回答生成
- **THEN** 系统生成一个包含全部 Segment、Tool Profile、Provider route 和候选缓存边界的 Prompt Manifest，并由同一个编译结果构造 `streamText` 请求

#### Scenario: A future Project Contract is absent
- **WHEN** 当前 Project 尚未实现或配置 Project Contract
- **THEN** 对应 Segment 为空且不插入随机占位、时间戳或每轮变化的文本

### Requirement: Sibling forks preserve an identical inherited prefix

对于相同有效模型路由、Prompt Compiler 版本、Agent Kernel、Project Contract、Tool Profile 和相同冻结祖先上下文的兄弟 Thread，系统 MUST 在 Branch-specific Context 出现之前产生相同的 Provider-visible stable prefix。`anchorText`、Branch ID、Thread ID、当前 Research plan 和当前用户消息 MUST NOT 出现在该共同前缀中。

#### Scenario: Two branches select different text from the same source message
- **WHEN** 两个兄弟分支拥有相同 `forkContext`，但 `anchorText` 不同
- **THEN** 两次请求的 inherited-end Prefix Hash 相同，首次内容差异只允许出现在 Frozen Inherited History 之后的 Branch Genesis Segment

#### Scenario: One branch changes its title or workspace placement
- **WHEN** 分支标题、脚注显示、列位置或其他 UI metadata 变化
- **THEN** stable prefix、Tool Profile 和缓存资格不变化

#### Scenario: Frozen source messages are later superseded
- **WHEN** 父 Thread 的来源 Message 在分叉后被 Edit 或 Retry 产生的新 Message 替代
- **THEN** 既有子 Thread 继续使用创建时冻结的 Message 内容和同一 inherited prefix，不按父 Thread 当前时间线重算

### Requirement: Branch context follows inherited history and remains stable within the branch

系统 MUST 根据 Thread 的冻结来源、Anchor 和模板版本生成服务端 Branch Genesis Context。Branch Genesis MUST 位于 Frozen Inherited History 之后、Branch History 之前，MUST NOT 进入全局 System Kernel，并 MUST 在同一 Thread 的后续请求中保持确定性。

#### Scenario: A user starts a branch from selected assistant text
- **WHEN** 新分支第一次发送用户问题
- **THEN** 模型在继承祖先对话之后收到包含选区焦点和指代规则的 Branch Genesis Context

#### Scenario: The branch continues for multiple turns
- **WHEN** 用户在同一分支继续提问
- **THEN** 原 Branch Genesis Context 保持相同位置和内容，已完成分支历史只在其后追加，当前轮动态内容位于 stable branch prefix 之后

#### Scenario: The root thread generates a response
- **WHEN** Main Thread 没有 fork source 或 Anchor
- **THEN** 系统不生成 Branch Genesis 占位消息

### Requirement: Dynamic research and runtime context cannot invalidate earlier stable history

Research mode、Research plan、动态记忆、跨 Thread 引用、当前运行控制、请求 ID、时间戳和当前用户消息 MUST 位于全部 stable history 之后。系统 MUST 使用两阶段编译，在 Research route/plan 已解析后再完成 Runtime Tail。长期 Research/Artifact 行为规则 MAY 位于稳定 Agent Kernel，但每轮计划与运行数据 MUST NOT 进入共同前缀。

#### Scenario: Two requests choose different research modes
- **WHEN** 相同 Thread 前缀的两轮请求分别选择 `answer` 和 `research`
- **THEN** 两次请求在 Runtime Tail 之前仍保持相同 stable prefix，Research mode 的差异不会改写 Frozen Inherited History 或 Branch History

#### Scenario: A research plan contains dynamic subquestions
- **WHEN** Research route 生成本轮专属计划
- **THEN** 计划只出现在 Runtime Tail，且 Prompt Manifest 将其标记为 non-cacheable dynamic content

#### Scenario: A request has no research plan
- **WHEN** route 不需要计划
- **THEN** 系统不插入变化的空计划、随机标记或时间信息

### Requirement: Tool definitions use explicit stable profiles

系统 MUST 使用有限、版本化的 Tool Profile 构造 Provider-visible 工具集合。一个 Profile 内的工具名、描述、JSON Schema 和顺序 MUST 稳定，工具执行闭包中的 Message ID 或运行状态 MUST NOT 进入工具描述或 Schema。不同 Profile MAY 形成有意的缓存分区，但不得为了缓存扩大工具权限。

#### Scenario: Two eligible sibling requests use the same capabilities
- **WHEN** 两次请求都选择同一 Tool Profile
- **THEN** 它们发送相同顺序和内容的 Tool Schema，并具有相同 `toolProfileId` 和 `toolProfileHash`

#### Scenario: A request gains Web Search capability
- **WHEN** 请求从 answer-only Profile 切换到 Web Profile
- **THEN** 系统将其记录为 `tool-profile-changed` 的有意缓存分区，不把该变化归因于随机前缀漂移

#### Scenario: A tool requires the current assistant message ID
- **WHEN** Artifact 工具执行需要当前 Message 身份
- **THEN** 该 ID 只存在于服务端 execute closure 或工具结果，不改变 Provider-visible工具 Schema

### Requirement: Model resolution exposes actual route and cache capability

模型解析 MUST 返回包含 `LanguageModel`、Adapter、Gateway、上游模型、route ID、routing policy 和 cache capability 的结构化结果。缓存策略 MUST 由实际 route 决定，而不是只由产品 model ID 决定。未验证的 compatible endpoint MUST 标记为 `probe-required` 或 `unsupported`，MUST NOT 接收猜测的 Provider 专属参数。

#### Scenario: The same product model uses different gateways
- **WHEN** 同一产品模型分别经 Vercel AI Gateway 和 OpenRouter 解析
- **THEN** 两次解析可以得到不同 route ID、cache strategy、affinity 和 Usage 能力

#### Scenario: A compatible proxy has not been probed
- **WHEN** 应用知道 proxy 能完成普通模型调用但未验证缓存字段透传和 Usage
- **THEN** 请求不发送专属 cache marker、TTL 或 cache key，并把策略记录为 `probe-required`

#### Scenario: Cache configuration is rejected upstream
- **WHEN** Provider 拒绝缓存字段或 affinity 参数
- **THEN** 系统安全降级为普通模型请求并记录诊断；若普通请求成功，Message 仍按成功结果完成

### Requirement: Provider-specific caching and routing affinity are applied safely

对于已验证 route，系统 SHALL 按 capability 使用 implicit caching、explicit breakpoint 或 Gateway auto caching。支持路由亲和的 Gateway SHALL 使用稳定、脱敏且有限长度的 affinity key。Key MUST 隔离用户、Project、上游模型和 Cache Profile，MUST NOT 包含原始用户 ID、Project ID、Thread ID、标题、Anchor 或 Prompt 正文。

#### Scenario: Sibling branches use OpenRouter with the same model
- **WHEN** 同一用户、Project 和上游模型的父 Thread 与兄弟 Thread 发起请求
- **THEN** 它们获得相同的脱敏 affinity key，以提高落到同一 Provider Endpoint 的概率

#### Scenario: Another project uses the same model
- **WHEN** 同一用户在另一个 Project 使用相同模型
- **THEN** affinity key 不同，避免无意跨 Project 绑定会话路由

#### Scenario: A route uses Gateway automatic caching
- **WHEN** route capability 声明 `gateway-auto`
- **THEN** 系统通过锁定版本支持的类型安全 Gateway option 请求自动缓存，并在 Manifest 中记录策略而不伪造 explicit marker

#### Scenario: Retention policy forbids an extended cache
- **WHEN** 部署或用户政策要求严格 ZDR/短保留，而某个缓存模式需要 extended retention
- **THEN** 系统禁用该模式或选择兼容 route，并记录 `retention-disabled`

### Requirement: Cache breakpoints are deterministic and prioritize branch reuse

Prompt Manifest MUST 声明 `kernel-end`、`inherited-end` 和 `thread-stable-end` 候选边界。显式缓存 Adapter MUST 根据 route 能力、最小长度、breakpoint 上限和 TTL policy 确定性选择实际 marker，优先支持 sibling fork 的 inherited prefix 和同一 Thread 的 stable history。隐式缓存 route MUST 保留相同边界信息用于诊断，但 MUST NOT 伪造 marker。

#### Scenario: An explicit-caching model receives a long inherited context
- **WHEN** inherited prefix 达到 route 的最小缓存长度且存在可用 breakpoint
- **THEN** Adapter 在 `inherited-end` 设置可复现 marker，并在后续分支轮次按能力增加或移动 `thread-stable-end` marker

#### Scenario: A prompt is below the provider minimum
- **WHEN**已知 route 的 stable prefix 短于最小缓存长度
- **THEN** 请求仍正常执行，资格标记为 `below-minimum`，不得宣称已创建缓存

#### Scenario: The provider uses implicit caching
- **WHEN** route strategy 为 `implicit`
- **THEN** 请求不增加无效 marker，但 Prefix Hash、长度、route 和 Usage 仍进入观测

### Requirement: Cache eligibility, warmth, and provider hits are distinct states

系统 MUST 区分应用前缀资格、缓存冷暖推断和 Provider 返回的 cache read 证据。相同 Prefix Hash MUST NOT 被表述为 Provider 命中。首次请求、最新 assistant 输出尚未再次作为输入、TTL 过期和 Provider Endpoint 漂移 MUST 有独立 reason code。

#### Scenario: A branch is created immediately from the latest assistant output
- **WHEN** 来源 assistant 内容从未作为后续模型请求输入
- **THEN** 系统将该情况标记为 cold-start 或 partial-warm，并允许只复用更早的共同前缀

#### Scenario: A warm-up request precedes a sibling branch request
- **WHEN** 相同 eligible prefix 已在 TTL 内通过同一路由作为输入提交，后续兄弟请求获得非零 cache read usage
- **THEN** 系统记录 `provider-hit`，并保留 read token 数和 Usage 来源

#### Scenario: Prefix hashes match but usage is absent
- **WHEN** 应用 Prefix Hash 相同但 Provider 不返回缓存字段
- **THEN** 状态为 `usage-unavailable` 或 unknown，而不是 hit 或 zero-read miss

#### Scenario: Provider fallback changes the endpoint
- **WHEN** affinity route 不可用并回退到另一个实际 Provider Endpoint
- **THEN** 系统记录 route drift/fallback，并不把合法冷缓存完全归因于 Prompt 结构

### Requirement: Cache usage is normalized per model attempt without replacing raw usage

系统 MUST 对每个模型 Step 采集 Model Attempt，并 best-effort 归一化 input、cache read、cache write、uncached input、输出、finish reason、耗时和实际 route。归一化 MUST 标记来源和完整性，缺失字段 MUST 保持 unknown。原始 provider usage 和现有计费链路 MUST 保持权威，不得被归一化摘要覆盖。

#### Scenario: AI SDK returns standard cache token details
- **WHEN** Step usage 包含标准 cache read/write 字段
- **THEN** Model Attempt 使用这些字段并标记来源为 AI SDK usage

#### Scenario: Only provider metadata contains cache details
- **WHEN** 标准 Usage 缺失但 allowlisted Provider/Gateway metadata 有合法字段
- **THEN** 归一化器使用该来源并保留原始 provider usage

#### Scenario: A multi-step tool loop completes
- **WHEN** 一次正式回答包含多个模型 Step
- **THEN** 每个 Step 都有独立 Model Attempt，run summary 由全部 Step 聚合而不是只采用最后一步

#### Scenario: Usage fields conflict or are incomplete
- **WHEN** 多个来源冲突或无法证明完整输入拆分
- **THEN** 系统保留可证明字段、标记 `complete=false`，不得补造数值

### Requirement: Cache telemetry integrates with existing traces and remains metadata-only

Prompt Cache MUST 扩展现有 assistant Message 根 Trace、AI SDK model Observations 和 eval envelope，不得创建第二套生成身份。生产环境默认只导出 Compiler/Profile/Route 版本、Hash、数值、资格和 reason code，MUST NOT 导出 Prompt、Anchor、Message、Search query、文件、网页正文、认证信息或隐藏推理。

#### Scenario: A cached generation completes in production
- **WHEN** production metadata-only 策略下 Provider 返回 cache usage
- **THEN** 根 Trace 和 Model Attempt 可用于分析命中、route、Tool Profile 和 Token，但不包含用户内容

#### Scenario: Telemetry export fails
- **WHEN** Langfuse、collector、Hash summary 或 usage exporter 异常
- **THEN** Agent 继续流式生成并按数据库事实完成 Message，服务端只产生有界安全诊断

#### Scenario: The same command is replayed
- **WHEN** 幂等命令重放到同一 assistant Message
- **THEN** 缓存观测继续关联同一确定性 Trace，不新增 generation 业务实体

### Requirement: Prompt cache behavior is evaluated with deterministic and live tests

Agent eval 基础设施 MUST 能表达 Prompt Cache case、Model Attempt 和 run-level cache summary。CI MUST 使用 fake Provider/fixture 验证 Segment、Hash、Profile、marker、affinity 和 reason code，不依赖外部缓存。Scheduled/release MAY 对批准 route 运行先 warm-up 后复用的 live probe，并以 Provider usage 作为命中证据。

#### Scenario: CI evaluates sibling forks
- **WHEN** CI 运行两个相同冻结祖先、不同 Anchor 的 fixture
- **THEN** scorer 断言 inherited Prefix Hash 相同、差异位置正确、affinity 隔离正确且不要求外部 cache read

#### Scenario: Scheduled evaluation probes a live provider
- **WHEN** approved scheduled run 对已验证 route 先发送 warm-up，再发送同前缀请求
- **THEN** result envelope 保存 Model Attempts、Provider cache evidence、TTFT 和 route，且不把凭据或私有正文写入仓库

#### Scenario: Caching improves performance but harms answer quality
- **WHEN** candidate 的 cache metrics 改善但现有安全、隔离、终态或回答质量 hard score 回归
- **THEN** candidate 不得因为缓存收益而通过发布门禁

#### Scenario: Provider usage is unstable
- **WHEN** live 样本不足或 cache usage 字段不稳定
- **THEN** cache scorer 保持 diagnostic，不设置阻断命中率阈值

### Requirement: Cache rollout is reversible and route-scoped

系统 MUST 提供 server-only `off`、`observe` 和 `enabled` 模式，并允许按环境、route 和受控 cohort 覆盖。`observe` MUST 发送旧 Prompt，只影子生成新 Manifest/Hash/资格；`enabled` 只对已验证 route 发送新 Prompt 与缓存控制。任何质量或 Provider 兼容问题 MUST 能无需数据迁移回退到 `off`。

#### Scenario: Observe mode is enabled
- **WHEN** staging 使用 `observe`
- **THEN** 用户收到与旧请求路径相同的模型行为，而运维可以比较候选 stable prefix、Tool Profile 和资格分布

#### Scenario: One provider route is enabled
- **WHEN** 只有 OpenRouter 某模型 route 通过 probe
- **THEN** 仅该 route 使用新缓存控制，其他 route 保持普通请求并继续被观测

#### Scenario: A new Agent Kernel version deploys
- **WHEN** Kernel、Compiler 或 Tool Profile 版本升级
- **THEN** 系统把一次预期冷启动记录为版本分区，旧 Provider KV 自然过期，无需修改 Message 或主动清理会话数据

#### Scenario: A quality regression is detected
- **WHEN** cohort 或 eval 发现新 Prompt 的质量、工具或终态回归
- **THEN** 操作员可将受影响 route 切回 `off`，数据库会话和已生成 Message 无需迁移

### Requirement: Application-level compiled segment caching is optional and tenant-isolated

系统 SHALL 定义 Compiled Segment Cache 接口，但首阶段默认使用 noop。任何启用的 L2 Cache MUST 使用租户隔离的内容寻址 Key、版本、TTL、容量限制和服务端访问控制。L2 Cache 只能优化数据库读取和 Prompt 编译，MUST NOT 被当作 Provider cache hit 或会话事实源。普通聊天 MUST NOT 使用 Exact Response Cache 返回旧答案。

#### Scenario: L2 cache is disabled
- **WHEN** 未配置或未证明应用编译瓶颈
- **THEN** Prompt Compiler 每次从权威数据库构造请求，L1 Provider Cache 仍可独立工作

#### Scenario: An in-process compiled segment cache hits
- **WHEN** 相同 tenant、Compiler Version 和 source content hash 的稳定 Segment 在 TTL 内再次编译
- **THEN** 系统可复用编译结果，并重新完成当前请求的动态尾部、权限校验和 Provider control

#### Scenario: Another tenant has identical text
- **WHEN** 不同用户或 Project 拥有相同内容
- **THEN** L2 Key 的 tenant HMAC 使它们不能互相读取缓存值

#### Scenario: A user asks the same question twice
- **WHEN** 两次用户请求文本完全相同
- **THEN** 系统仍执行新的模型生成，除非未来独立且明确授权的幂等任务规范另有规定
