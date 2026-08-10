/**
 * Thread Chat Web Search 客户端边界：
 *   node --experimental-strip-types app/thread-chat/net/web-search-ui.test.mjs
 */
import assert from "node:assert/strict"
import { createThreadStore } from "../core/store.ts"
import { sanitizeLoadedState } from "./sanitize-loaded-state.ts"
import { withoutTransientGenerationState } from "./transient-state.ts"
import {
  createWebSearchEventDispatcher,
  isWebSearchMode,
} from "./web-search-stream.ts"
import { summarizeWebSearchActivities } from "./web-search-summary.ts"
import {
  compactSourceLabel,
  stripSourcePrefix,
} from "../../../lib/chat/source-label.ts"

function seed() {
  return {
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
        messages: [],
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 1,
    tick: 1,
  }
}

{
  assert.equal(
    compactSourceLabel(
      "IBM Think — What Is Loop Engineering?",
      "https://www.ibm.com/think/topics/loop-engineering"
    ),
    "IBM Think"
  )
  assert.equal(
    compactSourceLabel(
      "What is loop engineering and how are leading software engineering teams using it?",
      "https://www.ibm.com/think/topics/loop-engineering"
    ),
    "IBM"
  )
  assert.equal(stripSourcePrefix("来源："), "")
  assert.equal(stripSourcePrefix("信息源：[IBM Think]"), "[IBM Think]")
  assert.equal(stripSourcePrefix("正文中的来源分析"), "正文中的来源分析")
  console.log("PASS  长来源标题收敛为胶囊品牌短名")
}

{
  assert.equal(isWebSearchMode("auto"), true)
  assert.equal(isWebSearchMode("always"), true)
  assert.equal(isWebSearchMode("off"), true)
  assert.equal(isWebSearchMode("on"), false)
  console.log("PASS  客户端仅接受三态联网策略")
}

{
  const summary = summarizeWebSearchActivities([
    {
      toolCallId: "search-success-a",
      phase: "completed",
      query: "Loop Engineering 概念 是什么",
      durationMs: 2_900,
      sources: [
        {
          sourceId: "a",
          title: "Loop Engineering",
          url: "https://example.com/loop",
        },
      ],
    },
    {
      toolCallId: "search-rejected",
      phase: "failed",
      query: "Loop Engineering software development concept",
      durationMs: 0,
      error: "已达到本轮联网搜索上限",
    },
    {
      toolCallId: "search-success-b",
      phase: "completed",
      query: "Addy Osmani Loop Engineering AI agent",
      durationMs: 2_100,
      sources: [
        {
          sourceId: "a-again",
          title: "Loop Engineering duplicate",
          url: "https://example.com/loop",
        },
        {
          sourceId: "b",
          title: "Addy Osmani",
          url: "https://example.com/addy",
        },
      ],
    },
    {
      toolCallId: "search-invalid",
      phase: "failed",
      durationMs: 360,
      error: "搜索词无效，回答将不使用联网结果",
    },
  ])
  assert.equal(summary.phase, "completed")
  assert.equal(summary.queryCount, 2)
  assert.equal(summary.resultCount, 2)
  assert.equal(summary.sources.length, 2)
  assert.equal(summary.durationMs, 5_000)
  assert.equal(summary.internalCallCount, 4)
  assert.equal(summary.acceptedCallCount, 2)
  assert.equal(summary.error, undefined)
  console.log("PASS  成功搜索优先聚合，忽略冗余失败并按 URL 去重来源")
}

{
  const summary = summarizeWebSearchActivities([
    {
      toolCallId: "search-failed-only",
      phase: "failed",
      query: "broken query",
      durationMs: 10,
      error: "联网搜索超时，回答将基于已有知识继续",
    },
  ])
  assert.equal(summary.phase, "failed")
  assert.equal(summary.error, "联网搜索超时，回答将基于已有知识继续")
  console.log("PASS  只有失败调用时仍保留单一失败状态")
}

