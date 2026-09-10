# 管理后台骨架

从 PR #118 提取的最小后台：`/admin` 外壳、一个静态样板页和管理员门禁。模型配置仍使用原实现。

`admin_members` 中存在用户记录即表示其拥有 admin 角色。注册不会创建该记录，也没有公开提权接口。

## 初始化

正式迁移 `drizzle/0008_admin_members.sql` 已在 develop 生成，只有新增管理员表和外键，无既有数据变更。先应用迁移，再部署后台；应用迁移后，先注册普通账号，再运行：

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

## 迁移集成验收

2026-09-10：在隔离 PGlite 中执行已有 0000–0007 迁移，插入旧用户，再通过 Drizzle migrator 升级到 0008。验证旧用户内容不变、成员表初始为空、外键有效、重复迁移及授权安全、删除用户会清除成员记录。类型检查通过。未连接生产库，未验证托管 PostgreSQL 的连接权限或实际部署。

复验脚本：`node e2e/admin/admin-migration.test.mjs`。需要测试环境提供 `@electric-sql/pglite` 和 `@electric-sql/pglite-pgvector`（前者也需能被 Drizzle 解析）；它们不是产品依赖。脚本仅使用内存数据库，不读取生产连接配置。

上线时确认构建命令为 `pnpm vercel-build`，数据库连接正确且预览库与生产库隔离。该命令先迁移再构建；迁移失败会中断部署。上线前确认备份，不对生产执行 `db:push`。
