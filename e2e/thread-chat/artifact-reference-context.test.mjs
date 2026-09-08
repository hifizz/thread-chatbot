import assert from "node:assert/strict"
import { convertToModelMessages } from "ai"
import { artifactReferenceData } from "../../lib/thread-chat/contracts/artifact-reference.ts"
import { expandArtifactReferencesInContext } from "../../lib/thread-chat/application/artifact-reference-context.ts"
import { artifactIdForTool } from "../../lib/thread-chat/streaming/artifacts.ts"

const id = (n) => `20000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const makeArtifact = (n) => ({
  id: artifactIdForTool(id(n), `call-${n}`), sourceMessageId: id(n), threadId: id(n + 100),
  title: "同名文档", kind: "markdown", content: `完整正文唯一标记_BODY_${n}_END`,
})
const a = makeArtifact(1)
const b = makeArtifact(2)
const artifacts = new Map([a, b].map((artifact) => [artifact.id, artifact]))
const source = (artifact, n) => ({
  id: artifact.sourceMessageId, role: "assistant",
  metadata: { messageId: artifact.sourceMessageId, threadId: artifact.threadId },
  parts: [{ type: "tool-createMarkdownArtifact", toolCallId: `call-${n}`, state: "output-available",
    input: { title: artifact.title, content: artifact.content }, output: { created: true, artifactId: artifact.id } }],
})
const user = (n, refs, threadId = a.threadId) => ({
  id: id(n), role: "user", metadata: { messageId: id(n), threadId },
  parts: [{ type: "text", text: "请比较正文末尾：" }, ...refs.map((artifact) => ({
    type: "data-artifact-reference", data: artifactReferenceData(artifact),
  }))],
})
const expand = (messages, map = artifacts) => expandArtifactReferencesInContext(messages, map)
const wire = (messages, map = artifacts) => convertToModelMessages(expand(messages, map), { ignoreIncompleteToolCalls: true })
const referenceAt = (messages, messageIndex, partIndex = 1) => JSON.parse(expand(messages)[messageIndex].parts[partIndex].text)
const bodyCount = (model, artifact) => JSON.stringify(model).split(artifact.content).length - 1
const fixedMarker = { contextType: "artifact-reference", artifactId: a.id, title: a.title, previouslyIncludedInContext: true }

// 当前 Thread 的源工具输入已经包含正文；新 @ 不再次添加正文。
const own = [source(a, 1), user(10, [a, a])]
const saved = structuredClone(own)
assert.equal(bodyCount(await wire(own), a), 1)
assert.deepEqual(referenceAt(own, 1), fixedMarker)
assert.deepEqual(referenceAt(own, 1, 2), fixedMarker)
assert.deepEqual(own, saved, "编译不修改持久化 Parts 或工具输入")

// 祖先消息随 forkContext 进入实际上下文，也能复用；无需当前 Thread 判定。
const inherited = [source(a, 1), user(11, [a], b.threadId)]
assert.equal(bodyCount(await wire(inherited), a), 1)
assert.deepEqual(referenceAt(inherited, 1), fixedMarker)

// 跨 Thread 首次显式引用展开，后续消息和同消息重复引用使用完全相同的标记。
const repeated = [user(12, [a, a]), user(13, [a]), user(14, [a])]
assert.equal(referenceAt(repeated, 0).content, a.content)
assert.equal(bodyCount(await wire(repeated), a), 1)
const strings = [expand(repeated)[0].parts[2].text, expand(repeated)[1].parts[1].text, expand(repeated)[2].parts[1].text]
assert.ok(strings.every((value) => value === JSON.stringify(fixedMarker)), "标记字节固定，不带位置或轮次")

// 只保留实际消息；旧来源被排除或上下文裁剪后必须在首次引用重新补全文。
assert.equal(referenceAt([user(15, [a])], 0).content, a.content)
assert.equal(bodyCount(await wire([user(13, [a]), user(14, [a])]), a), 1)
const forward = [user(16, [a]), source(a, 1)]
assert.equal(referenceAt(forward, 0).content, a.content, "不能因后文才出现的源工具而删掉前文正文")

// 不完整/临时工具输入会被 SDK 剔除，不能据此省略后续引用。
for (const patch of [{ state: "input-available", output: undefined }, { preliminary: true }]) {
  const message = source(a, 1)
  Object.assign(message.parts[0], patch)
  const context = [message, user(17, [a])]
  assert.equal(referenceAt(context, 1).content, a.content)
  assert.equal(bodyCount(await wire(context), a), 1)
}

// 内容、来源或回传 ID 不一致时保守提供权威正文；不能按标题去重。
for (const mutate of [
  (message) => { message.parts[0].input.content = "缩略正文" },
  (message) => { message.parts[0].input.title = "其他标题" },
  (message) => { message.parts[0].output.artifactId = b.id },
  (message) => { message.id = id(99) },
  (message) => { message.role = "user" },
]) {
  const message = source(a, 1)
  mutate(message)
  assert.equal(referenceAt([message, user(18, [a])], 1).content, a.content)
}
const distinct = [source(a, 1), user(19, [a, b])]
assert.equal(bodyCount(await wire(distinct), a), 1)
assert.equal(bodyCount(await wire(distinct), b), 1)
const dynamic = source(a, 1)
Object.assign(dynamic.parts[0], { type: "dynamic-tool", toolName: "createMarkdownArtifact" })
assert.equal(bodyCount(await wire([dynamic, user(20, [a])]), a), 1)

// 缓存契约：新增引用和新增产物查找结果，不得反向改变历史模型消息的字节。
for (const history of [[source(a, 1), user(21, [])], [user(22, [a, a])]]) {
  const originalMap = history[0].role === "assistant" ? new Map() : artifacts
  const before = await wire(history, originalMap)
  const after = await wire([...history, user(23, [a, b])])
  assert.equal(JSON.stringify(after.slice(0, before.length)), JSON.stringify(before))
}
assert.deepEqual(await wire(repeated), await wire(repeated), "重试编译结果确定且无请求间状态泄漏")
console.log("PASS artifact context: self/fork/history dedup, complete source validation, fixed markers and byte-stable model prefix")