{
  let clock = 1_000
  const events = []
  const dispatch = createWebSearchEventDispatcher(
    (event) => events.push(event.activity),
    () => clock
  )
  assert.equal(
    dispatch({
      type: "tool-input-start",
      toolCallId: "search-1",
      toolName: "webSearch",
    }),
    true
  )
  clock += 5
  assert.equal(
    dispatch({
      type: "tool-input-available",
      toolCallId: "search-1",
      toolName: "webSearch",
      input: { query: " Next.js 16 current docs " },
    }),
    true
  )
  clock += 95
  assert.equal(
    dispatch({
      type: "tool-output-available",
      toolCallId: "search-1",
      output: {
        ok: true,
        query: "Next.js 16 current docs",
        latencyMs: 87.6,
        results: [
          {
            sourceId: "s1",
            title: "Next.js Docs",
            url: "https://nextjs.org/docs",
            snippet: "unused in UI",
          },
          {
            sourceId: "bad",
            title: "unsafe",
            url: "javascript:alert(1)",
          },
        ],
        providerPayload: { secret: "must-not-leak" },
      },
    }),
    true
  )
  assert.deepEqual(events.map((event) => event.phase), [
    "starting",
    "searching",
    "completed",
  ])
  assert.equal(events.at(-1).resultCount, 1)
  assert.equal(events.at(-1).durationMs, 88)
  assert.equal(events.at(-1).sources[0].url, "https://nextjs.org/docs")
  assert.equal(JSON.stringify(events).includes("secret"), false)
  console.log("PASS  搜索生命周期仅展示白名单字段并过滤危险 URL")
}

{
  const events = []
  const dispatch = createWebSearchEventDispatcher((event) =>
    events.push(event.activity)
  )
  assert.equal(dispatch({ type: "tool-output-available" }), false)
  assert.equal(
    dispatch({
      type: "tool-input-start",
      toolCallId: "search-2",
      toolName: "unknown",
    }),
    false
  )
  dispatch({
    type: "tool-input-start",
    toolCallId: "search-3",
    toolName: "webSearch",
  })
  dispatch({
    type: "tool-output-available",
    toolCallId: "search-3",
    output: { success: false, error: "budget_exhausted" },
  })
  assert.equal(events.at(-1).phase, "failed")
  assert.equal(events.at(-1).error, "已达到本轮联网搜索上限")
  dispatch({
    type: "tool-input-start",
    toolCallId: "search-4",
    toolName: "webSearch",
  })
  assert.equal(dispatch({ type: "finish" }), false)
  assert.equal(events.at(-1).phase, "failed")
  console.log("PASS  未知事件忽略且结构化失败不暴露 provider 错误")
}

{
  const store = createThreadStore(seed())
  const messageId = store.beginAssistantMessage("main")
  store.appendAssistantDelta("main", messageId, "已输出的正文。")
  store.setWebSearchActivity("main", messageId, {
    toolCallId: "search-5",
    phase: "completed",
    query: "React 19 release notes",
    resultCount: 1,
    durationMs: 100,
    sources: [
      {
        sourceId: "s1",
        title: "React",
        url: "https://react.dev/blog/2024/12/05/react-19",
      },
    ],
  })
  const live = store.getState().threads.main.messages[0]
  assert.equal(live.webSearchActivities.length, 1)
  assert.equal(live.webSearchActivityTextOffset, "已输出的正文。".length)
  store.finishAssistantMessage("main", messageId)
  const persisted = withoutTransientGenerationState(store.getState())
  assert.equal(
    persisted.threads.main.messages[0].webSearchActivities[0].phase,
    "completed"
  )
  assert.equal(
    persisted.threads.main.messages[0].webSearchActivityTextOffset,
    "已输出的正文。".length
  )
  const reloaded = sanitizeLoadedState(
    JSON.parse(JSON.stringify(persisted)),
    (modelId) => modelId
  )
  assert.equal(
    reloaded.threads.main.messages[0].webSearchActivities[0].query,
    "React 19 release notes"
  )
  assert.equal(
    reloaded.threads.main.messages[0].webSearchActivityTextOffset,
    "已输出的正文。".length
  )
  store.resetAssistantMessage("main", messageId)
  assert.equal(live.webSearchActivities, undefined)
  assert.equal(live.webSearchActivityTextOffset, undefined)
  console.log("PASS  搜索终态和流顺序位置刷新后保留，retry 清空旧状态")
}

{
  const state = seed()
  state.threads.main.messages.push({
    id: "streaming-search",
    role: "assistant",
    text: "部分正文",
    forks: [],
    status: "streaming",
    webSearchActivities: [
      {
        toolCallId: "search-finished",
        phase: "completed",
        query: "finished query",
        resultCount: 1,
      },
      {
        toolCallId: "search-running",
        phase: "searching",
        query: "running query",
      },
    ],
    webSearchActivityTextOffset: 999,
  })
  const persisted = withoutTransientGenerationState(state)
  const message = persisted.threads.main.messages[0]
  assert.equal(message.webSearchActivities.length, 1)
  assert.equal(message.webSearchActivities[0].toolCallId, "search-finished")
  assert.equal(message.webSearchActivityTextOffset, "部分正文".length)
  console.log("PASS  存盘剔除进行中搜索并校正聚合卡正文位置")
}
