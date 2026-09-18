# Beta 隐私实现边界

## 当前数据分类

| 用途 | 当前数据 | 是否受 Analytics 同意控制 |
| --- | --- | --- |
| 必要服务 | 登录会话、语言偏好、Project / Thread / Artifact、Generation 状态 | 否 |
| 账务 | 余额、预占、用量、支付与调整流水 | 否 |
| 安全与排障 | Axiom 服务日志、受控错误上下文 | 否，但必须遵守独立的脱敏、访问和保留策略 |
| AI 观测 | Langfuse 模型与工具调用 | 否，但生产正文策略必须在开放前单独批准 |
| 产品分析 | 经白名单校验的产品事件 | 是；未选择、拒绝、过期或保存失败时关闭 |
| 评测 | 固定 Case 与经独立授权的生产样本 | Analytics 同意不能替代评测样本授权 |

仓库当前没有安装或初始化 PostHog 浏览器 SDK。`PrivacyProvider` 只提供唯一的
`capture` gate，并且不缓存未授权事件。后续接入 PostHog 时必须订阅 gate 发出的
`threadchat:analytics` 事件，关闭 autocapture 和 session replay，不允许绕过 gate
直接调用 SDK。

## 同意状态

- 匿名设备使用服务端签名、HttpOnly、SameSite=Lax 的最小 Cookie。
- 登录账户按 `userId + deviceIdHash` 保存；其他设备的同意不会覆盖当前设备。
- 接受只有在服务端保存成功后才生效；拒绝或撤回先立即关闭本地 gate，再持久化。
- 政策版本不匹配、Cookie 篡改、过期、数据库不可用或迁移未就绪均保守关闭分析。
- 跨标签页用 BroadcastChannel 同步最新选择，不补传同意前行为。

## 数据请求

`POST /api/privacy/requests` 只登记本人请求，不直接导出或删除。管理员状态机要求先
完成身份复核；删除请求只有确认第三方副本处理完成后才能标记 completed。实际导出包、
分享撤销、对象存储清理、备份窗口和处理商工单仍需在 Beta 开放验收中演练，因此不能把
“请求已登记”描述为“数据已删除”。

## 尚未批准的发布项

正式开放前仍需批准：处理中/欧盟等数据区域、各类别保留期、支持联系方式、处理商清单、
生产 Axiom/Langfuse 正文策略，以及中英文隐私政策和条款。代码不猜测法律期限。

