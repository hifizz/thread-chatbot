"use client"

import { useEffect, useRef } from "react"

// Cloudflare Turnstile 人机验证组件（显式渲染）。
// 仅当配置了 NEXT_PUBLIC_TURNSTILE_SITE_KEY 时使用；token 通过 onToken 回传，
// 由表单以 x-captcha-response 头发给 better-auth 的 captcha 插件校验。

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
const SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"

type TurnstileApi = {
  render: (
    el: HTMLElement,
    opts: {
      sitekey: string
      callback: (token: string) => void
      "expired-callback"?: () => void
      "error-callback"?: () => void
      theme?: "auto" | "light" | "dark"
    }
  ) => string
  remove: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
    onTurnstileLoad?: () => void
  }
}

/** 是否启用了 Turnstile（前端据此决定是否渲染 & 是否要求 token）。 */
export const turnstileEnabled = Boolean(SITE_KEY)

function loadScript(): Promise<void> {
  return new Promise((resolve) => {
    if (window.turnstile) return resolve()
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`
    )
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true })
      return
    }
    const s = document.createElement("script")
    s.src = SCRIPT_SRC
    s.async = true
    s.defer = true
    s.addEventListener("load", () => resolve(), { once: true })
    document.head.appendChild(s)
  })
}

export function TurnstileWidget({
  onToken,
}: {
  onToken: (token: string) => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!SITE_KEY) return
    let widgetId: string | undefined
    let cancelled = false

    loadScript().then(() => {
      if (cancelled || !ref.current || !window.turnstile) return
      widgetId = window.turnstile.render(ref.current, {
        sitekey: SITE_KEY,
        theme: "auto",
        callback: (token) => onToken(token),
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      })
    })

    return () => {
      cancelled = true
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!SITE_KEY) return null
  return <div ref={ref} className="flex justify-center" />
}
