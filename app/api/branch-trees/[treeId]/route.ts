/**
 * /api/branch-trees/[treeId] —— 分支对话树（app/thread-chat）的整树读写。
 *
 * 一棵树一行（branch_trees.state = 完整 ThreadTreeState JSON）：
 * · GET  命中返回 { state, customTitle }（customTitle = 用户重命名过的标题，未改过为 null，
 *        供主线列头副标题优先展示）；未命中返回 200 + { state: null, customTitle: null }——
 *        首次访问是正常路径不是错误，客户端一个分支判断即可，无需在 fetch 层区分
 *        「404 = 正常」与「404 = 路由不存在」。
 * · PUT  { state, title? } 整树 upsert。服务端不理解 ThreadTreeState 语义，只做
 *        「state 存在且为对象」的浅校验（深校验属于过度设计），体积治理交给 Next 默认 body 限制。
 *        只写 state / 派生 title / updatedAt，不触碰 custom_title（双轨标题，design D1）。
 * · PATCH { title } 重命名：trim 后非空且 ≤ CUSTOM_TITLE_MAX_LEN，只写 custom_title 列；
 *        树不存在 404——与 PUT 的派生轨互不踩踏。
 * · DELETE 删除该行，幂等（不存在也返回 { ok: true }）。
 * treeId 做 UUID 形状校验（安全阀），不合法一律 400。
 */

