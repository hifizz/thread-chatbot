import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import test from "node:test"

import { ThreadSwitcherPanel } from "../../app/thread-chat/orchestration/thread-switcher-panel.tsx"

const thread = (overrides) => ({
  id: "main",
  modelId: "glm-5.3",
  parentId: null,
  depth: 0,
  title: "Main research",
  anchorText: null,
  forkFromMsgId: null,
  footnote: null,
  children: ["branch"],
  messages: [],
  activeLeafMessageId: null,
  lastActive: 1,
  ...overrides,
})
const state = {
  schemaVersion: 2,
  threads: {
    main: thread({}),
    branch: thread({
      id: "branch",
      parentId: "main",
      depth: 1,
      title: "Focused branch",
      anchorText: "selected source",
      footnote: 1,
      children: [],
    }),
  },
  artifacts: {},
  artifactOrder: [],
  recents: ["branch"],
  footnoteCounter: 1,
  seq: 1,
  tick: 1,
}
const noop = () => {}

await test("global panel renders search, recents, tree rows, and placement status", () => {
  const html = renderToStaticMarkup(
    React.createElement(ThreadSwitcherPanel, {
      state,
      mode: { kind: "global" },
      slots: [{ id: "branch", folded: false }],
      recents: ["branch"],
      onPick: noop,
    })
  )

  assert.match(html, /搜索会话（标题 \/ 划选原文）/)
  assert.match(html, /最近访问/)
  assert.match(html, /Main research/)
  assert.match(html, /Focused branch/)
  assert.match(html, /第 2 列/)
})

await test("subtree panel owns its title, empty state, and compact footer", () => {
  const html = renderToStaticMarkup(
    React.createElement(ThreadSwitcherPanel, {
      state,
      mode: { kind: "subtree", rootId: "branch", x: 10, y: 20 },
      slots: [],
      recents: [],
      onPick: noop,
    })
  )

  assert.match(html, /『Focused branch』的子分支/)
  assert.match(html, /还没有子分支/)
  assert.match(html, /点击行打开（列满走当前策略）/)
  assert.doesNotMatch(html, /<input/)
})

await test("switcher shell delegates shared panel state and row rendering", async () => {
  const shell = await readFile(
    new URL(
      "../../app/thread-chat/orchestration/thread-switcher.tsx",
      import.meta.url
    ),
    "utf8"
  )

  assert.match(shell, /<ThreadSwitcherPanel/)
  assert.doesNotMatch(shell, /\b(useState|useEffect|allTreeRows|subtreeRows)\b/)
})
