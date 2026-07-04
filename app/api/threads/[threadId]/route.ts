import { eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { threads } from "@/lib/db/schema"

type RouteContext = { params: Promise<{ threadId: string }> }

export async function GET(_req: Request, { params }: RouteContext) {
  const { threadId } = await params
  const [row] = await db.select().from(threads).where(eq(threads.id, threadId))
  if (!row) return new Response("Not found", { status: 404 })
  return Response.json(row)
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const { threadId } = await params
  const body: { title?: string; status?: "regular" | "archived" } = await req.json()

  const [row] = await db
    .update(threads)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(threads.id, threadId))
    .returning()
  if (!row) return new Response("Not found", { status: 404 })
  return Response.json(row)
}

export async function DELETE(_req: Request, { params }: RouteContext) {
  const { threadId } = await params
  await db.delete(threads).where(eq(threads.id, threadId))
  return new Response(null, { status: 204 })
}
