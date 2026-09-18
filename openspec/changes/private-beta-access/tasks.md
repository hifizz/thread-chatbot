## 1. 数据与权限

- [ ] 1.1 复用 Auth/Admin/Resend，定义 waitlist/invite/entitlement/email/audit schema 与唯一约束。
- [ ] 1.2 列出历史赠额/Owner 迁移名单；对接 #164 的开户与 grantWelcomeOnce，不重复赠送。
- [ ] 1.3 在邮箱/OAuth/老用户/API 和全部对象入口接入服务端 guard。

## 2. 邮件与邀请

- [ ] 2.1 实现申请去重、防枚举/限流、批准/拒绝/撤回。
- [ ] 2.2 实现高熵 token/hash、加密邮件 outbox、轮换、POST 核销事务及 GET 扫描保护。
- [ ] 2.3 配置双语邮件、验证域名、有限重试、回调验签/去重/乱序及退信投诉抑制。

## 3. UI 与运营

- [ ] 3.1 接入 Waiting List 首页、邀请状态、等待资格页和 Admin 审核详情。
- [ ] 3.2 发布已核验的 Beta 模型 allowlist 与 Pro 权益/预算策略，个人连接保持 Owner-only。
- [ ] 3.3 接入业务审计和受 consent 控制的漏斗事件。

## 4. 验收与上线

- [ ] 4.1 测试重复/并发核销、过期/撤销、邮箱不匹配、GET 扫描、webhook 乱序和旧用户。
- [ ] 4.2 执行两账号越权、OAuth/API 绕过、Pro 过期/欠额测试。
- [ ] 4.3 真实邮箱演练申请至首次成功聊天，中英文各一次；审批批次可暂停。
- [ ] 4.4 develop 生成验证迁移；运行相关测试/typecheck 和 pnpm exec openspec validate private-beta-access --strict。

本 PR 不发送真实邀请，不执行上述实现任务。
