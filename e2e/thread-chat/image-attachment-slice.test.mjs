import assert from "node:assert/strict"
import { convertToModelMessages } from "ai"
import {
  getChatModel,
  supportsModelImageInput,
} from "../../constants/model.ts"
import {
  IMAGE_ATTACHMENT_LIMITS,
  IMAGE_MODEL_VALIDATION_MESSAGE,
} from "../../constants/attachment.ts"
import { validateAttachmentFile } from "../../lib/chat/attachment-upload.ts"
import {
  imageFilenameWithExtension,
  imageResizeDimensions,
  resizedImageOutput,
} from "../../lib/chat/image-attachment.ts"
import { canAddThreadImages } from "../../app/thread-chat/chat/composer/thread-attachment-model.ts"
import {
  applyImageFileMaterializations,
  resolveAttachmentContext,
} from "../../lib/chat/resolve-attachments.ts"
import {
  assertModelSupportsNewAttachments,
  hasImageFileReferences,
} from "../../lib/thread-chat/application/command-utils.ts"

const firstId = "00000000-0000-4000-8000-000000000001"
const secondId = "00000000-0000-4000-8000-000000000002"
assert.deepEqual(IMAGE_ATTACHMENT_LIMITS, {
  maxFilesPerMessage: 5,
  maxBytesPerFile: 10 * 1024 * 1024,
  maxLongestEdge: 2048,
  lossyOutputMediaType: "image/webp",
  lossyQuality: 0.8,
})
assert.deepEqual(imageResizeDimensions(4000, 2000), {
  width: 2048,
  height: 1024,
})
assert.deepEqual(imageResizeDimensions(1000, 1600), {
  width: 1000,
  height: 1600,
})
assert.deepEqual(imageResizeDimensions(1200, 3000), {
  width: 819,
  height: 2048,
})
assert.deepEqual(resizedImageOutput("image/png"), {
  mediaType: "image/png",
  extension: "png",
})
assert.deepEqual(resizedImageOutput("image/jpeg"), {
  mediaType: "image/webp",
  extension: "webp",
  quality: 0.8,
})
assert.equal(imageFilenameWithExtension("screen.capture.jpg", "webp"), "screen.capture.webp")
assert.throws(
  () =>
    validateAttachmentFile({
      type: "image/png",
      size: IMAGE_ATTACHMENT_LIMITS.maxBytesPerFile + 1,
    }),
  /文件超过大小上限（10MB）/
)

const composerImages = Array.from({ length: 4 }, (_, index) => ({
  id: String(index),
  file: { type: "image/png" },
  status: "ready",
  progress: 1,
}))
assert.equal(canAddThreadImages(composerImages, 1), true)
assert.equal(canAddThreadImages(composerImages, 2), false)

const files = [
  {
    url: `/api/attachments/${firstId}`,
    mediaType: "image/png",
    filename: "first.png",
  },
  {
    url: `/api/attachments/${secondId}`,
    mediaType: "image/jpeg",
    filename: "second.jpg",
  },
]

assert.equal(supportsModelImageInput("kimi-k2.6"), true)
assert.equal(supportsModelImageInput("umapis-claude-opus-5"), true)
assert.equal(supportsModelImageInput("openrouter-gpt-5.6-sol"), true)
assert.equal(supportsModelImageInput("umapis-claude-opus-4-6"), false)
assert.equal(supportsModelImageInput("private-relay-gpt-5.6-sol"), false)
assert.equal(supportsModelImageInput("deepseek-v4-flash"), false)
assert.equal(supportsModelImageInput("deepseek-v4-pro"), false)
assert.equal(
  supportsModelImageInput("openrouter-deepseek-v4-flash-0731"),
  false
)
assert.equal(getChatModel("openrouter-gpt-5.6-sol")?.supportsImageInput, true)
assert.equal(hasImageFileReferences(files), true)
assert.throws(
  () => assertModelSupportsNewAttachments("deepseek-v4-flash", files),
  (error) => error?.code === "VALIDATION_ERROR" && error.message === IMAGE_MODEL_VALIDATION_MESSAGE
)
assert.doesNotThrow(() =>
  assertModelSupportsNewAttachments("openrouter-gpt-5.6-sol", files)
)
assert.throws(
  () =>
    assertModelSupportsNewAttachments(
      "kimi-k2.6",
      Array.from({ length: 6 }, (_, index) => ({
        url: `/api/attachments/00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        mediaType: "image/png",
        filename: `${index}.png`,
      }))
    ),
  (error) =>
    error?.code === "VALIDATION_ERROR" &&
    error.message === "单次最多添加 5 张图片"
)

const rows = new Map([
  [
    firstId,
    {
      id: firstId,
      userId: "user-1",
      key: "attachments/first.png",
      filename: "first.png",
      mimeType: "image/png",
      size: 3,
      kind: "image",
      status: "ready",
      pageCount: null,
      pages: null,
      summary: null,
      suggestedQuestions: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
  [
    secondId,
    {
      id: secondId,
      userId: "user-1",
      key: "attachments/second.jpg",
      filename: "second.jpg",
      mimeType: "image/jpeg",
      size: 2,
      kind: "image",
      status: "ready",
      pageCount: null,
      pages: null,
      summary: null,
      suggestedQuestions: null,
      error: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  ],
])
const bytesByKey = new Map([
  ["attachments/first.png", Uint8Array.from([1, 2, 3])],
  ["attachments/second.jpg", Uint8Array.from([4, 5])],
])
const messages = [
  {
    id: "message-1",
    role: "user",
    parts: [{ type: "text", text: "依次描述两张图片" }, ...files.map((file) => ({ type: "file", ...file }))],
  },
]
const loadRows = async () => rows
const readObjectBytes = async (key) => bytesByKey.get(key)

const visual = await resolveAttachmentContext({
  messages,
  userId: "user-1",
  supportsImageInput: true,
  loadRows,
  readObjectBytes,
})
const converted = await convertToModelMessages(visual.messages)
const materialized = applyImageFileMaterializations(converted, visual.imageFiles)
const userContent = materialized[0].content
assert.ok(Array.isArray(userContent))
const imageParts = userContent.filter((part) => part.type === "file")
assert.deepEqual(
  imageParts.map((part) => [part.filename, part.mediaType, [...part.data.data]]),
  [
    ["first.png", "image/png", [1, 2, 3]],
    ["second.jpg", "image/jpeg", [4, 5]],
  ]
)
assert.ok(
  messages[0].parts.every(
    (part) => part.type !== "file" || part.url.startsWith("/api/attachments/")
  )
)

const nonVisual = await resolveAttachmentContext({
  messages,
  userId: "user-1",
  supportsImageInput: false,
  loadRows,
  readObjectBytes,
})
assert.equal(nonVisual.imageFiles.length, 0)
assert.match(nonVisual.messages[0].parts[1].text, /当前模型不支持查看图片/)
assert.match(nonVisual.messages[0].parts[2].text, /当前模型不支持查看图片/)

console.log("image attachment slice tests passed")
