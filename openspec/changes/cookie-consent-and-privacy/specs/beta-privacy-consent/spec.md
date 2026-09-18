## ADDED Requirements

### Requirement: Require explicit choice for optional analytics

系统 SHALL 对所有 Beta 语言界面默认关闭可选分析，并提供同级接受、拒绝和设置入口；语言 MUST NOT 作为用户适用地区的判据。

#### Scenario: First visit
- **WHEN** 用户尚未做出选择
- **THEN** 必要功能可用且没有可选分析请求

#### Scenario: Reject optional analytics
- **WHEN** 用户拒绝可选分析
- **THEN** 聊天、语言、账务和反馈继续正常工作

### Requirement: Honor consent at both client and server

系统 SHALL 在客户端和服务端发送可选事件前检查当前有效同意，不记录或补传拒绝期间的分析行为。

#### Scenario: Consent granted after earlier actions
- **WHEN** 用户拒绝期间进行了操作，之后才同意
- **THEN** 之前的可选行为不被补发

#### Scenario: A different device accepted
- **WHEN** 当前设备拒绝而同一账户另一个设备同意
- **THEN** 当前设备及其关联服务器事件仍按拒绝处理

### Requirement: Withdraw and isolate identities

系统 SHALL 支持撤回、过期重新选择及退出登录后的分析身份重置。

#### Scenario: Withdrawal with queued events
- **WHEN** 用户撤回时存在尚未发出的可选事件
- **THEN** 事件被丢弃、后续发送停止且可选标识被清理

#### Scenario: Switch accounts
- **WHEN** 同一浏览器从账户 A 切换到账户 B
- **THEN** 不将 B 的事件关联到 A，也不复制 A 的账户授权

### Requirement: Limit data by declared purpose

系统 SHALL 分别定义服务、账务、安全、分析和评测用途及访问/保留策略，普通分析事件不得包含正文、完整查询或密钥。

#### Scenario: Diagnostic content reused for evaluation
- **WHEN** 操作员准备将生产正文加入评测集
- **THEN** 必须满足独立的样本授权和敏感级别要求，不能仅依据 analytics 同意

### Requirement: Fulfill verified data requests

系统 SHALL 提供可追踪的导出与删除请求，覆盖共享链接、数据库、附件及第三方副本，并如实说明保留例外。

#### Scenario: Third-party deletion remains pending
- **WHEN** 本地已删除而第三方副本仍未完成处理
- **THEN** 请求保持处理中或明确部分完成，不能宣称全部删除完成

#### Scenario: Unverified requester
- **WHEN** 请求者无法证明对账户的控制权
- **THEN** 不导出或删除该账户数据
