/**
 * /api/branch-trees/[treeId] —— 分支对话树（app/thread-chat）的整树读写。
 *
 * 一棵树一行（branch_trees.state = 完整 ThreadTreeState JSON）：
 * · GET  命中返回 { state }；未命中返回 200 + { state: null }——首次访问是正常路径不是错误，
 *        客户端一个分支判断即可，无需在 fetch 层区分「404 = 正常」与「404 = 路由不存在」。
 * · PUT  { state, title? } 整树 upsert。服务端不理解 ThreadTreeState 语义，只做
 *        「state 存在且为对象」的浅校验（深校验属于过度设计），体积治理交给 Next 默认 body 限制。
 * treeId 做 UUID 形状校验（安全阀），不合法一律 400。
 */

import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { branchTrees } from "@/lib/db/schema"
import { isValidTreeId } from "@/lib/chat/tree-id"

type RouteContext = { params: Promise<{ treeId: string }> }

export async function GET(_req: Request, { params }: RouteContext) {
  const { treeId } = await params
  if (!isValidTreeId(treeId))
    return new Response("treeId 必须是 UUID", { status: 400 })

  const [row] = await db
    .select({ state: branchTrees.state })
    .from(branchTrees)
    .where(eq(branchTrees.id, treeId))
  return Response.json({ state: row?.state ?? null })
}

export async function PUT(req: Request, { params }: RouteContext) {
  const { treeId } = await params
  if (!isValidTreeId(treeId))
    return new Response("treeId 必须是 UUID", { status: 400 })

  let body: { state?: unknown; title?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response("body 必须是 JSON", { status: 400 })
  }
  const { state } = body
  if (typeof state !== "object" || state === null || Array.isArray(state))
    return new Response("state 缺失或不是对象", { status: 400 })

  const title = typeof body.title === "string" ? body.title : null
  const now = new Date()
  await db
    .insert(branchTrees)
    .values({ id: treeId, state, title, updatedAt: now })
    .onConflictDoUpdate({
      target: branchTrees.id,
      set: { state, title, updatedAt: now },
    })
  return Response.json({ ok: true })
}
