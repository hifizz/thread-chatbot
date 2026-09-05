import assert from "node:assert/strict"
import { MockLanguageModelV3 } from "ai/test"
import {
  createResearchPlan,
  contextualUrlFollowUpRoute,
  deterministicResearchRoute,
  reasoningForResearchRoute,
  resolveResearchRoute,
} from "../../lib/chat/research-router.ts"
import { GENERATION_CANCEL_REASONS } from "../../constants/generation.ts"
import { abortGeneration } from "../../lib/ai/generation-cancellation.ts"

const recent = [
  "user: 看看 https://example.com/release-notes",
  "assistant: 你想了解哪一部分？",
  "user: 总结这个链接",
].join("\n")

assert.deepEqual(contextualUrlFollowUpRoute("总结这个链接", recent), {
  mode: "fetch",
  reasonCode: "explicit_url",
  urls: ["https://example.com/release-notes"],
  suggestedQueries: [],
})
assert.deepEqual(
  contextualUrlFollowUpRoute("Summarize the previous page", recent)?.mode,
  "fetch"
)
assert.equal(contextualUrlFollowUpRoute("总结这段文字", recent), null)
assert.equal(
  contextualUrlFollowUpRoute("不要联网，总结这个链接", recent),
  null
)
assert.equal(deterministicResearchRoute("总结这段文字")?.mode, "answer")
assert.equal(reasoningForResearchRoute("search"), "medium")
assert.equal(reasoningForResearchRoute("fetch"), "medium")
assert.equal(reasoningForResearchRoute("answer"), "provider-default")
assert.equal(reasoningForResearchRoute("research"), "high")

let releaseModelCall
const modelCallStarted = new Promise((resolve) => {
  releaseModelCall = resolve
})
const routerAbortController = new AbortController()
const cancelledModel = new MockLanguageModelV3({
  doGenerate: async () => {
    releaseModelCall()
    return new Promise((_resolve, reject) => {
      routerAbortController.signal.addEventListener(
        "abort",
        () => reject(routerAbortController.signal.reason),
        { once: true }
      )
    })
  },
})
const cancelledRoute = resolveResearchRoute({
  model: cancelledModel,
  latestUserText: "请帮我分析这个问题",
  recentConversation: "",
  searchReady: true,
  abortSignal: routerAbortController.signal,
})
await modelCallStarted
abortGeneration(
  routerAbortController,
  GENERATION_CANCEL_REASONS.userStop
)
await assert.rejects(
  cancelledRoute,
  (error) => error?.name === "AbortError",
  "研究路由取消不得降级为直接回答"
)
assert.equal(cancelledModel.doGenerateCalls.length, 1)

const plannerAbortController = new AbortController()
abortGeneration(
  plannerAbortController,
  GENERATION_CANCEL_REASONS.userStop
)
await assert.rejects(
  createResearchPlan({
    model: cancelledModel,
    userRequest: "研究目标",
    route: {
      mode: "research",
      reasonCode: "multi_source_research",
      urls: [],
      suggestedQueries: ["query"],
    },
    abortSignal: plannerAbortController.signal,
  }),
  (error) => error?.name === "AbortError",
  "已经取消时不得启动研究计划模型调用"
)
assert.equal(cancelledModel.doGenerateCalls.length, 1)

console.log(
  "PASS  research routing preserves URL behavior, reasoning, and cancellation"
)
