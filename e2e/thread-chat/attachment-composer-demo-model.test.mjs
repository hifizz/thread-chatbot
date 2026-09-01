import assert from "node:assert/strict"

import {
  appendDemoAttachments,
  createDemoAttachments,
  createPastedTextAttachment,
  removeDemoAttachment,
} from "../../app/thread-chat/chat/composer/attachment-composer-demo-model.ts"

async function testFileNormalization() {
  const first = new File(["first"], "same.txt", { type: "text/plain" })
  const second = new File(["second"], "same.txt", { type: "text/plain" })
  const normalized = createDemoAttachments([first, second, first], "picker")

  assert.deepEqual(
    normalized.map((attachment) => attachment.file),
    [first, second, first],
    "文件顺序应保持不变"
  )
  assert.deepEqual(
    normalized.map((attachment) => attachment.source),
    ["picker", "picker", "picker"]
  )
  assert.equal(
    new Set(normalized.map((attachment) => attachment.id)).size,
    3,
    "同名文件和同一个 File 的重复出现都应获得独立 ID"
  )
}

async function testImmutableHelpers() {
  const current = createDemoAttachments(
    [new File(["a"], "a.txt"), new File(["b"], "b.txt")],
    "drop"
  )
  const added = createDemoAttachments([new File(["c"], "c.txt")], "paste")
  const currentSnapshot = [...current]
  const addedSnapshot = [...added]

  const appended = appendDemoAttachments(current, added)
  assert.notEqual(appended, current)
  assert.deepEqual(appended, [...currentSnapshot, ...addedSnapshot])
  assert.deepEqual(current, currentSnapshot, "append 不得修改当前数组")
  assert.deepEqual(added, addedSnapshot, "append 不得修改新增数组")

  const removed = removeDemoAttachment(appended, current[1].id)
  assert.notEqual(removed, appended)
  assert.deepEqual(
    removed.map((attachment) => attachment.id),
    [current[0].id, added[0].id]
  )
  assert.deepEqual(
    appended.map((attachment) => attachment.id),
    [current[0].id, current[1].id, added[0].id],
    "remove 不得修改原数组"
  )
}

async function testSyntheticTextFile() {
  const originalText = "  第一行\n第二行  "
  const attachment = createPastedTextAttachment(originalText, 1_788_000_000_000)

  assert.ok(attachment)
  assert.equal(attachment.source, "paste")
  assert.equal(attachment.file.name, "pasted-text-1788000000000.txt")
  assert.equal(attachment.file.type, "text/plain")
  assert.equal(await attachment.file.text(), originalText)
  assert.match(attachment.id, /^[0-9a-f-]{36}$/i)

  assert.equal(createPastedTextAttachment(""), null)
  assert.equal(createPastedTextAttachment(" \n\t "), null)
}

await testFileNormalization()
await testImmutableHelpers()
await testSyntheticTextFile()

console.log("PASS  Attachment Composer Demo 数据模型")
