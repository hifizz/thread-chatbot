# openrouter-model-access OpenRouter 模型接入

## ADDED Requirements

### Requirement: 固定且唯一的 OpenRouter 模型目录

系统 SHALL 在共享模型注册表中注册且仅注册本 change 指定的 10 个 OpenRouter 产品模型。每个模型 SHALL 使用全站唯一、带 `openrouter-` 前缀的内部 id，并 SHALL 映射到以下准确的 OpenRouter model id：`openai/gpt-5.6-luna`、`openai/gpt-5.6-luna-pro`、`openai/gpt-5.6-terra`、`openai/gpt-5.6-terra-pro`、`openai/gpt-5.6-sol`、`openai/gpt-5.6-sol-pro`、`openai/gpt-5.5`、`openai/gpt-5.5-pro`、`moonshotai/kimi-k3`、`deepseek/deepseek-v4-flash-0731`。系统 MUST 将调用 provider 与模型创建者分开表达，不得因 slug 前缀把这些模型送入现有 OpenAI、DeepSeek 或 Ark 路由。

#### Scenario: 注册表准确映射 10 个模型

- **WHEN** 系统读取 OpenRouter 模型注册项
- **THEN** SHALL 恰好得到 10 个全站唯一的内部 id，且每个内部 id SHALL 一一映射到指定的 OpenRouter model id

#### Scenario: 与现有 Ark DeepSeek 模型并存

- **WHEN** 注册 `openrouter-deepseek-v4-flash-0731` 且注册表中已存在 Ark 的 `deepseek-v4-flash`
- **THEN** 两者 SHALL 保持不同内部 id、不同调用 provider 和不同计费 key，不得互相覆盖

### Requirement: OpenRouter 模型固定走专属 provider

对于注册表中调用 provider 为 `openrouter` 的模型，系统 SHALL 使用与 AI SDK v7 兼容的 OpenRouter 专属 provider和仅服务端可读的 `OPENROUTER_API_KEY` 发起调用。该调用 MUST 不进入 Vercel AI Gateway、Cloudflare AI Gateway、Ark Coding Plan 或供应商直连的既有路由链，也 MUST 不因 OpenRouter 未配置或请求失败而静默切换 provider。

#### Scenario: 多种网关凭据同时存在

- **WHEN** 环境同时配置 `OPENROUTER_API_KEY`、Vercel AI Gateway、Cloudflare AI Gateway 和供应商直连 key，并请求一个 OpenRouter 内部模型 id
- **THEN** 系统 SHALL 只通过 OpenRouter 专属 provider 调用其注册的 OpenRouter model id

#### Scenario: OpenRouter key 缺失

- **WHEN** 请求一个合法 OpenRouter 模型但服务端未配置非空 `OPENROUTER_API_KEY`
- **THEN** 系统 SHALL 在进入 `streamText` 前返回 HTTP 400 与包含模型名称的中文配置错误，且不得调用上游或写入用量流水

#### Scenario: OpenRouter 上游失败

- **WHEN** OpenRouter 返回鉴权、额度、限流或服务错误
- **THEN** 系统 SHALL 使用既有流内错误掩码与服务端日志处理，不得自动改用另一个 provider 或模型

### Requirement: 聊天接口只接受内部模型 id

`POST /api/chat` SHALL 保持既有 `modelId?: unknown` 请求字段，不得增加或信任客户端提供的 OpenRouter slug、provider、reasoning 配置、插件、路由策略或成本字段。缺失 `modelId` SHALL 沿用既有默认模型；显式非字符串或未注册 id SHALL 返回 HTTP 400。

#### Scenario: 内部 OpenRouter id 正常请求

- **WHEN** 客户端提交已注册的 OpenRouter 内部 `modelId`
- **THEN** 服务端 SHALL 从共享注册表解析对应 OpenRouter model id 并使用它处理本次请求

#### Scenario: 客户端直接提交 OpenRouter slug

