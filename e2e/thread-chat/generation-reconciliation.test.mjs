import assert from "node:assert/strict"
import {
  initialGenerationIds,
  isGenerationInFlight,
  messageGenerationIds,
  missingGenerationTurn,
  terminalGenerationResultInput,
} from "../../app/thread-chat/generation/generation-reconciliation-logic.ts"
import { mergeGenerationResult } from "../../app/thread-chat/generation/merge-result.ts"

assert.equal(isGenerationInFlight("running"), true)
assert.equal(isGenerationInFlight("stop_requested"), true)
assert.equal(isGenerationInFlight("completed"), false)
assert.deepEqual(
  [
    ...initialGenerationIds([
      { id: "running", status: "running" },
      { id: "stopping", status: "stop_requested" },
      { id: "done", status: "completed" },
    ]),
  ],
  ["running", "stopping"]
)

assert.deepEqual(
  messageGenerationIds({
    threads: {
      main: {
        messages: [
          {
            role: "assistant",
            status: "pending",
            generationId: "pending",
          },
          {
            role: "assistant",
            status: "streaming",
            generationId: "streaming",
          },
          {
            role: "assistant",
            status: "done",
            generationId: "done",
          },
          { role: "user", status: "pending", generationId: "user" },
          { role: "assistant", status: "pending" },
        ],
      },
    },
  }),
  ["pending", "streaming"]
)

const localState = {
  schemaVersion: 2,
  threads: {
    main: {
      id: "main",
      modelId: "glm-5.3",
      parentId: null,
      depth: 0,
      title: "主线",
      anchorText: null,
      forkFromMsgId: null,
      footnote: null,
      children: ["local-branch"],
      messages: [
        {
          id: "u1",
          parentMessageId: null,
          role: "user",
          text: "问题",
          forks: [],
        },
        {
          id: "a1",
          parentMessageId: "u1",
          role: "assistant",
          text: "本地 partial",
          forks: [],
          generationId: "gen-1",
          status: "streaming",
        },
      ],
      activeLeafMessageId: "a1",
      lastActive: 1,
    },
    "local-branch": {
      id: "local-branch",
      modelId: "glm-5.3",
      parentId: "main",
      depth: 1,
      title: "尚未持久化的本地分支",
      anchorText: "问题",
      forkFromMsgId: "a1",
      footnote: 1,
      children: [],
      messages: [],
      activeLeafMessageId: null,
      lastActive: 2,
    },
  },
  artifacts: {},
  artifactOrder: [],
  recents: ["local-branch"],
  footnoteCounter: 1,
  seq: 4,
  tick: 2,
}
const terminal = {
  id: "gen-1",
  treeId: "tree-1",
  threadId: "main",
  userMessageId: "u1",
  assistantMessageId: "a1",
  attempt: 1,
  isCurrent: true,
  status: "completed",
  updatedAt: new Date(0).toISOString(),
  result: {
    version: 1,
    generationId: "gen-1",
    text: "服务端最终答案",
    status: "done",
    artifactIds: [],
    artifacts: {},
  },
}
const resultInput = terminalGenerationResultInput(terminal)
assert.ok(resultInput)
const merged = mergeGenerationResult(localState, resultInput)
assert.equal(merged.threads.main.messages[1].text, "服务端最终答案")
assert.ok(merged.threads["local-branch"])
assert.deepEqual(merged.recents, ["local-branch"])
assert.equal(terminalGenerationResultInput({ ...terminal, result: null }), null)

assert.deepEqual(missingGenerationTurn(localState, "gen-1"), {
  threadId: "main",
  userMessageId: "u1",
  assistantMessageId: "a1",
  reason: "missing_generation",
})
assert.equal(missingGenerationTurn(localState, "unknown"), null)

console.log(
  "PASS  generation reconciliation tracks work and merges only generation-owned state"
)
