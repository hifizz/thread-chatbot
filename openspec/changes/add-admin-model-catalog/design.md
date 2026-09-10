## Context
现有 Base UI 组件已经齐备；sidebar-08 使用 SidebarProvider、SidebarInset、独立导航与用户菜单。复用这些组件，不更换项目基础样式。模型目录目前是 constants/models/token-router.ts；公开 ID 与上游 ID 已分离。

## Decisions
- /admin/layout.tsx 仅负责权限和公共壳；导航集中定义，页面业务在 components/admin/models 与 lib/model-catalog。
- model_catalog 按稳定公开 ID 主键存储 enabled、sortOrder、version、配置 JSONB。配置使用严格 Zod schema，拒绝任意脚本、URL 和未支持的协议。
- singleton model_catalog_settings 保存默认模型 ID；admin_members 保存经明确授权的用户 ID。管理员不能通过注册字段自授角色。
- model_catalog_audit 与修改在同一事务提交；版本比较防止覆盖他人修改，默认模型不能停用。
- 数据库目录为运行时唯一来源，不在数据库错误时静默回退静态目录。源码目录仅用于一次性幂等初始化和离线演示。
- 服务端生成开始时读取快照，附件处理和最终请求共享该对象。浏览器通过公开 DTO 获取能力和默认值，不能获取路由、密钥、审计信息。
- 用户未设置参数时使用模型默认值；显式设置必须属于该模型允许范围。不支持 effort 的模型不发送 effort。
- 已存在请求适配作为有限枚举选择；新的协议或超出现有实现的参数语义仍需要发版。
- 第一版不添加用户分析和错误日志空页面，不构造通用 CRUD 引擎。

## Migration / Rollout
功能分支只改 schema；在独立本地数据库 db:push 验证。在 develop 集成时统一 db:generate，审阅 SQL 并在上一版本库 db:migrate 验证。运行 model-catalog:seed，之后 admin:grant --email 指定已有用户。重复 seed 不覆盖后台编辑。迁移未验证前 PR 为 draft。

## Verification
严格配置校验、数据库 CRUD/审计/冲突/默认保护、管理员与普通用户门禁、真实 SDK 请求序列化、后台浏览器增改启停与截图、聊天菜单更新及参数生效。模型网络验收与本地模拟上游分别报告。
