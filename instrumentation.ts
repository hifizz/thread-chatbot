// Next.js 服务实例启动时执行一次（v15 起 stable，无需任何 experimental 开关）。
// OTel 的 Node SDK 只能跑在 nodejs runtime，edge 下直接跳过。
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerObservability } =
      await import("./lib/observability/register")
    registerObservability()
  }
}
