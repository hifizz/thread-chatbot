import assert from "node:assert/strict"
import { consumeUIMessagePipeline } from "../../lib/thread-chat/streaming/ui-message-pipeline.ts"
import { initialAssistantSnapshot } from "../../lib/thread-chat/streaming/stream-session.ts"

function streamOf(parts) {
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

function fakeSession(initial) {
  let snapshot = structuredClone(initial)
  const published = []
  const abortController = new AbortController()
  return {
    published,
    session: {
      messageId: initial.id,
      signal: abortController.signal,
      getSnapshot: () => structuredClone(snapshot),
      replaceSnapshot: (next) => {
        snapshot = structuredClone(next)
      },
      publish: (chunk, next) => {
        snapshot = structuredClone(next)
        published.push({ chunk: structuredClone(chunk), snapshot })
      },
      finish: () => {},
    },
    getSnapshot: () => snapshot,
  }
}

const initial = initialAssistantSnapshot({
  messageId: "assistant-pipeline",
  threadId: "thread-pipeline",
  modelId: "test/model",
})
const controlled = fakeSession(initial)
const progress = {
  type: "data-artifact-progress",
  id: "artifact-progress",
  transient: true,
  data: {
    toolCallId: "tool-1",
    phase: "streaming",
    characterCount: 12,
    lineCount: 2,
    headings: [],
  },
}
const route = {
  type: "data-research-route",
  id: "research-route",
  data: {
    mode: "search",
    reasonCode: "explicit_search",
    urls: [],
    suggestedQueries: ["AI SDK v7"],
  },
}
const end = await consumeUIMessagePipeline({
  initialMessage: initial,
  session: controlled.session,
  leadingChunks: [route, progress],
  textStream: streamOf([
    { type: "start" },
    { type: "start-step", request: {}, warnings: [] },
    { type: "reasoning-start", id: "reasoning-1" },
    { type: "reasoning-delta", id: "reasoning-1", text: "think" },
    { type: "reasoning-end", id: "reasoning-1" },
    {
      type: "source",
      sourceType: "url",
      id: "source-1",
      url: "https://example.com/source",
      title: "Source",
    },
    {
      type: "file",
      file: { mediaType: "text/plain", base64: "aGVsbG8=" },
    },
    {
      type: "tool-input-start",
      id: "tool-1",
      toolName: "createMarkdownArtifact",
    },
    {
      type: "tool-input-delta",
      id: "tool-1",
      delta: '{"title":"Doc","content":"# Done"}',
    },
    {
      type: "tool-call",
      toolCallId: "tool-1",
      toolName: "createMarkdownArtifact",
      input: { title: "Doc", content: "# Done" },
    },
    {
      type: "tool-result",
      toolCallId: "tool-1",
      toolName: "createMarkdownArtifact",
      input: { title: "Doc", content: "# Done" },
      output: { created: true, artifactId: "artifact-1" },
    },
    { type: "text-start", id: "text-1" },
    { type: "text-delta", id: "text-1", text: "answer" },
    { type: "text-end", id: "text-1" },
    {
      type: "finish-step",
      response: {},
      usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
      performance: {},
      finishReason: "stop",
      rawFinishReason: "stop",
      providerMetadata: undefined,
    },
    {
      type: "finish",
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
    },
  ]),
})

const final = controlled.getSnapshot()
assert.equal(end.isAborted, false)
assert.equal(end.finishReason, "stop")
assert.equal(final.id, initial.id, "响应 Message ID 必须固定")
assert(final.parts.some((part) => part.type === "reasoning"))
assert(final.parts.some((part) => part.type === "source-url"))
assert(final.parts.some((part) => part.type === "file"))
assert(final.parts.some((part) => part.type === "tool-createMarkdownArtifact"))
assert(final.parts.some((part) => part.type === "data-research-route"))
assert(!final.parts.some((part) => part.type === "data-artifact-progress"))
assert(final.parts.some((part) => part.type === "text" && part.text === "answer"))

const progressEvent = controlled.published.find(
  ({ chunk }) => chunk.type === "data-artifact-progress"
)
assert(progressEvent.snapshot.parts.some((part) => part.type === "data-artifact-progress"))
for (const event of controlled.published) {
  if (event.chunk.type === "text-delta") {
    assert(
      event.snapshot.parts.some(
        (part) => part.type === "text" && part.text.includes(event.chunk.delta)
      ),
      "每个 chunk 广播前 snapshot 必须已经吸收该 chunk"
    )
  }
}

const artifactOnly = fakeSession({ ...initial, id: "artifact-only" })
await consumeUIMessagePipeline({
  initialMessage: { ...initial, id: "artifact-only" },
  session: artifactOnly.session,
  textStream: streamOf([
    { type: "start" },
    {
      type: "tool-call",
      toolCallId: "artifact-tool",
      toolName: "createMarkdownArtifact",
      input: { title: "Only", content: "Artifact" },
    },
    {
      type: "tool-result",
      toolCallId: "artifact-tool",
      toolName: "createMarkdownArtifact",
      input: { title: "Only", content: "Artifact" },
      output: { created: true, artifactId: "artifact-only-id" },
    },
    {
      type: "finish",
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
  ]),
})
assert.equal(
  artifactOnly
    .getSnapshot()
    .parts.filter((part) => part.type === "tool-createMarkdownArtifact").length,
  1,
  "Artifact-only 回复必须保留 tool part"
)

const aborted = fakeSession({ ...initial, id: "aborted" })
const abortEnd = await consumeUIMessagePipeline({
  initialMessage: { ...initial, id: "aborted" },
  session: aborted.session,
  textStream: streamOf([
    { type: "start" },
    { type: "text-start", id: "abort-text" },
    { type: "text-delta", id: "abort-text", text: "partial" },
    { type: "abort", reason: "user-stop" },
  ]),
})
assert.equal(abortEnd.isAborted, true)
assert(
  aborted
    .getSnapshot()
    .parts.some((part) => part.type === "text" && part.text === "partial")
)

const partialError = fakeSession({ ...initial, id: "partial-error" })
const protocolErrors = []
const errorEnd = await consumeUIMessagePipeline({
  initialMessage: { ...initial, id: "partial-error" },
  session: partialError.session,
  onProtocolError: (error) => protocolErrors.push(error),
  textStream: streamOf([
    { type: "start" },
    { type: "text-start", id: "error-text" },
    { type: "text-delta", id: "error-text", text: "kept" },
    { type: "error", error: new Error("controlled") },
    {
      type: "finish",
      finishReason: "error",
      rawFinishReason: "error",
      totalUsage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    },
  ]),
})
assert.equal(errorEnd.finishReason, "error")
assert(protocolErrors.length > 0)
assert(
  partialError
    .getSnapshot()
    .parts.some((part) => part.type === "text" && part.text === "kept")
)

const emptyReply = fakeSession({ ...initial, id: "empty-reply" })
await consumeUIMessagePipeline({
  initialMessage: { ...initial, id: "empty-reply" },
  session: emptyReply.session,
  textStream: streamOf([
    { type: "start" },
    {
      type: "finish",
      finishReason: "stop",
      rawFinishReason: "stop",
      totalUsage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
    },
  ]),
})
assert.deepEqual(emptyReply.getSnapshot().parts, [])

console.log("normalized AI SDK v7 UI Message pipeline tests passed")
