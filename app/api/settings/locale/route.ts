import { readJsonBody } from "@/lib/http/json-body"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/constants/i18n"
import { getSession } from "@/lib/auth/server"
import { db } from "@/lib/db"
import { user } from "@/lib/db/schema"
import { isSameOrigin } from "@/lib/http/same-origin"
import { publicErrorResponse } from "@/lib/http/public-error"
import { saveLocalePreference, updateLocaleSchema } from "@/lib/i18n/locale-preference"

export async function PATCH(request: Request) {
  if (!isSameOrigin(request)) return publicErrorResponse("ORIGIN_NOT_ALLOWED", 403)
  let body: unknown
  try { body = await readJsonBody(request, 256) } catch { return publicErrorResponse("VALIDATION_ERROR", 400) }
  const parsed = updateLocaleSchema.safeParse(body)
  if (!parsed.success) return publicErrorResponse("VALIDATION_ERROR", 400)
  const session = await getSession(request.headers)
  const result = await saveLocalePreference(parsed.data.locale, session?.user.id ?? null, async (userId, locale) => {
    const rows = await db.update(user).set({ locale, updatedAt: new Date() }).where(eq(user.id, userId)).returning({ id: user.id })
    if (!rows.length) throw new Error("LOCALE_USER_NOT_FOUND")
  })
  const response = NextResponse.json(result, { status: result.code ? 503 : 200, headers: { "Cache-Control": "no-store" } })
  response.cookies.set(LOCALE_COOKIE, result.locale, {
    path: "/", sameSite: "lax", maxAge: LOCALE_COOKIE_MAX_AGE,
    secure: new URL(process.env.BETTER_AUTH_URL || request.url).protocol === "https:",
  })
  return response
}
