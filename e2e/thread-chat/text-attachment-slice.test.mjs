import assert from "node:assert/strict"
import {
  renderTextAttachment,
} from "../../lib/chat/attachment-content-resolver.ts"
import {
  startProjectCommandSchema,
} from "../../lib/thread-chat/contracts/commands.ts"
import {
  THREAD_MESSAGE_ATTACHMENT_MIME_TYPES,
} from "../../lib/thread-chat/application/command-utils.ts"

const id = crypto.randomUUID()
const row = {
  id,
  userId: "user",
  key: "attachments/plain.txt",
  filename: 'code & "notes".txt',
  mimeType: "text/plain",
  size: 32,
  kind: "document",
  status: "ready",
  pageCount: null,
  pages: null,
  summary: null,
  suggestedQuestions: null,
  error: null,
  createdAt: new Date(),
  updatedAt: new Date(),
}

const original = "function demo() {\n  return 42\n}\n\n尾行"
const full = await renderTextAttachment(
  row,
  1_000,
  async () => new TextEncoder().encode(original)
)
assert.equal(full.mode, "full")
assert.match(full.text, /name="code &amp; &quot;notes&quot;\.txt" mime="text\/plain"/)
assert.ok(full.text.includes(original), "必须原样保留换行与代码缩进")

const truncated = await renderTextAttachment(
  row,
  12,
  async () => new TextEncoder().encode(original)
)
assert.equal(truncated.mode, "fallback")
assert.ok(truncated.text.includes(original.slice(0, 12)))
assert.match(truncated.text, /已截断：附件正文超出本轮上下文预算/)

const invalidUtf8 = await renderTextAttachment(
  row,
  100,
  async () => Uint8Array.from([0xc3, 0x28])
)
assert.match(invalidUtf8.text, /文本附件解析失败：内容不是有效的 UTF-8 文本/)

assert.deepEqual(THREAD_MESSAGE_ATTACHMENT_MIME_TYPES, [
  "text/plain",
  "image/png",
  "image/jpeg",
  "image/webp",
])
const parsed = startProjectCommandSchema.parse({
  commandId: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  rootThreadId: crypto.randomUUID(),
  userMessageId: crypto.randomUUID(),
  assistantMessageId: crypto.randomUUID(),
  modelId: "test/model",
  text: "请阅读附件",
  files: [
    {
      url: `/api/attachments/${id}`,
      mediaType: "text/plain",
      filename: row.filename,
    },
  ],
})
assert.equal(parsed.files[0].mediaType, "text/plain")

console.log("text attachment slice tests passed")
