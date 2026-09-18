import { and, eq } from "drizzle-orm"
import { NextResponse } from "next/server"
import { PRIVACY_REQUEST_BODY_LIMIT_BYTES } from "@/constants/privacy"
import { AdminAccessError, requireAdmin } from "@/lib/admin/auth"
import { db } from "@/lib/db"
import { privacyDataRequests } from "@/lib/db/schema"
import { readJsonBody } from "@/lib/http/json-body"
import { isSameOrigin } from "@/lib/http/same-origin"
import type { DataRequestStatus, PrivacyErrorResponse } from "@/lib/privacy/types"

const transitions: Record<DataRequestStatus, readonly DataRequestStatus[]> = {
  requested: ["verified", "rejected"],
  verified: ["processing", "rejected"],
  processing: ["completed", "rejected"],
  completed: [],
  rejected: [],
}

function error(code: PrivacyErrorResponse["code"], status: number) {
  return NextResponse.json({ code } satisfies PrivacyErrorResponse, { status })
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ requestId: string }> }
) {
  if (!isSameOrigin(request)) return error("INVALID_ORIGIN", 403)
  try {
    await requireAdmin()
  } catch (cause) {
    if (cause instanceof AdminAccessError) return error("AUTH_REQUIRED", cause.status)
    throw cause
  }
  let body: unknown
  try {
    body = await readJsonBody(request, PRIVACY_REQUEST_BODY_LIMIT_BYTES)
  } catch {
    return error("VALIDATION_ERROR", 400)
  }
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {}
  const status = input.status
  if (!(["verified", "processing", "completed", "rejected"] as const).includes(status as never)) {
    return error("VALIDATION_ERROR", 400)
  }
  const nextStatus = status as DataRequestStatus
  if (nextStatus === "verified" && typeof input.verificationMethod !== "string") {
    return error("VALIDATION_ERROR", 400)
  }
  if (nextStatus === "rejected" && typeof input.reasonCode !== "string") {
    return error("VALIDATION_ERROR", 400)
  }

  const { requestId } = await context.params
  const [current] = await db
    .select({ status: privacyDataRequests.status, kind: privacyDataRequests.kind })
    .from(privacyDataRequests)
    .where(eq(privacyDataRequests.id, requestId))
    .limit(1)
  if (!current || !transitions[current.status].includes(nextStatus)) {
    return error("VALIDATION_ERROR", 409)
  }
  // 删除只有在第三方副本检查完成后才能标为全部完成。
  if (current.kind === "delete" && nextStatus === "completed" && input.thirdPartyCompleted !== true) {
    return error("VALIDATION_ERROR", 409)
  }
  const now = new Date()
  const [updated] = await db
    .update(privacyDataRequests)
    .set({
      status: nextStatus,
      updatedAt: now,
      ...(nextStatus === "verified"
        ? { verificationMethod: String(input.verificationMethod), verifiedAt: now }
        : {}),
      ...(nextStatus === "completed" ? { completedAt: now } : {}),
      ...(nextStatus === "rejected" ? { reasonCode: String(input.reasonCode) } : {}),
    })
    .where(
      and(
        eq(privacyDataRequests.id, requestId),
        eq(privacyDataRequests.status, current.status)
      )
    )
    .returning()
  if (!updated) return error("VALIDATION_ERROR", 409)
  return NextResponse.json({ request: updated })
}

