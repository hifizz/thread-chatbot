## Purpose

为 Thread Chat 建立缓存友好、Provider-aware、可观测且可评测的 Prompt 编译与运行合同，使冻结祖先上下文能够在兄弟分支和后续轮次中尽可能复用，同时保证当前 Thread-only Quote、工具权限、回答质量、隐私边界和数据库事实源不被缓存优化破坏。

## ADDED Requirements

### Requirement: Prompt compilation classifies every input element

系统 MUST 在任何内容进入正式模型请求前，将其分类为 `stable-prefix`、`dynamic-tail`、`non-model-metadata` 或 `intentional-partition`。未分类的新元素 MUST NOT 被直接拼入 System Prompt 或稳定历史之前。

#### Scenario: A new runtime field is introduced
- **WHEN** 新能力希望把字段加入模型上下文
- **THEN** Prompt Compiler 先声明模型是否需要看到、变化频率、位置、缓存影响和版本策略

#### Scenario: UI metadata changes
- **WHEN** Thread 标题、脚注、列位置、Quote Draft ID 或展开状态变化
- **THEN** 这些 non-model metadata 不进入 Prompt，稳定前缀不变化

### Requirement: Stable content precedes all current-run content

正式请求 MUST 按以下逻辑顺序构造：稳定 Tool Profile、稳定 Agent Kernel、可选 Project Contract、冻结祖先历史、已完成分支历史、本轮 Runtime Control、当前 User Message。当前 Quote、comment、问题、附件、Research plan 和其他本轮内容 MUST NOT 出现在冻结祖先历史或已完成分支历史之前。

#### Scenario: First fork question is generated
- **WHEN** Thread B 从 A 的选区创建并发送 B1
- **THEN** A 的冻结历史位于 B1 branch-origin Quote 和问题之前

#### Scenario: The same branch continues
- **WHEN** Thread B 发送 B2
- **THEN** A 的冻结历史、历史 B1 和 BA1 位于本轮 Runtime Control 与 B2 之前

#### Scenario: An empty branch is opened
- **WHEN** 用户空问题创建 Thread B 但尚未发送
- **THEN** 不产生模型请求、Prompt Cache 写入或 Token 成本

### Requirement: Concrete quote content never appears in the system prefix

Agent Kernel MUST 只定义 Quote 的稳定解释规则。具体 `anchorText`、Quote 正文和 Quote comment MUST 仅作为当前或历史 User Message 的模型可见内容出现，不得拼入全局 System Prompt。

#### Scenario: Two sibling branches select different text
- **WHEN** 两个兄弟分支拥有相同 `forkContext` 但不同 Anchor
- **THEN** 两次请求到 `inherited-end` 的模型可见内容和 Prefix Hash 相同，首次差异出现在各自 B1 Quote

#### Scenario: Quote source metadata changes
- **WHEN** Quote 的来源标题、脚注或未来导航状态变化，但正文与 comment 不变
- **THEN** 模型文本和 Prefix Hash 不变化

### Requirement: Current-thread quote restrictions cannot be bypassed for cache or convenience

普通 Quote MUST 只引用目标 Composer 所属当前 Thread 的 completed assistant Message 或其 Markdown Artifact。缓存优化、Prompt Compiler 或 Composer MUST NOT 通过隐式加载其他 Thread 内容扩大来源范围。Fork 的自动 branch-origin 是唯一服务端派生的父 Thread 来源例外。

#### Scenario: Another thread message is submitted as a quote
- **WHEN** Thread A 的 Command 提交 Thread B 的 Message ID
- **THEN** 服务端在 Message 写入和模型调用前拒绝，不把它当作动态尾部绕过权限

#### Scenario: A branch-origin quote is generated
- **WHEN** ForkedThread 发送第一条 User Message
- **THEN** 服务端根据 Fork 字段生成父 Thread 来源 Quote，并且不开放任意跨 Thread 选择

### Requirement: Multiple quotes remain in the current user tail

当前 User Message MAY 包含零到 50 份有序 Quote。Quote 的 `text` 与可选 `comment` MUST 按 Parts 顺序转换，并位于稳定历史之后。Quote source IDs、TextAnchor、Artifact ID、Draft ID 和其他导航元信息 MUST NOT 进入模型请求。

#### Scenario: Current user submits many quotes
- **WHEN** 用户一次发送多份当前 Thread Quote
- **THEN** 它们只改变 Current User Segment，不改变 inherited 或 branch-history Prefix Hash

