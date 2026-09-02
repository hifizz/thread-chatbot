export {}

const email = process.env.CONVERSATION_HTTP_TEST_EMAIL?.trim()
const password = process.env.CONVERSATION_HTTP_TEST_PASSWORD
const baseURL = process.env.BETTER_AUTH_URL

if (!email || !password) {
  throw new Error(
    "缺少 CONVERSATION_HTTP_TEST_EMAIL 或 CONVERSATION_HTTP_TEST_PASSWORD"
  )
}
if (!baseURL) throw new Error("缺少 BETTER_AUTH_URL")

// 本地种子账号不发送邮件，也不经过 Turnstile。
process.env.RESEND_API_KEY = ""
process.env.TURNSTILE_SECRET_KEY = ""

const base = new URL(baseURL)
const headers = new Headers({ host: base.host, origin: base.origin })
const { auth } = await import("@/lib/auth")

await auth.api.signUpEmail({
  body: { email, password, name: "Worktree Test User" },
  headers,
})

console.log(`Created local test user: ${email}`)

// Better Auth 的数据库客户端会保持连接，账号写入完成后直接结束命令。
process.exit(0)
