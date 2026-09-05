## Purpose

定义 Thread Chat Prompt 缓存 V1 的固定生成模式、缓存线路资格、共同历史断点和持续观测合同，使系统在不改变 Prompt 语义与生成行为的前提下尽可能复用供应商原生缓存。

## ADDED Requirements

### Requirement: Generation behavior is partitioned into fixed modes

系统 MUST 以 `(researchMode, artifactRequested)` 的合法组合作为固定生成模式。每个固定模式 MUST 确定其 System 模板、模型可见工具名称与顺序、工具描述与 Schema、首步强制工具规则、推理设置和最大步骤。

系统 MUST NOT 为提高缓存命中率向某个模式增加其原本没有的工具权限、取消其首步强制工具、改变推理设置或改变最大步骤。

研究计划仍是 `research` 模式的当前请求动态 System 内容。V1 MUST 保留其现有服务端指令权威和位置，并接受该内容之后的旧前缀无法复用。

#### Scenario: Two requests use the same fixed mode

- **WHEN** 两次请求具有相同的 `researchMode`、`artifactRequested`、模型配置和 Prompt Schema 版本
- **THEN** 系统为两次请求生成逐字相同的静态 System、工具定义、首步工具规则、推理设置和最大步骤

#### Scenario: A request changes generation capability

- **WHEN** 请求从普通回答切换为联网、研究或 Markdown Artifact 能力
- **THEN** 系统使用对应的另一个固定生成模式和缓存分区，并保留该模式真实需要的权限与行为

#### Scenario: A cache optimization would widen permissions

- **WHEN** 复用另一个模式的缓存需要增加工具权限、取消强制工具或改变推理设置
- **THEN** 系统拒绝该优化并保持原固定模式行为

#### Scenario: A research plan is generated

- **WHEN** 请求进入 `research` 模式并生成当前请求专属研究计划
- **THEN** 系统将计划保留在现有服务端 System 权威位置，不把它降级为普通 User 内容

### Requirement: Prompt-visible fixed mode content is deterministic

在输入固定模式、Project Contract、Prompt Schema 版本和历史模型可见内容相同的情况下，系统 MUST 确定性地产生模型可见前缀。请求 ID、Generation ID、Message ID、当前时间、研究路由原因、观测身份和缓存命中结果 MUST NOT 进入模型可见的固定前缀。

工具执行所需但模型不可见的上下文 MAY 随请求变化，但 MUST NOT 改变工具名称、顺序、描述或 Schema。

#### Scenario: Only execution metadata changes

- **WHEN** 两次请求只有请求 ID、Generation ID、观测身份或研究路由原因不同
- **THEN** 两次请求的固定模式模型可见内容保持逐字相同

#### Scenario: Tool execution context changes

- **WHEN** 工具执行闭包收到不同的非模型可见路由元数据，但固定模式相同
- **THEN** 工具名称、顺序、描述和 Schema 保持相同

#### Scenario: Project Contract changes

- **WHEN** Project Contract 的目标、指令或版本发生变化
- **THEN** 系统允许形成新的 Prompt 前缀和缓存分区，不通过降低 Project Contract 指令权威来复用旧缓存

### Requirement: Shared Thread history remains before current dynamic input

系统 MUST 按 `forkContext` 的有序 Message ID 加载完整、原序的冻结继承历史，再追加 Child 中已完成的当前 Thread 历史，最后追加当前 User Message。

系统 MUST NOT 对 Child 单独应用 6000 字符截断，MUST NOT 插入伪造的历史省略 User Message，且 MUST NOT 将 `anchorText`、`forkAnchor` 或具体 Quote 拼入早于共同历史的 System。

Quote 的具体模型可见内容 MUST 只出现在其所属 User Message 的位置。完整请求超过模型真实上下文限制时，V1 MUST 在付费回答调用前返回明确错误，不得静默截断或逐轮摘要。

#### Scenario: Sibling forks use different quotes

- **WHEN** 两个 Child 使用相同模型、固定生成模式、Project Contract 和 `forkContext`，但当前 User Message 包含不同 Quote
- **THEN** Quote/Fork 机制在共同历史结束前不制造差异，两次请求从各自当前 User Message 开始不同

