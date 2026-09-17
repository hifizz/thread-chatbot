## Why

对外内测需要可运营的准入，而不是只在首页显示 waiting list。必须打通申请、审核、邮件、验证注册、唯一赠额，并保证 OAuth、直接 API 和旧账号都遵守同一服务端权限。

## What Changes

- 首页申请邮箱，Admin 批准/拒绝/重发/撤销；邀请链接绑定邮箱，一次核销，无公开手填邀请码。
- 复用现有 Auth、Resend、Admin role；新增 Beta/Pro 权益与账号状态，不引入复杂 RBAC。
- 邀请核销、权益激活和 billing 欢迎额度在同一事务中执行。
- 邮件与审核独立记录状态；可靠重试、退信/投诉抑制、管理员操作审计。
- 所有聊天/模型/API 按用户与对象授权；未隔离的个人连接/沙箱保持 Owner-only。

## Capabilities

### New Capabilities

- `private-beta-access`: 申请、邀请、激活、模型权益、邮件及运营审计。

### Modified Capabilities

无。复用已存在的 Auth 和赠额实现，新的领域契约在本 change 描述。

## Impact

计划增加 lib/beta、现有邮件扩展、用户权益 schema、首页/Auth/Admin 组件与服务端 guards。本 PR 只有文档。

## Dependencies

直接 Git 父分支 spec/beta-02-billing-quota（#164），消费事务内 grantWelcomeOnce。双语依赖 #163；开放前隐私策略依赖 #165。模块依赖保持单向：准入调用 billing 赠额，服务端编排先授权再调用 billing.reserve，billing 不反向依赖准入。

## Non-goals

不做公开邀请码分发、推荐奖励、复杂角色系统、在线充值/订阅支付或自动开通付费套餐。Pro 第一版由管理员授权并配置预算，仍完整计费。
