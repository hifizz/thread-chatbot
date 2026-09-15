// 部署构建期的迁移守卫。
//
// 语义：
// · 配置了数据库连接串（DIRECT_URL 或 DATABASE_URL）→ 使用官方 migrator 执行迁移；
//   迁移失败则以非零码退出，从而中断部署（保持「迁移不过就不部署」）。
// · 未配置连接串 → 跳过迁移并正常退出，让「尚未配置数据库的 Vercel 预览构建」也能通过，
//   而不是在 `db:migrate` 连不上库时直接失败。
//
// 之所以需要它：`vercel-build` 会在 build 前跑迁移，但预览环境/尚未配置密钥的项目
// 读不到连接串，drizzle-kit 会因无法解析/连接而失败，连带整个部署失败。

const url = process.env.DIRECT_URL || process.env.DATABASE_URL

if (!url) {
  console.log(
    "[vercel-build] 未配置 DATABASE_URL/DIRECT_URL，跳过数据库迁移（构建继续）。"
  )
  process.exit(0)
}

console.log("[vercel-build] 检测到数据库连接串，执行迁移…")
// drizzle-kit 的进度组件在迁移失败时直接 process.exit(1)，会吞掉 SQL 异常。
// 使用同一个配置和官方 migrator，确保 CI 能看到失败原因。
let client
try {
  const { register } = await import("tsx/esm/api")
  register()
  const { default: config } = await import("../drizzle.config.ts")
  const { default: postgres } = await import("postgres")
  const { drizzle } = await import("drizzle-orm/postgres-js")
  const { migrate } = await import("drizzle-orm/postgres-js/migrator")
  client = postgres(config.dbCredentials.url, { max: 1 })
  await migrate(drizzle(client), {
    migrationsFolder: config.out,
    migrationsTable: config.migrations?.table,
    migrationsSchema: config.migrations?.schema,
  })
  console.log("[vercel-build] 数据库迁移完成。")
} catch (error) {
  // DrizzleQueryError.cause 才包含 PostgreSQL 的 SQLSTATE 和具体失败原因。
  // 不输出连接配置；异常文本里的连接串也要遮蔽。
  const seen = new Set()
  for (let cause = error; cause && !seen.has(cause); cause = cause.cause) {
    seen.add(cause)
    const message = String(cause.message ?? cause).replace(
      /postgres(?:ql)?:\/\/[^\s"']+/gi,
      "[REDACTED_DATABASE_URL]"
    )
    console.error(`[vercel-build] 迁移失败${cause.code ? ` (${cause.code})` : ""}: ${message}`)
  }
  // 等待输出及连接关闭，不直接 process.exit，以免丢失最后的错误日志。
  process.exitCode = 1
} finally {
  await client?.end({ timeout: 5 })
}
