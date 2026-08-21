import { fetchWithAuth } from "@/lib/auth/session-recovery"
import {
  switchActiveLeafErrorResponseSchema,
  switchActiveLeafSuccessResponseSchema,
} from "@/lib/thread-chat/contracts/switch-active-leaf"
import type { VariantSwitchResult } from "../../chat/actions/message-action-commands"

const NETWORK_ERROR = "网络请求失败，请重试"

type SwitchActiveLeafInput = {
  treeId: string
  threadId: string
  assistantMessageId: string
  baseRevision: number | null
}

type SwitchActiveLeafDependencies = {
  fetch: typeof fetchWithAuth
}

const defaultDependencies: SwitchActiveLeafDependencies = {
  fetch: fetchWithAuth,
}

/** 请求服务端原子切换 active leaf；本地 revision/store 更新由调用者负责。 */
export async function switchActiveLeaf(
  { treeId, threadId, assistantMessageId, baseRevision }: SwitchActiveLeafInput,
  dependencies: SwitchActiveLeafDependencies = defaultDependencies
): Promise<VariantSwitchResult> {
  try {
    const res = await dependencies.fetch(
      `/api/branch-trees/${treeId}/active-leaf`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ threadId, assistantMessageId, baseRevision }),
      }
    )
    const responseBody = await res.json().catch(() => null)
    if (!res.ok) {
      const failure =
        switchActiveLeafErrorResponseSchema.safeParse(responseBody)
      return {
        ok: false,
        code: failure.success ? failure.data.error.code : "network_error",
        message: failure.success
          ? failure.data.error.message
          : "切换回复版本失败",
      }
    }
    const success =
      switchActiveLeafSuccessResponseSchema.safeParse(responseBody)
    if (!success.success) {
      return {
        ok: false,
        code: "network_error",
        message: "服务端未返回新的树修订号",
      }
    }
    return {
      ok: true,
      threadId,
      assistantMessageId,
      revision: success.data.revision,
    }
  } catch {
    return { ok: false, code: "network_error", message: NETWORK_ERROR }
  }
}
