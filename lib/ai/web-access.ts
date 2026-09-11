import { WEB_MAX_DURATION_MS, WEB_MAX_PROVIDER_ATTEMPTS, WEB_MAX_CONCURRENCY } from "@/constants/research"

export type WebToolFailure = {
  ok: false
  error: { code: string; message: string }
  nextAction: "search" | "revise_query" | "stop"
}
export type WebToolResult<T> = { ok: true; data: T } | WebToolFailure

/** 只将已识别的联网故障交给模型；不包含供应商原始响应。 */
export class WebAccessError extends Error {
  constructor(
    readonly code: string,
    readonly publicMessage: string,
    readonly nextAction: WebToolFailure["nextAction"] = "search",
    readonly allowProviderFallback = false,
    readonly status?: number,
  ) {
    super(publicMessage)
    this.name = "WebAccessError"
  }
}

export function webBudgetExceeded(): WebAccessError {
  return new WebAccessError("WEB_BUDGET_EXHAUSTED", "本轮联网核实已达到限制，请依据已有有效来源回答；证据不足时明确无法核实。", "stop")
}

export function webFailure(error: WebAccessError): WebToolFailure {
  return { ok: false, error: { code: error.code, message: error.publicMessage }, nextAction: error.nextAction }
}

export function normalizeWebUrl(value: string): string {
  let url: URL
  try { url = new URL(value.trim()) } catch {
    throw new WebAccessError("INVALID_URL", "网址无效，请提供完整的公开网页链接。", "stop")
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (!/^https?:$/.test(url.protocol) || url.username || url.password ||
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
    /^(?:127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host) ||
    host === "::1" || host === "::" || /^(?:fc|fd|fe[89ab])/.test(host) && host.includes(":") || host.startsWith("::ffff:")) {
    throw new WebAccessError("UNSAFE_URL", "只能读取公开的 HTTP 或 HTTPS 网页。", "stop")
  }
  url.hash = ""
  return url.toString()
}

export function assertUsablePage(content: string): void {
  if (!content.trim()) throw new WebAccessError("EMPTY_RESULT", "没有取得可用正文。", "search", true)
  // 只识别明确的拦截页/抽取错误开头，避免把讨论验证码的正常文章误判。
  if (/^\s*(?:[#\s]*)(?:this page couldn.{0,8}t load|this page (?:could not|cannot) (?:be loaded|load)|access denied|403 forbidden|404 not found|just a moment|verify (?:that )?you are human|checking your browser|captcha|error(?:\s*[:：]| fetching| extracting)|failed to (?:fetch|extract)|无法(?:抓取|抽取)|网页抽取失败)/i.test(content)) {
    throw new WebAccessError("UNUSABLE_CONTENT", "网页返回错误或验证页面，没有取得可用正文。", "search", true)
  }
}

/** 每次生成独享；从首个真实上游尝试开始计时，空闲时不保留计时器/监听器。 */
export function createWebBudget(options: {
  maxProviderAttempts?: number
  maxDurationMs?: number
  maxConcurrency?: number
} = {}) {
  const maxAttempts = options.maxProviderAttempts ?? WEB_MAX_PROVIDER_ATTEMPTS
  const duration = options.maxDurationMs ?? WEB_MAX_DURATION_MS
  const concurrency = options.maxConcurrency ?? WEB_MAX_CONCURRENCY
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || !Number.isFinite(duration) || duration <= 0 || !Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("联网预算配置必须为正数，次数和并发数必须为整数")
  }
  let attempts = 0
  let deadline: number | undefined
  let active = 0
  const waiting = new Set<() => void>()
  return {
    get attempts() { return attempts },
    get exhausted() { return attempts >= maxAttempts || (deadline !== undefined && Date.now() >= deadline) },
    async run<T>(signal: AbortSignal | undefined, operation: (signal: AbortSignal, attemptIndex: number) => Promise<T>): Promise<T> {
      signal?.throwIfAborted()
      while (active >= concurrency) {
        await new Promise<void>((resolve, reject) => {
          const wake = () => { signal?.removeEventListener("abort", abort); waiting.delete(wake); resolve() }
          const abort = () => { waiting.delete(wake); signal?.removeEventListener("abort", abort); reject(signal?.reason) }
          waiting.add(wake)
          signal?.addEventListener("abort", abort, { once: true })
        })
        signal?.throwIfAborted()
      }
      if (attempts >= maxAttempts || (deadline !== undefined && Date.now() >= deadline)) throw webBudgetExceeded()
      deadline ??= Date.now() + duration
      const index = ++attempts
      active++
      const controller = new AbortController()
      const abort = () => controller.abort(signal?.reason)
      signal?.addEventListener("abort", abort, { once: true })
      const timer = setTimeout(() => controller.abort(webBudgetExceeded()), Math.max(0, deadline - Date.now()))
      try {
        return await operation(controller.signal, index)
      } catch (error) {
        signal?.throwIfAborted()
        if (controller.signal.aborted) throw controller.signal.reason
        throw error
      } finally {
        clearTimeout(timer)
        signal?.removeEventListener("abort", abort)
        active--
        for (const wake of waiting) wake()
      }
    },
  }
}
export type WebBudget = ReturnType<typeof createWebBudget>
