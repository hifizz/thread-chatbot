import { randomUUID } from "node:crypto"
import { getCurrentUserId } from "@/lib/auth/server"
import { getTopupPack, topupProductId } from "@/constants/creem"
import { createCheckout, isCreemConfigured } from "@/lib/payments/creem"

// 发起充值：创建 Creem checkout 会话，返回支付链接供前端跳转。
export async function POST(req: Request) {
  const userId = await getCurrentUserId()
  if (!userId) return Response.json({ error: "未登录" }, { status: 401 })

  if (!isCreemConfigured()) {
    return Response.json(
      { error: "支付未配置（缺少 CREEM_API_KEY）" },
      { status: 400 }
    )
  }

  const { packId }: { packId?: string } = await req.json().catch(() => ({}))
  const pack = getTopupPack(packId)
  if (!pack) return Response.json({ error: "无效的充值包" }, { status: 400 })

  const productId = topupProductId(pack)
  if (!productId) {
    return Response.json(
      {
        error: `充值包「${pack.name}」未配置 Creem 产品（${pack.productIdEnv}）`,
      },
      { status: 400 }
    )
  }

  const baseUrl = process.env.BETTER_AUTH_URL ?? new URL(req.url).origin
  const requestId = randomUUID()

  try {
    const checkout = await createCheckout({
      productId,
      successUrl: `${baseUrl}/account?topup=success`,
      requestId,
      // 透传到 webhook：据此定位用户与充值包
      metadata: { userId, packId: pack.id },
    })
    return Response.json({ url: checkout.checkout_url })
  } catch (e) {
    const message = e instanceof Error ? e.message : "创建支付会话失败"
    return Response.json({ error: message }, { status: 502 })
  }
}
