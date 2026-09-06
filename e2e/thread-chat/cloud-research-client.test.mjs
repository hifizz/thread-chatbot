import assert from "node:assert/strict"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createGate3MockRuntime, GATE3_HARNESS_IDS } from "../../app/thread-chat/gate-3-harness/mock-v1-runtime.ts"
import { createConversationStore } from "../../app/thread-chat/core/store.ts"
import { selectVisibleMessages } from "../../app/thread-chat/core/selectors.ts"
import { createConversationCommands } from "../../app/thread-chat/net/commands/conversation-commands.ts"
import { CloudResearchTool } from "../../app/thread-chat/branching/assistant/cloud-research-tool.tsx"

const mock = createGate3MockRuntime("00000000-0000-4000-8000-000000000098")
mock.setScenario("cloud-research")
const store = createConversationStore({ bootstrap: mock.bootstrap })
const stages = new Set()
const unsubscribe = store.subscribe((state) => {
  for (const message of selectVisibleMessages(state, GATE3_HARNESS_IDS.rootThreadId)) {
    for (const part of message.parts) {
      if (part.type === "tool-prepareRepository" && part.output?.detail) stages.add(part.output.detail)
    }
  }
})
const commands = createConversationCommands({ store, client: mock.client, fetch: mock.fetchStream })
try {
  const { connection } = await commands.sendMessage({ threadId: GATE3_HARNESS_IDS.rootThreadId, modelId: "doubao-seed-2.1-turbo", text: "演示云调研" })
  await connection.finished
  assert([...stages].some((stage) => stage.includes("启动沙箱")))
  assert([...stages].some((stage) => stage.includes("读取与调研代码")))
  const message = Object.values(store.getState().messagesById).find((value) => value.parts.some((part) => part.type === "tool-publishResearchReport"))
  assert.equal(message.status, "completed")
  const part = message.parts.find((part) => part.type === "tool-publishResearchReport")
  const html = renderToStaticMarkup(React.createElement(CloudResearchTool, { part, generating: false }))
  assert(html.includes("打开报告 PR"))
  assert(html.includes("https://github.com/hifizz/thread-chatbot/pull/98"))
  assert(html.includes("演示数据"))
  console.log("PASS 客户端 SSE、Store 阶段更新、终态报告与真实 React 任务卡渲染（模拟服务，非浏览器视觉验收）")
} finally {
  unsubscribe()
  commands.dispose()
}
