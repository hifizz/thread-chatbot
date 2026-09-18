"use client"

import { useEffect } from "react"
import { ANALYTICS_CAPTURE_API_PATH } from "@/constants/analytics"
import type { AnalyticsEvent } from "@/lib/privacy/analytics-gate"

const ANALYTICS_EVENT_NAME = "threadchat:analytics"
const ANALYTICS_RESET_EVENT = "threadchat:analytics-reset"

/**
 * 浏览器侧 PostHog 接入：只转发 PrivacyProvider 已放行的 CustomEvent，
 * 不加载第三方 SDK，天然没有 autocapture/session replay。
 * 同意撤回时服务端会拒绝后续事件；本组件不缓存、不补传。
 */
export function AnalyticsBridge() {
  useEffect(() => {
    let disabled = false
    const onCapture = (event: Event) => {
      if (disabled) return
      const detail = (event as CustomEvent<AnalyticsEvent>).detail
      if (!detail?.name) return
      void fetch(ANALYTICS_CAPTURE_API_PATH, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(detail),
        keepalive: true,
      }).catch(() => undefined)
    }
    const onReset = () => {
      disabled = true
    }
    window.addEventListener(ANALYTICS_EVENT_NAME, onCapture)
    window.addEventListener(ANALYTICS_RESET_EVENT, onReset)
    return () => {
      window.removeEventListener(ANALYTICS_EVENT_NAME, onCapture)
      window.removeEventListener(ANALYTICS_RESET_EVENT, onReset)
    }
  }, [])
  return null
}