#### Scenario: Inherited history exceeds the former child budget

- **WHEN** `forkContext` 历史超过 6000 字符但完整请求仍在模型真实上下文限制内
- **THEN** 系统发送完整、原序的继承历史且不插入省略消息

#### Scenario: A child message has no quote

- **WHEN** Child 的当前 User Message 不含 `data-quote`，但 Thread 仍保存 `anchorText` 或 `forkAnchor`
- **THEN** 系统不把这些 Thread 字段通过 System、User 或隐藏内容发送给模型

#### Scenario: Exact context exceeds the model limit

- **WHEN** 完整原序历史和当前输入超过所选模型的真实上下文限制
- **THEN** 系统在付费回答调用前返回明确错误，不执行 Child 专属截断或摘要

### Requirement: Explicit prompt caching is enabled only for verified model routes

系统 MUST 通过单一 Provider 缓存能力策略判断是否发送显式缓存参数。V1 MUST 只为 UMAPIS Claude 凭据组中的 `claude-opus-5` 和 `claude-sonnet-5` 启用 Anthropic 显式 Prompt 缓存。

未列入显式缓存白名单的模型线路 MUST NOT 接收猜测性的缓存参数。它们 MAY 继续使用 Provider 自动缓存，并 MAY 上报 Provider 实际返回的缓存用量。

缓存资格 MUST 根据实际 Provider、协议和上游模型判断，不得仅根据展示名称、模型创建者或推测能力判断。

#### Scenario: A verified UMAPIS Claude model is selected

- **WHEN** 实际线路是 UMAPIS Anthropic 协议且上游模型为 `claude-opus-5` 或 `claude-sonnet-5`
- **THEN** 系统为该回答请求启用 Anthropic 显式 Prompt 缓存

#### Scenario: An unverified OpenAI-compatible route is selected

- **WHEN** 实际线路使用 OpenAI-compatible 协议且未经过独立缓存透传验证
- **THEN** 系统不发送显式缓存参数，并仅记录上游实际返回的缓存用量

#### Scenario: A model creator matches but the route does not

- **WHEN** 模型由 Anthropic 创建，但实际调用线路不在已验证白名单中
- **THEN** 系统不因模型创建者身份自动启用显式缓存

### Requirement: The stable shared prefix has a provider cache breakpoint

对于显式缓存白名单线路，系统 MUST 在当前 User Message 之前的稳定共同历史末尾设置 Provider 缓存断点。若请求没有可用的共同历史，系统 MUST 仍可在稳定服务端指令前缀设置合法缓存断点，但 MUST NOT 为制造断点插入模型可见占位消息。

缓存断点 MUST 通过 Provider 策略层附加到现有 System、Message 或 Message Part，MUST NOT 改写模型可见文本、消息角色、消息顺序或工具定义。单次请求的断点数量 MUST 遵守实际 Provider 限制。

#### Scenario: A continued conversation has stable history

- **WHEN** 白名单模型生成请求包含位于当前 User Message 之前的稳定共同历史
- **THEN** 系统在最后一条稳定历史的合法末尾设置缓存断点，使当前 User Message 保持在断点之后

#### Scenario: A new conversation has no shared history

- **WHEN** 白名单模型的请求只有稳定服务端指令和当前 User Message
- **THEN** 系统只在合法稳定前缀设置缓存断点，且不插入占位 User Message

#### Scenario: Cache decoration is removed

- **WHEN** 从同一请求中移除所有 Provider 缓存参数
- **THEN** 除缓存参数外的 System、Messages、工具、推理设置、步骤规则和输出限制保持相同

#### Scenario: Provider breakpoint limit applies

- **WHEN** Provider 限制单次请求最多四个缓存断点
- **THEN** 系统的 Provider 策略不生成超过四个断点，且优先保留当前 User Message 之前的共同历史断点

### Requirement: Cache outcome is observed with unknown-preserving semantics

系统 MUST 为每次 Thread Chat 回答调用记录实际 Provider、上游模型、固定生成模式、Prompt Schema 版本、Project Contract 版本、显式缓存是否启用、输入 Token、未缓存输入 Token、缓存读取 Token、缓存写入 Token和输出 Token。

