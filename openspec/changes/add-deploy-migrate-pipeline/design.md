# 设计：部署即迁移 + 数据库连接串策略

## Context

- 应用运行时连接在 `lib/db/index.ts`：`postgres(process.env.DATABASE_URL!, { max: DB_POOL_MAX||10, prepare: DB_PREPARE==='true', connection: { search_path: 'thread_chat,extensions,public' } })`，全局单例避免 HMR 耗尽连接。**只读 `DATABASE_URL`**。
- 迁移工具配置在 `drizzle.config.ts`：`const base = process.env.DIRECT_URL || process.env.DATABASE_URL!`，再经 `withSearchPath()` 往 URL 注入 `?options=-c search_path=thread_chat,public,extensions`（让 `vector` 类型可解析、本项目 schema 置前）。
- 所有表都在自定义 schema `thread_chat`（`lib/db/pg-schema.ts` 的 `pgSchema("thread_chat")`），与机器上其它项目隔离。
- 迁移基线 `drizzle/0000_*.sql` 由 `drizzle-kit generate` 生成后**手工前置**了 `CREATE SCHEMA IF NOT EXISTS "thread_chat";` 与 `CREATE EXTENSION IF NOT EXISTS vector;`——drizzle-kit 不会自动 emit 这两句。
- 目标部署形态：Vercel（构建 + Serverless 运行时）+ Supabase Postgres。Supabase 暴露两个连接串：事务连接池（6543，PgBouncer/Supavisor，事务级复用、**不支持预处理语句**）与直连（5432，独占后端进程、支持 DDL/长事务）。

## Goals / Non-Goals

**Goals:**

- 部署时自动、可复现地应用迁移，保证表结构先于流量就位；迁移失败即中断部署。
- 明确「应用用哪条连接串、迁移用哪条」及其理由，并给出「单库小项目只配一个」的降级路径。
- 修复 `drizzle-kit push`/`pull` 对自定义 schema 失明的配置坑。
- 本地 `pnpm build` 与线上部署行为解耦（本地构建不触库）。

**Non-Goals:**

- 迁移生成流程（generate）改造、迁移回滚策略、零停机迁移编排。
- 多环境（preview / production）的连接串与密钥编排（交给 Vercel 环境变量分层，本文只列前置要求）。
- 连接池容量与超时调优（已有 `DB_POOL_MAX` / `DB_PREPARE` 旋钮）。

## Decisions

### D1：新增 `vercel-build`，而非改动 `build`

**选择**：`package.json` 加 `"vercel-build": "node scripts/vercel-migrate.mjs && next build"`；`build` 保持 `next build` 不变。

**理由**：Vercel 构建时若存在 `vercel-build` 脚本会**自动优先执行它**（否则才用 `build`）。据此把「先迁移 → 再构建」的部署语义收敛到一个专用脚本里，而**本地 `pnpm build` 保持纯构建、不连数据库**——本地开发者不会因为跑构建而误改库，两条路径互不干扰。`&&` 短路保证迁移守卫失败即中断、不产出可能与旧表结构不匹配的构建物。

**迁移守卫（`scripts/vercel-migrate.mjs`）**：迁移步不直接调 `db:migrate`，而是过一层守卫——配了连接串（`DIRECT_URL`/`DATABASE_URL`）才跑 `pnpm db:migrate`（迁移失败以非零码退出、中断部署）；未配连接串则打印跳过并 `exit 0`。动机：Vercel 的预览部署或尚未配置密钥的项目读不到连接串，直接 `db:migrate` 会因无法解析/连接而失败、连带整个部署失败。守卫让「未配库的构建照样通过」，同时保留「配了库就必须迁移成功才部署」。

**弃选**：把 `build` 直接改成 `drizzle-kit migrate && next build`——会让本地 `pnpm build` 也强连数据库，破坏本地构建的纯粹性；且 CI/其它消费 `build` 的场景被动触库。

### D2：迁移在 build 阶段跑，而非 runtime/start

**选择**：迁移挂在 `vercel-build`（构建期），不挂 `start`。

**理由**：Vercel 的产物交给它的 Serverless 运行时托管，**不会执行 `next start`**；能保证「上线前只跑一次迁移」的可靠钩子就是构建命令。构建期迁移天然单次、单连接、无并发压力，恰好适合 DDL。（自托管若真用 `next start` 起长驻进程，可另配 `"start": "drizzle-kit migrate && next start"`，本次不涉及。）

**代价/约束**：Vercel **构建期**环境必须能连到数据库（读得到 `DATABASE_URL`/`DIRECT_URL`）。这是构建期迁移的固有前提，已在 proposal/Impact 与 `.env.example` 标注。

