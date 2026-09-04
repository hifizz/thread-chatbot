import assert from "node:assert/strict"
import {
  renderTextAttachment,
} from "../../lib/chat/attachment-content-resolver.ts"
import {
  isTextAttachmentFile,
  normalizeAttachmentFile,
  validateAttachmentFile,
} from "../../lib/attachments/upload.ts"
import {
  isThreadComposerFile,
  isThreadComposerImageFile,
  THREAD_COMPOSER_ACCEPT,
} from "../../app/thread-chat/chat/composer/thread-attachment-model.ts"
import {
  startProjectCommandSchema,
} from "../../lib/thread-chat/contracts/commands.ts"
import {
  THREAD_MESSAGE_ATTACHMENT_MIME_TYPES,
} from "../../lib/thread-chat/application/command-utils.ts"

const sourceText = "export function demo() {\n  return 42\n}\n"
for (const [filename, mediaType] of [
  ["README.MD", "text/markdown"],
  ["guide.markdown", "text/markdown"],
  ["index.js", "text/javascript"],
  ["types.ts", "video/mp2t"],
  ["page.html", "text/html"],
  ["document.xml", "application/xml"],
  ["icon.svg", "image/svg+xml"],
]) {
  const sourceFile = new File([sourceText], filename, { type: mediaType })
  const normalizedFile = normalizeAttachmentFile(sourceFile)
  assert.equal(isTextAttachmentFile(sourceFile), true)
  assert.equal(isThreadComposerFile(sourceFile), true)
  assert.equal(normalizedFile.name, filename)
  assert.equal(normalizedFile.type, "text/plain")
  assert.equal(normalizedFile.lastModified, sourceFile.lastModified)
  assert.equal(await normalizedFile.text(), sourceText)
  assert.doesNotThrow(() => validateAttachmentFile(sourceFile))
}

const svgFile = new File(["<svg></svg>"], "icon.svg", {
  type: "image/svg+xml",
})
assert.equal(isThreadComposerImageFile(svgFile), false)
assert.ok(THREAD_COMPOSER_ACCEPT.split(",").includes(".md"))
assert.ok(THREAD_COMPOSER_ACCEPT.split(",").includes(".js"))
assert.ok(THREAD_COMPOSER_ACCEPT.split(",").includes(".svg"))

const binaryFile = new File([Uint8Array.from([0, 1, 2])], "tool.exe", {
  type: "application/octet-stream",
})
assert.equal(isTextAttachmentFile(binaryFile), false)
assert.equal(isThreadComposerFile(binaryFile), false)
assert.throws(() => validateAttachmentFile(binaryFile), /不支持的文件类型/)

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
