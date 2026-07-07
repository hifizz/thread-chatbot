"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"

export type TopupPackView = {
  id: string
  name: string
  priceLabel: string
  creditLabel: string
  bonusLabel?: string
  available: boolean
}

// 充值包购买：点击 → 创建 Creem checkout → 跳转支付页。
export function TopupPacks({
  packs,
  creemConfigured,
}: {
  packs: TopupPackView[]
  creemConfigured: boolean
}) {
  const [loadingId, setLoadingId] = useState<string | null>(null)

  async function buy(packId: string) {
    setLoadingId(packId)
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        toast.error(data.error || "发起支付失败")
        return
      }
      // 跳转到 Creem 托管支付页
      window.location.href = data.url
    } catch {
      toast.error("网络错误，请稍后重试")
    } finally {
      setLoadingId(null)
    }
  }

  if (!creemConfigured) {
    return (
      <p className="text-sm text-muted-foreground">
        支付尚未配置（缺少 <code className="text-xs">CREEM_API_KEY</code>
        ）。配置后即可在此充值。
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {packs.map((pack) => (
        <div
          key={pack.id}
          className="flex flex-col gap-2 rounded-xl border border-border/60 p-4"
        >
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">{pack.name}</span>
            {pack.bonusLabel && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
                {pack.bonusLabel}
              </span>
            )}
          </div>
          <div className="text-2xl font-semibold">{pack.priceLabel}</div>
          <div className="text-xs text-muted-foreground">
            到账 {pack.creditLabel}
          </div>
          <Button
            size="sm"
            className="mt-1 w-full"
            disabled={!pack.available || loadingId === pack.id}
            onClick={() => buy(pack.id)}
          >
            {loadingId === pack.id
              ? "跳转中…"
              : pack.available
                ? "充值"
                : "未配置"}
          </Button>
        </div>
      ))}
    </div>
  )
}