### D3：应用走连接池、迁移走直连；`DIRECT_URL` 可选且回退

**选择**：应用运行时 `DATABASE_URL` = Supabase 事务池（6543，配 `DB_PREPARE` 不为 true 即 `prepare:false`）；迁移 `DIRECT_URL` = Supabase 直连（5432）。`drizzle.config.ts` 取 `DIRECT_URL || DATABASE_URL`——**未配 `DIRECT_URL` 则迁移回退 `DATABASE_URL`**。

**理由**：Serverless 会瞬时开出大量连接，直连很快打满 Postgres 后端；事务池用 PgBouncer 做事务级复用扛住高并发，但**复用会串会话状态**，故不支持预处理语句（`prepare:false`）。迁移是 DDL/多语句/需稳定会话状态的低频操作，事务池不适合，必须走直连。二者指向**同一个 Supabase 库**、只是连接方式不同。对「就一个本地 Postgres、无池化」的小项目，`DIRECT_URL || DATABASE_URL` 的回退让**只配一个 `DATABASE_URL` 即可**，迁移与应用共用它。

**弃选**：强制两条都填——对单库场景是无谓负担；只用一条——生产 Serverless + Supabase 下要么应用打满连接、要么迁移在事务池里跑 DDL 出错。

**陷阱备忘**：`DIRECT_URL` 与 `DATABASE_URL` 若被误指向**不同的库**，会出现「迁移建到 A、应用读 B」的分裂（本次排查中真实出现过的一类症状）。二者必须是同一个库的两种连法。

### D4：显式 `schemaFilter: [DB_SCHEMA]`，修复 drizzle-kit 对自定义 schema 失明

**选择**：`drizzle.config.ts` 增加 `schemaFilter: [DB_SCHEMA]`（`"thread_chat"`）。

**理由**：`drizzle-kit` 的 `schemaFilter` **默认是 `["public"]`**。本项目所有表都在 `thread_chat`，不显式指定时 `db:push`/`db:pull` 会把这些表当作「不归我管」全部忽略——表现为**对着空库也报「No changes detected」**（排查 Google 登录 500 时正是此坑：库是空的，push 却说无变更）。显式指向本项目 schema 后，push/pull 才正确纳管。

**弃选**：继续只靠 `db:migrate` 而不修 `schemaFilter`——`migrate` 确实不受此影响（直接跑 SQL），但把 `push`/`pull` 留成哑弹，后人本地迭代必再踩。

### D5：`db:migrate`（或直接执行 SQL）为建表/上线权威路径，`db:push` 仅本地便捷

**选择**：上线与「把库建对」一律走 `db:migrate`（跑 `drizzle/*.sql`）；`db:push` 只作本地快速迭代，且已由 D4 修正可用。

**理由**：迁移文件自带 `CREATE SCHEMA` + `CREATE EXTENSION vector`、可复现、与部署脚本（D1）一致；`push` 走 diff 语义、历史上因 `schemaFilter` 默认值误判过，不适合作权威建表路径。空库/半残库最稳的收敛是「跑迁移 SQL」（本地数据可弃时甚至可先 `DROP SCHEMA thread_chat CASCADE` 再迁移）。

## Risks / Trade-offs

- **构建期需连库**（D2）：Vercel 构建环境要能访问 Supabase；若网络策略限制，需放通或改为 runtime 迁移钩子（本次不做）。缓解：`.env.example`/proposal 明确前置要求。
- **本地 `vector` 扩展缺失**：迁移第 3 行 `CREATE EXTENSION vector` 在未装 pgvector 的本地 Postgres 会失败、连带后续建表中止。缓解：文档提示 `brew install pgvector`，或本地跳过向量表（RAG 未启用时）。
- **两串指向不同库**（D3 陷阱）：属配置错误而非设计缺陷，已在 design 备忘 + 排查经验沉淀。
- **迁移失败即断部署**（D1 的 `&&`）：这是**期望行为**（宁可不上线也不上错结构），但要求迁移本身幂等/可重入（drizzle 迁移日志已保证已应用的不重跑）。

## Migration / Rollout

1. Vercel 项目设 `DATABASE_URL`（事务池 6543）、`DIRECT_URL`（直连 5432）、`BETTER_AUTH_URL`（站点根，供 auth 回调）。
2. 部署触发 `vercel-build` → 守卫脚本：配了连接串则 `pnpm db:migrate`（走 `DIRECT_URL`）应用迁移，未配则跳过 → `next build`。
3. 本地：只配 `DATABASE_URL` 即可，`pnpm db:migrate` 建表；`pnpm build` 不触库。
4. 新增/改连接串后需重新部署以让构建期迁移在新环境生效。
