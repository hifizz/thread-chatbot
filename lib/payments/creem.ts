import { createHmac, timingSafeEqual } from "node:crypto"

// Creem 支付客户端：创建 checkout 会话 + 校验 webhook 签名。
// 文档：https://docs.creem.io/  （checkout: POST {api}/v1/checkouts，头 x-api-key）

const API_URL = process.env.CREEM_API_URL ?? "https://api.creem.io/v1"
const API_KEY = process.env.CREEM_API_KEY
const WEBHOOK_SECRET = process.env.CREEM_WEBHOOK_SECRET

/** 是否已配置 Creem（可发起支付）。 */
export function isCreemConfigured(): boolean {
  return Boolean(API_KEY)
}

export type CreateCheckoutInput = {
  productId: string
  successUrl: string
  /** 幂等/追踪用的请求 id */
  requestId: string
  /** 透传到 webhook 的自定义数据（如 userId、packId） */
  metadata: Record<string, string>
  units?: number
}

export type CreemCheckout = {
  id: string
  checkout_url: string
  status?: string
}

/** 创建 checkout 会话，返回 { id, checkout_url }。失败抛错。 */
export async function createCheckout(
  input: CreateCheckoutInput
): Promise<CreemCheckout> {
  if (!API_KEY) throw new Error("Creem 未配置（缺少 CREEM_API_KEY）")

  const res = await fetch(`${API_URL}/checkouts`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": API_KEY },
    body: JSON.stringify({
      product_id: input.productId,
      units: input.units ?? 1,
      success_url: input.successUrl,
      request_id: input.requestId,
      metadata: input.metadata,
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`创建 Creem checkout 失败（${res.status}）：${text}`)
  }

  const data = (await res.json()) as CreemCheckout
  if (!data.checkout_url) throw new Error("Creem 未返回 checkout_url")
  return data
}

/**
 * 校验 webhook 签名：creem-signature 头 = HMAC-SHA256(原始请求体, webhook secret) 的十六进制。
 * 未配置 secret 时返回 false（拒绝，避免误放行）。
 */
export function verifyWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  if (!WEBHOOK_SECRET || !signature) return false
  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex")
  const a = Buffer.from(expected)
  const b = Buffer.from(signature)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

// ---- webhook 负载解析（object 字段在不同事件里层级略有差异，做防御式读取）----

type AnyRecord = Record<string, unknown>

function asRecord(v: unknown): AnyRecord | undefined {
  return v && typeof v === "object" ? (v as AnyRecord) : undefined
}

export type CreemWebhookEvent = {
  eventType: string
  object: AnyRecord
}

export function parseWebhookEvent(payload: unknown): CreemWebhookEvent | null {
  const root = asRecord(payload)
  if (!root) return null
  const eventType = (root.eventType ?? root.event_type ?? root.type) as
    string | undefined
  const object = asRecord(root.object) ?? root
  if (!eventType) return null
  return { eventType, object }
}

/** 从事件 object 里读取透传的 metadata（不同事件层级不一，逐层兜底）。 */
export function readMetadata(object: AnyRecord): Record<string, string> {
  const direct = asRecord(object.metadata)
  const fromCheckout = asRecord(asRecord(object.checkout)?.metadata)
  const fromOrder = asRecord(asRecord(object.order)?.metadata)
  return (direct ?? fromCheckout ?? fromOrder ?? {}) as Record<string, string>
}

/** 读取订单 id（充值到账的幂等键）。 */
export function readOrderId(object: AnyRecord): string | undefined {
  const order = asRecord(object.order)
  return (order?.id ?? object.order_id ?? object.id) as string | undefined
}

export function readProductId(object: AnyRecord): string | undefined {
  const product = asRecord(object.product)
  return (product?.id ?? object.product_id) as string | undefined
}

export function readCheckoutId(object: AnyRecord): string | undefined {
  const checkout = asRecord(object.checkout)
  return (checkout?.id ?? object.checkout_id) as string | undefined
}

export function readSubscription(object: AnyRecord): {
  id?: string
  status?: string
  currentPeriodEnd?: string
} {
  const sub = asRecord(object.subscription) ?? object
  return {
    id: (sub.id ?? object.subscription_id) as string | undefined,
    status: (sub.status ?? object.status) as string | undefined,
    currentPeriodEnd: (sub.current_period_end_date ??
      sub.current_period_end) as string | undefined,
  }
}
