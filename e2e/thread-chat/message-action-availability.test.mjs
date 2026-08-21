/**
 * Message toolbar availability regression:
 *   node --import tsx e2e/thread-chat/message-action-availability.test.mjs
 */
import assert from "node:assert/strict"
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