#### Scenario: The next turn begins
- **WHEN** 上一轮引用式 User Message 与 assistant 回复已完成，用户继续提问
- **THEN** 上一轮 Quote/Text/回复成为稳定 Branch History，可被下一轮增量复用

### Requirement: Prompt compilation exposes deterministic segments and boundaries

系统 MUST 通过版本化 Prompt Compiler 输出稳定 System、Frozen Inherited History、Stable Branch History、Runtime Control、Current User、Tool Profile、Provider Route 和 metadata-only Prompt Manifest。正式模型调用 MUST 使用同一编译结果，而不是在调用点独立拼接。

#### Scenario: A generation is prepared
- **WHEN** 一个已提交 assistant Message 开始正式生成
- **THEN** Compiler 输出 `kernel-end`、`inherited-end` 和 `branch-history-end` 候选边界及稳定前缀 Hash

#### Scenario: Prompt compiler version changes
- **WHEN** 序列化、Quote Model Format、截断策略或 Segment 顺序改变
- **THEN** 系统升级对应版本并将冷启动记录为 intentional partition

### Requirement: Canonical hashes describe only provider-visible content

`segmentContentHash`、`forkContextHash`、`toolProfileHash` 和 `stableRequestPrefixHash` MUST 基于模型实际看到的角色、内容、Part 顺序、空白、Quote Model Format 和 Tool Schema。Message/Thread/Trace ID、时间戳、Quote source metadata 和 UI 状态 MUST 被排除。

#### Scenario: Objects are reconstructed with different property order
- **WHEN** 应用重建语义相同的非模型 metadata 对象
- **THEN** 稳定前缀 Hash 不变化

#### Scenario: Quote order changes before sending
- **WHEN** 用户在 Draft 中调整 Quote 顺序并发送
- **THEN** Current User 请求形状改变，但其之前的稳定前缀 Hash 不变化

#### Scenario: Tool schema changes
- **WHEN** 工具描述、Schema 或顺序改变
- **THEN** Tool Profile Hash 改变并形成新的缓存空间

### Requirement: Tool definitions use finite stable profiles

系统 MUST 使用有限、版本化的 Tool Profile。一个 Profile 内的工具名、描述、JSON Schema 和顺序 MUST 稳定。运行期 Message ID、query、route reason 和 Project/Thread 信息 MUST NOT 进入 Provider-visible Schema。不同权限面 MAY 形成主动缓存分区，但不得为了命中率扩大工具权限。

#### Scenario: Two requests use the same tool profile
- **WHEN** 两次请求选择相同 Profile
- **THEN** Provider-visible Tool Schema byte-for-byte 稳定

#### Scenario: Web capability is added
- **WHEN** 请求从 answer-only 切换到 Web Profile
- **THEN** 系统记录 `tool-profile-changed`，而不是把它误判为随机缓存失败

### Requirement: Model resolution exposes actual route and cache capability

模型解析 MUST 返回 LanguageModel、Adapter、Gateway、上游模型、route ID、routing policy 和 cache capability。缓存策略 MUST 由实际 Route 决定，不能只由产品 model ID 决定。未验证的 compatible endpoint MUST 保持 `probe-required` 或 `unsupported`。

#### Scenario: The same model uses different routes
- **WHEN** 同一上游模型分别通过 UMAPIS、OpenRouter 或直接 Provider 调用
- **THEN** 它们可以具有不同 route ID、缓存策略、Usage 能力和成本证据

#### Scenario: A private relay is unverified
- **WHEN** Private Relay 可以完成普通调用但未证明缓存透传与 Usage
- **THEN** 系统不得发送猜测的缓存参数或宣称已节省成本

### Requirement: Cache and route selection minimize verified total cost without quality regression

系统 SHALL 在相同目标能力下，以“质量不变差时真实总成本最低”为选择目标。真实总成本 MUST 尽可能包含未缓存输入、缓存写入、缓存读取、输出、Gateway/Relay 费用和因路由漂移产生的失效成本。仅有标价、Token 估计或 Prefix Hash 不足以证明更便宜。

#### Scenario: A cheaper route has equal quality and verified cost
- **WHEN** 候选 Route 使用相同目标模型，质量、工具、安全与终态测试无回归，并且 Provider 实际成本更低
- **THEN** 系统可以优先启用该 Route

#### Scenario: A cheaper route reduces answer quality
- **WHEN** 候选 Route 成本更低，但回答质量、引用理解、工具行为、安全、隔离或终态出现硬回归
- **THEN** 候选不得启用

#### Scenario: Cost evidence is unavailable
- **WHEN** Route 不提供可靠 Cache Usage 或实际成本元数据
- **THEN** 系统保持未验证状态，不自动切换，也不对外宣称更省

