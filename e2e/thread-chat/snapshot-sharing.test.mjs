import assert from "node:assert/strict"
import { test } from "node:test"
import { randomUUID } from "node:crypto"
import { createShareSchema, shareLayoutSchema, publicSnapshotSchema, expiryDate, isShareActive } from "../../lib/thread-chat/sharing/contracts.ts"
import { publicText, publicParts, safePublicHref } from "../../lib/thread-chat/sharing/content.ts"
import { buildProjectSnapshot, buildArtifactSnapshot } from "../../lib/thread-chat/sharing/snapshot.ts"
import { SHARE_PAGE_PATTERN, SHARE_LIMITS } from "../../constants/sharing.ts"
import { sharingFixture } from "./snapshot-sharing-fixture.mjs"

test("请求严格拒绝未支持粒度、客户端正文、owner、非枚举期限和异常布局", () => {
  const base = { commandId: randomUUID(), resourceType: "project", resourceId: "p", layout: {} }
  assert.equal(createShareSchema.parse(base).expiry, "unlimited")
  for (const patch of [{ resourceType: "thread" }, { resourceType: "message" }, { ownerId: "secret" }, { content: "secret" }, { expiry: "1" }, { expiry: 3 }, { layout: { viewport: { x: Infinity, y: 0, zoom: 1 } } }, { layout: { widths: { p: -1 } } }, { layout: { draft: "secret" } }]) assert.equal(createShareSchema.safeParse({ ...base, ...patch }).success, false)
  assert.equal(createShareSchema.safeParse({ ...base, resourceType: "artifact" }).success, false)
})
test("四种期限从服务端创建时刻计算，到期时刻即不可用", () => {
  const now = new Date("2026-09-05T12:00:00.000Z")
  assert.equal(expiryDate("unlimited", now), null)
  for (const days of ["3", "7", "30"]) {
    const expiresAt = expiryDate(days, now)
    assert.equal(expiresAt - now, Number(days) * 86400000)
    assert.equal(isShareActive({ expiresAt, revokedAt: null }, new Date(+expiresAt - 1)), true)
    assert.equal(isShareActive({ expiresAt, revokedAt: null }, expiresAt), false)
  }
  assert.equal(isShareActive({ expiresAt: null, revokedAt: now }, now), false)
})
test("必要旧来源闭合，无关旧版本排除，所有分支仍可阅读", () => {
  const f = sharingFixture()
  const result = buildProjectSnapshot(f.project, f.threads, f.messages, f.artifacts, f.layout)
  assert.equal(result.threads.length, 3)
  assert.equal(result.messages.find((m) => m.id === "old-answer").historical, true)
  assert.equal(result.messages.some((m) => m.id === "unrelated-old"), false)
  assert.deepEqual(result.threads.find((t) => t.id === "branch").forkContext, ["question", "old-answer"])
  assert.deepEqual(result.messages.find((m) => m.id === "pending").parts, [])
  assert.deepEqual(result.layout.slots, [{ id: "deep", folded: false }, { id: "branch", folded: true }])
  assert.equal(result.layout.artifactId, "document")
  assert.equal(JSON.stringify(result).includes("PRIVATE_SENTINEL"), false)
})
test("跨项目、缺失来源、循环关联拒绝创建", () => {
  for (const corrupt of [
    (f) => { f.threads[1].projectId = "other" },
    (f) => { f.messages = f.messages.filter((m) => m.id !== "old-answer") },
    (f) => { f.messages[0].projectId = "other" },
    (f) => { f.threads[1].parentId = "deep" },
    (f) => { f.artifacts[0].threadId = "deep" },
  ]) {
    const f = sharingFixture(); corrupt(f)
    assert.throws(() => buildProjectSnapshot(f.project, f.threads, f.messages, f.artifacts, f.layout), /SHARE_INVALID_SOURCE/)
  }
})
test("公开 parts 白名单不透传任何嵌套元数据或工具参数", () => {
  const parts = publicParts([
    { type: "text", text: "可见", providerMetadata: { secret: "PRIVATE_SENTINEL" } },
    { type: "reasoning", text: "思考", secret: "PRIVATE_SENTINEL" },
    { type: "data-quote", data: { text: "引用", secret: "PRIVATE_SENTINEL" } },
    { type: "file", filename: "PRIVATE_SENTINEL", url: "/api/attachments/PRIVATE_SENTINEL" },
    { type: "tool-readUrl", input: { secret: "PRIVATE_SENTINEL" }, output: "PRIVATE_SENTINEL" },
    { type: "data-new-private-part", data: "PRIVATE_SENTINEL" },
  ], "completed")
  assert.equal(JSON.stringify(parts).includes("PRIVATE_SENTINEL"), false)
  assert.deepEqual(parts.map((p) => p.type), ["text", "reasoning", "quote", "attachment"])
})
test("Markdown 图片、HTML、引用链接、自动链接、代码与纯文本私有地址不泄漏", () => {
  const privateUrls = ["/api/attachments/PRIVATE_SENTINEL", "https://example.com/api/attachments/PRIVATE_SENTINEL", "https://bucket.r2.cloudflarestorage.com/PRIVATE_SENTINEL", "https://cdn.example.com/file?X-Amz-Signature=PRIVATE_SENTINEL", "%2fapi%2fattachments%2fPRIVATE_SENTINEL", "%252f%2561pi%252fattachments%252fPRIVATE_SENTINEL", "//bucket.r2.cloudflarestorage.com/PRIVATE_SENTINEL", "javascript:PRIVATE_SENTINEL"]
  for (const url of privateUrls) {
    for (const markdown of [`[文件](${url})`, `![图片](${url})`, `[文件][ref]\n\n[ref]: ${url}`, `<${url}>`, `地址 ${url}`, `\`${url}\``, `\`\`\`\n${url}\n\`\`\``]) assert.equal(publicText(markdown).includes("PRIVATE_SENTINEL"), false, markdown)
  }
  assert.equal(publicText('<img src="PRIVATE_SENTINEL">').includes("PRIVATE_SENTINEL"), false)
  assert.equal(publicText("![追踪](https://public.example/pixel)").includes("pixel"), false)
  assert.equal(safePublicHref("javascript:alert(1)"), null)
  assert.equal(safePublicHref("https://example.com/reference"), "https://example.com/reference")
  const markdown = "# 标题\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst n = 1\n```\n\n[资料](https://example.com/reference)"
  assert.equal(publicText(markdown), markdown)
})
test("独立文档没有 Project/Thread/来源 ID，仅 completed Markdown 可分享", () => {
  const f = sharingFixture(), artifact = f.artifacts[0], source = f.messages.find((m) => m.id === artifact.sourceMessageId)
  const result = buildArtifactSnapshot(f.project, f.threads[1], source, artifact)
  assert.deepEqual(Object.keys(result).sort(), ["schemaVersion", "resourceType", "title", "content", "createdAt"].sort())
  for (const status of ["generating", "stopped", "failed"]) assert.throws(() => buildArtifactSnapshot(f.project, f.threads[1], { ...source, status }, artifact))
  assert.throws(() => buildArtifactSnapshot(f.project, f.threads[1], source, { ...artifact, kind: "code" }))
})
test("未知快照字段被再次排除，超限明确失败而非截断", () => {
  const f = sharingFixture()
  const result = buildProjectSnapshot(f.project, f.threads, f.messages, f.artifacts, f.layout)
  const parsed = publicSnapshotSchema.parse({ ...result, instructions: "PRIVATE_SENTINEL", messages: result.messages.map((m) => ({ ...m, usage: "PRIVATE_SENTINEL" })) })
  assert.equal(JSON.stringify(parsed).includes("PRIVATE_SENTINEL"), false)
  assert.throws(() => publicText("x".repeat(SHARE_LIMITS.text + 1)), /SHARE_TOO_LARGE/)
  assert.throws(() => buildProjectSnapshot(f.project, Array.from({ length: SHARE_LIMITS.threads + 1 }, () => f.threads[0]), f.messages, [], f.layout), /SHARE_TOO_LARGE/)
})
test("布局丢弃越界引用，不保存草稿；proxy 只放行精确 token 路径", () => {
  const f = sharingFixture()
  const result = buildProjectSnapshot(f.project, f.threads, f.messages, f.artifacts, shareLayoutSchema.parse({ slots: [{ id: "outside", folded: false }], focusId: "outside", pins: [{ id: "outside", x: 1, y: 2 }], artifactId: "outside" }))
  assert.equal(result.layout.focusId, "root"); assert.equal(result.layout.artifactId, null); assert.deepEqual(result.layout.pins, [])
  const token = "a".repeat(32)
  assert.equal(SHARE_PAGE_PATTERN.test(`/share/${token}`), true)
  for (const path of ["/share", `/share/${token}/edit`, `/share/${token}x`, `/thread-chat/${token}`, `/share-private/${token}`]) assert.equal(SHARE_PAGE_PATTERN.test(path), false)
})
