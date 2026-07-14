import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { payments, subscriptions, userCredits } from "@/lib/db/schema"
import {
  verifyWebhookSignature,
  parseWebhookEvent,
  readMetadata,
  readOrderId,
  readProductId,
  readCheckoutId,
  readSubscription,
} from "@/lib/payments/creem"
import { recordCreemTopup } from "@/lib/billing/credits"
import { getTopupPack } from "@/constants/creem"

// Creem webhook：签名校验 → 分发事件。必须读原始请求体做 HMAC 校验。
export async function POST(req: Request) {
  const rawBody = await req.text()
  const signature = req.headers.get("creem-signature")

  if (!verifyWebhookSignature(rawBody, signature)) {
    return Response.json({ error: "签名校验失败" }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return Response.json({ error: "无效的 JSON" }, { status: 400 })
  }

  const event = parseWebhookEvent(payload)
  if (!event) return Response.json({ ok: true, ignored: "no-event-type" })

  const { eventType, object } = event
  const metadata = readMetadata(object)
  const userId = metadata.userId

  try {
    switch (eventType) {
      case "checkout.completed": {
        // 一次性充值到账
        if (!userId) break
        const pack = getTopupPack(metadata.packId)
        const orderId = readOrderId(object)
        if (!pack || !orderId) break

        await recordCreemTopup({
          userId,
          orderId,
          checkoutId: readCheckoutId(object),
          productId: readProductId(object),
          packId: pack.id,
          creditMicros: pack.creditMicros,
          priceLabel: pack.priceLabel,
          raw: payload,
        })
        break
      }

      case "subscription.active":
      case "subscription.paid":
      case "subscription.trialing":
      case "subscription.update":
      case "subscription.past_due":
      case "subscription.scheduled_cancel":
      case "subscription.paused":
      case "subscription.canceled":
      case "subscription.expired": {
        if (!userId) break
        const sub = readSubscription(object)
        if (!sub.id || !sub.status) break
        const periodEnd = sub.currentPeriodEnd
          ? new Date(sub.currentPeriodEnd)
          : null

        await db
          .insert(subscriptions)
          .values({
            id: randomUUID(),
            userId,
            provider: "creem",
            subscriptionId: sub.id,
            productId: readProductId(object) ?? null,
            status: sub.status,
            currentPeriodEnd: periodEnd,
            raw: payload,
          })
          .onConflictDoUpdate({
            target: subscriptions.subscriptionId,
            set: {
              status: sub.status,
              currentPeriodEnd: periodEnd,
              updatedAt: new Date(),
              raw: payload,
            },
          })
        break
      }

      case "refund.created": {
        // 退款：标记订单已退款并扣回额度，放进同一事务（幂等：仅当前为 paid 时执行一次）
        const orderId = readOrderId(object)
        if (!orderId) break
        await db.transaction(async (tx) => {
          const [row] = await tx
            .update(payments)
            .set({ status: "refunded" })
            .where(
              and(eq(payments.orderId, orderId), eq(payments.status, "paid"))
            )
            .returning({
              userId: payments.userId,
              creditMicros: payments.creditMicros,
            })
          if (row) {
            await tx
              .update(userCredits)
              .set({
                balanceMicros: sql`${userCredits.balanceMicros} - ${row.creditMicros}`,
                updatedAt: new Date(),
              })
              .where(eq(userCredits.userId, row.userId))
          }
        })
        break
      }

      default:
        // 未处理的事件类型：忽略但回 200，避免 Creem 反复重试
        break
    }
  } catch (e) {
    // 处理失败回 500，Creem 会按其重试策略重投（我们的到账逻辑是幂等的）
    const message = e instanceof Error ? e.message : "webhook 处理失败"
    return Response.json({ error: message }, { status: 500 })
  }

  return Response.json({ ok: true })
}
