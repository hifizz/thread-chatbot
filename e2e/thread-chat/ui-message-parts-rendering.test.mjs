import assert from "node:assert/strict"
import fs from "node:fs"
import { assistantPartRenderPlan } from "../../app/thread-chat/branching/assistant/assistant-part-render-plan.ts"

const message = {
  id: "assistant-parts",
  parentMessageId: "user-parts",
  role: "assistant",
  text: "正文",
  forks: [],
  status: "done",
  uiParts: [
    { type: "reasoning", text: "第一行\n第二行", state: "done" },
    { type: "text", text: "正文", state: "done" },
  ],
}

const plan = assistantPartRenderPlan(message)

assert.deepEqual(
  plan.map((item) => item.kind),
  ["reasoning", "text"],
  "assistant parts 必须按 AI SDK UIMessage.parts[] 顺序渲染"
)

const css = fs.readFileSync("app/thread-chat/styles/columns.css", "utf8")
assert.match(
  css,
  /\.tc \.reasoning-body\s*\{[^}]*white-space:\s*pre-wrap;/s,
  "reasoning 展开内容必须保留换行"
)

console.log("PASS  UIMessage parts renderer preserves reasoning order")
