import { desc } from "drizzle-orm"
import { db } from "@/lib/db"
import { threads } from "@/lib/db/schema"

export async function GET() {
  const rows = await db
    .select()
    .from(threads)
    .orderBy(desc(threads.lastMessageAt), desc(threads.createdAt))
  return Response.json({ threads: rows })
}

export async function POST(req: Request) {
  const { id }: { id: string } = await req.json()
  const [row] = await db.insert(threads).values({ id }).returning()
  return Response.json(row)
}
