import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import path from "node:path"

const root = process.cwd()
const read = (file) => readFile(path.join(root, file), "utf8")

for (const retired of [
  "app/api/branch-trees/route.ts",
  "app/api/branch-generations/[generationId]/route.ts",
  "lib/thread-chat-generation/tree-repository.ts",
  "app/thread-chat/net/persistence/persist.ts",
  "lib/thread-chat/contracts/switch-active-leaf.ts",
]) {
  await assert.rejects(access(path.join(root, retired)), `${retired} 必须退役`)
}

const schema = await read("lib/db/schema.ts")
assert.doesNotMatch(
  schema,
  /export const branch(?:Trees|Generations|MessageFeedback)/,
  "应用 schema 不得 export legacy 表"
)

const migration = await read("drizzle/0005_legacy_thread_chat_backup.sql")
for (const rename of [
  '"branch_trees" RENAME TO "legacy_branch_trees_backup"',
  '"branch_generations" RENAME TO "legacy_branch_generations_backup"',
  '"branch_message_feedback" RENAME TO "legacy_branch_message_feedback_backup"',
]) {
  assert.match(migration, new RegExp(rename.replaceAll('"', '\\"')))
}
assert.doesNotMatch(migration, /\b(?:DROP|CREATE\s+VIEW|INSERT|UPDATE|DELETE)\b/i)

const productionFiles = [
  "app/thread-chat/thread-chat-demo.tsx",
  "app/thread-chat/tree-redirect.tsx",
  "app/thread-chat/orchestration/workspace/use-conversation-runtime.ts",
  "app/thread-chat/orchestration/workspace/use-normalized-workspace.ts",
  "app/thread-chat/net/client.ts",
  "app/thread-chat/net/commands/conversation-commands.ts",
  "app/thread-chat/net/boot/conversation-boot.ts",
  "app/thread-chat/net/stream/generation-connection.ts",
  "lib/thread-chat/application/index.ts",
  "lib/thread-chat/streaming/index.ts",
]
const productionSource = (
  await Promise.all(productionFiles.map(async (file) => `${file}\n${await read(file)}`))
).join("\n")
for (const forbidden of [
  /\/api\/branch-(?:trees|generations)/,
  /\/api\/chat(?:["'`/?]|$)/,
  /lib\/thread-chat-generation/,
  /lib\/(?:billing|payments)\//,
  /usage-store/,
  /contracts\/(?:save-tree|switch-active-leaf|tree-revision)/,
  /\bsaveTree(?:Strict)?\b/,
]) {
  assert.doesNotMatch(productionSource, forbidden)
}

const route = await read("app/api/chat/route.ts")
assert.doesNotMatch(route, /prepareThreadGenerationContext|generationSettlement/)

console.log("thread-chat Gate 4 cutover static checks passed")
