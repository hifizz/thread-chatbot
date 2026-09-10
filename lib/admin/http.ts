import { ZodError } from "zod"
import { ModelCatalogError } from "@/lib/model-catalog/errors"

/** cookie 鉴权写接口只接受同源 JSON，避免跨站提交。 */
export function assertAdminWriteRequest(request: Request) {
  const url = new URL(request.url)
  // Next.js 代理后的内部 request.url 可能是 localhost；Host 保留浏览器访问域名。
  const host = request.headers.get("host") ?? url.host
  const protocol = request.headers.get("x-forwarded-proto") ?? url.protocol.slice(0, -1)
  if (!["http", "https"].includes(protocol) || request.headers.get("origin") !== `${protocol}://${host}`) throw new ModelCatalogError("请求来源无效", 403)
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new ModelCatalogError("请提交 JSON 配置", 415)
}
export function adminErrorResponse(error: unknown) {
  if (error instanceof ModelCatalogError) return Response.json({ error: error.message }, { status: error.status })
  if (error instanceof ZodError) return Response.json({ error: error.issues.map((i) => `${i.path.join(".")}：${i.message}`).join("；") }, { status: 400 })
  if (error instanceof SyntaxError) return Response.json({ error: "无效 JSON" }, { status: 400 })
  console.error("[admin] 操作失败", error)
  return Response.json({ error: "操作失败，请稍后重试" }, { status: 500 })
}
