import assert from "node:assert/strict"
import { resolveForkModelId } from "../../lib/thread-chat/application/fork-model.ts"
import { HISTORICAL_MODEL_ALIASES } from "../../constants/models/historical-aliases.ts"
import { THREAD_CHAT_MODELS } from "../../constants/model.ts"
import { forkThread } from "../../lib/thread-chat/application/fork-thread.ts"

for (const model of THREAD_CHAT_MODELS) {
  assert.equal(resolveForkModelId(model.id), model.id, "可用模型保持原样")
}
assert.equal(resolveForkModelId("umapis-claude-opus-5"), "iceland-claude-opus-5")
for (const [oldId, currentId] of Object.entries(HISTORICAL_MODEL_ALIASES)) {
  assert.equal(resolveForkModelId(oldId), currentId, "别名必须指向可用的应用 ID")
}
// 模拟映射目标后来下架：必须重新选择，不能继续返回旧的映射结果。
const targetIndex = THREAD_CHAT_MODELS.findIndex((model) => model.id === "iceland-claude-opus-5")
const [removedTarget] = THREAD_CHAT_MODELS.splice(targetIndex, 1)
try { assert.equal(resolveForkModelId("umapis-claude-opus-5"), null) }
finally { THREAD_CHAT_MODELS.splice(targetIndex, 0, removedTarget) }
for (const id of [null, undefined, "", "retired-model", "unknown-claude-opus-5", "umapis-claude-sonnet-5", "toString", "__proto__"]) {
  assert.equal(resolveForkModelId(id), null, "不得猜测前缀或使用默认模型")
}
// 未知模型在访问数据库前被最终校验拦截；已解析模型使用新模型的参数能力。
assert.throws(() => forkThread("owner", "parent", { modelId: "retired-model" }), { code: "MODEL_NOT_ALLOWED" })
assert.throws(() => forkThread("owner", "parent", {
  modelId: "umapis-claude-opus-5",
  generationSettings: { effort: "invalid", maxOutputTokens: 1 },
}), { code: "VALIDATION_ERROR" })

const command = Object.freeze({
  modelId: "umapis-claude-opus-5",
  generationSettings: { effort: "invalid", maxOutputTokens: 1 },
})
assert.throws(() => forkThread("owner", "parent", command), { code: "VALIDATION_ERROR" })
assert.equal(command.modelId, "umapis-claude-opus-5", "保留原始命令用于幂等校验")
console.log("fork-model: PASS")
