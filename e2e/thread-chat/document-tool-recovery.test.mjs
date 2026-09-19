import assert from "node:assert/strict"
import { test } from "node:test"
import { createDocumentToolExecutor } from "../../lib/thread-chat/streaming/documents/execution.ts"
import { notFound } from "../../lib/thread-chat/application/errors.ts"
import { expandDocumentContextPart } from "../../lib/thread-chat/application/documents/model-context.ts"
import { sanitizeParts } from "../../lib/thread-chat/sharing/whitelist.ts"
import { DOCUMENT_UNAVAILABLE_FAILURE } from "../../constants/project-documents.ts"

const id = () => crypto.randomUUID()
const options = { documentId: id() }

await test("错误 ID 并发/重复调用只执行一次；纠正 ID 和版本后可重新读取", async () => {
  const run = createDocumentToolExecutor()
  let executions = 0
  const missing = async () => { executions++; await Promise.resolve(); notFound() }
  const results = await Promise.all(Array.from({ length: 7 }, (_, i) =>
    run("readProjectDocument", options, `bad-${i}`, undefined, missing)))
  assert.equal(executions, 1)
  for (const result of results) {
    assert.deepEqual(result, DOCUMENT_UNAVAILABLE_FAILURE)
    assert.equal(result.retryable, false)
  }
  const fixed = await run("readProjectDocument", { documentId: id() }, "fixed", undefined, async () => "正文")
  assert.equal(fixed, "正文")
  await run("readProjectDocument", { ...options, revisionId: id() }, "historical", undefined, missing)
  assert.equal(executions, 2)
  await createDocumentToolExecutor()("readProjectDocument", options, "new-turn", undefined, missing)
  assert.equal(executions, 3, "失败缓存不可跨生成共享")
})

await test("成功读取分别执行，保留独立收据且可看到后续修改", async () => {
  const run = createDocumentToolExecutor()
  let executions = 0
  const results = await Promise.all(Array.from({ length: 2 }, (_, i) =>
    run("readProjectDocument", options, `success-${i}`, undefined, async () => ++executions)))
  assert.deepEqual(results, [1, 2])
})

await test("更新的入口定位失败可恢复；版本冲突不缓存", async () => {
  const run = createDocumentToolExecutor()
  assert.deepEqual(await run("updateProjectDocument", options, "missing", undefined, async () => notFound()), DOCUMENT_UNAVAILABLE_FAILURE)
  const valid = { documentId: id(), expectedRevisionId: id() }
  assert.equal((await run("updateProjectDocument", valid, "conflict", undefined, async () => ({ status: "conflict" }))).status, "conflict")
  assert.equal((await run("updateProjectDocument", valid, "commit", undefined, async () => ({ status: "committed" }))).status, "committed")
})

await test("基础设施异常不冒充找不到文档，取消不能命中失败缓存", async () => {
  const run = createDocumentToolExecutor()
  const outage = new Error("database unavailable")
  await assert.rejects(run("readProjectDocument", options, "outage", undefined, async () => { throw outage }), (error) => error === outage)
  assert.equal(await run("readProjectDocument", options, "recovered", undefined, async () => "正文"), "正文")
  await run("readProjectDocument", options, "missing", undefined, async () => notFound())
  await assert.rejects(run("readProjectDocument", options, "abort", AbortSignal.abort(), async () => "禁止执行"), { name: "AbortError" })
})

await test("新失败结果不冒充完整正文，旧成功结果仍参与上下文去重", () => {
  const artifactId = id()
  const revision = { artifactId, title: "文档", content: "正文" }
  const part = { type: "tool-readProjectDocument", toolCallId: "read", state: "output-available", input: options }
  const seen = new Set()
  const artifacts = new Map([[artifactId, { id: artifactId, title: "文档", content: "正文" }]])
  const message = { role: "assistant", parts: [] }
  expandDocumentContextPart(message, { ...part, output: DOCUMENT_UNAVAILABLE_FAILURE }, new Map(), artifacts, seen)
  assert.equal(seen.size, 0)
  expandDocumentContextPart(message, { ...part, output: { revision, readId: id(), isCurrent: true } }, new Map(), artifacts, seen)
  assert.ok(seen.has(artifactId))
  const shared = sanitizeParts([{ ...part, output: { ...DOCUMENT_UNAVAILABLE_FAILURE, message: "SECRET", guidance: "SECRET" } }],
    { messageIds: new Set(), artifactIds: new Set() })
  assert.equal(shared.length, 1)
  assert.deepEqual(shared[0].output, DOCUMENT_UNAVAILABLE_FAILURE)
  assert.ok(!JSON.stringify(shared).includes("SECRET"))
})