系统 MUST 将缓存结果表达为命中、未命中或未知三态：`cacheReadTokens > 0` 为命中；缓存明细完整且 `cacheReadTokens = 0` 为未命中；缓存读取字段缺失为未知。系统 MUST NOT 把缺失字段转换为零。

观测数据 MUST 上报到现有 Langfuse 和服务端结构化日志链路，并保留现有 generation `providerUsage` 中足够的标准或原始 Provider 用量供排障。观测 MUST NOT 记录完整 Prompt、Quote 正文、附件正文或用户消息正文。

#### Scenario: A cache read is reported

- **WHEN** Provider 返回大于零的 `cacheReadTokens`
- **THEN** 系统记录缓存命中、读取 Token 数和对应模型线路维度

#### Scenario: A cache write without a read is reported

- **WHEN** Provider 返回完整缓存明细、`cacheReadTokens = 0` 且 `cacheWriteTokens > 0`
- **THEN** 系统记录未命中和缓存写入，不把该请求记录为命中

#### Scenario: Cache details are absent

- **WHEN** Provider 只返回总输入 Token 或完全不返回缓存明细
- **THEN** 系统记录缓存结果为未知，不填充伪造的零读取或零写入值

#### Scenario: Sensitive content reaches observability

- **WHEN** 系统构造缓存观测或结构化日志事件
- **THEN** 事件只包含允许的身份、模式、版本和数值字段，不包含完整 Prompt、Quote、附件或用户正文

### Requirement: Cache observability does not control generation

缓存命中、未命中、写入、未知或观测上报失败 MUST 仅作为观测结果。系统 MUST NOT 因缓存结果切换模型、改变固定生成模式、修改 Prompt、调整工具权限、重试回答、改变计费终态或把成功回答改为失败。

Provider 忽略缓存参数或没有命中缓存时，系统 MUST 继续执行与未启用缓存相同的生成和持久化流程。

#### Scenario: A verified model misses the cache

- **WHEN** 白名单模型返回零缓存读取并重新写入相同前缀
- **THEN** 系统正常完成回答并记录未命中，不切换模型或重试生成

#### Scenario: Cache telemetry upload fails

- **WHEN** Langfuse 或结构化日志的缓存观测上报失败
- **THEN** 回答生成、消息持久化和消息终态不受影响

#### Scenario: The provider ignores cache control

- **WHEN** Provider 成功处理请求但没有应用或报告显式缓存
- **THEN** 系统按正常生成结果完成请求，并把缓存结果记录为未知或基于完整返回字段记录为未命中

### Requirement: Cache effectiveness uses token-based and request-based metrics

系统 MUST 能按实际 Provider、上游模型、固定生成模式和 Prompt Schema 版本聚合缓存效果。

当 `noCacheTokens`、`cacheReadTokens` 和 `cacheWriteTokens` 均存在时，Token 缓存命中率 MUST 按 `cacheReadTokens / (noCacheTokens + cacheReadTokens + cacheWriteTokens)` 计算。当这些明细不完整但 `inputTokens` 和 `cacheReadTokens` 均存在时，系统 MAY 降级使用 `cacheReadTokens / inputTokens`，并 MUST 标记计算口径。

请求命中率 MUST 只使用缓存读取字段已知的请求作为分母。未知请求 MUST 单独统计，MUST NOT 并入未命中。

#### Scenario: Complete cache token details are available

- **WHEN** 一组请求均返回未缓存、缓存读取和缓存写入 Token
- **THEN** 系统使用完整 Token 公式计算命中率并记录该口径

#### Scenario: Only total input and cache reads are available

- **WHEN** 请求返回 `inputTokens` 和 `cacheReadTokens`，但未返回其他缓存明细
- **THEN** 系统使用降级公式并标记降级口径

#### Scenario: Some requests have unknown cache details

- **WHEN** 聚合窗口中部分请求缺失缓存读取字段
- **THEN** 系统从请求命中率分母排除这些请求，并单独报告未知率
