import { betterAuth, type BetterAuthPlugin } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { nextCookies } from "better-auth/next-js"
import { captcha } from "better-auth/plugins"
import { db } from "@/lib/db"
import { user, session, account, verification } from "@/lib/db/schema"
import { ensureUserCredits } from "@/lib/billing/credits"
import { isEmailConfigured, sendEmail } from "@/lib/email/client"
import { verificationEmail, resetPasswordEmail } from "@/lib/email/templates"

// 邮箱验证是否可用：需已配置邮件服务。未配置时（如本地开发）优雅降级为「注册即用」，
// 避免用户因收不到验证邮件而被锁死。
const emailReady = isEmailConfigured()

// 人机验证（Cloudflare Turnstile）：配了 secret 才启用，默认拦截 /sign-up/email 与 /sign-in/email。
const TURNSTILE_SECRET = process.env.TURNSTILE_SECRET_KEY

const plugins: BetterAuthPlugin[] = []
if (TURNSTILE_SECRET) {
  plugins.push(
    captcha({ provider: "cloudflare-turnstile", secretKey: TURNSTILE_SECRET })
  )
}
// nextCookies 必须放最后（负责在路由处理器/服务端动作里写 cookie）。
plugins.push(nextCookies())

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: { user, session, account, verification },
  }),
  emailAndPassword: {
    enabled: true,
    // 配了邮件服务才强制邮箱验证；否则注册后直接可用（开发友好）。
    requireEmailVerification: emailReady,
    // 找回密码：发送重置链接邮件。
    sendResetPassword: async ({ user: u, url }) => {
      const { subject, html } = resetPasswordEmail(url)
      await sendEmail({ to: u.email, subject, html })
    },
  },
  emailVerification: {
    // 注册后自动发验证邮件（仅在邮件服务就绪时）。
    sendOnSignUp: emailReady,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user: u, url }) => {
      const { subject, html } = verificationEmail(url)
      await sendEmail({ to: u.email, subject, html })
    },
    // 关键防薅：初始额度改到「邮箱验证通过后」才发放，抬高白嫖门槛。
    afterEmailVerification: async (verifiedUser) => {
      await ensureUserCredits(verifiedUser.id)
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (createdUser) => {
          // 未启用邮箱验证时，退回「注册即赠额」；启用后由 afterEmailVerification 发放。
          if (!emailReady) await ensureUserCredits(createdUser.id)
        },
      },
    },
  },
  plugins,
})

export type Session = typeof auth.$Infer.Session
