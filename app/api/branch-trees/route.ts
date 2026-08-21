/**
 * /api/branch-trees —— 分支树的轻量列表（会话列表 UI 的数据源）。
 *
 * GET 返回 { trees: [{ id, title, updatedAt, threadCount }] }：
 * · title = coalesce(custom_title, title)（双轨标题，design D1），双空回退「未命名对话」；
 * · threadCount 在 SQL 内由 state->'threads' 的顶层键数派生（design D2）——
 *   不回传整树 state（可能百 KB 级），列表只要元信息；
 * · updated_at 降序，limit 100 兜底（v1 不做分页/搜索）。
 */

import { getCurrentUserId } from "@/lib/auth/server"
import { listOwnedTreeSummaries } from "@/lib/thread-chat-generation/tree-repository"
import { legacyProtocolGate } from "@/lib/thread-chat/cutover/conversation-authority"

export async function GET() {
  const userId = await getCurrentUserId()
  if (!userId)
    return Response.json(
      { error: { code: "unauthorized", message: "请先登录" } },
      { status: 401 }
    )
  const gate = legacyProtocolGate({
    mutation: false,
    protocol: "branch-tree-list",
  })
  if (gate) return gate

  const rows = await listOwnedTreeSummaries(userId)
  return Response.json({ trees: rows })
}
