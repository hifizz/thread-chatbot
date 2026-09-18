import { randomUUID } from "node:crypto"
import { and, desc, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { DATA_REQUEST_API_PATH, PRIVACY_REQUEST_BODY_LIMIT_BYTES } from "@/constants/privacy"
import { getCurrentUserId } from "@/lib/auth/server"
import { db } from "@/lib/db"
import { privacyDataRequests } from "@/lib/db/schema"
import { readJsonBody } from "@/lib/http/json-body"
import { isSameOrigin } from "@/lib/http/same-origin"
import type { DataRequestKind, PrivacyErrorResponse } from "@/lib/privacy/types"

function error(code: PrivacyErrorResponse["code"], status: number) {
  return NextResponse.json({ code } satisfies PrivacyErrorResponse, { status })
}

export async function GET(request: Request) {
  const userId = await getCurrentUserId(request.headers)
  if (!userId) return error("AUTH_REQUIRED", 401)
  const requests = await db
    .select()
    .from(privacyDataRequests)
    .where(eq(privacyDataRequests.userId, userId))
    .orderBy(desc(privacyDataRequests.requestedAt))
    .limit(20)
  return NextResponse.json({ requests, path: DATA_REQUEST_API_PATH })
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return error("INVALID_ORIGIN", 403)
  const userId = await getCurrentUserId(request.headers)
  if (!userId) return error("AUTH_REQUIRED", 401)

  let body: unknown
  try {
    body = await readJsonBody(request, PRIVACY_REQUEST_BODY_LIMIT_BYTES)
  } catch {
    return error("VALIDATION_ERROR", 400)
  }
  const kind =
    body && typeof body === "object" && "kind" in body
      ? (body as { kind?: unknown }).kind
      : null
  if (kind !== "export" && kind !== "delete") {
    return error("VALIDATION_ERROR", 400)
  }

  const id = randomUUID()
  const [created] = await db
    .insert(privacyDataRequests)
    .values({
      id,
      userId,
      kind: kind satisfies DataRequestKind,
      status: "requested",
    })
    .onConflictDoNothing()
    .returning({ id: privacyDataRequests.id })
  const requestId = created?.id ?? (
    await db
      .select({ id: privacyDataRequests.id })
      .from(privacyDataRequests)
      .where(
        and(
          eq(privacyDataRequests.userId, userId),
          eq(privacyDataRequests.kind, kind)
        )
      )
      .orderBy(desc(privacyDataRequests.requestedAt))
      .limit(1)
  )[0]?.id
  if (!requestId) return error("PRIVACY_PERSISTENCE_FAILED", 503)
  // 本接口只登记请求。身份复核、导出链接签发和删除执行由后续受控流程完成。
  return NextResponse.json({ id: requestId, kind, status: "requested" as const }, { status: 202 })
}
