## ADDED Requirements

### Requirement: UMAPIS 默认调用不配置 Effort
系统 SHALL 将 UMAPIS 预览模型作为上游默认调用接入；Prompt 输入不得展示 Effort 控件，服务端 MUST NOT 发送 `reasoning_effort` 或未经验证的 UMAPIS 专用 Effort 参数。

#### Scenario: 选择 UMAPIS 模型
- **WHEN** 用户在 Thread Chat Prompt 输入关联的模型选择器选择任一 UMAPIS 模型
- **THEN** 系统只按该模型的默认上游行为发起请求，不显示或持久化 Effort

#### Scenario: 处理既有模型
- **WHEN** 客户端请求现有非 UMAPIS 模型
- **THEN** 系统保持现有参数和路由行为
