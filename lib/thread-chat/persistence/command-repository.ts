import { createHash } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { conversationCommands } from "@/lib/db/schema"
import { canonicalCommandPayload } from "@/lib/thread-chat/contracts/command-replay"
import type { ConversationTransaction } from "@/lib/thread-chat/persistence/transaction"

export class CommandIdConflictError extends Error {
  readonly code = "COMMAND_ID_CONFLICT" as const

  constructor() {
    super("相同 commandId 已用于不同命令")
    this.name = "CommandIdConflictError"
  }
}

export function commandRequestHash(payload: unknown): string {
  return createHash("sha256")
    .update(canonicalCommandPayload(payload))
    .digest("hex")
}

export async function executeIdempotentCommand<T>({
  tx,
  userId,
  commandId,
  kind,
  scopeId,
  payload,
  execute,
}: {
  tx: ConversationTransaction
  userId: string
  commandId: string
  kind: string
  scopeId: string
  payload: unknown
  execute: () => Promise<T>
}): Promise<{ replayed: boolean; result: T }> {
  const requestHash = commandRequestHash(payload)
  const [reserved] = await tx
    .insert(conversationCommands)
    .values({
      userId,
      id: commandId,
      kind,
      scopeId,
      requestHash,
      result: { pending: true },
    })
    .onConflictDoNothing()
    .returning({ id: conversationCommands.id })

  if (!reserved) {
    const [receipt] = await tx
      .select()
      .from(conversationCommands)
      .where(
        and(
          eq(conversationCommands.userId, userId),
          eq(conversationCommands.id, commandId)
        )
      )
      .limit(1)
    if (
      !receipt ||
      receipt.kind !== kind ||
      receipt.scopeId !== scopeId ||
      receipt.requestHash !== requestHash
    ) {
      throw new CommandIdConflictError()
    }
    return { replayed: true, result: receipt.result as T }
  }

  const result = await execute()
  await tx
    .update(conversationCommands)
    .set({ result })
    .where(
      and(
        eq(conversationCommands.userId, userId),
        eq(conversationCommands.id, commandId)
      )
    )
  return { replayed: false, result }
}
