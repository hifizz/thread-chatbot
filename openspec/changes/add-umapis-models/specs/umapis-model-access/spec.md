## ADDED Requirements

### Requirement: UMAPIS 模型注册
系统 SHALL 以 UMAPIS 专属 provider 注册 claude-opus-4-6、claude-sonnet-5、gpt-5.6-sol 和 gpt-5.6-terra，并 SHALL 在 Thread Chat Prompt 输入关联的模型选择器展示四者。

#### Scenario: 查看 UMAPIS 模型
- **WHEN** 用户打开 Thread Chat Prompt 输入关联的模型选择器
- **THEN** 系统展示四个指定模型，选中值使用统一注册表 id

### Requirement: UMAPIS 专属路由
系统 SHALL 使用独立 UMAPIS API Key 和可配 Base URL 调用 UMAPIS；Claude 模型使用 Claude 组 Key，GPT 模型使用 GPT 组 Key，MUST NOT 把这些请求路由到 Vercel、Cloudflare、Ark 或现有供应商直连分支。

#### Scenario: 配置完整
- **WHEN** 该模型所属 UMAPIS 凭据组已配置且客户端请求已注册 UMAPIS 模型
- **THEN** 服务端把请求发送到 UMAPIS provider，并使用注册的上游模型 id

#### Scenario: 凭据缺失
- **WHEN** 客户端请求 UMAPIS 模型但服务端没有该模型所属组的 UMAPIS API Key
- **THEN** 服务端在调用上游前返回可读的 400，且不泄露凭据或内部配置

### Requirement: UMAPIS 流式能力
系统 SHALL 保持现有流式文本、工具调用、reasoning 事件和 token usage 契约，并 SHALL 仅在上游实际返回字面推理标签时使用标签抽取中间件。

#### Scenario: 成功流式生成
- **WHEN** UMAPIS 返回流式响应
- **THEN** 用户逐步看到回复，完成时系统保留上游可用的 reasoning 与 token usage，且请求不携带未经验证的 Effort 参数

#### Scenario: 标准 reasoning 流
- **WHEN** UMAPIS 已返回独立 reasoning 事件
- **THEN** 系统直接透传该事件，不对正文应用字面标签抽取

### Requirement: 现有 provider 行为不变
系统 MUST 保持非 UMAPIS 模型现有的配置判断、路由优先级和上游 id 行为。

#### Scenario: 请求现有模型
- **WHEN** 客户端请求非 UMAPIS 的已注册模型
- **THEN** 系统使用原 provider 路径，且不要求 UMAPIS 配置

### Requirement: 未计费预览边界
系统 SHALL 在后续计费 capability 落地前将 UMAPIS 模型视为未计费预览，MUST NOT 展示未经验证的价格，也 MUST NOT 因这些调用扣减用户付费额度。

#### Scenario: 预览生成完成
- **WHEN** UMAPIS 模型成功完成生成
- **THEN** 系统可记录 token usage，但不扣付费额度且不把未知价格表示为已知单价
