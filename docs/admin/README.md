# 管理后台骨架

从 PR #118 提取的最小后台：`/admin` 外壳、一个静态样板页和管理员门禁。模型配置仍使用原实现。

`admin_members` 中存在用户记录即表示其拥有 admin 角色。注册不会创建该记录，也没有公开提权接口。

## 初始化

功能分支仅提供 schema，正式 migration 留待 develop 集成生成并验证。应用迁移后，先注册普通账号，再运行：

```bash
pnpm admin:grant --email admin@example.com
```

脚本读取 `.env.local`，仅授权已存在账号，重复执行安全。撤权由维护者删除对应的 `admin_members` 记录；下一次服务端访问即拒绝。

## 添加页面

在 `app/admin/<feature>/page.tsx` 添加页面，并在 `constants/admin.ts` 添加导航项。页头和侧边栏由公共 layout 提供。数据页面在读取前调用 `requireAdminPage()`；未来接口独立调用 `requireAdmin()` 并将 `AdminAccessError.status` 映射为 401/403，不能只依赖父布局。

后台样板页使用静态占位，不提供模型管理、用户统计或日志业务。sidebar-08 来源和许可证在 `components/admin/NOTICE.md`。

## 验证

```bash
pnpm typecheck
OPENSPEC_TELEMETRY=0 pnpm exec openspec validate add-admin-shell --strict
ADMIN_SHELL_TEST_WRITES=1 ADMIN_TEST_CHROMIUM=/path/to/chromium node --env-file=.env.local --import tsx e2e/admin/admin-shell-browser.mjs
```

浏览器脚本只允许本地隔离数据库和本地应用，创建专用测试账号并在结束时删除。正式 PostgreSQL 迁移与生产部署另行验证。

本次已通过 TypeScript、受影响文件 ESLint、OpenSpec 严格校验，以及 Chromium + 独立 PGlite 的完整权限与手机导航验收。PGlite 验收设置 `DB_POOL_MAX=1`，不代表正式 PostgreSQL 迁移已验证。
