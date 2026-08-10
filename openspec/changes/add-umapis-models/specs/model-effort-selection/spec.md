## ADDED Requirements

### Requirement: 模型级 Effort 元数据
系统 SHALL 为每个支持 Effort 的模型声明独立允许选项、上游值映射和默认值，前端展示与服务端校验 MUST 消费同一元数据。

#### Scenario: Claude 与 GPT 的支持集不同
- **WHEN** 两个 UMAPIS 模型声明不同的 Effort 列表
- **THEN** 选择器只展示当前模型选项，API 也只接受该列表中的值

#### Scenario: 模型不支持 Effort
- **WHEN** 当前模型没有 Effort 元数据
- **THEN** 选择器不显示 Effort 控件，系统不向上游发送 UMAPIS Effort 参数

### Requirement: Thread 级 Effort 选择
系统 SHALL 允许用户在可编辑的主线 Thread 选择当前模型支持的 Effort。切换模型时，系统 SHALL 在新模型仍支持原值时保留它，否则 SHALL 使用新模型默认值。

#### Scenario: 在主线修改 Effort
- **WHEN** 主线未生成且用户选择当前模型支持的 Effort
- **THEN** 系统更新 Thread Effort，并用于下一次生成

#### Scenario: 切换后保留共同 Effort
- **WHEN** 用户切换模型且新模型仍支持原 Effort
- **THEN** 系统保留原 Effort

#### Scenario: 切换后原 Effort 无效
- **WHEN** 用户切换模型且新模型不支持原 Effort
- **THEN** 系统改用新模型默认值，或在新模型不支持 Effort 时清除它

#### Scenario: 生成或分支期间锁定
- **WHEN** Thread 正在生成或当前 Thread 不是主线
- **THEN** 系统与模型选择一样禁用 Effort 修改

### Requirement: Effort 持久化与继承
系统 SHALL 在 Thread 中保存已解析 Effort，SHALL 在创建分支时连同模型继承，并 SHALL 兼容缺失或无效 Effort 的历史整树 JSON。

#### Scenario: 刷新后恢复
- **WHEN** 用户选择 Effort、等待树保存后刷新
- **THEN** 系统恢复该 Thread 的模型与 Effort

#### Scenario: 新分支继承
- **WHEN** 用户从已选 Effort 的 Thread 创建分支
- **THEN** 新分支继承父 Thread 的 modelId 与 Effort

#### Scenario: 加载没有 Effort 的旧树
- **WHEN** 历史 Thread 没有 Effort 字段
- **THEN** 系统按其有效模型填充默认 Effort，且加载不失败

#### Scenario: 加载错配 Effort
- **WHEN** 历史 Effort 不在当前有效模型的允许列表
- **THEN** 系统用模型默认值替换，或在模型不支持 Effort 时清除

### Requirement: Effort API 边界
系统 SHALL 随聊天请求发送 Thread Effort，并 MUST 在服务端依据已验证 modelId 重验。缺省值 SHALL 解析为模型默认值，显式非法值 MUST 被拒绝。

#### Scenario: 有效 Effort 映射
- **WHEN** 客户端为 UMAPIS 模型发送受支持 Effort
- **THEN** 服务端映射为经 UMAPIS 协议验证的上游参数，且不通过 system prompt 模拟

#### Scenario: 缺省 Effort
- **WHEN** 请求支持 Effort 的 UMAPIS 模型但未传 Effort
- **THEN** 服务端使用该模型注册默认值

#### Scenario: 显式非法 Effort
- **WHEN** 客户端显式传入不在该模型允许列表的 Effort
- **THEN** 服务端调用上游前返回 400，且不泄露凭据

#### Scenario: 非 UMAPIS 模型
- **WHEN** 客户端请求现有非 UMAPIS 模型
- **THEN** 系统不发送 UMAPIS 专用 Effort 参数，并保持现有行为
