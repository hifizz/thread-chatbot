import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import * as schema from "./schema"

declare global {
  var __dbClient: ReturnType<typeof postgres> | undefined
}

const client = globalThis.__dbClient ?? postgres(process.env.DATABASE_URL!, { max: 10 })
if (process.env.NODE_ENV !== "production") globalThis.__dbClient = client

export const db = drizzle(client, { schema })
