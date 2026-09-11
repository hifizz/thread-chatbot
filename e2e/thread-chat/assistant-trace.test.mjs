import assert from "node:assert/strict"
import { assistantPartRenderPlan } from "../../app/thread-chat/branching/assistant/assistant-part-render-plan.ts"
import { researchQuestionForReasoning, researchQuestionForTrace, traceToolFromPart, traceSourceHref } from "../../lib/chat/assistant-trace.ts"
import { createWebResearchActivityDispatcher } from "../../lib/chat/web-research-activity.ts"
import { assistantMessagePresentation } from "../../app/thread-chat/chat/message/conversation-message-logic.ts"

const search = { type: "tool-webSearch", toolCallId: "search-1", state: "output-available", input: { query: "official docs" }, output: { query: "official docs", results: [{ title: "Docs", url: "https://example.com/docs", snippet: "text" }] } }
const reasoning = { type: "reasoning", text: "公开返回的思考", state: "done" }
const activity = { type: "data-research-activity", id: "research-activity:search-1", data: { toolCallId: "search-1", kind: "search", status: "complete", query: "official docs", sources: search.output.results } }
const message = { id: "assistant", parentMessageId: "user", role: "assistant", text: "结果", forks: [], status: "done" }
const parts = [reasoning, search, activity, { type: "step-start" }, { ...reasoning, text: "查阅后重新分析" }, { type: "tool-readUrl", toolCallId: "read-1", state: "output-available", input: { url: "https://example.com/docs" }, output: { url: "https://example.com/docs", content: "ok" } }, { type: "text", text: "结果", state: "done" }]
const plan = assistantPartRenderPlan({ ...message, uiParts: parts })
assert.deepEqual(plan.map(item => item.kind), ["trace", "text"])
assert.deepEqual(plan[0].items.map(item => item.part.type), ["reasoning", "tool-webSearch", "reasoning", "tool-readUrl"])
assert.equal(plan[0].items.filter(item => "toolCallId" in item.part).length, 2, "原生调用和派生事件不能双重渲染")
const between = assistantPartRenderPlan({ ...message, uiParts: [reasoning, { type: "text", text: "先说明检索方向" }, search, activity, reasoning, { type: "text", text: "最终答案" }] })
assert.deepEqual(between.map(item => item.kind), ["trace", "text", "trace", "text"], "工具前的正文保留原始位置")
assert.equal(between[2].items[0].part.toolCallId, "search-1")
assert.equal(assistantPartRenderPlan({ ...message, uiParts: [activity] })[0].items.length, 1, "兼容只有派生活动的历史消息")
assert.deepEqual(assistantPartRenderPlan(message).map(item => item.kind), ["text"])

for (const status of ["streaming", "stopped", "error", "done", undefined]) {
  const part = { ...search, state: "input-available", output: undefined }
  const tool = traceToolFromPart(part, status)
  const expected = status === "streaming" ? "running" : status === "stopped" ? "stopped" : status === "error" ? "error" : "incomplete"
  assert.equal(tool.phase, expected, "终态不能把尚未返回的工具当作成功")
}
assert.equal(traceToolFromPart({ ...search, state: "output-error", output: undefined, errorText: "internal secret" }, "done").phase, "error")
assert.equal(traceToolFromPart({ ...search, state: "output-denied", output: undefined }, "done").phase, "error")
assert.equal(traceToolFromPart(search, "stopped").phase, "complete", "已完成结果不因后续停止而丢失")
assert.equal(traceToolFromPart(search, "done").sources.length, 1)
assert.equal(traceSourceHref("javascript:alert(1)"), undefined)
assert.equal(traceSourceHref("data:text/html,test"), undefined)
assert.equal(traceSourceHref("https://example.com"), "https://example.com/")

const events = []
const dispatch = createWebResearchActivityDispatcher(event => events.push(event))
dispatch({ type: "tool-input-start", toolCallId: "failed", toolName: "webSearch" })
dispatch({ type: "tool-input-available", toolCallId: "failed", toolName: "webSearch", input: { query: "test query" } })
dispatch({ type: "tool-output-error", toolCallId: "failed", errorText: "private upstream error" })
assert.equal(events.at(-1).status, "error")
assert.equal(events.at(-1).query, "test query")
assert(!JSON.stringify(events).includes("private upstream error"))
dispatch({ type: "tool-input-available", toolCallId: "completed", toolName: "readUrl", input: { url: "https://example.com/done" } })
dispatch({ type: "tool-output-available", toolCallId: "completed", output: { content: "done" } })
dispatch({ type: "tool-input-available", toolCallId: "stopped", toolName: "readUrl", input: { url: "https://example.com/stop" } })
dispatch({ type: "abort" })
assert.equal(events.at(-1).status, "cancelled")
assert.equal(events.at(-1).toolCallId, "stopped")
assert.equal(events.filter(event => event.toolCallId === "completed").at(-1).status, "complete")
assert.equal(events.filter(event => event.toolCallId === "failed").at(-1).status, "error")

