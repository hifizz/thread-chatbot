## ADDED Requirements

### Requirement: Accept and approve waitlist applications safely

系统 SHALL 提供邮箱申请和管理员审核，重复申请返回统一接受结果，不泄露已有账号状态。

#### Scenario: Repeated application
- **WHEN** 相同归一化邮箱重复申请
- **THEN** 复用记录，不重复创建邀请或发送邮件

### Requirement: Keep approval and email delivery distinct

系统 SHALL 分别保存审核、邀请、邮件投递和注册状态，失败投递可有限重试并人工处理。

#### Scenario: Approval succeeds but email fails
- **WHEN** 审核事务成功但邮件服务失败
- **THEN** 申请保持 approved 且邮件可见 failed/queued 状态，不伪装 delivered 或 registered

#### Scenario: Complaint webhook
- **WHEN** 收到验签通过的投诉事件
- **THEN** 更新抑制状态并停止重复投递，重复 webhook 不产生重复副作用

### Requirement: Redeem invitations once for the verified identity

系统 SHALL 仅通过显式核销请求将邀请授予匹配的已验证邮箱，并在同一事务激活权益和执行一次欢迎赠额。

#### Scenario: Link opened by scanner
- **WHEN** 邮件扫描器 GET 邀请链接
- **THEN** 邀请不被消费

#### Scenario: Concurrent redemption
- **WHEN** 相同 token 被并发核销
- **THEN** 仅一次激活/赠额，其余请求返回已处理结果

#### Scenario: Mismatched email or revoked token
- **WHEN** 已登录邮箱不匹配，或 token 已过期/撤销
- **THEN** 不核销、不激活、不赠额

### Requirement: Enforce access and ownership server side

系统 SHALL 在邮箱/OAuth/旧账号/直接 API 入口执行统一准入和对象所有权检查，而不是只隐藏首页按钮。

#### Scenario: Unapproved OAuth account
- **WHEN** 未批准用户通过 OAuth 登录后直接调用聊天 API
- **THEN** 返回 BETA_ACCESS_REQUIRED 且没有付费请求

#### Scenario: Cross-user object ID
- **WHEN** 用户 A 将请求中的对象 ID 替换为 B 的 Project、Thread、Artifact、附件或 Generation
- **THEN** 请求被拒绝且不泄露 B 的内容

### Requirement: Separate model entitlement from budget

系统 SHALL 将管理员角色、Beta/Pro 权益、账号状态和余额分开，所有用户均受预算和价格约束。

#### Scenario: Pro user has exhausted credit
- **WHEN** Pro 用户尝试启动新任务但无法预占额度
- **THEN** 仍被账务拒绝，不能因 Pro 绕过

#### Scenario: Newly registered model
- **WHEN** 管理员添加了未列入 Beta allowlist 的模型
- **THEN** 不自动开放给 Beta，缺价时任何计划都不可启动

### Requirement: Audit sensitive administration and protect personal connectors

系统 SHALL 审计批准、撤销、暂停、权益和额度变更，并将未隔离的个人连接及沙箱权限保持 Owner-only。

#### Scenario: Admin grants Pro
- **WHEN** 管理员修改用户计划
- **THEN** 保存 actor、target、reason、时间和前后值，普通用户不能执行同一操作