### Requirement: Claude caching is verified on the current route before enablement

第一条 Claude Probe SHALL 使用当前实际可用的 UMAPIS Claude Route。Probe MUST 验证缓存参数透传、cache creation/read Usage、回答与工具质量、TTFT、安全回退和真实总成本。若无法证明缓存生效和净节省，该 Route MUST 保持缓存关闭。直接 Anthropic Route MAY 作为具备凭据的参考实验，不要求生产立即切换。

#### Scenario: UMAPIS returns cache usage and lower cost
- **WHEN** warm-up 与复用请求证明非零 cache read、相同质量且实际总成本下降
- **THEN** 该具体 Route 可以进入小范围 enabled

#### Scenario: UMAPIS accepts requests but hides cache evidence
- **WHEN** 普通 Claude 调用成功但缓存透传或 Usage 无法证明
- **THEN** 该 Route 保持 `probe-required` 或无显式缓存，不把未知当作命中

#### Scenario: Cache options are rejected
- **WHEN** 上游拒绝 cache control、affinity 或 TTL 参数
- **THEN** 系统安全降级为普通模型请求；若普通请求成功，Message 仍正常完成

### Requirement: Short provider-default caching is the initial TTL policy

第一阶段 MUST 使用 Provider 默认短时缓存；Provider 明确支持时 MAY 验证约 5 分钟 TTL。1 小时或其他 Extended TTL MUST 默认关闭，只有真实会话间隔、读写费用与数据保留评估证明净成本更低时，才可按 Route 启用。

#### Scenario: User creates sibling branches within a short interval
- **WHEN** 请求发生在短时缓存有效期内
- **THEN** 系统优先复用短缓存，不为可能不会发生的长期返回支付额外写入成本

#### Scenario: Extended TTL appears attractive
- **WHEN** 运营数据表明用户常在短缓存过期后返回
- **THEN** 系统仍需证明 extended write cost 小于后续 read savings，并通过 retention/ZDR 检查后才能启用

### Requirement: Breakpoints prioritize inherited and branch-history reuse

显式缓存 Route MUST 根据最小长度、最大 breakpoint 数和 TTL 确定性选择边界，优先级为 `inherited-end`、`branch-history-end`、`kernel-end`。Implicit 或 Gateway auto Route MUST 保留相同候选边界用于诊断，但不得伪造 marker。

#### Scenario: A long inherited history is eligible
- **WHEN** inherited prefix 达到 Route 最小长度且存在可用 breakpoint
- **THEN** Adapter 优先在 `inherited-end` 设置可复现 marker

#### Scenario: Prompt is below minimum
- **WHEN** stable prefix 短于已知最小缓存长度
- **THEN** 请求正常执行，资格标记为 `below-minimum`，不得宣称创建缓存

### Requirement: Eligibility, cache warmth, and provider hit are distinct

系统 MUST 区分应用前缀资格、缓存冷暖推断和 Provider 返回的 cache read 证据。相同 Prefix Hash MUST NOT 被表述为 Provider 命中。首次请求、最新 assistant 输出尚未作为输入、TTL 过期和 Route 漂移 MUST 使用独立 reason code。

#### Scenario: A branch is created from the latest assistant output
- **WHEN** 来源 assistant 内容此前只作为输出出现
- **THEN** 系统标记 cold-start 或 partial-warm，并允许只复用更早历史

#### Scenario: A warm sibling receives cache reads
- **WHEN** 相同 eligible prefix 已在 TTL 内作为输入提交，后续请求返回非零 cache read
- **THEN** 系统记录 `provider-hit`

#### Scenario: Usage fields are absent
- **WHEN** Prefix Hash 相同但 Provider 不返回缓存字段
- **THEN** 状态为 `usage-unavailable`，不是 hit 或明确 miss

### Requirement: Cache usage is normalized per model attempt without replacing raw usage

系统 MUST 对每个模型 Step best-effort 归一化 input、cache read、cache write、uncached input、output、finish reason、TTFT、时长和实际 Route。缺失字段 MUST 保持 unknown。原始 provider usage 和现有计费链路继续是权威。

#### Scenario: Standard cache fields are available
- **WHEN** AI SDK Usage 提供标准 cache read/write 字段
- **THEN** Model Attempt 使用这些字段并记录来源

#### Scenario: Only provider metadata has details
- **WHEN** 标准 Usage 缺失但 allowlisted Provider metadata 有合法字段
- **THEN** 归一化器使用该来源并保留原始 usage

