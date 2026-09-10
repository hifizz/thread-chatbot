## Decisions
- 复用项目现有 Base UI 组件与 UserMenu；保留 PR #118 外壳的 sidebar-08 来源声明。
- `/admin/layout.tsx` 管公共布局，`/admin/page.tsx` 是首个样板页，导航集中于 `constants/admin.ts`。
- `admin_members.user_id` 是关联既有用户的主键；存在记录即具备 admin 角色。注册和客户端不能授予角色。
- `requireAdmin` 每次读取服务端登录与数据库成员记录；页面包装函数处理登录跳转和无权限 404。页面自身也校验，后续数据页面/接口不能只依赖父 layout。
- 授权脚本只处理已注册邮箱且可重复运行。删除成员记录可撤销权限，后续服务端访问立即受限。
- 样板页仅为静态布局占位，没有模型管理、统计数据、业务 API、缓存、审计框架或通用角色权限系统。

## Rollout
先由 develop 集成任务生成、审查并验证正式 migration，再应用迁移和部署。功能分支仅向隔离本地库 push schema，未完成正式迁移前 PR 保持 draft。
