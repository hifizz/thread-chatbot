import { fetchWithAuth } from "@/lib/auth/session-recovery"

export type StopGenerationResult = { ok: true } | { ok: false; message: string }

type StopGenerationDependencies = {
  fetch: typeof fetchWithAuth
  logError(message: string, error: unknown): void
}

const defaultDependencies: StopGenerationDependencies = {
  fetch: fetchWithAuth,
  logError: (message, error) => console.error(message, error),
}

/** 请求服务端停止指定 generation；不负责断开本地 stream consumer。 */
export async function requestGenerationStop(
  generationId: string,
  dependencies: StopGenerationDependencies = defaultDependencies
): Promise<StopGenerationResult> {
  try {
    const res = await dependencies.fetch(
      `/api/branch-generations/${generationId}/stop`,
      { method: "POST" }
    )
    return res.ok
      ? { ok: true }
      : {
          ok: false,
          message: `停止失败（HTTP ${res.status}），生成仍在继续`,
        }
  } catch (error) {
    dependencies.logError("[thread-chat] Stop 请求失败", error)
    return { ok: false, message: "停止失败，生成仍在继续" }
  }
}
