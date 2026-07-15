# 部署即迁移 + 数据库连接串策略（Vercel + Supabase）

## Why

服务要上 Vercel，但表结构（`thread_chat` schema 下 13 张表）必须在新构建产物承接流量前就位，否则首个请求即 500。此前没有「部署时自动迁移」的机制，靠手动 `pnpm db:migrate` 既不可靠也不可复现。

同时目标数据库是 Supabase，其连接模型是「事务连接池（6543）跑应用、直连（5432）跑迁移/DDL」两条链路，而本项目原本只有一个 `DATABASE_URL`。要落地 Vercel + Supabase，得把这两条链路的职责、以及「本地单库开发不必配两条」的降级路径一并定清。

本次还修掉一个隐蔽的迁移工具坑：`drizzle-kit push` 因 `schemaFilter` 默认只认 `public`，对着一个本应装满 `thread_chat` 表的**空库**却报「No changes」，一度让人误以为库是好的（排查 Google 登录 500 时暴露）。

## What Changes

- **新增 `vercel-build` 脚本**：`pnpm db:migrate && next build`。Vercel 会自动优先执行 `vercel-build` 而非 `build`，于是部署链路变成「先应用迁移 → 再构建」，任一步失败即中断部署；本地 `pnpm build` 保持纯构建、不碰数据库。
- **确立双连接串职责**：应用运行时用 `DATABASE_URL`（Supabase 事务池 6543，需 `prepare:false`）；迁移用 `DIRECT_URL`（Supabase 直连 5432）。`drizzle.config.ts` 取 `DIRECT_URL || DATABASE_URL`——**`DIRECT_URL` 可选**，未配置则迁移回退 `DATABASE_URL`，满足「小项目单库、只配一个」的场景。
- **修复 `drizzle-kit` 对自定义 schema 失明**：`drizzle.config.ts` 显式声明 `schemaFilter: [DB_SCHEMA]`（`thread_chat`），使 `db:push` / `db:pull` 正确纳管本项目 schema，而非默认只看 `public`。
- **确立 `db:migrate` 为建表/上线的权威路径**（而非 `db:push`）：迁移文件（`drizzle/0000_*.sql`）开头自带 `CREATE SCHEMA IF NOT EXISTS "thread_chat"` 与 `CREATE EXTENSION IF NOT EXISTS vector`，直接跑 SQL、不受 `schemaFilter` 影响，可复现。
- 范围明确**不含**：迁移文件的自动生成流程改造、多环境（preview/prod）连接串编排、连接池参数调优（`DB_POOL_MAX`/`DB_PREPARE` 等旋钮已存在，本次不动）。

## Capabilities

### New Capabilities

- `deploy-migrate-pipeline`: 部署时的迁移执行契约、应用/迁移双连接串的职责划分与降级、drizzle 工具面向自定义 schema 的配置约束。

### Modified Capabilities

（无——`openspec/specs/` 目前为空，本仓库尚无既有 spec；本变更不修改任何既有能力的需求级行为。）

## Impact

- **脚本**：`package.json` 新增 `vercel-build`；`build` / `start` 不变。
- **配置**：`drizzle.config.ts` 增加 `schemaFilter: [DB_SCHEMA]`；连接串取值逻辑（`DIRECT_URL || DATABASE_URL` + `withSearchPath` 注入 `search_path=thread_chat,public,extensions`）沿用。
- **文档**：`.env.example` 已含 `DATABASE_URL` / `DIRECT_URL` / `BETTER_AUTH_URL` 说明；本 change 把「谁用哪条、为什么」沉淀为 design + spec。
- **部署前置**：Vercel 构建期环境需能读到 `DATABASE_URL`（运行时）与 `DIRECT_URL`（迁移，若用 Supabase 池化则必填）；新增/改动连接串后需重新部署以让构建期迁移生效。
- **不改**：`lib/db/index.ts` 运行时连接（本次已确认其只用 `DATABASE_URL` 的既有行为）、迁移文件内容本身。
