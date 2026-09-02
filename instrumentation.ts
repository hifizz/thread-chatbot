export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { registerNodeObservability } =
    await import("./lib/observability/register-node")
  await registerNodeObservability()
}
