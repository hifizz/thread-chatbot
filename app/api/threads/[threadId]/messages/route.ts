import { asc, eq } from "drizzle-orm"
import { db } from "@/lib/db"
import { messages, threads } from "@/lib/db/schema"

type RouteContext = { params: Promise<{ threadId: string }> }

export async function GET(_req: Request, { params }: RouteContext) {
  const { threadId } = await params
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.threadId, threadId))
    .orderBy(asc(messages.createdAt))

  return Response.json(
    rows.map((row) => ({
      id: row.id,
      parentId: row.parentId,
      format: row.format,
      content: row.content,
    }))
  )
}

export async function POST(req: Request, { params }: RouteContext) {
  const { threadId } = await params
  const body: {
    id: string
    parentId: string | null
    content: { role: string } & Record<string, unknown>
  } = await req.json()

  const [row] = await db
    .insert(messages)
    .values({
      id: body.id,
      threadId,
      parentId: body.parentId,
      role: body.content.role,
      content: body.content,
    })
    .returning()

  await db
    .update(threads)
    .set({ lastMessageAt: new Date(), updatedAt: new Date() })
    .where(eq(threads.id, threadId))

  return Response.json(row)
}
