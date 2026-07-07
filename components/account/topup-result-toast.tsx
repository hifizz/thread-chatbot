"use client"

import { useEffect, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"

// 支付跳转回来后（/account?topup=success）提示一次，并清理 URL 参数。
// 额度由 webhook 异步到账，稍等刷新即可看到。
export function TopupResultToast() {
  const router = useRouter()
  const params = useSearchParams()
  const shown = useRef(false)

  useEffect(() => {
    if (shown.current) return
    if (params.get("topup") === "success") {
      shown.current = true
      toast.success("支付成功，额度将在到账后自动更新，可稍后刷新页面")
      router.replace("/account")
    }
  }, [params, router])

  return null
}
