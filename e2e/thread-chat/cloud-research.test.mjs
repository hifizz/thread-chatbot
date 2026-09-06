import assert from "node:assert/strict"
import { MockLanguageModelV3, convertArrayToReadableStream } from "ai/test"
import { prepareCloudResearch } from "../../lib/cloud-research/generation.ts"
import { parseCloudResearchRequest, requireCloudResearchConfig } from "../../lib/cloud-research/request.ts"
import { ResearchGitHub } from "../../lib/cloud-research/github.ts"
import { consumeUIMessagePipeline } from "../../lib/thread-chat/streaming/ui-message-pipeline.ts"
import { collectFinalArtifacts } from "../../lib/thread-chat/streaming/artifacts.ts"
import { resolveGenerationTerminalOutcome } from "../../lib/thread-chat/streaming/generation-outcome.ts"

assert.equal(parseCloudResearchRequest("普通聊天 github/hifizz/coding"), null)
assert.deepEqual(parseCloudResearchRequest("@ GitHub 看下 github/hifizz/coding\n/publish-pr"), { repository: "hifizz/coding", publish: true })
assert.equal(parseCloudResearchRequest("@GitHub https://github.com/hifizz/coding 调研 PR 功能").publish, false)
assert.throws(() => parseCloudResearchRequest("@GitHub github/a/a github/b/b"))
Object.assign(process.env, {
  CLOUD_RESEARCH_DEMO_ENABLED: "true",
  CLOUD_RESEARCH_DEMO_USER_ID: "demo-user",
  CLOUD_RESEARCH_DEMO_REPOSITORIES: "hifizz/coding",
  CLOUD_RESEARCH_GITHUB_TOKEN: "secret-github-test-token",
  E2B_API_KEY: "e2b_test-only",
})
assert.throws(() => requireCloudResearchConfig("other-user", "hifizz/coding"))
assert.throws(() => requireCloudResearchConfig("demo-user", "other/repo"))

const report = { title: "云任务调研", content: "# 云任务\n\n依据 README.md:1，建议增加任务执行器。" }
const usage = { inputTokens: { total: 10 }, outputTokens: { total: 10 } }
async function run({ publish = true, failPublish = false, abortDuringCreate = false, invalidUser = false, earlyStop = false } = {}) {
  const abort = new AbortController()
  let destroyed = 0, publications = 0, calls = 0
  const writes = []
  const model = new MockLanguageModelV3({
    doStream: async (options) => {
      calls++
      let name = options.toolChoice?.toolName
      if (!name && options.toolChoice?.type === "required") {
        name = calls <= 2 ? "inspectRepository" : "createMarkdownArtifact"
      }
      if (earlyStop && calls === 2) name = undefined
      const args = name === "inspectRepository" ? { mode: "read", path: "README.md", start: 1 } : name === "createMarkdownArtifact" ? report : {}
      const id = `call-${calls}`
      return { stream: convertArrayToReadableStream([
        { type: "stream-start", warnings: [] },
        ...(name ? [
          { type: "tool-input-start", id, toolName: name },
          { type: "tool-input-delta", id, delta: JSON.stringify(args) },
          { type: "tool-input-end", id },
          { type: "tool-call", toolCallId: id, toolName: name, input: JSON.stringify(args) },
        ] : [
          { type: "text-start", id },
          { type: "text-delta", id, delta: "报告已完成。" },
          { type: "text-end", id },
        ]),
        { type: "finish", finishReason: { unified: name ? "tool-calls" : "stop", raw: undefined }, usage },
      ]) }
    },
  })
  class FakeGitHub {
    async snapshot() { return { branch: "main", sha: "a".repeat(40) } }
    async archive() { return "archive-test" }
    async publish(value) {
      publications++
      assert.equal(value.content, report.content)
      assert.equal(value.sha, "a".repeat(40))
      if (failPublish) throw new Error("failure containing secret-github-test-token")
      return { url: "https://github.com/hifizz/coding/pull/1", number: 1 }
    }
  }
  const prepared = prepareCloudResearch({
    userId: invalidUser ? "other" : "demo-user", messageId: "test-message", latestUserText: "@GitHub github/hifizz/coding 调研云任务",
    abortSignal: abort.signal,
  }, { repository: "hifizz/coding", publish }, model, {
    GitHub: FakeGitHub,
    createSandbox: async () => {
      if (abortDuringCreate) abort.abort()
      return {
        filesystem: { writeFile: async (...args) => { writes.push(args) } },
        runCommand: async () => ({ exitCode: 0, stdout: JSON.stringify({ text: "1: demo repository", truncated: false }) }),
        destroy: async () => { destroyed++ },
      }
    },
  })
  let snapshot = { id: "test-message", role: "assistant", parts: [] }
  const chunks = []
  const end = await consumeUIMessagePipeline({
    ...prepared,
    initialMessage: snapshot,
    session: {
      signal: abort.signal,
      getSnapshot: () => snapshot,
      replaceSnapshot: (value) => { snapshot = value },
      publish: (chunk, value) => { chunks.push(chunk); snapshot = value },
    },
  })
  assert.equal(JSON.stringify(chunks).includes("secret-github-test-token"), false)
  assert.equal(JSON.stringify(writes).includes("secret-github-test-token"), false)
  assert.equal(destroyed, invalidUser ? 0 : 1)
  if (invalidUser || abortDuringCreate || earlyStop) {
    assert.equal(publications, 0)
    assert.notEqual(resolveGenerationTerminalOutcome({
      signal: abort.signal, pipelineAborted: end.isAborted,
      sdkOutcome: end.outcome, finishReason: end.finishReason,
      thrown: null, protocolError: null,
    }).status, "completed")
  } else {
    assert.equal(publications, publish ? 1 : 0)
    assert.equal(collectFinalArtifacts("test-message", snapshot.parts).length, 1)
    assert(chunks.some((p) => p.type === "tool-output-available" && p.preliminary === true))
    assert(chunks.some((p) => p.type === "data-artifact-progress"))
    if (failPublish) assert(snapshot.parts.some((p) => p.output?.status === "failed"))
    else assert.equal(end.outcome.status, "completed")
  }
  return { snapshot, chunks, end }
}
await run()
await run({ publish: false })
await run({ failPublish: true })
await run({ abortDuringCreate: true })
await run({ invalidUser: true })
await run({ earlyStop: true })

// 验证真正 REST 适配器的分支、固定文件路径、草稿标记与冻结 SHA。
const requests = []
const github = new ResearchGitHub("hifizz/coding", "private-test-token", new AbortController().signal, async (url, init) => {
  requests.push({ url, ...init, body: JSON.parse(init.body) })
  return Response.json(url.endsWith("/pulls") ? { html_url: "https://github.com/hifizz/coding/pull/1", number: 1 } : {})
})
await github.publish({ messageId: "test-message", base: "main", sha: "a".repeat(40), ...report })
assert.equal(requests[0].body.sha, "a".repeat(40))
assert.equal(requests[1].url, "https://api.github.com/repos/hifizz/coding/contents/docs/research/test-message.md")
assert.equal(Buffer.from(requests[1].body.content, "base64").toString(), report.content)
assert.equal(requests[2].body.draft, true)
assert.equal(requests[2].body.base, "main")
console.log("PASS 云调研：真实 SDK 多轮与消息流管线、报告提取、PR 请求、失败保留、停止回收、账号边界（外部服务模拟）")
