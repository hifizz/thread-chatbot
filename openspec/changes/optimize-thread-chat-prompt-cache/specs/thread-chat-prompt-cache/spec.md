## Purpose

为 Thread Chat 建立缓存友好、Provider-aware、可观测且可评测的 Prompt 编译与运行契约，使冻结祖先上下文能够在兄弟分支和后续轮次中尽可能复用，同时保证多 Quote 消息、工具权限、隐私、会话事实源和回答正确性不因缓存优化而改变。

## ADDED Requirements

### Requirement: Prompt compilation exposes ordered stable and dynamic segments

系统 MUST 通过一个版本化 Prompt Compiler 把正式回答请求编译为有序内容，至少区分 Provider-visible Tool Profile、Agent Kernel、可选 Project Contract、Frozen Inherited History、Stable Branch History、Runtime Control 和 Current User Message。正式模型调用 MUST 使用同一编译结果构造 `system`、`messages`、`tools`、Provider cache controls 和 Prompt Manifest，而不是在调用点独立拼字符串。

#### Scenario: A normalized Thread Chat generation is prepared
- **WHEN** 一个已提交 assistant Message 开始正式回答生成
- **THEN** 系统生成包含 Tool Profile、全部 Segment、Provider route 和候选缓存边界的 Prompt Manifest，并由同一结果构造模型请求

#### Scenario: A future Project Contract is absent
- **WHEN** 当前 Project 尚未实现或配置 Project Contract
- **THEN** 对应 Segment 为空且不插入随机占位、时间戳或每轮变化的文本

#### Scenario: The root thread sends an ordinary message
- **WHEN** Main Thread 没有继承历史且当前 User Message 没有 Quote
- **THEN** 系统不生成 Fork、Quote 或 Project 占位内容，普通聊天行为保持兼容

### Requirement: Sibling forks preserve an identical prefix through inherited history

对于相同有效模型路由、Compiler/Kernel/Quote Format、Project Contract、Tool Profile 和相同冻结祖先上下文的兄弟 Thread，系统 MUST 在 Current User Message 出现之前产生相同的 Provider-visible inherited prefix。具体 Quote 正文、Quote 来源元信息、Branch/Thread ID、Research plan 和当前问题 MUST NOT 出现在该共同前缀中。

#### Scenario: Two branches select different text from the same source message
- **WHEN** 两个兄弟分支拥有相同 `forkContext`，但 B1 的 branch-origin Quote 正文不同
- **THEN** 两次请求的 `inherited-end` Prefix Hash 相同，首次模型可见差异只出现在 A 的冻结历史之后的 B1 Quote Part

#### Scenario: Two branches ask different questions about the same selection
- **WHEN** 两个分支继承同一历史并引用相同文本，但 B1 问题不同
- **THEN** 共同前缀仍到 `inherited-end`，差异只位于 Current User Message

#### Scenario: One branch changes its title or workspace placement
- **WHEN** 分支标题、脚注显示、列位置或其他 UI metadata 变化
- **THEN** stable prefix、Tool Profile、Provider-visible文本和缓存资格不变化

#### Scenario: Frozen source messages are later superseded
- **WHEN** 父 Thread 的来源 Message 在分叉后被 Edit 或 Retry 产生的新 Message 替代
- **THEN** 既有子 Thread 继续使用创建时冻结的 `forkContext` 和 Quote Snapshot，不按父 Thread 当前时间线重算

### Requirement: Quote text follows inherited history and quote metadata never enters the prompt

系统 MUST 使用 `thread-chat-message-quotes` 能力把 B1 的一份或多份 Quote 作为 Current User Message Parts 放在 Frozen Inherited History 之后。System Kernel 只保存稳定 Quote 解释规则。Quote 的 ID、kind、Project/Thread/Message ID、TextAnchor、标题、脚注和 UI 状态 MUST NOT 进入模型文本、stable Prefix Hash 或 Provider cache key。

#### Scenario: A first branch question contains one quote
- **WHEN** 用户从 A2 创建 B 并提出 B1
- **THEN** 模型依次收到稳定 Tool/System、A 的冻结历史、B1 Quote 正文和 B1 问题，具体 Anchor 不出现在 system

