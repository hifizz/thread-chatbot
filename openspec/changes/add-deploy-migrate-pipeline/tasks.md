# 任务拆解：部署即迁移 + 数据库连接串策略（已实现，回填记录）

## 1. 部署脚本

- [x] 1.1 `package.json` 新增 `"vercel-build": "node scripts/vercel-migrate.mjs && next build"`；`build`/`start` 保持不变（Vercel 自动优先执行 vercel-build）
- [x] 1.2 新增迁移守卫 `scripts/vercel-migrate.mjs`：配了 `DIRECT_URL`/`DATABASE_URL` 才跑 `pnpm db:migrate`（失败非零退出中断部署），未配则跳过并 `exit 0`（让未配库的预览部署也能通过）

## 2. 连接串职责与降级

- [x] 2.1 确认 `lib/db/index.ts` 运行时只用 `DATABASE_URL`（事务池，`prepare: DB_PREPARE==='true'`，`search_path=thread_chat,extensions,public`，全局单例）
- [x] 2.2 确认 `drizzle.config.ts` 迁移取 `DIRECT_URL || DATABASE_URL`（直连优先、可回退），`withSearchPath` 注入 `search_path=thread_chat,public,extensions`
- [x] 2.3 `.env.example` 含 `DATABASE_URL`（运行时/事务池）、`DIRECT_URL`（迁移/直连，可选）、`BETTER_AUTH_URL` 说明

## 3. 修复 drizzle-kit 自定义 schema 失明

- [x] 3.1 `drizzle.config.ts` 增加 `schemaFilter: [DB_SCHEMA]`（`thread_chat`），使 db:push/db:pull 纳管本项目 schema
- [x] 3.2 复核迁移基线 `drizzle/0000_*.sql` 开头含 `CREATE SCHEMA IF NOT EXISTS "thread_chat";` 与 `CREATE EXTENSION IF NOT EXISTS vector;`（drizzle-kit 不自动 emit，手工前置）

## 4. 验证

- [x] 4.1 `pnpm typecheck` 0 错误；`pnpm build` 成功（本地纯构建、不触库，路由与 middleware 均编译）
- [x] 4.2 空库场景验证 `db:migrate` 能建出 `thread_chat` + 全部表（`db:push` 因 schemaFilter 默认 public 曾对空库误报「No changes」，已由 3.1 修正）
- [x] 4.3 `prettier --check drizzle.config.ts` 通过

## 5. 文档与收尾

- [x] 5.1 连接串「谁用哪条、为什么」沉淀进本 change 的 design（应用=事务池、迁移=直连、单库可只配一个）
- [x] 5.2 `pnpm openspec:validate` 通过；提交前统一 prettier 本次改动文件