- **WHEN** 客户端将 `openai/gpt-5.6-luna` 等外部 slug 作为 `modelId` 提交
- **THEN** 服务端 SHALL 将其视为未知 id 并返回 HTTP 400，不得把它透传给 OpenRouter

#### Scenario: 客户端提交路由或成本覆盖字段

- **WHEN** 请求体附带未定义的 OpenRouter provider options、插件、reasoning 或 cost 字段
- **THEN** 系统 SHALL 忽略这些字段，实际路由和计费 SHALL 只由服务端注册表、服务端配置与上游元数据决定

### Requirement: OpenRouter 模型在 Thread Chat 中可选择并持久化

10 个 OpenRouter 模型 SHALL 从共享注册表进入 Thread Chat 可选模型集合，不得在 selector 内维护第二份 id 列表。根 Thread SHALL 能在空闲时选择任一新增模型并持久化该内部 id；分支 SHALL 继续继承直接父 Thread 的内部模型 id并保持选择器锁定。加载未知、缺失或已移除模型 id SHALL 继续回退既有 Thread 默认模型，且不得丢失消息或分支。

#### Scenario: 根 Thread 选择 OpenRouter 模型

- **WHEN** 用户在根 Thread 选择 `openrouter-kimi-k3` 后发送消息
- **THEN** Thread 状态与请求体 SHALL 使用该内部 id，并在保存和刷新后保持该选择

#### Scenario: 分支继承 OpenRouter 模型

- **WHEN** 从使用 `openrouter-gpt-5.6-terra` 的 Thread 创建分支
- **THEN** 新分支 SHALL 继承相同内部模型 id，且分支选择器 SHALL 保持禁用

#### Scenario: 已移除 OpenRouter 模型的旧树

- **WHEN** 持久化树包含一个已不在 Thread 可见模型集合中的 OpenRouter 内部 id
- **THEN** 加载器 SHALL 只把该 id 替换为既有默认模型，并保留树、消息和分支结构

### Requirement: OpenRouter 原生 reasoning 和工具流保持 AI SDK 语义

OpenRouter 模型 SHALL 使用 provider-native reasoning 传输，不得应用仅用于字面 `<think>...</think>` 的抽取中间件。系统 SHALL 保留 AI SDK 标准 reasoning、usage、工具调用和多 step 流行为。本 change SHALL 使用 OpenRouter默认 reasoning 配置，不得新增客户端 reasoning-effort 参数；Pro 模型 SHALL 作为独立模型 id 而不是普通模型的 effort 变体。

#### Scenario: 原生 reasoning 不经过标签抽取

- **WHEN** OpenRouter provider 返回 AI SDK reasoning parts
- **THEN** 系统 SHALL 将其作为标准 reasoning 流处理，且不得要求响应包含或解析 `<think>` 标签

#### Scenario: OpenRouter 模型调用既有工具

- **WHEN** 一个新增模型在 Thread Chat 中调用现有 Markdown Artifact 工具并产生后续模型 step
- **THEN** 系统 SHALL 继续使用现有工具定义、`prepareStep`、停止条件和 UI stream，不得为 OpenRouter 复制独立工具协议

#### Scenario: Pro 模型保持独立选项

- **WHEN** 用户打开模型选择器
- **THEN** Luna Pro、Terra Pro、Sol Pro 与 GPT-5.5 Pro SHALL 作为各自独立模型选项出现，不得被折叠为 reasoning effort

### Requirement: 逐 step 验证并聚合 OpenRouter 真实成本

对于成功结束的 OpenRouter 生成，系统 SHALL 从本次 `streamText` 的全部 steps 读取 `providerMetadata.openrouter.usage.cost`。只有在 steps 非空且每个 step 的 cost 都是有限、非负 number 时，系统 SHALL 将全部 step 的 cost 求和作为本次真实美元成本；`0` SHALL 被视为合法值。任一 step 缺失或包含非法 cost 时，系统 MUST 放弃全部部分成本并对整次调用使用静态保守估值。

#### Scenario: 单 step 真实成本