#### Scenario: A user message contains multiple quotes
- **WHEN** 当前 User Message 包含多份有序 Quote
- **THEN** Quote 正文按 Parts 顺序出现在 Current User Message，全部位于 stable history 之后

#### Scenario: Navigation metadata changes without text changes
- **WHEN** Quote 来源标题、Anchor 元信息或未来 UI 状态变化但冻结正文不变
- **THEN** Quote-to-model 结果不变，模型 Token 和 stable prefix 不受影响

#### Scenario: The branch continues
- **WHEN** 用户在 B 中发送 B2
- **THEN** 历史 B1 Quote/问题和 BA1 作为 Stable Branch History 参与 `branch-history-end` 前缀，B2 的当前内容仍在其后

### Requirement: Every prompt element has an explicit cache stability classification

Prompt Compiler MUST 为所有模型调用元素声明它属于稳定前缀、动态尾部、非模型元信息或主动缓存分区。新增元素若未声明模型可见性、变化频率、位置和失效行为，MUST NOT 直接加入正式 Prompt。

#### Scenario: A request ID is available
- **WHEN** 生成拥有 request/trace/message/thread ID
- **THEN** 这些标识只用于授权、日志和关联，不进入模型 Prompt 或 stable prefix serialization

#### Scenario: Agent Kernel text changes
- **WHEN** 发布新 Kernel 版本
- **THEN** 系统产生明确的版本缓存分区和预期冷启动，而不是把命中下降归因于随机 miss

#### Scenario: A current-turn value changes
- **WHEN** Quote 正文、用户问题、Research plan 或当前附件变化
- **THEN** 变化只影响 Runtime/Current User 尾部，不改写此前的 Frozen/Branch History

#### Scenario: A model route or retention policy changes
- **WHEN** 实际模型、Provider Endpoint、Tool Profile、TTL 或 retention class 变化
- **THEN** 系统将请求划入新的缓存资格分区，不宣称可以读取旧 route 的 Provider KV

### Requirement: Dynamic research and runtime context cannot invalidate earlier stable history

Research mode、Research plan、动态记忆、运行控制、请求 ID、时间戳和当前用户内容 MUST 位于全部 stable history 之后。系统 MUST 先编译稳定 Base，再解析 Research route/plan，最后完成 Runtime Control 和 Current User Message。长期 Research/Artifact 行为规则 MAY 位于稳定 Agent Kernel，但每轮计划与运行数据 MUST NOT 进入共同前缀。

#### Scenario: Two requests choose different research modes
- **WHEN** 相同 Thread 前缀的两轮请求分别选择 `answer` 和 `research`
- **THEN** 两次请求在 Runtime Control 之前保持相同 stable prefix，Research mode 不改写 Frozen/Branch History

#### Scenario: A research plan contains dynamic subquestions
- **WHEN** Research route 生成本轮专属计划
- **THEN** 计划只出现在 Runtime Control，Manifest 将其标记为 dynamic/non-cacheable

#### Scenario: A request has no research plan
- **WHEN** route 不需要计划
- **THEN** 系统不插入变化的空计划、随机标记或时间信息

### Requirement: Tool definitions use explicit stable profiles

系统 MUST 使用有限、版本化的 Tool Profile 构造 Provider-visible 工具集合。一个 Profile 内的工具名、描述、JSON Schema 和顺序 MUST 稳定，Message ID、route reason、当前 Query 或运行状态 MUST NOT 进入工具描述或 Schema。不同 Profile MAY 形成有意缓存分区，但不得为了缓存扩大工具权限。

#### Scenario: Two eligible sibling requests use the same capabilities
- **WHEN** 两次请求选择同一 Tool Profile
- **THEN** 它们发送相同顺序和内容的 Tool Schema，并具有相同 `toolProfileId` 和 `toolProfileHash`

#### Scenario: A request gains Web Search capability
- **WHEN** 请求从 answer-only Profile 切换到 Web Profile
- **THEN** 系统记录 `tool-profile-changed` 的有意分区，不把该变化归因于 Prompt 漂移

