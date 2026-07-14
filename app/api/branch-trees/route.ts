/**
 * /api/branch-trees —— 分支树的轻量列表（会话列表 UI 的数据源）。
 *
 * GET 返回 { trees: [{ id, title, updatedAt, threadCount }] }：
 * · title = coalesce(custom_title, title)（双轨标题，design D1），双空回退「未命名对话」；
 * · threadCount 在 SQL 内由 state->'threads' 的顶层键数派生（design D2）——
 *   不回传整树 state（可能百 KB 级），列表只要元信息；
 * · updated_at 降序，limit 100 兜底（v1 不做分页/搜索）。
 */

import { desc, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { branchTrees } from "@/lib/db/schema"
import { TREE_TITLE_FALLBACK } from "@/constants/thread-chat"

export async function GET() {
  const rows = await db
    .select({
      id: branchTrees.id,
      title: sql<string>`coalesce(${branchTrees.customTitle}, ${branchTrees.title}, ${TREE_TITLE_FALLBACK})`,
      updatedAt: branchTrees.updatedAt,
      // jsonb_typeof 防御：threads 非对象的历史毒行不再让整个列表 500（写入侧已校验，此处兜底）
      threadCount: sql<number>`(case when jsonb_typeof(${branchTrees.state} -> 'threads') = 'object' then (select count(*) from jsonb_object_keys(${branchTrees.state} -> 'threads')) else 0 end)::int`,
    })
    .from(branchTrees)
    .orderBy(desc(branchTrees.updatedAt))
    .limit(100)
  return Response.json({ trees: rows })
}
