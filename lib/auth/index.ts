import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { db } from "@/lib/db"
import { user, session, account, verification } from "@/lib/db/schema"
import { ensureUserCredits } from "@/lib/billing/credits"

// better-auth 服务端实例：邮箱/密码登录 + Postgres(drizzle) 持久化。
// BETTER_AUTH_SECRET / BETTER_AUTH_URL 从环境变量读取。
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // 先不做邮箱验证，注册后即可登录（跑通闭环）。上线可开启 requireEmailVerification。
    requireEmailVerification: false,
  },
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // 新用户注册即赠送初始额度，便于在接入 Creem 支付前就能跑通计费闭环。
          await ensureUserCredits(createdUser.id)
        },
      },
    },
  },
  // nextCookies 必须放在插件数组最后，负责在 Next.js 路由处理器/服务端动作里写入 cookie。
  plugins: [nextCookies()],
})

export type Session = typeof auth.$Infer.Session