#### Scenario: Multi-step tool loop completes
- **WHEN** 正式回答包含多个模型 Step
- **THEN** 每个 Step 都有独立 Model Attempt，运行摘要由全部 Step 聚合

### Requirement: Cache telemetry remains metadata-only and extends existing traces

Prompt Cache MUST 扩展现有 assistant Message Trace、AI SDK model Observation 和 Agent Eval envelope，不得创建第二套生成身份。生产环境默认只导出版本、Hash、数值、Route、成本与 reason code，MUST NOT 导出 Prompt、Quote 正文、Quote source IDs、TextAnchor、Search query、文件、网页正文、认证信息或隐藏推理。

#### Scenario: A cached generation completes
- **WHEN** Provider 返回缓存 Usage
- **THEN** Trace 可以分析命中、TTFT、真实成本和 Route，但不包含用户正文

#### Scenario: Telemetry fails
- **WHEN** Collector、Hash、Usage parser 或 exporter 异常
- **THEN** Agent 继续生成并按数据库事实完成 Message

### Requirement: Cache behavior is evaluated deterministically and with approved live probes

CI MUST 使用 fake Provider/fixture 验证 Segment、Hash、Quote metadata 排除、Tool Profile、breakpoint、Route 和 reason code。Scheduled/release MAY 对批准 Route 执行 warm-up 与复用 Probe，并使用 Provider Usage 和实际成本作为证据。缓存收益 MUST NOT 覆盖回答质量、安全、隔离和终态硬失败。

#### Scenario: CI evaluates sibling forks
- **WHEN** 两个 fixture 拥有相同冻结祖先和不同 Quote
- **THEN** inherited Prefix Hash 相同，差异只出现在 Current User

#### Scenario: CI tests cross-thread rejection
- **WHEN** Quote Selection 指向另一个 Thread
- **THEN** 命令被拒绝，不产生模型调用

#### Scenario: Live probe is cheaper but quality regresses
- **WHEN** Cache metrics 改善但质量 hard score 回归
- **THEN** candidate 不得通过启用门禁

### Requirement: Cache rollout is reversible and route-scoped without changing prompt semantics

系统 MUST 提供 server-only `off`、`observe` 和 `enabled` 模式，并允许按环境、Route 和稳定 cohort 覆盖。三种模式 MUST 使用同一套 Quote-safe、确定性的 Prompt Compiler 和消息顺序；模式切换 MUST NOT 把具体 Anchor、Quote 或 Research plan 重新移到 System 或稳定历史之前。`off` MUST 不发送 Provider 缓存控制；`observe` MUST 发送与 `off` 相同的语义 Prompt、记录 Manifest/Route/资格/成本诊断，但不发送 cache marker、affinity、TTL 或 Gateway cache option；`enabled` MUST 只对已验证 Route 在同一语义 Prompt 上增加缓存传输控制。

#### Scenario: Off mode is enabled
- **WHEN** 某 Route 配置为 off
- **THEN** 请求仍使用 Quote-safe Prompt Compiler，但不发送 Provider 缓存参数，并可作为无缓存成本基线

#### Scenario: Observe mode is enabled
- **WHEN** staging 或生产小范围使用 observe
- **THEN** 用户收到与 off 相同的语义 Prompt 结果，系统收集候选边界、Prefix Hash、Route、Usage 和成本证据，且 Provider 看不到缓存控制字段

#### Scenario: One Claude route is enabled
- **WHEN** 只有 UMAPIS 某 Claude Route 通过质量与成本 Probe
- **THEN** 只有该 Route 在相同语义 Prompt 上增加已验证的缓存控制，其他 Route 继续使用 off 或 observe

#### Scenario: Regression is detected
- **WHEN** 质量、工具、Provider 兼容或成本证据出现问题
- **THEN** 操作员可以将受影响 Route 切回 off，无需迁移 Message，且不会回退到旧的动态 System Prompt

### Requirement: Application-level compiled segment caching is optional

系统 SHALL 定义可选的 Compiled Segment Cache，但第一阶段默认使用 noop。L2 Cache 只能优化数据库读取和 Prompt 编译，MUST NOT 被当作 Provider cache hit、会话事实源或普通聊天答案缓存。普通聊天 MUST NOT 使用 Exact Response Cache 返回旧答案。

#### Scenario: L2 is disabled
- **WHEN** 未证明应用编译成为瓶颈
- **THEN** Prompt Compiler 每次从权威数据库构造请求，L1 Provider Cache 仍可独立工作

#### Scenario: User repeats the same question
- **WHEN** 两次用户请求文本相同
- **THEN** 系统仍执行新的模型生成，不直接返回旧答案
