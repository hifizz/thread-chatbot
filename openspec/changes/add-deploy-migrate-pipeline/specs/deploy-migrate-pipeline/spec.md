# deploy-migrate-pipeline 部署迁移与连接串策略

## ADDED Requirements

### Requirement: 部署时先迁移后构建

系统 SHALL 提供 `vercel-build` 脚本，在构建产物生成前经守卫脚本应用数据库迁移：`node scripts/vercel-migrate.mjs && next build`。Vercel 部署 SHALL 自动优先执行该脚本。守卫 SHALL 在配置了连接串（`DIRECT_URL`/`DATABASE_URL`）时运行迁移，迁移失败 SHALL 以 `&&` 短路中断部署、不产出构建物；未配置连接串时守卫 SHALL 跳过迁移并正常退出，使构建继续。本地 `build` 脚本 SHALL 保持纯构建、不连接数据库。

#### Scenario: 已配库时先迁移后构建

- **WHEN** Vercel 执行部署，且配置了 `DATABASE_URL`/`DIRECT_URL`
- **THEN** 守卫先运行 `pnpm db:migrate` 应用迁移，成功后再 `next build`

#### Scenario: 未配库时跳过迁移让构建通过

- **WHEN** Vercel 执行部署，但未配置任何数据库连接串（如尚未配置密钥的预览部署）
- **THEN** 守卫跳过迁移并以 0 退出，`next build` 照常执行，部署不因缺少数据库而失败

#### Scenario: 迁移失败中断部署

- **WHEN** 已配置连接串且 `pnpm db:migrate` 返回非零（迁移失败）
- **THEN** `&&` 短路，`next build` 不执行，部署失败，不产出可能与旧结构不匹配的构建物

#### Scenario: 本地构建不触库

- **WHEN** 开发者在本地运行 `pnpm build`
- **THEN** 仅执行 `next build`，不连接数据库、不应用迁移

### Requirement: 应用与迁移的连接串职责划分

系统 SHALL 在运行时使用 `DATABASE_URL`（面向 Supabase 事务连接池，`prepare` 关闭）承接应用查询；迁移 SHALL 使用直连连接串，取值为 `DIRECT_URL || DATABASE_URL`。`DIRECT_URL` SHALL 为可选：未配置时迁移回退到 `DATABASE_URL`，以支持「单库、只配一个连接串」的小项目。两个连接串 SHALL 指向同一个数据库（仅连接方式不同）。

#### Scenario: 生产双连接串

- **WHEN** 部署到 Vercel + Supabase 并同时配置了 `DATABASE_URL`（6543 事务池）与 `DIRECT_URL`（5432 直连）
- **THEN** 应用运行时经事务池查询（`prepare:false`），迁移经直连执行 DDL

#### Scenario: 本地单连接串回退

- **WHEN** 本地只配置了 `DATABASE_URL`、未配置 `DIRECT_URL`
- **THEN** 迁移回退使用 `DATABASE_URL`，应用与迁移共用同一连接串，流程照常

### Requirement: drizzle-kit 纳管自定义 schema

由于本项目所有表位于自定义 schema `thread_chat`，`drizzle.config.ts` SHALL 显式声明 `schemaFilter` 指向该 schema，使 `db:push` / `db:pull` 正确对比与管理其中的表，而非沿用默认只识别 `public` 的行为。

#### Scenario: push 正确识别缺表

- **WHEN** 数据库为空且执行 `db:push`
- **THEN** drizzle-kit 检出 `thread_chat` 下缺失的表并生成创建操作，而非误报「No changes」

#### Scenario: 默认行为的回归防护

- **WHEN** 未显式配置 `schemaFilter`（历史行为）
- **THEN** drizzle-kit 默认只看 `public`、忽略 `thread_chat` 的表——此为本需求要修复的缺陷，配置后不得再现

### Requirement: 迁移为建表的权威路径

系统 SHALL 以 `db:migrate`（执行 `drizzle/*.sql`）作为建表与上线的权威路径。迁移基线 SHALL 在开头包含 `CREATE SCHEMA IF NOT EXISTS "thread_chat"` 与 `CREATE EXTENSION IF NOT EXISTS vector`（drizzle-kit 不自动生成，需手工前置）。`db:push` SHALL 仅用于本地便捷迭代。

#### Scenario: 空库迁移建全量

- **WHEN** 对一个空库执行 `pnpm db:migrate`
- **THEN** 先创建 `thread_chat` schema 与 `vector` 扩展，再创建全部业务表，结果可复现

#### Scenario: 缺少 vector 扩展的本地库

- **WHEN** 本地 Postgres 未安装 pgvector 且执行迁移
- **THEN** `CREATE EXTENSION vector` 失败并中止后续建表；需先安装 pgvector（或在未用 RAG 时跳过向量表）后重试
