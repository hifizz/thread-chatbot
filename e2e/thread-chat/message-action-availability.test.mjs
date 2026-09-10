/**
 * Message toolbar availability regression:
 *   node --import tsx e2e/thread-chat/message-action-availability.test.mjs
 */
import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { buildMessageActionViewState } from "../../app/thread-chat/chat/actions/message-action-presentation.ts"
import { hasCompletedAssistantActions } from "../../app/thread-chat/chat/actions/message-action-types.ts"
import { messageToolbarTooltip } from "../../app/thread-chat/chat/actions/message-toolbar.tsx"

const message = (status, text = "回复") => ({
  id: "assistant-message-id",
  parentMessageId: "user-message-id",
  role: "assistant",
  text,
  forks: [],
  status,
})

assert.equal(hasCompletedAssistantActions(message("pending", "")), false)
assert.equal(
  hasCompletedAssistantActions(message("streaming", "半截回复")),
  false
)
assert.equal(hasCompletedAssistantActions(message("error", "半截回复")), false)
assert.equal(hasCompletedAssistantActions(message("done")), true)
assert.equal(
  hasCompletedAssistantActions({
    id: "user-message-id",
    parentMessageId: null,
    role: "user",
    text: "问题",
    forks: [],
  }),
  false
)

console.log("PASS  assistant toolbar is available only for done messages")

const copyAction = {
  key: "copy",
  label: "复制",
  icon: () => null,
  onSelect() {},
  disabledReason: "该回复没有可复制的 Markdown 正文",
}
assert.equal(messageToolbarTooltip(copyAction), "复制")
assert.equal(
  messageToolbarTooltip({ ...copyAction, disabled: true }),
  "该回复没有可复制的 Markdown 正文"
)

console.log("PASS  disabled reason is never shown for an enabled action")

// 只渲染助手消息；隔离用户编辑器及其依赖的 Next 字体/CSS 编译。
const userEditorHook = registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/chat/message/editable-user-message.tsx")) {
      return {
        format: "module",
        source: 'export function EditableUserMessage() { throw new Error("本测试不应渲染用户编辑器") }',
        shortCircuit: true,
      }
    }
    return nextLoad(url, context)
  },
})
const { ConversationMessage } = await import("../../app/thread-chat/chat/message/conversation-message.tsx")
userEditorHook.deregister()

const commands = {
  retryAssistant() { throw new Error("渲染不得触发重试") },
  submitFeedback() { throw new Error("渲染不得提交反馈") },
}
const onRetry = () => { throw new Error("渲染不得触发重试") }

for (const latestStatus of ["error", "stopped", "done", "pending", "streaming", "user"]) {
  const history = ["done", "stopped", "error"].flatMap((status, index) => [
    { id: `user-${index}`, role: "user", parentMessageId: index ? `assistant-${index - 1}` : null, text: "问题", forks: [] },
    { ...message(status), id: `assistant-${index}`, parentMessageId: `user-${index}` },
  ])
  const latestUser = { id: "latest-user", role: "user", parentMessageId: "assistant-2", text: "继续", forks: [] }
  const latestAssistant = { ...message(latestStatus), id: "latest-assistant", parentMessageId: latestUser.id }
  const messages = [...history, latestUser, ...(latestStatus === "user" ? [] : [latestAssistant])]
  const state = {
    threads: {
      main: { id: "main", parentId: null, forkFromMsgId: null, children: [], messages, activeLeafMessageId: messages.at(-1).id },
    },
  }
  const actionState = buildMessageActionViewState({
    state,
    recoverableByUserMessageId: new Map(),
    feedbackByMessageId: new Map(),
  })
  const latestId = actionState.presentationByThreadId.get("main").latestAssistantMessageId
  const renderMessage = (entry, retry = onRetry) => renderToStaticMarkup(
    React.createElement(ConversationMessage, {
      threadId: "main",
      message: entry,
      messageCommands: commands,
      regeneratableAssistantMessageId: latestId,
      onRetry: retry,
    })
  )

  for (const entry of history.filter((item) => item.role === "assistant")) {
    const html = renderMessage(entry)
    assert.doesNotMatch(html, /class="retry"/, `${latestStatus}: 历史失败和停止消息不得显示重试`)
    if (entry.status === "done") {
      assert.match(html, /<button[^>]*aria-label="重新生成"[^>]*disabled=""/, `${latestStatus}: 历史成功回复必须禁用重新生成`)
    } else {
      assert.match(html, new RegExp(`class="msg-${entry.status}"`), "仍须保留历史错误或停止提示")
    }
  }

  if (latestStatus === "error" || latestStatus === "stopped") {
    assert.match(renderMessage(latestAssistant), /class="retry"/, "最后一条失败或停止消息仍可重试")
    assert.doesNotMatch(renderMessage(latestAssistant, null), /class="retry"/, "没有重试能力时不显示空按钮")
  } else if (latestStatus === "done") {
    const button = renderMessage(latestAssistant).match(/<button[^>]*aria-label="重新生成"[^>]*>/)?.[0]
    assert.ok(button)
    assert.doesNotMatch(button, /disabled=/, "最后一条成功回复仍可重新生成")
  } else if (latestStatus !== "user") {
    assert.doesNotMatch(renderMessage(latestAssistant), /class="retry"|aria-label="重新生成"/, "生成中不显示重试或重新生成")
  }
}

console.log("PASS  shared message rendering restricts retry and regeneration to the latest terminal assistant")
