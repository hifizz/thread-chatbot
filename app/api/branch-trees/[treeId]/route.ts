/**
 * /api/branch-trees/[treeId] —— 分支对话树（app/thread-chat）的整树读写。
 *
 * 一棵树一行（branch_trees.state = 完整 ThreadTreeState JSON）：
 * · GET  命中返回 { state }；未命中返回 200 + { state: null }——首次访问是正常路径不是错误，
 *        客户端一个分支判断即可，无需在 fetch 层区分「404 = 正常」与「404 = 路由不存在」。
 * · PUT  { state, title? } 整树 upsert。服务端不理解 ThreadTreeState 语义，只做
 *        「state 存在且为对象」的浅校验（深校验属于过度设计），体积治理交给 Next 默认 body 限制。
 *        只写 state / 派生 title / updatedAt，不触碰 custom_title（双轨标题，design D1）。
 * · PATCH { title } 重命名：trim 后非空且 ≤ CUSTOM_TITLE_MAX_LEN，只写 custom_title 列；
 *        树不存在 404——与 PUT 的派生轨互不踩踏。
 * · DELETE 删除该行，幂等（不存在也返回 { ok: true }）。
 * treeId 做 UUID 形状校验（安全阀），不合法一律 400。
 */

import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { branchTrees } from "@/lib/db/schema"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { CUSTOM_TITLE_MAX_LEN } from "@/constants/thread-chat"

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
  // threads 必须是普通对象（codex review：数组/标量会让列表接口的 jsonb_object_keys
  // 对这一行永久抛错，一行毒数据打挂整个 GET /api/branch-trees）
  const threads = (state as Record<string, unknown>).threads
  if (typeof threads !== "object" || threads === null || Array.isArray(threads))
    return new Response("state.threads 必须是对象", { status: 400 })

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

export async function PATCH(req: Request, { params }: RouteContext) {
  const { treeId } = await params
  if (!isValidTreeId(treeId))
    return new Response("treeId 必须是 UUID", { status: 400 })

  let body: { title?: unknown }
  try {
    body = await req.json()
  } catch {
    return new Response("body 必须是 JSON", { status: 400 })
  }
  const title = typeof body.title === "string" ? body.title.trim() : ""
  if (title === "" || title.length > CUSTOM_TITLE_MAX_LEN)
    return new Response(
      `title 必须为 trim 后非空且不超过 ${CUSTOM_TITLE_MAX_LEN} 字的字符串`,
      { status: 400 }
    )

  // 只写 custom_title（用户意志轨）——防抖 PUT 的派生 title 与之互不踩踏（design D1）
  const updated = await db
    .update(branchTrees)
    .set({ customTitle: title })
    .where(eq(branchTrees.id, treeId))
    .returning({ id: branchTrees.id })
  if (updated.length === 0) return new Response("树不存在", { status: 404 })
  return Response.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { treeId } = await params
  if (!isValidTreeId(treeId))
    return new Response("treeId 必须是 UUID", { status: 400 })

  // 幂等：不存在也返回 ok——重复删除 / 悬空条目再删都不是错误
  await db.delete(branchTrees).where(eq(branchTrees.id, treeId))
  return Response.json({ ok: true })
}
