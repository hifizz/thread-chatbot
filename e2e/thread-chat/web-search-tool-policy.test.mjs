import assert from "node:assert/strict"
import test from "node:test"

import { buildThreadChatStepPolicy } from "../../lib/chat/thread-chat-tool-policy.ts"

const WEB_SEARCH_TOOL_NAME = "webSearch"

const base = {
  stepNumber: 0,
  searchMode: "auto",
  searchEnabled: true,
  searchBudgetRemaining: 2,
  forceMarkdownArtifact: false,
  calledToolNames: [],
  markdownArtifactToolName: "createMarkdownArtifact",
  webSearchToolName: WEB_SEARCH_TOOL_NAME,
}

test("off 和耗尽预算时不暴露搜索工具", () => {
  for (const patch of [
    { searchMode: "off" },
    { searchBudgetRemaining: 0 },
    { searchEnabled: false },
  ]) {
    const policy = buildThreadChatStepPolicy({ ...base, ...patch })
    assert.ok(!policy.activeTools.includes(WEB_SEARCH_TOOL_NAME))
  }
})

test("always 只在第 0 步强制搜索", () => {
  const first = buildThreadChatStepPolicy({ ...base, searchMode: "always" })
  assert.deepEqual(first.activeTools, [WEB_SEARCH_TOOL_NAME])
  assert.deepEqual(first.toolChoice, {
    type: "tool",
    toolName: WEB_SEARCH_TOOL_NAME,
  })

  const later = buildThreadChatStepPolicy({
    ...base,
    stepNumber: 1,
    searchMode: "always",
    calledToolNames: [WEB_SEARCH_TOOL_NAME],
  })
  assert.equal(later.toolChoice, "auto")
})

test("已用过搜索工具后保留其 schema，重复调用降级为结构化预算结果", () => {
  const exhausted = buildThreadChatStepPolicy({
    ...base,
    stepNumber: 2,
    searchEnabled: false,
    searchBudgetRemaining: 0,
    calledToolNames: [WEB_SEARCH_TOOL_NAME],
  })
  assert.ok(exhausted.activeTools.includes(WEB_SEARCH_TOOL_NAME))
  assert.equal(exhausted.toolChoice, "auto")

  const off = buildThreadChatStepPolicy({
    ...base,
    searchMode: "off",
    searchEnabled: false,
    searchBudgetRemaining: 0,
    calledToolNames: [WEB_SEARCH_TOOL_NAME],
  })
  assert.ok(!off.activeTools.includes(WEB_SEARCH_TOOL_NAME))
})

test("当前 Markdown 交付可先搜索再强制 Artifact", () => {
  const first = buildThreadChatStepPolicy({
    ...base,
    forceMarkdownArtifact: true,
  })
  assert.deepEqual(first.activeTools, [
    WEB_SEARCH_TOOL_NAME,
    "createMarkdownArtifact",
  ])
  assert.equal(first.toolChoice, "required")

  const afterSearch = buildThreadChatStepPolicy({
    ...base,
    stepNumber: 1,
    forceMarkdownArtifact: true,
    calledToolNames: [WEB_SEARCH_TOOL_NAME],
  })
  assert.deepEqual(afterSearch.toolChoice, {
    type: "tool",
    toolName: "createMarkdownArtifact",
  })
})
