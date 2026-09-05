import assert from "node:assert/strict"
import { kickoffQuestion } from "../../lib/thread-chat/application/prompt-policy.ts"

assert.equal(
  kickoffQuestion("贝尔不等式"),
  "请结合上下文，展开讲解『贝尔不等式』"
)

console.log("PASS thread chat kickoff prompt policy")
