import { Resend, type WebhookEventPayload } from "resend"

// Resend 邮件服务封装。未配置 RESEND_API_KEY 时 isEmailConfigured() 为 false，
// 上层据此优雅降级（如开发环境不强制邮箱验证）。

const API_KEY = process.env.RESEND_API_KEY
// 发件人：需在 Resend 后台验证过的域名，如 "Thread Chat <noreply@yourdomain.com>"
const FROM = process.env.EMAIL_FROM ?? "Thread Chat <onboarding@resend.dev>"

let client: Resend | null = null
function getClient(): Resend | null {
  if (!API_KEY) return null
  client ??= new Resend(API_KEY)
  return client
}

export function isEmailConfigured(): boolean {
  return Boolean(API_KEY)
}

export type SendEmailInput = {
  to: string
  subject: string
  html: string
  idempotencyKey?: string
}

/** 发送邮件。未配置时抛错（调用方应先判断 isEmailConfigured 或允许失败）。 */
export async function sendEmail(input: SendEmailInput): Promise<string> {
  const resend = getClient()
  if (!resend) throw new Error("邮件服务未配置（缺少 RESEND_API_KEY）")
  const { data, error } = await resend.emails.send(
    {
      from: FROM,
      to: input.to,
      subject: input.subject,
      html: input.html,
    },
    input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : undefined
  )
  if (error) throw new Error(`发送邮件失败：${error.message}`)
  if (!data?.id) throw new Error("发送邮件失败：服务商未返回消息 ID")
  return data.id
}

export function verifyEmailWebhook(
  payload: string,
  headers: Headers
): WebhookEventPayload {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()
  if (!secret) throw new Error("RESEND_WEBHOOK_SECRET_NOT_CONFIGURED")
  const id = headers.get("svix-id")
  const timestamp = headers.get("svix-timestamp")
  const signature = headers.get("svix-signature")
  if (!id || !timestamp || !signature)
    throw new Error("RESEND_WEBHOOK_HEADERS_INVALID")
  return new Resend(API_KEY).webhooks.verify({
    payload,
    headers: { id, timestamp, signature },
    webhookSecret: secret,
  })
}