- **WHEN** 一次 OpenRouter 生成只有一个 step 且其 cost 为合法正数
- **THEN** 系统 SHALL 使用该值作为整次真实美元成本

#### Scenario: 多 step 成本完整聚合

- **WHEN** 一次工具循环完成三个 step，且三个 step 分别返回合法 cost
- **THEN** 系统 SHALL 使用三个 cost 的精确和作为整次真实美元成本，不得只读取最终 step

#### Scenario: 合法零成本

- **WHEN** 所有 step 都返回合法数值且其中某个 cost 为 `0`
- **THEN** 系统 SHALL 将零值纳入求和并继续使用真实成本路径，不得因 falsy 判断回退

#### Scenario: 某一步缺失成本

- **WHEN** 多 step 生成中任意 step 缺少 OpenRouter usage cost
- **THEN** 系统 SHALL 对整次生成使用静态保守估值，不得把其余 step 的部分和记录为真实成本

#### Scenario: 非法成本值

- **WHEN** 任意 step 的 cost 为字符串、负数、`NaN` 或无限值
- **THEN** 系统 SHALL 将整次真实成本判定为不可用、记录可诊断日志并使用静态保守估值

### Requirement: OpenRouter 成本证据进入统一原子计费

计费接口 SHALL 接受判别式成本证据。合法 OpenRouter 真实美元成本 SHALL 经既有美元转微元函数与利润率公式计算成本和售价，在扣余额与写用量流水的同一事务内记录 `costSource = "openrouter"`，且不得进入 Vercel generation-id reconcile。真实成本不可用时 SHALL 使用该模型非零、覆盖最高已知阶梯的静态 USD 回退价并记录 `costSource = "estimate"`。

#### Scenario: 真实成本即时记账

- **WHEN** 成功结束的 OpenRouter 生成得到完整真实美元成本
- **THEN** 系统 SHALL 按既有汇率与至少 30% 目标利润率计算售价，原子扣减余额并写入 `openrouter` 来源流水

#### Scenario: 元数据缺失时保守估值

- **WHEN** OpenRouter 生成成功但完整真实成本不可用
- **THEN** 系统 SHALL 使用对应内部模型的非零保守价格计费并记录 `estimate`，不得按零成本或部分成本记账

#### Scenario: OpenRouter 流水不参与 Vercel 对账

- **WHEN** 成本来源为 `openrouter` 的流水已经写入
- **THEN** Vercel Gateway reconcile SHALL 不扫描或修改该流水，且该流水 SHALL 不需要 generation id

#### Scenario: 长上下文的回退价格

- **WHEN** GPT 系列 OpenRouter 请求缺少真实成本元数据且输入可能超过 272K tokens
- **THEN** 静态回退成本 SHALL 使用该模型当前最高已知长上下文阶梯价，避免低估供应商成本

### Requirement: 配置、密钥与兼容性边界

系统 SHALL 只在服务端读取 `OPENROUTER_API_KEY`；可选归因配置为空时 SHALL 不发送对应 header。任何 API key、原始 provider metadata 或 OpenRouter 完整响应 MUST NOT 写入客户端消息、日志或数据库。新增能力 SHALL 不改变既有模型 id、默认模型、现有 provider 路由优先级和历史流水语义。

#### Scenario: 可选归因配置为空

- **WHEN** 已配置 OpenRouter key 但未配置 referer 或 app title
- **THEN** 系统 SHALL 正常调用 OpenRouter，且 SHALL 不发送空值归因 header

#### Scenario: 敏感信息不外泄

- **WHEN** OpenRouter 请求成功、失败或写入用量流水
- **THEN** 客户端响应、服务端日志和数据库 SHALL 不包含 `OPENROUTER_API_KEY` 或完整原始 provider 响应

#### Scenario: 既有 provider 行为保持不变

- **WHEN** 请求 MiniMax、Ark 或现有网关/供应商模型
- **THEN** 系统 SHALL 继续遵循其既有配置检测、路由、reasoning 和计费行为，不得因新增 OpenRouter provider 改变优先级
