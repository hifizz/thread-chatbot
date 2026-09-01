import assert from "node:assert/strict"
import { artifacts, messages } from "../../lib/db/schema.ts"
import {
  buildBranchOriginQuote,
  mergeBranchOriginQuote,
  resolveQuoteSelections,
} from "../../lib/thread-chat/application/quote-resolver.ts"
import { buildUserParts } from "../../lib/thread-chat/application/command-utils.ts"
import { threadQuotePartToModelText } from "../../lib/thread-chat/application/quote-model.ts"

const id = () => crypto.randomUUID()
const projectId = id()
const threadA = id()
const threadB = id()
const completedMessageA = id()
const stoppedMessageA = id()
const failedMessageA = id()
const completedMessageB = id()
const artifactA = id()
const artifactB = id()

const anchor = (exact, start = 0) => ({
  quote: { exact, prefix: "", suffix: "" },
  position: { start, end: start + exact.length },
})

const messageRows = [
  {
    id: completedMessageA,
    projectId,
    threadId: threadA,
    role: "assistant",
    status: "completed",
    supersededAt: null,
  },
  {
    id: stoppedMessageA,
    projectId,
    threadId: threadA,
    role: "assistant",
    status: "stopped",
    supersededAt: null,
  },
  {
    id: failedMessageA,
    projectId,
    threadId: threadA,
    role: "assistant",
    status: "failed",
    supersededAt: null,
  },
  {
    id: completedMessageB,
    projectId,
    threadId: threadB,
    role: "assistant",
    status: "completed",
    supersededAt: null,
  },
]
const artifactRows = [
  {
    id: artifactA,
    projectId,
    sourceMessageId: completedMessageA,
    kind: "markdown",
  },
  {
    id: artifactB,
    projectId,
    sourceMessageId: completedMessageB,
    kind: "markdown",
  },
]

const fakeTx = {
  select() {
    return {
      from(table) {
        return {
          async where() {
            if (table === messages) return messageRows
            if (table === artifacts) return artifactRows
            throw new Error("unexpected table")
          },
        }
      },
    }
  },
}

const validMessageSelection = {
  source: {
    type: "message-selection",
    sourceMessageId: completedMessageA,
    anchor: anchor("当前 Thread 引用"),
  },
  comment: "解释",
}
const resolvedMessage = await resolveQuoteSelections({
  tx: fakeTx,
  destinationProjectId: projectId,
  destinationThreadId: threadA,
  selections: [validMessageSelection, validMessageSelection],
  createId: id,
})
assert.equal(resolvedMessage.length, 1, "相同来源与 Anchor 保序去重")
assert.equal(resolvedMessage[0].source.threadId, threadA)
assert.equal(resolvedMessage[0].comment, "解释")

await assert.rejects(
  resolveQuoteSelections({
    tx: fakeTx,
    destinationProjectId: projectId,
    destinationThreadId: threadA,
    selections: [
      {
        source: {
          type: "message-selection",
          sourceMessageId: completedMessageB,
          anchor: anchor("跨 Thread"),
        },
      },
    ],
  }),
  /v1 只允许引用当前 Thread/
)

for (const sourceMessageId of [stoppedMessageA, failedMessageA]) {
  await assert.rejects(
    resolveQuoteSelections({
      tx: fakeTx,
      destinationProjectId: projectId,
      destinationThreadId: threadA,
      selections: [
        {
          source: {
            type: "message-selection",
            sourceMessageId,
            anchor: anchor("不稳定来源"),
          },
        },
      ],
    }),
    /只能引用当前 Thread 中已完成的 AI 回复/
  )
}

const resolvedArtifact = await resolveQuoteSelections({
  tx: fakeTx,
  destinationProjectId: projectId,
  destinationThreadId: threadA,
  selections: [
    {
      source: {
        type: "artifact-selection",
        artifactId: artifactA,
        anchor: anchor("Artifact 段落"),
      },
      comment: "补充证据",
    },
  ],
  createId: id,
})
assert.equal(resolvedArtifact[0].source.type, "artifact-selection")
assert.equal(resolvedArtifact[0].source.threadId, threadA)

await assert.rejects(
  resolveQuoteSelections({
    tx: fakeTx,
    destinationProjectId: projectId,
    destinationThreadId: threadA,
    selections: [
      {
        source: {
          type: "artifact-selection",
          artifactId: artifactB,
          anchor: anchor("跨 Thread Artifact"),
        },
        comment: "不允许",
      },
    ],
  }),
  /v1 只允许批注当前 Thread/
)

const originInput = {
  projectId,
  parentThreadId: threadA,
  sourceMessageId: completedMessageA,
  anchor: anchor("分叉焦点"),
  anchorText: "分叉焦点",
}
const directOrigin = buildBranchOriginQuote({ ...originInput, quoteId: id() })
const delayedOrigin = buildBranchOriginQuote({ ...originInput, quoteId: id() })
assert.equal(
  threadQuotePartToModelText(directOrigin),
  threadQuotePartToModelText(delayedOrigin),
  "直接带问 Fork 与空 Fork 首问的 origin 模型文本等价"
)
assert.deepEqual(
  buildUserParts({ text: "为什么？", files: [], quotes: [directOrigin] })
    .map((part) =>
      part.type === "data-quote"
        ? threadQuotePartToModelText(part.data)
        : part.type === "text"
          ? part.text
          : part.type
    ),
  buildUserParts({ text: "为什么？", files: [], quotes: [delayedOrigin] })
    .map((part) =>
      part.type === "data-quote"
        ? threadQuotePartToModelText(part.data)
        : part.type === "text"
          ? part.text
          : part.type
    )
)

assert.equal(
  mergeBranchOriginQuote(directOrigin, [directOrigin, ...resolvedMessage]).length,
  2,
  "自动 origin 始终第一且重复来源被去除"
)

console.log("PASS quote resolver authorization contracts")
