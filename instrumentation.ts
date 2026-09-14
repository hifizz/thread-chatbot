import type { Instrumentation } from "next"
import { axiomConfigured, logger } from "@/lib/axiom/server"
import { safeErrorMetadata } from "@/lib/observability/error"

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
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
    digest: "digest" in error ? error.digest : undefined,
    ...safeErrorMetadata(error),
  })
  await logger.flush()
}