const planning = assistantMessagePresentation({ ...message, text: "", status: "streaming", uiParts: [{ type: "data-research-plan", data: { goal: "test" } }] })
assert.equal(planning.showBubble, true)
assert.equal(planning.isWaitingForVisibleOutput, false, "计划已到达时显示过程而非继续三个点")
const startingReasoning = assistantMessagePresentation({ ...message, text: "", status: "streaming", uiParts: [{ type: "reasoning", text: "", state: "streaming" }] })
assert.equal(startingReasoning.isWaitingForVisibleOutput, false)
console.log("PASS chronological assistant trace, terminal states, source URLs and early planning")

const researchPlan = { goal: "研究", subquestions: [
  { id: "q1", question: "工具返回后如何继续回答？", queries: ["AI SDK tool loop"] },
  { id: "q2", question: "如何控制循环何时停止？", queries: ["AI SDK stopWhen"] },
] }
assert.equal(researchQuestionForTrace(researchPlan, [{ ...search, input: { query: "AI SDK tool loop" } }]), researchPlan.subquestions[0].question)
assert.equal(researchQuestionForTrace(researchPlan, [{ ...search, input: { query: "new query", subquestionId: "q2" } }]), researchPlan.subquestions[1].question)
assert.equal(researchQuestionForTrace(researchPlan, [{ ...search, input: { query: "AI SDK tool loop", subquestionId: "not-in-plan" } }]), undefined, "未知 ID 不猜标题")
assert.equal(researchQuestionForTrace(researchPlan, [{ ...search, input: { query: "AI SDK tools" } }]), undefined, "仅语义相近不能冒充当前问题")
assert.equal(researchQuestionForTrace(undefined, [search]), undefined)
assert.equal(researchQuestionForTrace(researchPlan, [reasoning]), undefined)
assert.equal(researchQuestionForTrace(researchPlan, [
  { ...search, input: { subquestionId: "q1" } },
  { ...search, toolCallId: "latest", input: { subquestionId: "q2" } },
]), researchPlan.subquestions[1].question, "完成一项后可推进至下一子问题")
assert.equal(researchQuestionForTrace(researchPlan, [
  { ...search, state: "input-available", input: { subquestionId: "q1" } },
  { ...search, state: "input-available", toolCallId: "parallel", input: { subquestionId: "q2" } },
]), undefined, "并行处理不同问题时使用通用标题")
console.log("PASS research titles use existing subquestions only, with no inferred summaries")

assert.equal(assistantMessagePresentation({ ...message, status: "streaming", uiParts: [
  { type: "text", text: "我先检索", state: "done" },
  { ...search, state: "input-available" },
] }).showCaret, false, "调用工具时不冒充正文正在输出")
assert.equal(assistantMessagePresentation({ ...message, status: "streaming", uiParts: [
  search, { type: "text", text: "回答", state: "streaming" },
] }).showCaret, true)

const consecutiveQuestions = [
  reasoning,
  { ...search, input: { query: "test", subquestionId: "q1" } },
  reasoning,
  { ...search, toolCallId: "q2-search", input: { query: "test", subquestionId: "q2" } },
  reasoning,
]
assert.equal(researchQuestionForReasoning(researchPlan, consecutiveQuestions, 0), researchPlan.subquestions[0].question)
assert.equal(researchQuestionForReasoning(researchPlan, consecutiveQuestions, 2), researchPlan.subquestions[1].question)
assert.equal(researchQuestionForReasoning(researchPlan, consecutiveQuestions, 4), undefined, "没有明确关联的工具时不沿用前一段标题")
assert.equal(researchQuestionForReasoning(researchPlan, [reasoning, consecutiveQuestions[1], consecutiveQuestions[3]], 0), undefined, "一段涉及多个问题时不拼接标题")
console.log("PASS per-reasoning titles never inherit later or unrelated subquestions")
