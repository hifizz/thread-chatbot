import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { createBranchWorkspaceActions } from "../../app/thread-chat/orchestration/workspace/branch-workspace-actions.ts"

const state = {
  threads: {
    main: { id: "main", title: "主线", messages: [], activeLeafMessageId: null },
    source: {
      id: "source",
      title: "来源",
      anchorText: "anchor",
      messages: [],
      activeLeafMessageId: null,
    },
    target: {
      id: "target",
      title: "目标",
      messages: [],
      activeLeafMessageId: null,
    },
  },
}
const calls = []
const toasts = []
const columns = {
  slots: [{ id: "source", folded: false }],
  flashThread: (id) => calls.push(["flash", id]),
  openThread: (id, sourceId, hint) => {
    calls.push(["open", id, sourceId, hint])
    return {
      kind: "replaced",
      idx: 0,
      replacedId: "source",
      prevSlots: [{ id: "source", folded: false }],
    }
  },
  restoreSlots: (slots) => calls.push(["restore", slots]),
  normalizeToReplace: () => ["source"],
  navColumn: (...args) => calls.push(["navigate", ...args]),
}
const actions = createBranchWorkspaceActions({
  state,
  store: { fork: () => null },
  chat: { send: () => {} },
  columns,
  viewMode: "columns",
  mode: "fold",
  setMode: (mode) => calls.push(["mode", mode]),
  showColumnsView: () => calls.push(["columns"]),
  focusCanvasNode: (id) => calls.push(["focus", id]),
  closeSwitcher: () => calls.push(["close-switcher"]),
  showToast: (message, undo) => toasts.push({ message, undo }),
})

actions.openBranchUI("target", "source", { keepSource: true })
assert.deepEqual(calls.slice(0, 2), [
  ["columns"],
  ["open", "target", "source", { keepSource: true }],
])
assert.match(toasts[0].message, /来源.*目标/)
toasts[0].undo()
assert.equal(calls.at(-2)[0], "restore")
assert.deepEqual(calls.at(-1), ["flash", "source"])

actions.changeMode("replace")
assert.deepEqual(calls.find((call) => call[0] === "mode"), ["mode", "replace"])
assert.match(toasts.at(-1).message, /来源.*已收起/)

actions.pickRow({ id: "source" }, { kind: "column", vpIndex: 0 })
assert.deepEqual(calls.at(-2), ["close-switcher"])
assert.deepEqual(calls.at(-1), ["flash", "source"])
assert.equal(actions.isThreadBusy("source"), false)
assert.match(actions.composerPrefillFor("source"), /anchor/)

const shell = await readFile(
  new URL("../../app/thread-chat/thread-chat-demo.tsx", import.meta.url),
  "utf8"
)
for (const command of [
  "openBranchUI",
  "handleFork",
  "changeMode",
  "pickRow",
  "isThreadBusy",
  "composerPrefillFor",
])
  assert.doesNotMatch(shell, new RegExp(`function ${command}\\(`))

console.log(
  "PASS  branch workspace actions compose open, undo, mode, switcher and derivations"
)
