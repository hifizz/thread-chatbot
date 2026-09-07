import assert from "node:assert/strict"
import { messageContentInputSchema, messageContentToUiParts, composerDraftToMessageContent, messagePartsToComposerDraft, normalizeMessageContentParts } from "../../lib/thread-chat/contracts/message-content.ts"
import { artifactReferenceData, artifactReferenceDataSchema } from "../../lib/thread-chat/contracts/artifact-reference.ts"
import { expandArtifactReferencesInContext } from "../../lib/thread-chat/application/artifact-reference-context.ts"
const id = () => crypto.randomUUID()
const artifact = { id: id(), title: "固定正文", kind: "markdown", content: "原文不能跟随新产物变化", threadId: id(), sourceMessageId: id() }
const quote = { schemaVersion: "thread-quote-v1", text: "原句", source: { type: "message", messageId: id(), anchor: { quote: { exact: "原句", prefix: "", suffix: "" } } } }
const file = { url: "/api/attachments/test", mediaType: "text/plain", filename: "test.txt" }
const content = { parts: [
  { type: "text", text: "前文 " }, { type: "file", file },
  { type: "artifact-reference", artifactId: artifact.id }, { type: "quote", quote },
  { type: "text", text: " 后文" }, { type: "artifact-reference", artifactId: artifact.id },
] }
const data = artifactReferenceData(artifact)
const parts = messageContentToUiParts(messageContentInputSchema.parse(content), () => data)
assert.deepEqual(composerDraftToMessageContent(messagePartsToComposerDraft(parts)), content)
assert.throws(() => messageContentToUiParts(content), /解析/)
assert.equal(messageContentInputSchema.safeParse({ parts: [{ type: "text", text: "问题" }, { type: "artifact-reference", artifactId: artifact.id, title: "伪造" }] }).success, false)
assert.equal(artifactReferenceDataSchema.safeParse({ ...data, schemaVersion: 2 }).success, false)
assert.deepEqual(normalizeMessageContentParts([
  { type: "text", text: "" }, { type: "text", text: " a" }, { type: "text", text: " b " }, ...content.parts.slice(2),
]), [{ type: "text", text: " a b " }, ...content.parts.slice(2)])
const references = new Map([[artifact.id, artifact]])
const user = { id: id(), role: "user", parts }
const before = structuredClone(user)
const expanded = expandArtifactReferencesInContext([user], references)
assert.equal(JSON.parse(expanded[0].parts[2].text).content, artifact.content)
assert.deepEqual(JSON.parse(expanded[0].parts[5].text), { contextType: "artifact-reference", artifactId: artifact.id, title: artifact.title, previouslyIncludedInContext: true })
assert.deepEqual(user, before)
const extended = expandArtifactReferencesInContext([user, { ...user, id: id() }], references)
assert.deepEqual(extended[0], expanded[0])
assert.equal(JSON.parse(expandArtifactReferencesInContext([{ ...user, id: id() }], references)[0].parts[2].text).content, artifact.content)
assert.throws(() => expandArtifactReferencesInContext([user], new Map()), /Artifact/)
console.log("PASS 有序内容往返、严格引用协议、重复引用展开、前缀稳定与原消息不可变")