import { and, eq, isNull, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { branchTrees } from "@/lib/db/schema"
import { isValidTreeId } from "@/lib/chat/tree-id"
import { CUSTOM_TITLE_MAX_LEN } from "@/constants/thread-chat"
import { getCurrentUserId } from "@/lib/auth/server"
import type { ThreadTreeState } from "@/app/thread-chat/core/types"
import { migrateThreadTreeState } from "@/app/thread-chat/core/message-graph"
import { reconcileThreadChatTurns } from "@/app/thread-chat/generation/reconcile-turns"
import {
  failStaleGenerationsForTree,
  listCurrentGenerationsForTree,
  toGenerationSummary,
  treeHasActiveGenerations,
} from "@/lib/thread-chat-generation/repository"

type RouteContext = { params: Promise<{ treeId: string }> }

function unauthorized() {
  return Response.json(
    { error: { code: "unauthorized", message: "请先登录" } },
    { status: 401 }
  )
}

function notFound() {
  return Response.json(
    { error: { code: "not_found", message: "分支树不存在" } },
    { status: 404 }
  )
}

async function loadOwnedOrClaimedTree(userId: string, treeId: string) {
  return db.transaction(async (tx) => {
    const [owned] = await tx
      .select({
        state: branchTrees.state,
        customTitle: branchTrees.customTitle,
        revision: branchTrees.revision,
      })
      .from(branchTrees)
      .where(and(eq(branchTrees.id, treeId), eq(branchTrees.userId, userId)))
    if (owned) return owned

    // 精确 URL 的一次性历史迁移认领；并发时只有一个 UPDATE 能成功。
    const [claimed] = await tx
      .update(branchTrees)
      .set({ userId })
      .where(and(eq(branchTrees.id, treeId), isNull(branchTrees.userId)))
      .returning({
        state: branchTrees.state,
        customTitle: branchTrees.customTitle,
        revision: branchTrees.revision,
      })
    return claimed ?? null
  })
}

export async function GET(_req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return unauthorized()
  const { treeId } = await params
  if (!isValidTreeId(treeId))
    return new Response("treeId 必须是 UUID", { status: 400 })

  const row = await loadOwnedOrClaimedTree(userId, treeId)
  if (!row) return notFound()

  await failStaleGenerationsForTree(userId, treeId)
  const generations = await listCurrentGenerationsForTree(userId, treeId)
  let reconciled
  try {
    reconciled = reconcileThreadChatTurns({
      state: row.state as ThreadTreeState,
      generations: generations.map((generation) => ({
        ...toGenerationSummary(generation),
        turnSnapshot: generation.turnSnapshot,
      })),
    })
  } catch (error) {
    console.error("[thread-chat] 消息图读取协调失败", { treeId, error })
    return Response.json(
      {
        error: {
          code: "invalid_tree_state",
          message: "分支树消息结构无效",
        },
      },
      { status: 500 }
    )
  }
  return Response.json({
    state: reconciled.state,
    revision: row.revision,
    customTitle: row.customTitle,
    generations: generations.map(toGenerationSummary),
    recoverableTurns: reconciled.recoverableTurns,
  })
}

export async function PUT(req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return unauthorized()
  const { treeId } = await params
  if (!isValidTreeId(treeId))
    return new Response("treeId 必须是 UUID", { status: 400 })

  let body: { state?: unknown; title?: unknown; baseRevision?: unknown }
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
  const incomingSchemaVersion = (state as Record<string, unknown>).schemaVersion
  const baseRevision = body.baseRevision
  if (
    incomingSchemaVersion === 2 &&
    (!Number.isInteger(baseRevision) || (baseRevision as number) < 0)
  )
    return Response.json(
      {
        error: {
          code: "revision_required",
          message: "消息图存盘必须携带 baseRevision",
        },
      },
      { status: 428 }
    )

  let validatedState = state
  if (incomingSchemaVersion === 2) {
    try {
      validatedState = migrateThreadTreeState(state)
    } catch {
      return Response.json(
        {
          error: {
            code: "invalid_tree_state",
            message: "消息图包含无效的 parent 或 active leaf",
          },
        },
        { status: 400 }
      )
    }
  }
  const now = new Date()
  const saved = await db.transaction(async (tx) => {
    if (Number.isInteger(baseRevision)) {
      const expectedRevision = baseRevision as number
      const [updated] = await tx
        .update(branchTrees)
        .set({
          state: validatedState,
          title,
          revision: sql`${branchTrees.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(branchTrees.id, treeId),
            eq(branchTrees.userId, userId),
            eq(branchTrees.revision, expectedRevision)
          )
        )
        .returning({ revision: branchTrees.revision })
      if (updated) return { kind: "saved" as const, revision: updated.revision }

      const [existing] = await tx
        .select({ revision: branchTrees.revision })
        .from(branchTrees)
        .where(and(eq(branchTrees.id, treeId), eq(branchTrees.userId, userId)))
      if (existing)
        return { kind: "conflict" as const, revision: existing.revision }
      if (expectedRevision !== 0) return { kind: "not_found" as const }

      const [inserted] = await tx
        .insert(branchTrees)
        .values({
          id: treeId,
          userId,
          state: validatedState,
          title,
          revision: 1,
          updatedAt: now,
        })
        .onConflictDoNothing({ target: branchTrees.id })
        .returning({ revision: branchTrees.revision })
      if (inserted)
        return { kind: "saved" as const, revision: inserted.revision }
      return { kind: "not_found" as const }
    }

    // 滚动部署兼容：旧客户端只能继续写未升级的 legacy tree。
    const [existing] = await tx
      .select({ state: branchTrees.state, revision: branchTrees.revision })
      .from(branchTrees)
      .where(and(eq(branchTrees.id, treeId), eq(branchTrees.userId, userId)))
    if (
      existing &&
      (existing.state as { schemaVersion?: unknown }).schemaVersion === 2
    )
      return { kind: "revision_required" as const }
    const [updated] = await tx
      .update(branchTrees)
      .set({ state: validatedState, title, updatedAt: now })
      .where(and(eq(branchTrees.id, treeId), eq(branchTrees.userId, userId)))
      .returning({ revision: branchTrees.revision })
    if (updated) return { kind: "saved" as const, revision: updated.revision }

    const [inserted] = await tx
      .insert(branchTrees)
      .values({
        id: treeId,
        userId,
        state: validatedState,
        title,
        updatedAt: now,
      })
      .onConflictDoNothing({ target: branchTrees.id })
      .returning({ revision: branchTrees.revision })
    return inserted
      ? { kind: "saved" as const, revision: inserted.revision }
      : { kind: "not_found" as const }
  })
  if (saved.kind === "not_found") return notFound()
  if (saved.kind === "revision_required")
    return Response.json(
      {
        error: {
          code: "revision_required",
          message: "该树已升级，请刷新后再保存",
        },
      },
      { status: 428 }
    )
  if (saved.kind === "conflict")
    return Response.json(
      {
        error: {
          code: "tree_revision_conflict",
          message: "该对话已在其他页面更新",
          currentRevision: saved.revision,
        },
      },
      { status: 409 }
    )
  return Response.json({ ok: true, revision: saved.revision })
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return unauthorized()
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
    .where(and(eq(branchTrees.id, treeId), eq(branchTrees.userId, userId)))
    .returning({ id: branchTrees.id })
  if (updated.length === 0) return new Response("树不存在", { status: 404 })
  return Response.json({ ok: true })
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const userId = await getCurrentUserId()
  if (!userId) return unauthorized()
  const { treeId } = await params
  if (!isValidTreeId(treeId))
    return new Response("treeId 必须是 UUID", { status: 400 })

  const [owned] = await db
    .select({ id: branchTrees.id })
    .from(branchTrees)
    .where(and(eq(branchTrees.id, treeId), eq(branchTrees.userId, userId)))
  if (!owned) return notFound()
  if (await treeHasActiveGenerations(userId, treeId)) {
    return Response.json(
      {
        error: {
          code: "generation_running",
          message: "请先停止正在运行的生成，再删除这棵对话树",
        },
      },
      { status: 409 }
    )
  }
  await db
    .delete(branchTrees)
    .where(and(eq(branchTrees.id, treeId), eq(branchTrees.userId, userId)))
  return Response.json({ ok: true })
}
