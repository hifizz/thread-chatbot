import { readFile } from "node:fs/promises"

import {
  assertConversationCutoverManifestReady,
  conversationCutoverManifestSchema,
  hashConversationCutoverManifest,
} from "../lib/thread-chat/cutover/conversation-cutover-manifest.ts"

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return value && !value.startsWith("--") ? value : undefined
}

const manifestPath = flag("--manifest-file")
if (!manifestPath) throw new Error("必须提供 --manifest-file")
const manifest = conversationCutoverManifestSchema.parse(
  JSON.parse(await readFile(manifestPath, "utf8"))
)

if (process.argv.includes("--for-execution")) {
  const environment = flag("--environment")
  const databaseHost = flag("--database-host")
  const databaseName = flag("--database-name")
  if (!environment || !databaseHost || !databaseName)
    throw new Error(
      "--for-execution 必须显式提供 --environment、--database-host 和 --database-name"
    )
  assertConversationCutoverManifestReady({
    manifest,
    environment,
    databaseHost,
    databaseName,
  })
}

console.log(
  JSON.stringify(
    {
      ok: true,
      mode: process.argv.includes("--for-execution")
        ? "execution-gate"
        : "schema-only",
      environment: manifest.environment,
      database: manifest.database,
      epoch: manifest.authority.epoch,
      disposition: manifest.disposition.mode,
      manifestSha256: hashConversationCutoverManifest(manifest),
    },
    null,
    2
  )
)
