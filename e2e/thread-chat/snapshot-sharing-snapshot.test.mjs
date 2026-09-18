import assert from "node:assert/strict"
import {
  buildProjectSnapshot,
  buildDocumentSnapshot,
  ShareSnapshotError,
} from "../../lib/thread-chat/sharing/snapshot.ts"
import {
  isSafeShareUrl,
  sanitizeShareMarkdown,
  sanitizeShareText,
} from "../../lib/thread-chat/sharing/sanitize-links.ts"
import { normalizeShareLayout } from "../../lib/thread-chat/sharing/layout.ts"

const uid = () => crypto.randomUUID()
const PROJECT_ID = uid()
const NOW = "2026-09-18T00:00:00.000Z"

const baseLayout = {
  view: "columns",
  columnSlots: [],
  columnWidths: {},
  forceColumns: null,
  placementMode: "replace",
  selectedThreadId: null,
  canvas: { pins: {} },
  panelSizes: {},
  expandedNodes: [],
  activeArtifactId: null,
  drawerOpen: false,
}

function project(overrides = {}) {
  return {
    id: PROJECT_ID,
    rootThreadId: "",
    autoTitle: "测试项目",
    customTitle: null,
    target: "SECRET_TARGET_SENTINEL",
    instructions: "SECRET_INSTRUCTIONS_SENTINEL",
    contractVersion: 3,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function thread(overrides = {}) {
  return {
    id: uid(),
    projectId: PROJECT_ID,
    parentId: null,
    forkMessageId: null,
    forkArtifactId: null,
    forkContext: [],
    forkAnchor: null,
    anchorText: null,
    footnote: 1,
    depth: 0,
    modelId: "gpt-test",
    autoTitle: "主线",
    customTitle: null,
    titleGenerationAttempted: true,
    titleGenerated: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function message(threadId, overrides = {}) {
  return {
    id: uid(),
    projectId: PROJECT_ID,
    threadId,
    sequence: 1,
    role: "assistant",
    parts: [{ type: "text", text: "你好" }],
    status: "completed",
    modelId: "gpt-test",
    replacesMessageId: null,
    supersededAt: null,
    feedback: "up",
    error: { code: "SECRET_ERR", message: "SECRET_ERROR_SENTINEL" },
    createdAt: NOW,
    updatedAt: NOW,
    finishedAt: NOW,
    ...overrides,
  }
}

function artifact(threadId, sourceMessageId, overrides = {}) {
  return {
    id: uid(),
    projectId: PROJECT_ID,
    threadId,
    sourceMessageId,
    sourceThreadTitle: "主线",
    sourceThreadFootnote: 1,
    sourceMessageStatus: "completed",
    kind: "markdown",
    title: "文档",
    language: null,
    metadata: { secret: "SECRET_METADATA_SENTINEL" },
    createdAt: NOW,
    updatedAt: NOW,
    content: "# 标题\n正文",
    ...overrides,
  }
}

const source = (overrides = {}) => ({
  project: project(),
  threads: [],
  messages: [],
  artifacts: [],
  documents: [],
  layout: baseLayout,
  createdAt: NOW,
  ...overrides,
})

/* ---- 闭包：被替换消息仅在被引用时进入快照 ---- */
const root = thread({ footnote: 1 })
const branch = thread({ parentId: root.id, footnote: 2, depth: 1 })
const oldSource = message(root.id, { supersededAt: NOW }) // 已被替换
const currentMsg = message(root.id, { sequence: 2 })
const unrelatedOld = message(root.id, { supersededAt: NOW, sequence: 3 }) // 不被引用
branch.forkMessageId = oldSource.id
branch.forkContext = [oldSource.id]
const proj = project({ rootThreadId: root.id })

const snap1 = buildProjectSnapshot(
  source({ project: proj, threads: [root, branch], messages: [oldSource, currentMsg, unrelatedOld] })
)
const snapIds = new Set(snap1.entities.messages.map((m) => m.id))
assert.ok(snapIds.has(currentMsg.id), "当前消息必须在快照内")
assert.ok(snapIds.has(oldSource.id), "forkContext 引用的旧消息必须闭包进快照")
assert.ok(!snapIds.has(unrelatedOld.id), "无关旧消息不得进入快照")
console.log("分支闭包与无关旧消息：3 项通过")

/* ---- 跨 Project / 缺失引用 ---- */
const ghost = thread({ parentId: root.id, forkMessageId: uid() })
assert.throws(
  () =>
    buildProjectSnapshot(
      source({ project: proj, threads: [root, ghost], messages: [currentMsg] })
    ),
  (e) => e instanceof ShareSnapshotError && e.code === "SNAPSHOT_INCOMPLETE"
)
const alien = thread({ projectId: uid(), parentId: root.id })
assert.throws(
  () =>
    buildProjectSnapshot(
      source({ project: proj, threads: [root, alien], messages: [currentMsg] })
    ),
  (e) => e.code === "SNAPSHOT_INCOMPLETE"
)
console.log("缺失/跨 Project 引用拒绝：2 项通过")

/* ---- 白名单：字段剔除 + 哨兵 ---- */
const secretParts = [
  { type: "text", text: "看附件 /api/attachments/abc123 和 [私链](/api/attachments/x)" },
  { type: "reasoning", text: "内部推理 https://ok.example.com" },
  { type: "file", url: "/api/attachments/file-1", mediaType: "image/png", filename: "SECRET_FILE.png" },
  { type: "source-url", sourceId: "s1", url: "/api/attachments/u", title: "私有" },
  { type: "source-url", sourceId: "s2", url: "https://example.com/ok", title: "外部" },
  { type: "tool-webSearch", toolCallId: "t1", state: "output-available",
    input: { query: "天气" },
    output: { query: "天气", results: [
      { title: "好", url: "https://example.com", snippet: "片段" },
      { title: "坏", url: "/api/attachments/y", snippet: "SECRET_SNIP" }] } },
  { type: "tool-readUrl", toolCallId: "t2", state: "output-available",
    input: { url: "https://example.com" },
    output: { url: "https://example.com", content: "SECRET_FULLTEXT_SENTINEL" } },
  { type: "data-project-document-updates", data: { secret: 1 } },
  { type: "data-document-update-notices", data: { secret: 2 } },
  { type: "data-artifact-progress", data: { p: 1 } },
  { type: "data-unknown-future", data: { secret: "SECRET_UNKNOWN_SENTINEL" } },
]
const richMsg = message(root.id, { parts: secretParts })
const snap2 = buildProjectSnapshot(
  source({ project: proj, threads: [root], messages: [richMsg] })
)
const json = JSON.stringify(snap2)
for (const sentinel of [
  "SECRET_TARGET_SENTINEL",
  "SECRET_INSTRUCTIONS_SENTINEL",
  "SECRET_ERROR_SENTINEL",
  "SECRET_FILE.png",
  "SECRET_SNIP",
  "SECRET_FULLTEXT_SENTINEL",
  "SECRET_UNKNOWN_SENTINEL",
  "/api/attachments/",
])
  assert.ok(!json.includes(sentinel), `快照不得包含 ${sentinel}`)
const kept = snap2.entities.messages[0].parts
assert.ok(kept.some((p) => p.type === "text" && p.text.includes("附件未分享")), "file 占位")
assert.ok(kept.some((p) => p.type === "reasoning"), "reasoning 保留")
assert.ok(kept.filter((p) => p.type === "source-url").length === 1, "仅外部 source-url 保留")
const ws = kept.find((p) => p.type === "tool-webSearch")
assert.equal(ws.output.results.length, 1, "webSearch 仅保留安全结果")
const read = kept.find((p) => p.type === "tool-readUrl")
assert.equal(read.output.content, "", "readUrl 丢弃抓取全文")
console.log("白名单字段剔除与哨兵：9 项通过")

/* ---- 链接清洗 ---- */
assert.equal(isSafeShareUrl("https://example.com"), true)
assert.equal(isSafeShareUrl("http://a.b/c"), true)
assert.equal(isSafeShareUrl("#anchor"), true)
assert.equal(isSafeShareUrl("/api/attachments/x"), false)
assert.equal(isSafeShareUrl("https://h.com/api/attachments/x"), false)
assert.equal(isSafeShareUrl("javascript:alert(1)"), false)
assert.equal(isSafeShareUrl("data:image/png;base64,x"), false)
assert.equal(isSafeShareUrl("/thread-chat/abc"), false)
assert.equal(isSafeShareUrl("ftp://x"), false)

const md = [
  "[ok](https://example.com)",
  "[bad](/api/attachments/1)",
  "[ref][r1]",
  "[r1]: /api/attachments/2",
  "![pic](/api/attachments/3)",
  "裸文本 /api/attachments/4 出现",
  "<https://safe.example.com/auto>",
].join("\n")
const cleaned = sanitizeShareMarkdown(md)
assert.ok(!cleaned.includes("/api/attachments/"), "所有附件地址必须清除")
assert.ok(cleaned.includes("https://example.com"), "安全链接保留")
assert.ok(cleaned.includes("bad"), "不安全链接保留可读文本")
assert.ok(cleaned.includes("https://safe.example.com/auto"), "自动链接保留")
console.log("链接清洗：13 项通过")

/* ---- 布局规范化 ---- */
const staleLayout = {
  ...baseLayout,
  columnSlots: [
    { threadId: root.id, folded: true },
    { threadId: uid(), folded: false },
  ],
  columnWidths: { [root.id]: 400, [uid()]: 300 },
  selectedThreadId: uid(),
  canvas: { pins: { [root.id]: { x: 1, y: 2 }, [uid()]: { x: 3, y: 4 } } },
  activeArtifactId: uid(),
  drawerOpen: true,
}
const normalized = normalizeShareLayout(staleLayout, {
  threadIds: new Set([root.id]),
  artifactIds: new Set(),
})
assert.equal(normalized.columnSlots.length, 1)
assert.equal(Object.keys(normalized.columnWidths).length, 1)
assert.equal(normalized.selectedThreadId, root.id, "失效焦点回退到打开的列")
assert.equal(Object.keys(normalized.canvas.pins).length, 1)
assert.equal(normalized.activeArtifactId, null)
assert.equal(normalized.drawerOpen, false)
console.log("布局规范化：6 项通过")

/* ---- Document 快照 pin 当前版 ---- */
const doc = {
  id: uid(),
  title: "方案",
  currentRevisionId: uid(),
  revisionNumber: 4,
  currentArtifactId: uid(),
}
const dsnap = buildDocumentSnapshot({
  document: doc,
  revisionCreatedAt: NOW,
  content: "# 方案\n见附件 /api/attachments/z",
  createdAt: NOW,
})
assert.equal(dsnap.document.revisionId, doc.currentRevisionId)
assert.equal(dsnap.document.revisionNumber, 4)
assert.ok(!dsnap.content.includes("/api/attachments/"))
assert.ok(!JSON.stringify(dsnap).includes("sourceMessageId"), "不带来源对话元信息")
console.log("Document 快照 pin 当前版：4 项通过")

/* ---- 尺寸上限 ---- */
const huge = Array.from({ length: 5001 }, (_, i) =>
  message(root.id, { sequence: i + 1 })
)
assert.throws(
  () =>
    buildProjectSnapshot(
      source({ project: proj, threads: [root], messages: huge })
    ),
  (e) => e.code === "SNAPSHOT_TOO_LARGE"
)
console.log("尺寸上限：1 项通过")
