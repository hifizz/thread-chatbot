/** 登录回跳只允许站内路径，避免 query 参数形成开放重定向。 */
export function safeReturnPath(value: string | null, fallback: string): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020]/.test(value)) return fallback
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith("//") || /[\\\u0000-\u001f]/.test(decoded)) return fallback
    const url = new URL(value, "https://threadchat.invalid")
    return url.origin === "https://threadchat.invalid" ? `${url.pathname}${url.search}${url.hash}` : fallback
  } catch { return fallback }
}
