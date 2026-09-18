/** 状态写入只接受同源浏览器请求；配置外部 origin 时不信任任意转发头。 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin || origin === "null") return false
  try {
    const expected = new URL(process.env.BETTER_AUTH_URL || request.url).origin
    return new URL(origin).origin === expected && origin === expected
  } catch {
    return false
  }
}
