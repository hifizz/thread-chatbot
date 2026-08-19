/**
 * Thread 模型归属的纯状态用例：
 *   node --import tsx e2e/thread-chat/model-selection.test.mjs
 */
import assert from "node:assert/strict"
import {
  CHAT_MODELS,
  DEFAULT_THREAD_CHAT_MODEL_ID,
  isThreadChatModelId,
  isLinearChatModelId,
  THREAD_CHAT_MODELS,
} from "../../constants/model.ts"
import { MODEL_COST, costMicros } from "../../constants/pricing.ts"
import { createThreadStore } from "../../app/thread-chat/core/store.ts"
import { sanitizeLoadedState } from "../../app/thread-chat/net/sanitize-loaded-state.ts"

const DEFAULT_MODEL_ID = DEFAULT_THREAD_CHAT_MODEL_ID
const validIds = new Set(THREAD_CHAT_MODELS.map((model) => model.id))
const isValidModelId = (modelId) => validIds.has(modelId)
const resolveModelId = (modelId) =>
  isValidModelId(modelId) ? modelId : DEFAULT_MODEL_ID

function seed(modelId = DEFAULT_MODEL_ID) {
  return {
    schemaVersion: 2,
    threads: {
      main: {
        id: "main",
        modelId,
        parentId: null,
        depth: 0,
        title: "主线",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages: [
          {
            id: "m1",
            parentMessageId: null,
            role: "assistant",
            text: "可分叉的回答",
            forks: [],
            status: "done",
          },
        ],
        activeLeafMessageId: "m1",
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 2,
    tick: 1,
  }
}

{
  const store = createThreadStore(seed(), isValidModelId)
  store.setThreadModel("main", "glm-5.3")
  assert.equal(store.getState().threads.main.modelId, "glm-5.3")

  store.setThreadModel("main", "not-a-model")
  assert.equal(store.getState().threads.main.modelId, "glm-5.3")

  store.setThreadModel("main", "minimax-m2")
  assert.equal(store.getState().threads.main.modelId, "glm-5.3")

  const branch = store.fork({
    sourceThreadId: "main",
    sourceMsgId: "m1",
    anchorText: "可分叉",
  })
  assert.ok(branch)
  assert.equal(store.getState().threads[branch.threadId].modelId, "glm-5.3")

  store.setThreadModel(branch.threadId, "deepseek-v4-pro")
  assert.equal(store.getState().threads[branch.threadId].modelId, "glm-5.3")
  console.log("PASS  根 Thread 可切换，分支继承且拒绝独立切换")
}

{
  const legacy = seed()
  delete legacy.threads.main.modelId
  legacy.threads.branch = {
    ...legacy.threads.main,
    id: "branch",
    modelId: "removed-model",
    parentId: "main",
    messages: [],
    activeLeafMessageId: null,
  }
  legacy.threads.main.children = ["branch"]

  const clean = sanitizeLoadedState(legacy, resolveModelId)
  assert.equal(clean.threads.main.modelId, DEFAULT_MODEL_ID)
  assert.equal(clean.threads.branch.modelId, DEFAULT_MODEL_ID)
  assert.equal(clean.threads.main.messages[0].text, "可分叉的回答")
  console.log("PASS  旧树缺失/失效模型回填默认值且不丢消息")
}

{
  const arkModels = CHAT_MODELS.filter((model) => model.provider === "ark")
  assert.equal(arkModels.length, 9)
  for (const model of arkModels) {
    assert.ok(MODEL_COST[model.id])
    assert.ok(costMicros(model.id, 1_000, 1_000) > 0)
  }
  console.log("PASS  Ark 文档中的 9 个模型均有非零计费估值")
}

{
  const visibleIds = new Set(THREAD_CHAT_MODELS.map((model) => model.id))
  assert.ok(!visibleIds.has("minimax-m2"))
  assert.ok(!visibleIds.has("minimax-m2.7"))
  assert.equal(isThreadChatModelId("minimax-m2"), false)
  assert.equal(isThreadChatModelId("minimax-m2.7"), false)
  assert.equal(isThreadChatModelId("glm-5.3"), true)
  assert.equal(isLinearChatModelId("minimax-m2"), true)
  assert.equal(isLinearChatModelId("umapis-claude-opus-4-6"), false)
  console.log("PASS  Thread Chat selector 不展示 M2 与 M2.7")
}
