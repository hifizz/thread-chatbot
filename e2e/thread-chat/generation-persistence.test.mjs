/**
 * Generation 结构化投影、CAS 合并与加载清理的纯函数回归测试：
 *   node --experimental-strip-types e2e/thread-chat/generation-persistence.test.mjs
 */
import assert from "node:assert/strict"
import {
  generationArtifactId,
  projectGenerationResult,
} from "../../app/thread-chat/generation/project-result.ts"
import { mergeGenerationResult } from "../../app/thread-chat/generation/merge-result.ts"
import { sanitizeLoadedState } from "../../app/thread-chat/net/persistence/sanitize-loaded-state.ts"
import { GENERATION_RESULT_VERSION } from "../../constants/generation.ts"

async function test(name, fn) {
  await fn()
  console.log(`PASS  ${name}`)
}

function seed(messages = []) {
  return {
    schemaVersion: 2,
    threads: {
      main: {
        id: "main",
        modelId: "glm-5.2",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages,
        activeLeafMessageId: messages.at(-1)?.id ?? null,
        lastActive: 0,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 3,
    tick: 0,
  }
}

const userMessage = {
  id: "m1",
  parentMessageId: null,
  role: "user",
  text: "生成报告",
  forks: [],
}
const assistantMessage = {
  id: "m2",
  parentMessageId: "m1",
  role: "assistant",
  text: "",
  forks: [],
  generationId: "gen-1",
  status: "pending",
}
const snapshot = {
  threadId: "main",
  assistantMessageIndex: 1,
  userMessage,
  assistantMessage,
}

await test("正文、Markdown、联网来源和研究上下文投影", () => {
  const route = {
    mode: "research",
    reasonCode: "multi_source_research",
    urls: [],
    suggestedQueries: ["可靠软件"],
  }
  const plan = {
    goal: "可靠软件调研",
    subquestions: [
      {
        id: "q1",
        question: "如何设计？",
        queries: ["reliable software"],
        preferredSourceTypes: ["official"],
        requiresPageFetch: true,
      },
    ],
    exitCriteria: {
      minimumIndependentSources: 2,
      requirePrimarySources: true,
      freshnessRequired: false,
    },
  }
  const projected = projectGenerationResult({
    generationId: "gen-1",
    threadId: "main",
    assistantMessageId: "m2",
    terminalStatus: "completed",
    responseMessage: {
      parts: [
        { type: "text", text: "最终正文" },
        {
          type: "tool-createMarkdownArtifact",
          toolCallId: "call-md",
          state: "output-available",
          input: { title: "报告", content: "# 报告" },
          output: { created: true },
        },
        {
          type: "tool-webSearch",
          toolCallId: "call-web",
          state: "output-available",
          input: { query: "可靠软件" },
          output: {
            results: [{ title: "Primary", url: "https://example.com/primary" }],
          },
        },
        { type: "data-research-route", data: route },
        { type: "data-research-plan", data: plan },
      ],
    },
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  })
  assert.equal(projected.hasDisplayableOutput, true)
  assert.equal(projected.result.version, GENERATION_RESULT_VERSION)
  assert.equal(projected.result.text, "最终正文")
  assert.equal(projected.result.status, "done")
  assert.equal(projected.result.artifactIds.length, 1)
  assert.equal(
    projected.result.artifacts[projected.result.artifactIds[0]].content,
    "# 报告"
  )
  assert.equal(projected.result.webResearch[0].sources.length, 1)
  assert.deepEqual(projected.result.researchRoute, route)
  assert.deepEqual(projected.result.researchPlan, plan)
  assert.equal(projected.result.usage.totalTokens, 30)
})

await test("确定性 Artifact id 与重复投影幂等", () => {
  assert.equal(
    generationArtifactId("gen-1", "call-md"),
    generationArtifactId("gen-1", "call-md")
  )
  assert.notEqual(
    generationArtifactId("gen-1", "call-md"),
    generationArtifactId("gen-2", "call-md")
  )
})

await test("partial error 保留正文，空完成回复收敛可重试错误", () => {
  const partial = projectGenerationResult({
    generationId: "gen-1",
    threadId: "main",
    assistantMessageId: "m2",
    terminalStatus: "failed",
    error: "provider failed",
    responseMessage: { parts: [{ type: "text", text: "半截正文" }] },
  })
  assert.equal(partial.result.text, "半截正文")
  assert.equal(partial.result.status, "error")
  assert.equal(partial.result.error, "provider failed")

  const empty = projectGenerationResult({
    generationId: "gen-empty",
    threadId: "main",
    assistantMessageId: "m-empty",
    terminalStatus: "completed",
    responseMessage: { parts: [] },
  })
  assert.equal(empty.hasDisplayableOutput, false)
  assert.equal(empty.result.status, "error")
  assert.ok(empty.result.error)
})

await test("合并保留 forks、清旧 Artifact 且 patch 重放不重复", () => {
  const state = seed([
    userMessage,
    {
      ...assistantMessage,
      text: "旧正文",
      forks: [{ text: "锚点", num: 1, threadId: "b1", depth: 1 }],
      artifactIds: ["old"],
    },
  ])
  state.artifacts.old = {
    id: "old",
    title: "旧产物",
    kind: "markdown",
    content: "old",
    sourceThreadId: "main",
    sourceMessageId: "m2",
  }
  state.artifactOrder = ["old"]
  const id = generationArtifactId("gen-1", "call-md")
  const result = {
    version: 1,
    generationId: "gen-1",
    text: "最终正文",
    status: "done",
    artifactIds: [id],
    artifacts: {
      [id]: {
        id,
        title: "新产物",
        kind: "markdown",
        content: "new",
        sourceThreadId: "main",
        sourceMessageId: "m2",
      },
    },
  }
  const once = mergeGenerationResult(state, {
    threadId: "main",
    assistantMessageId: "m2",
    generationId: "gen-1",
    turnSnapshot: snapshot,
    result,
  })
  const twice = mergeGenerationResult(once, {
    threadId: "main",
    assistantMessageId: "m2",
    generationId: "gen-1",
    turnSnapshot: snapshot,
    result,
  })
  assert.equal(once.threads.main.messages[1].forks.length, 1)
  assert.equal(once.artifacts.old, undefined)
  assert.deepEqual(once.artifactOrder, [id])
  assert.deepEqual(twice, once)
})

await test("目标消息缺失时读修复，旧 attempt 不覆盖新 attempt", () => {
  const result = {
    version: 1,
    generationId: "gen-1",
    text: "已恢复",
    status: "done",
    artifactIds: [],
    artifacts: {},
  }
  const repaired = mergeGenerationResult(seed([userMessage]), {
    threadId: "main",
    assistantMessageId: "m2",
    generationId: "gen-1",
    turnSnapshot: snapshot,
    result,
  })
  assert.equal(repaired.threads.main.messages[1].text, "已恢复")

  const newer = seed([
    userMessage,
    { ...assistantMessage, generationId: "gen-2", text: "新 attempt" },
  ])
  assert.equal(
    mergeGenerationResult(newer, {
      threadId: "main",
      assistantMessageId: "m2",
      generationId: "gen-1",
      turnSnapshot: snapshot,
      result,
    }),
    newer
  )
})

await test("sanitize 保留 pending identity，无 generation 时转可重试错误", () => {
  const state = seed([userMessage, assistantMessage])
  const active = sanitizeLoadedState(state, (id) => id ?? "glm-5.2", [
    {
      id: "gen-1",
      threadId: "main",
      assistantMessageId: "m2",
      status: "running",
    },
  ])
  assert.equal(active.threads.main.messages.length, 2)
  assert.equal(active.threads.main.messages[1].status, "pending")

  const stale = sanitizeLoadedState(state, (id) => id ?? "glm-5.2")
  assert.equal(stale.threads.main.messages.length, 2)
  assert.equal(stale.threads.main.messages[1].status, "error")
})
