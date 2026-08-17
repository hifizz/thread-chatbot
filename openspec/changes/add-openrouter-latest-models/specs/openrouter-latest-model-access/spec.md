## ADDED Requirements

### Requirement: 固定登记近期 OpenRouter 模型

系统 SHALL 在共享模型注册表中增加且仅增加本 change 指定的三个近期 OpenRouter 模型：Qwen3.8 Max 映射 `qwen/qwen3.8-max`，Grok 4.5 映射 `x-ai/grok-4.5`，Grok 4.6 映射 `x-ai/grok-4.6`。每一项 MUST 使用全站唯一、带 `openrouter-` 前缀的内部 id，调用 provider MUST 为 `openrouter`，且 MUST 使用原生 reasoning 传输。

#### Scenario: 精确的目录映射

- **WHEN** 系统读取新增的 OpenRouter 注册项
- **THEN** SHALL 得到三个唯一内部 id，且其上游 slug 按登记顺序准确映射到 `qwen/qwen3.8-max`、`x-ai/grok-4.5` 与 `x-ai/grok-4.6`

#### Scenario: 未上架的 GLM 5.3 不被登记

- **WHEN** 系统读取 OpenRouter 注册项
- **THEN** SHALL 不存在映射到 GLM 5.3 的内部 id 或上游 slug

### Requirement: 新模型在 Thread Chat 中可选并固定走 OpenRouter

三个新增模型 SHALL 从共享注册表进入 Thread Chat 模型选择器、持久化校验与请求体内部 id 校验。它们 MUST 固定走既有 OpenRouter 专属 provider，不得进入现有 Vercel AI Gateway、Cloudflare AI Gateway 或创建者直连路由。

#### Scenario: 根会话选择新模型

- **WHEN** 根 Thread 选择任一新增内部 id 并发送下一条消息
- **THEN** 持久化状态与请求 SHALL 使用该内部 id，服务端 SHALL 从注册表解析对应 OpenRouter slug

### Requirement: 新模型具有保守的非零静态回退价

三个新增模型在 `MODEL_COST` 中 SHALL 具有非零美元输入与输出回退价。Qwen3.8 Max SHALL 使用 $2/$6 每百万 token；Grok 4.5 与 Grok 4.6 SHALL 使用其 200K 输入以上的最高公开阶梯 $4/$12 每百万 token。完整 OpenRouter 逐 step 成本存在时，系统 MUST 继续优先使用真实成本。

#### Scenario: 成本元数据缺失时的安全计费

- **WHEN** 任一新增模型成功结束但 OpenRouter 成本元数据不完整
- **THEN** 系统 SHALL 使用对应内部 id 的非零静态回退价计费，不得按零成本或部分 step 成本计费
