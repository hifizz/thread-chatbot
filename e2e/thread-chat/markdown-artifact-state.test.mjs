import assert from "node:assert/strict"
import { createThreadStore } from "../../app/thread-chat/core/store.ts"
import { hasAssistantOutput } from "../../app/thread-chat/net/assistant-output.ts"
import { serializeMessageForModel } from "../../app/thread-chat/net/message-serialization.ts"
import { sanitizeLoadedState } from "../../app/thread-chat/net/sanitize-loaded-state.ts"
import { withoutTransientGenerationState } from "../../app/thread-chat/net/transient-state.ts"
import {
  createMarkdownArtifactEventDispatcher,
  createMarkdownArtifactProgressDispatcher,
} from "../../lib/chat/markdown-artifact.ts"

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`PASS  ${name}`))
}

function seed() {
  return {
    threads: {
      main: {
        id: "main",
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages: [],
        lastActive: 0,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 1,
    tick: 0,
  }
}

await test("store 原子绑定与无效目标零写入", () => {
  const store = createThreadStore(seed())
  const before = store.getState().seq
  assert.equal(
    store.attachArtifactToMessage("missing", "missing", {
      kind: "markdown",
      title: "坏目标",
      content: "x",
    }),
    null
  )
  assert.equal(store.getState().seq, before)
  assert.deepEqual(store.getState().artifactOrder, [])

  const messageId = store.beginAssistantMessage("main")
  assert.ok(messageId)
  const artifactId = store.attachArtifactToMessage("main", messageId, {
    kind: "markdown",
    title: "发布说明",
    content: "# v1",
  })
  assert.ok(artifactId)
  const state = store.getState()
  assert.deepEqual(state.artifactOrder, [artifactId])
  assert.deepEqual(state.threads.main.messages[0].artifactIds, [artifactId])
  assert.equal(state.artifacts[artifactId].sourceThreadId, "main")
  assert.equal(state.threads.main.messages[0].status, "streaming")
})

await test("Markdown 临时进度不持久化且完整 Artifact 原子替换", () => {
  const store = createThreadStore(seed())
  const messageId = store.beginAssistantMessage("main")
  assert.ok(messageId)
  store.setMarkdownGenerationProgress("main", messageId, {
    toolCallId: "call-progress",
    phase: "streaming",
    partialTitle: "项目总结",
    characterCount: 18,
    lineCount: 3,
    headings: ["概览"],
  })

  const liveMessage = store.getState().threads.main.messages[0]
  assert.equal(liveMessage.status, "streaming")
  assert.equal(liveMessage.markdownGeneration?.characterCount, 18)

  const persisted = withoutTransientGenerationState(store.getState())
  assert.equal(persisted.threads.main.messages[0].markdownGeneration, undefined)
  assert.equal(liveMessage.markdownGeneration?.partialTitle, "项目总结")

  store.attachArtifactToMessage("main", messageId, {
    kind: "markdown",
    title: "项目总结",
    content: "# 概览",
  })
  assert.equal(liveMessage.markdownGeneration, undefined)
  assert.equal(liveMessage.artifactIds?.length, 1)
})

await test("流分派依次发出 start、局部真实进度和完整 Artifact", async () => {
  const chunks = [
    {
      type: "tool-input-start",
      toolCallId: "call-stream",
      toolName: "createMarkdownArtifact",
    },
    {
      type: "tool-input-delta",
      toolCallId: "call-stream",
      inputTextDelta: '{"title":"项目总结","content":"# 概览\\n\\n',
    },
    {
      type: "tool-input-delta",
      toolCallId: "call-stream",
      inputTextDelta: '## 风险\\n说明"}',
    },
    {
      type: "tool-input-available",
      toolCallId: "call-stream",
      toolName: "createMarkdownArtifact",
      input: {
        title: "项目总结",
        content: "# 概览\n\n## 风险\n说明",
      },
    },
    { type: "finish" },
  ]
  const progressEvents = []
  const artifacts = []
  const dispatchProgress = createMarkdownArtifactProgressDispatcher((event) =>
    progressEvents.push(event)
  )
  const dispatchArtifact = createMarkdownArtifactEventDispatcher((event) =>
    artifacts.push(event)
  )
  for (const chunk of chunks) {
    const handledAsProgress = await dispatchProgress(chunk)
    if (!handledAsProgress) dispatchArtifact(chunk)
  }

  assert.equal(progressEvents[0].phase, "starting")
  assert.equal(progressEvents.at(-1).partialTitle, "项目总结")
  assert.equal(progressEvents.at(-1).lineCount, 4)
  assert.deepEqual(progressEvents.at(-1).headings, ["概览", "风险"])
  assert.equal(artifacts.length, 1)
})

await test("retry 清除旧 Markdown registry、order 与消息关联", () => {
  const store = createThreadStore(seed())
  const messageId = store.beginAssistantMessage("main")
  const artifactId = store.attachArtifactToMessage("main", messageId, {
    kind: "markdown",
    title: "旧版",
    content: "old",
  })
  assert.ok(messageId && artifactId)
  store.resetAssistantMessage("main", messageId)
  const state = store.getState()
  assert.equal(state.artifacts[artifactId], undefined)
  assert.deepEqual(state.artifactOrder, [])
  assert.equal(state.threads.main.messages[0].artifactIds, undefined)
  assert.equal(state.threads.main.messages[0].status, "pending")
})

await test("Artifact-only 计为有效终态输出", () => {
  assert.equal(
    hasAssistantOutput({ receivedTextChars: 0, attachedArtifactCount: 1 }),
    true
  )
  assert.equal(
    hasAssistantOutput({ receivedTextChars: 0, attachedArtifactCount: 0 }),
    false
  )
})

await test("UI stream 分派只转发合法 Markdown complete event 并按 call id 去重", () => {
  const valid = {
    type: "tool-input-available",
    toolCallId: "call-1",
    toolName: "createMarkdownArtifact",
    input: { title: "总结", content: "# 总结" },
  }
  const artifacts = []
  const dispatch = createMarkdownArtifactEventDispatcher((event) =>
    artifacts.push(event)
  )
  assert.equal(dispatch(valid), true)
  assert.equal(dispatch(valid), true)
  assert.equal(
    dispatch({ ...valid, toolCallId: "call-2", toolName: "unknown" }),
    false
  )
  assert.equal(
    dispatch({
      ...valid,
      toolCallId: "call-3",
      input: { title: "总结", content: "" },
    }),
    false
  )
  assert.equal(dispatch({ type: "text-delta", delta: "完成" }), false)
  assert.equal(artifacts.length, 1)
  assert.equal(artifacts[0].toolCallId, "call-1")
})

await test("sanitize 恢复 Artifact-only 中断消息并清理坏引用和孤儿", () => {
  const state = seed()
  state.artifacts = {
    keep: {
      id: "keep",
      kind: "markdown",
      title: "保留",
      content: "# 保留",
      sourceThreadId: "main",
    },
    orphan: {
      id: "orphan",
      kind: "markdown",
      title: "孤儿",
      content: "# 孤儿",
      sourceThreadId: "main",
    },
  }
  state.artifactOrder = ["orphan", "missing"]
  state.threads.main.messages = [
    {
      id: "m1",
      role: "assistant",
      text: "",
      forks: [],
      artifactIds: ["keep", "missing", "keep"],
      status: "streaming",
    },
    {
      id: "m2",
      role: "assistant",
      text: "",
      forks: [],
      status: "pending",
    },
  ]

  const clean = sanitizeLoadedState(state)
  assert.equal(clean.threads.main.messages.length, 1)
  assert.equal(clean.threads.main.messages[0].status, "done")
  assert.deepEqual(clean.threads.main.messages[0].artifactIds, ["keep"])
  assert.deepEqual(Object.keys(clean.artifacts), ["keep"])
  assert.deepEqual(clean.artifactOrder, ["keep"])
})

await test("sanitize 防御性清理旧快照中的 Markdown 临时进度", () => {
  const state = seed()
  state.threads.main.messages = [
    {
      id: "m-progress",
      role: "assistant",
      text: "已有正文",
      forks: [],
      status: "streaming",
      markdownGeneration: {
        toolCallId: "stale",
        phase: "streaming",
        characterCount: 12,
        lineCount: 2,
        headings: [],
      },
    },
  ]
  const clean = sanitizeLoadedState(state)
  assert.equal(clean.threads.main.messages[0].status, "done")
  assert.equal(clean.threads.main.messages[0].markdownGeneration, undefined)
})

await test("Artifact-only 上下文回放标题与原始 Markdown", () => {
  const state = seed()
  state.artifacts.a1 = {
    id: "a1",
    kind: "markdown",
    title: "项目总结",
    content: "# 项目总结\n\n- 完成 A",
    sourceThreadId: "main",
  }
  const message = {
    id: "m1",
    role: "assistant",
    text: "",
    forks: [],
    artifactIds: ["a1"],
    status: "done",
  }
  const serialized = serializeMessageForModel(state, message)
  assert.match(serialized, /\[Markdown Artifact: 项目总结\]/)
  assert.match(serialized, /# 项目总结/)
  assert.match(serialized, /\[\/Markdown Artifact\]/)
})
