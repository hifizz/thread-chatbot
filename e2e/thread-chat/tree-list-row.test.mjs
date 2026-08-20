import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import test from "node:test"

import { CUSTOM_TITLE_MAX_LEN } from "../../constants/thread-chat.ts"
import { TreeListRow } from "../../app/thread-chat/orchestration/tree-list-row.tsx"

const noop = () => {}
const baseProps = {
  item: {
    id: "tree-1",
    title: "Research notes",
    updatedAt: "",
    threadCount: 3,
  },
  isCurrent: true,
  unsaved: false,
  editing: false,
  confirming: false,
  deleting: false,
  draft: "Research notes",
  onSelect: noop,
  onDraftChange: noop,
  onCancelEdit: noop,
  onCommitEdit: noop,
  onStartEdit: noop,
  onRequestDelete: noop,
  onConfirmDelete: noop,
  onCancelDelete: noop,
}

await test("saved tree row owns title, current badge, branch count, and actions", () => {
  const html = renderToStaticMarkup(React.createElement(TreeListRow, baseProps))

  assert.match(html, /Research notes/)
  assert.match(html, />当前</)
  assert.match(html, /⑂ 2/)
  assert.match(html, /title="重命名"/)
  assert.match(html, /title="删除此对话"/)
})

await test("unsaved and editing rows expose only their allowed controls", () => {
  const unsaved = renderToStaticMarkup(
    React.createElement(TreeListRow, { ...baseProps, unsaved: true })
  )
  assert.match(unsaved, />未保存</)
  assert.doesNotMatch(unsaved, /title="重命名"|title="删除此对话"/)

  const editing = renderToStaticMarkup(
    React.createElement(TreeListRow, { ...baseProps, editing: true })
  )
  assert.match(editing, /class="tlx-edit"/)
  assert.match(editing, new RegExp(`maxLength="${CUSTOM_TITLE_MAX_LEN}"`))
  assert.doesNotMatch(editing, /title="重命名"|title="删除此对话"/)
})

await test("confirming row exposes the destructive second step", () => {
  const html = renderToStaticMarkup(
    React.createElement(TreeListRow, { ...baseProps, confirming: true })
  )

  assert.match(html, /确认删除/)
  assert.match(html, /title="取消"/)
  assert.doesNotMatch(html, /title="重命名"|title="删除此对话"/)
})

await test("tree list composes the row instead of owning its icon actions", async () => {
  const source = await readFile(
    new URL(
      "../../app/thread-chat/orchestration/tree-list.tsx",
      import.meta.url
    ),
    "utf8"
  )

  assert.match(source, /<TreeListRow/)
  assert.doesNotMatch(source, /\b(Check|Pencil|Trash2|X)\b/)
})