#### Scenario: A tool needs the current assistant message ID
- **WHEN** Artifact 工具执行需要当前 Message 身份
- **THEN** ID 只存在于服务端 execute closure 或工具结果，不改变 Provider-visible Schema

### Requirement: Model resolution exposes actual route and cache capability

模型解析 MUST 返回包含 `LanguageModel`、Adapter、Gateway、上游模型、route ID、routing policy 和 cache capability 的结构化结果。缓存策略 MUST 由实际 route 决定，而不是只由产品 model ID 决定。未验证的 compatible endpoint MUST 标记为 `probe-required` 或 `unsupported`，MUST NOT 接收猜测的 Provider 专属参数。

#### Scenario: The same product model uses different gateways
- **WHEN** 同一产品模型分别经 Vercel AI Gateway 和 OpenRouter 解析
- **THEN** 两次解析可以得到不同 route ID、cache strategy、affinity、TTL 和 Usage 能力

#### Scenario: A compatible proxy has not been probed
- **WHEN** proxy 能完成普通模型调用但未验证缓存字段透传和 Usage
- **THEN** 请求不发送专属 marker、TTL 或 cache key，并把策略记录为 `probe-required`

#### Scenario: Cache configuration is rejected upstream
- **WHEN** Provider 拒绝缓存字段或 affinity 参数
- **THEN** 系统安全降级为普通模型请求并记录诊断；若普通请求成功，Message 仍成功完成

### Requirement: Provider-specific caching and routing affinity are applied safely

对于已验证 route，系统 SHALL 按 capability 使用 implicit caching、explicit breakpoint 或 Gateway auto caching。支持路由亲和的 Gateway SHALL 使用稳定、脱敏且有限长度的 affinity key。Key MUST 隔离用户、Project、上游模型和 Cache Profile，MUST NOT 包含原始用户/Project/Thread ID、Quote、Anchor、标题或 Prompt 正文。

#### Scenario: Sibling branches use an affinity-capable route
- **WHEN** 同一用户、Project 和上游模型的父 Thread 与兄弟 Thread 发起请求
- **THEN** 它们获得相同脱敏 affinity key，以提高落到同一 Provider Endpoint 的概率

#### Scenario: Another project uses the same model
- **WHEN** 同一用户在另一个 Project 使用相同模型
- **THEN** affinity key 不同，避免无意跨 Project 路由绑定

#### Scenario: A verified Claude route is enabled
- **WHEN** Claude route 已通过 marker、Usage、TTL、降级和保留策略 probe
- **THEN** Adapter 优先在 `inherited-end` / `branch-history-end` 应用受支持的 explicit 或 gateway-auto 策略，并记录 cache creation/read 证据

#### Scenario: Retention policy forbids extended caching
- **WHEN** 部署或用户政策要求严格 ZDR/短保留，而缓存模式需要 extended retention
- **THEN** 系统禁用该模式或选择兼容 route，并记录 `retention-disabled`

### Requirement: Cache breakpoints are deterministic and prioritize reusable history

Prompt Manifest MUST 声明 `kernel-end`、`inherited-end` 和 `branch-history-end` 候选边界。显式缓存 Adapter MUST 根据 route 能力、最小长度、breakpoint 上限和 TTL policy 确定性选择 marker，优先 sibling fork 的 inherited prefix 和同一 Thread 的 stable history。隐式 route MUST 保留相同边界用于诊断，但 MUST NOT 伪造 marker。

#### Scenario: An explicit-caching model receives a long inherited context
- **WHEN** inherited prefix 达到 route 最小缓存长度且存在可用 breakpoint
- **THEN** Adapter 在 `inherited-end` 设置可复现 marker

#### Scenario: A later turn has stable branch history
- **WHEN** B2 之前的 A history、B1 Quotes/问题和 BA1 达到缓存条件
- **THEN** Adapter 按能力使用 `branch-history-end`，使后续轮次增量复用

#### Scenario: A prompt is below the provider minimum
- **WHEN** 已知 route 的 stable prefix 短于最小缓存长度
- **THEN** 请求正常执行，资格标记为 `below-minimum`，不得宣称已创建缓存

