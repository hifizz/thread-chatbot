import { getInstanceId, getReleaseId } from "@/lib/runtime/instance"

// Liveness：只证明进程活着，不查数据库、不调用供应商，公开响应不含密钥/连接串。
export const dynamic = "force-dynamic"

export function GET() {
  return Response.json(
    {
      status: "healthy",
      release: getReleaseId(),
      instance: getInstanceId(),
    },
    {
      headers: { "Cache-Control": "no-store" },
    }
  )
}
