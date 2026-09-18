## ADDED Requirements

### Requirement: Resolve locale before first render

系统 SHALL 在服务端按账户明确偏好、设备语言 cookie、Accept-Language、英文默认值的顺序解析 locale，并使客户端首屏使用同一值。

#### Scenario: Browser prefers Chinese
- **WHEN** 用户没有明确偏好且 Accept-Language 的最高可接受匹配为 zh-TW
- **THEN** 首屏使用 zh-CN 词典且不经历先英文后中文的闪烁

#### Scenario: Excluded language
- **WHEN** Accept-Language 包含 zh;q=0 且无其他中文偏好
- **THEN** 系统不将该中文标签作为可接受匹配

#### Scenario: Manual preference overrides browser
- **WHEN** 用户选择英文并刷新中文浏览器中的页面
- **THEN** 页面保持英文，登录用户的资料保存结果与设备保存结果被准确区分

### Requirement: Deliver complete bilingual interface and notifications

系统 SHALL 对首页、Auth、Beta、费用、隐私、错误、反馈和核心 Admin UI 提供键与模板变量一致的中英文文案，并按 locale 格式化日期与金额。

#### Scenario: Missing translation
- **WHEN** 任一受支持语言缺少另一语言存在的必需 key 或模板变量
- **THEN** 翻译完整性检查失败并阻止发布

#### Scenario: Queued invitation email
- **WHEN** 中文申请的邀请邮件被英文服务器环境的 worker 执行
- **THEN** 邮件仍使用申请记录的中文 locale，并提供纯文本与 HTML 正文

### Requirement: Separate interface language from response language

系统 SHALL 优先遵循用户明确指定的回答语言，不通过 UI locale 改写历史消息或覆盖现有对话语言。

#### Scenario: Chinese question in English interface
- **WHEN** 用户在英文界面要求中文研究报告
- **THEN** 模型上下文不包含与该要求冲突的固定英文或中文输出规则

### Requirement: Keep locale independent of analytics consent

系统 SHALL 允许拒绝可选分析的用户切换语言，并不得因此记录未经同意的分析事件。

#### Scenario: Analytics rejected
- **WHEN** 用户拒绝 analytics 后切换界面语言
- **THEN** 语言切换正常工作且没有可选 analytics 请求

### Requirement: Localize stable public errors

服务端 SHALL 返回稳定错误码和 requestId，客户端按 locale 映射文案，不直接展示供应商原始响应。

#### Scenario: Provider error
- **WHEN** 搜索或模型服务返回带有内部细节的错误
- **THEN** 用户只看到本地化错误提示及支持定位所需的 requestId