#### Scenario: The provider uses implicit caching
- **WHEN** route strategy 为 `implicit`
- **THEN** 请求不增加无效 marker，但 Prefix Hash、长度、route 和 Usage 仍进入观测

### Requirement: Cache eligibility, warmth, and provider hits are distinct states

系统 MUST 区分应用前缀资格、缓存冷暖推断和 Provider 返回的 read 证据。相同 Prefix Hash MUST NOT 被表述为 Provider 命中。首次请求、最新 assistant 输出尚未再次作为输入、TTL 过期和 Provider Endpoint 漂移 MUST 有独立 reason code。

#### Scenario: A branch is created immediately from the latest assistant output
- **WHEN** 来源 assistant 内容从未作为后续模型请求输入
- **THEN** 系统标记 cold-start 或 partial-warm，并允许只复用更早的共同前缀

#### Scenario: A warm-up request precedes a sibling request
- **WHEN** 相同 eligible prefix 已在 TTL 内通过同一路由作为输入提交，后续兄弟请求获得非零 cache read
- **THEN** 系统记录 `provider-hit`、read token 数和 Usage 来源

#### Scenario: Prefix hashes match but usage is absent
- **WHEN** 应用 Prefix Hash 相同但 Provider 不返回缓存字段
- **THEN** 状态为 `usage-unavailable`/unknown，而不是 hit 或 zero-read miss

#### Scenario: Provider fallback changes the endpoint
- **WHEN** affinity route 回退到另一个 Provider Endpoint
- **THEN** 系统记录 route drift/fallback，不把合法冷缓存完全归因于 Prompt 结构

### Requirement: Cache usage is normalized per model attempt without replacing raw usage

系统 MUST 对每个模型 Step 采集 Model Attempt，并 best-effort 归一化 input、cache read、cache write、uncached input、output、finish reason、TTFT、耗时和实际 route。归一化 MUST 标记来源和完整性，缺失字段保持 unknown。原始 provider usage 和现有计费链路保持权威。

#### Scenario: AI SDK returns standard cache token details
- **WHEN** Step usage 包含标准 cache read/write 字段
- **THEN** Model Attempt 使用这些字段并标记来源为 AI SDK usage

#### Scenario: Only provider metadata contains cache details
- **WHEN** 标准 Usage 缺失但 allowlisted Provider/Gateway metadata 有合法字段
- **THEN** 归一化器使用该来源并保留 raw provider usage

#### Scenario: A multi-step tool loop completes
- **WHEN** 正式回答包含多个模型 Step
- **THEN** 每个 Step 都有独立 Model Attempt，run summary 聚合全部 Step

#### Scenario: Usage fields conflict or are incomplete
- **WHEN** 多个来源冲突或无法证明完整输入拆分
- **THEN** 系统保留可证明字段、标记 `complete=false`，不得补造数值

### Requirement: Cache telemetry integrates with existing traces and remains metadata-only

Prompt Cache MUST 扩展现有 assistant Message 根 Trace、AI SDK model Observations 和 eval envelope，不得创建第二套生成身份。生产环境默认只导出 Compiler/Kernel/Quote Format/Profile/Route 版本、Prefix Hash、Quote 数量、Token、资格和 reason code，MUST NOT 导出 Prompt、Quote 正文、Quote source IDs、Anchor、Message、Search query、文件、网页正文、认证信息或隐藏推理。

#### Scenario: A cached quoted generation completes in production
- **WHEN** metadata-only 策略下 Provider 返回 cache usage
- **THEN** Trace 可分析命中、route、Tool Profile、Quote 数量和 Token，但不包含引用正文或导航元信息

#### Scenario: Telemetry export fails
- **WHEN** Langfuse、collector、Hash summary 或 usage exporter 异常
- **THEN** Agent 继续流式生成并按数据库事实完成 Message，只产生有界安全诊断

#### Scenario: The same command is replayed
- **WHEN** 幂等命令重放到同一 assistant Message
- **THEN** 缓存观测继续关联同一确定性 Trace，不新增 generation 业务实体

### Requirement: Prompt cache behavior is evaluated with deterministic and live tests

