import type { Instrumentation } from "next"
import { axiomConfigured, logger } from "@/lib/axiom/server"
import { safeErrorMetadata } from "@/lib/observability/error"

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // 启动期环境白名单校验：Fly 生产缺关键配置直接失败，不静默降级。
  const { assertRuntimeEnv } = await import("./lib/runtime/env")
  assertRuntimeEnv()
  // drain 生命周期：SIGTERM/SIGINT → 关准入 → 有界收尾 → flush → 退出。
  // 与 NEXT_MANUAL_SIG_HANDLE 配合时这是唯一的信号处置路径。
  const { installDrainSignalHandlers } = await import("./lib/runtime/drain")
  installDrainSignalHandlers()
  const { registerNodeObservability } =
    await import("./lib/observability/register-node")
  await registerNodeObservability()
  logger.info("app.started", {
    runtime: "nodejs",
    axiomConfigured: axiomConfigured(),
  })
  await logger.flush()
}

export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context
) => {
  logger.error("next.request.error", {
    method: request.method,
    path: request.path.split("?")[0],
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    digest:
      typeof error === "object" && error !== null && "digest" in error
        ? error.digest
        : undefined,
    ...safeErrorMetadata(error),
  })
  await logger.flush()
}
