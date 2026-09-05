import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { startProjectCommandSchema } from "../../lib/thread-chat/contracts/commands.ts"
import { ConversationApplicationError } from "../../lib/thread-chat/application/errors.ts"
import { CommandIdConflictError } from "../../lib/thread-chat/persistence/command-repository.ts"
import { ThreadChatUnauthorizedError } from "../../lib/thread-chat/server/auth.ts"
import {
  commandResponse,
  jsonNoCache,
  mapRouteError,
  parseJson,
} from "../../lib/thread-chat/server/route-utils.ts"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const id = () => crypto.randomUUID()
const validStart = {
  commandId: id(),
  projectId: id(),
  rootThreadId: id(),
  userMessageId: id(),
  assistantMessageId: id(),
  modelId: "test/model",
  parts: [{ type: "text", text: "hello" }],
}

const parsed = await parseJson(
  new Request("http://localhost/api/thread-chat/v1/projects/x/start", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(validStart),
  }),
  startProjectCommandSchema
)
assert.deepEqual(parsed, validStart)

const validGenerationSettings = {
  effort: "high",
  maxOutputTokens: 32_000,
}
const parsedWithGenerationSettings = startProjectCommandSchema.parse({
  ...validStart,
  generationSettings: validGenerationSettings,
})
assert.deepEqual(
  parsedWithGenerationSettings.generationSettings,
  validGenerationSettings
)
assert.equal(
  startProjectCommandSchema.safeParse({
    ...validStart,
    generationSettings: { ...validGenerationSettings, effort: "extreme" },
  }).success,
  false
)
assert.equal(
  startProjectCommandSchema.safeParse({
    ...validStart,
    generationSettings: {
      ...validGenerationSettings,
      maxOutputTokens: 12_345,
    },
  }).success,
  false
)
assert.equal(
  startProjectCommandSchema.safeParse({
    ...validStart,
    generationSettings: { ...validGenerationSettings, unknownField: true },
  }).success,
  false
)

await assert.rejects(() =>
  parseJson(
    new Request("http://localhost/api/thread-chat/v1/projects/x/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...validStart, unknownField: true }),
    }),
    startProjectCommandSchema
  )
)
await assert.rejects(() =>
  parseJson(
    new Request("http://localhost/api/thread-chat/v1/projects/x/start", {
      method: "POST",
      body: "not-json",
    }),
    startProjectCommandSchema
  )
)

const noCache = jsonNoCache({ ok: true })
assert.equal(noCache.headers.get("cache-control"), "private, no-store, max-age=0")
const success = commandResponse({ replayed: true, result: { id: "same" } })
assert.deepEqual(await success.json(), {
  ok: true,
  replayed: true,
  data: { id: "same" },
})

const unauthorized = mapRouteError(new ThreadChatUnauthorizedError())
assert.equal(unauthorized.status, 401)
const notFound = mapRouteError(
  new ConversationApplicationError("NOT_FOUND", "资源不存在")
)
assert.equal(notFound.status, 404)
assert.deepEqual(await notFound.json(), {
  ok: false,
  error: { code: "NOT_FOUND", message: "资源不存在" },
})
const conflict = mapRouteError(new CommandIdConflictError())
assert.equal(conflict.status, 409)
const conflictBody = await conflict.json()
assert.equal(conflictBody.error.code, "COMMAND_ID_CONFLICT")
assert.equal("stack" in conflictBody.error, false, "API 不得泄露 error stack")

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const filename = path.join(directory, entry.name)
      return entry.isDirectory() ? filesUnder(filename) : [filename]
    })
  )
  return nested.flat().filter((filename) => filename.endsWith(".ts"))
}

const routeRoot = path.join(root, "app/api/thread-chat/v1")
const routeFiles = await filesUnder(routeRoot)
assert.equal(routeFiles.length, 16, "v1 应实现全部查询、命令和 stream 路由文件")
assert.ok(
  routeFiles.some((filename) =>
    filename.endsWith(
      path.join("threads", "[threadId]", "title", "route.ts")
    )
  ),
  "v1 应提供 Thread 自动标题持久化路由"
)
for (const filename of routeFiles) {
  const source = await readFile(filename, "utf8")
  assert.match(source, /export const dynamic = "force-dynamic"/)
  if (filename.includes("[")) assert.match(source, /await context\.params/)
  assert.doesNotMatch(source, /request\.signal/)
  assert.doesNotMatch(source, /\bafter\s*\(/)
}

const pipelineSource = await readFile(
  path.join(root, "lib/thread-chat/streaming/ui-message-pipeline.ts"),
  "utf8"
)
assert.match(pipelineSource, /toUIMessageStream/)
assert.match(pipelineSource, /readUIMessageStream/)
assert.doesNotMatch(pipelineSource, /\.textStream\b/)

console.log("PASS normalized v1 API contracts")