Agent eval MUST 能表达 Quote-aware Prompt Cache case、Model Attempt 和 run-level cache summary。CI MUST 使用 fake Provider/fixture 验证 Parts、Segment、Hash、Profile、marker、affinity 和 reason code，不依赖外部缓存。Scheduled/release MAY 对批准 route 运行先 warm-up 后复用的 live probe，并以 Provider Usage 作为命中证据。

#### Scenario: CI evaluates sibling forks
- **WHEN** CI 运行相同冻结祖先、不同 branch-origin Quote 的 fixture
- **THEN** scorer 断言 `inherited-end` Hash 相同、Quote 差异位置正确、metadata 未送模且不要求外部 read

#### Scenario: CI evaluates a multi-quote message
- **WHEN** 当前 User Message 含多份 Quote
- **THEN** scorer 断言 Quote model blocks 顺序、metadata 排除、Current User 边界和稳定历史 Hash

#### Scenario: Scheduled evaluation probes an expensive route
- **WHEN** approved scheduled run 对 Claude 等已验证 route 先 warm-up，再发送兄弟分支或同前缀请求
- **THEN** result 保存 Model Attempts、Provider cache evidence、TTFT、实际 cost/Token 和 route，且不把私有正文写入仓库

#### Scenario: Caching improves cost but harms quality
- **WHEN** cache metrics 改善但安全、隔离、终态、工具或回答质量 hard score 回归
- **THEN** candidate 不得因省钱而通过发布门禁

### Requirement: Cache rollout is reversible and route-scoped

系统 MUST 提供 server-only `off`、`observe` 和 `enabled` 模式，并允许按环境、route 和受控 cohort 覆盖。`observe` MUST 发送旧 Prompt，只影子生成新 Quote model view、Manifest/Hash/资格；`enabled` 只对已验证 route 发送新 Prompt 与缓存控制。任何质量或 Provider 兼容问题 MUST 能无需数据迁移回退到 `off`。

#### Scenario: Observe mode is enabled
- **WHEN** staging 使用 `observe`
- **THEN** 用户收到旧请求路径的模型行为，同时运维可以比较候选稳定前缀、Quote 位置、Tool Profile 和资格分布

#### Scenario: One provider route is enabled
- **WHEN** 只有某条 Claude/OpenRouter route 通过 probe
- **THEN** 仅该 route 使用新缓存控制，其他 route 保持普通请求并继续观测

#### Scenario: A Kernel, Quote format, Compiler, or Tool Profile version deploys
- **WHEN** 任一 Provider-visible 版本升级
- **THEN** 系统记录预期冷启动和新分区，旧 Provider KV 自然过期，无需改写 Message

#### Scenario: A quality regression is detected
- **WHEN** cohort 或 eval 发现新 Prompt 回归
- **THEN** 操作员可将受影响 route 切回 `off`，会话和 Message 无需迁移

### Requirement: Application-level compiled segment caching is optional and tenant-isolated

系统 SHALL 定义 Compiled Segment Cache 接口，但首阶段默认 noop。任何启用的 L2 Cache MUST 使用租户隔离的内容寻址 Key、版本、TTL、容量限制和服务端访问控制。L2 只能优化数据库读取和 Prompt/Quote 编译，MUST NOT 被当作 Provider hit 或会话事实源。普通聊天 MUST NOT 使用 Exact Response Cache。

#### Scenario: L2 cache is disabled
- **WHEN** 未证明应用编译瓶颈
- **THEN** Compiler 每次从权威数据库构造请求，L1 Provider Cache 独立工作

#### Scenario: An in-process stable segment cache hits
- **WHEN** 相同 tenant、Compiler Version 和 source content hash 的稳定 Segment 在 TTL 内再次编译
- **THEN** 系统复用编译结果，并重新完成当前 Quote/User/Runtime、权限和 Provider control

#### Scenario: Another tenant has identical text
- **WHEN** 不同用户或 Project 拥有相同内容
- **THEN** tenant HMAC 使它们不能互相读取 L2 value

#### Scenario: The same question is asked twice
- **WHEN** 两次用户文本和 Quote 完全相同
- **THEN** 系统仍执行新的模型生成，除非未来独立授权的幂等任务规范另有规定