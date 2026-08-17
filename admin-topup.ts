/**
 * 一次性管理员充值脚本(自包含,不依赖应用模块)。用完请删除本文件。
 *
 * 表结构:thread_chat.user(id,email 唯一)、thread_chat.user_credits(user_id PK,
 * balance_micros bigint)。金额单位「微元」:1 元 = 1_000_000 微元。
 *
 * 用法(在项目根目录,自己传生产 DATABASE_URL):
 *   # 1) 干跑(只读余额,确认账号存在、换算正确,不写)
 *   DATABASE_URL="postgres://..." pnpm exec tsx admin-topup.ts
 *   # 2) 确认无误后真正写入(非幂等,只跑一次!)
 *   DATABASE_URL="postgres://..." CONFIRM=yes pnpm exec tsx admin-topup.ts
 *
 * 可选环境变量:EMAIL(默认 fizzstark@gmail.com)、AMOUNT_YUAN(默认 20)。
 */
import postgres from "postgres"

const DATABASE_URL = process.env.DATABASE_URL
const EMAIL = process.env.EMAIL ?? "fizzstark@gmail.com"
const AMOUNT_YUAN = Number(process.env.AMOUNT_YUAN ?? "20")
const CONFIRM = process.env.CONFIRM === "yes"
const MICROS_PER_YUAN = 1_000_000

const yuan = (micros: number) => (micros / MICROS_PER_YUAN).toFixed(6)

async function main() {
  if (!DATABASE_URL) throw new Error("缺少 DATABASE_URL")
  if (!Number.isFinite(AMOUNT_YUAN) || AMOUNT_YUAN <= 0)
    throw new Error(`AMOUNT_YUAN 非法: ${process.env.AMOUNT_YUAN}`)

  const micros = Math.round(AMOUNT_YUAN * MICROS_PER_YUAN)
  const sql = postgres(DATABASE_URL, { max: 1 })

  try {
    const users = await sql<{ id: string; email: string }[]>`
      select id, email from thread_chat."user" where email = ${EMAIL}
    `
    if (users.length === 0) throw new Error(`未找到账号: ${EMAIL}`)
    if (users.length > 1) throw new Error(`邮箱命中多行(异常): ${EMAIL}`)
    const target = users[0]

    const [cur] = await sql<{ balance_micros: string }[]>`
      select balance_micros from thread_chat.user_credits where user_id = ${target.id}
    `
    const before = cur ? Number(cur.balance_micros) : 0

    console.log(`账号:     ${target.email} (${target.id})`)
    console.log(
      `当前余额: ${yuan(before)} 元 (${before} 微元)${cur ? "" : "  [无 credits 行,将新建]"}`
    )
    console.log(`拟充值:   ${AMOUNT_YUAN} 元 (${micros} 微元)`)

    if (!CONFIRM) {
      console.log(
        "\n[干跑] 未写入。确认无误后加 CONFIRM=yes 再跑一次(非幂等,只跑一次)。"
      )
      return
    }

    // 原子 upsert:有行则累加,无行则以本次金额新建(不附带注册赠额)。
    const [row] = await sql<{ balance_micros: string }[]>`
      insert into thread_chat.user_credits (user_id, balance_micros, updated_at)
      values (${target.id}, ${micros}, now())
      on conflict (user_id) do update
        set balance_micros = thread_chat.user_credits.balance_micros + ${micros},
            updated_at = now()
      returning balance_micros
    `
    const after = Number(row.balance_micros)
    console.log(`\n[已写入] 新余额: ${yuan(after)} 元 (${after} 微元)`)
    const delta = after - before
    if (delta !== micros)
      console.warn(`⚠ 增量 ${delta} 微元 与预期 ${micros} 不符,请核查!`)
    else console.log(`✓ 增量核对无误: +${AMOUNT_YUAN} 元`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("失败:", e instanceof Error ? e.message : e)
    process.exit(1)
  })
