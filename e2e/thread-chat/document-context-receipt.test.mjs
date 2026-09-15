import assert from 'node:assert/strict'
import { withDocumentContextReceipt } from '../../lib/thread-chat/streaming/documents/context-receipt.ts'
import { documentExportSnapshot } from '../../lib/thread-chat/domain/documents/export.ts'

import { documentContextForRequest } from '../../lib/thread-chat/domain/documents/context-history.ts'

const consume = async (parts) => {
  let calls = 0
  const stream = new ReadableStream({ start(controller) { for (const part of parts) controller.enqueue(part); controller.close() } })
  const result = []
  for await (const part of withDocumentContextReceipt(stream, async () => { calls++ })) result.push(part)
  assert.deepEqual(result, parts)
  return calls
}
assert.equal(await consume([{ type: 'stream-start' }, { type: 'error', error: 'context_length_exceeded' }]), 0)
assert.equal(await consume([{ type: 'stream-start' }, { type: 'text-start' }, { type: 'text-delta', delta: '回答' }, { type: 'finish' }]), 1)
assert.equal(await consume([{ type: 'tool-input-start' }, { type: 'tool-call' }, { type: 'error' }]), 1)
const artifact = { id: 'fixed-v1', title: 'F1.md', content: '# V1', document: { revisionNumber: 1, currentRevisionId: 'v3' } }
const snapshot = documentExportSnapshot(artifact)
assert.equal(snapshot.filename, 'F1-v1.md')
assert.equal(snapshot.content, '# V1')
artifact.content = '# changed object'
assert.equal(snapshot.content, '# V1')
assert.equal(snapshot.artifactId, 'fixed-v1')
console.log('PASS 使用收据：提供商拒绝不消费、有效响应仅一次；导出/分享固定所选版本')

const id = n => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const manifest = { schemaVersion: 1, documents: [{ documentId: id(1), revisionId: id(2), artifactId: id(3), commitIds: [id(2)] }] }
const planned = { id: 'failed-user', role: 'user', parts: [{ type: 'text', text: '原用户问题' }, { type: 'data-project-document-updates', data: manifest }] }
const filter = documentContextForRequest([], 'next-user')
assert.deepEqual(filter(planned).parts, [{ type: 'text', text: '原用户问题' }])
assert.equal(planned.parts.length, 2)
assert.deepEqual(documentContextForRequest([], planned.id)(planned), planned)
assert.deepEqual(documentContextForRequest([{ id: 'assistant', parts: [], documentContextUsed: manifest }], 'next-user')(planned), planned)
console.log('PASS 超限后缩小范围：不补发旧失败计划、保留用户正文、重试原清单、保留已使用历史')

const { resolveGenerationMode } = await import('../../lib/thread-chat/streaming/generation-modes.ts')
const { isExplicitMarkdownArtifactRequest } = await import('../../lib/chat/markdown-artifact.ts')
const { DOCUMENT_TOOL_NAMES, DOCUMENT_LIMITS } = await import('../../constants/project-documents.ts')
for (const request of ['把 @F1 的旧方案替换成盲评，保存为原文档', '创建一份文档，介绍 Git update 和 edit 命令']) {
  const mode = resolveGenerationMode({ researchMode: 'answer', artifactRequested: isExplicitMarkdownArtifactRequest(request), documentTools: DOCUMENT_TOOL_NAMES })
  assert.equal(mode.firstTool, null, '存在文档工具时不强制新建；由模型区分创建与更新')
  assert.ok(mode.toolNames.includes('createMarkdownArtifact'))
  assert.ok(mode.toolNames.includes('readProjectDocument'))
  assert.equal(mode.maxSteps, DOCUMENT_LIMITS.toolSteps)
}
assert.equal(resolveGenerationMode({ researchMode: 'search', artifactRequested: true, documentTools: DOCUMENT_TOOL_NAMES }).firstTool, 'webSearch')
console.log('PASS 文档生成策略：创建/更新自由选择，研究首步约束保持')

const { messagePartsToContent } = await import('../../lib/thread-chat/contracts/message-content.ts')
const content = messagePartsToContent(planned.parts)
assert.deepEqual(content.parts, [{ type: 'text', text: '原用户问题' }])
assert.equal(planned.parts.length, 2, '还原编辑内容不修改服务端保存的固定清单')
assert.throws(() => messagePartsToContent([{ type: 'text', text: '问题' }, { type: 'unknown-data' }]), /不支持/)
console.log('PASS 刷新/编辑消息：服务端文档清单不进入用户内容，未知类型仍拒绝')

const { parseDocumentContextReceipt } = await import('../../lib/thread-chat/contracts/document.ts')
const { documentReceiptForParts } = await import('../../lib/thread-chat/streaming/documents/context-receipt.ts')
const tagged = { ...manifest, kind: 'updates' }
assert.deepEqual(parseDocumentContextReceipt(manifest), tagged)
assert.deepEqual(documentReceiptForParts(planned.parts), tagged)
const secondEntry = { documentId: id(4), revisionId: id(5), artifactId: id(6), commitIds: [id(7), id(5)] }
const full = { schemaVersion: 1, documents: [manifest.documents[0], secondEntry] }
const reordered = { documents: [
  { commitIds: [id(5), id(7), id(5)], artifactId: id(6), revisionId: id(5), documentId: id(4) },
  { commitIds: [id(2)], artifactId: id(3), revisionId: id(2), documentId: id(1) },
], schemaVersion: 1, kind: 'updates' }
const fullMessage = { ...planned, parts: [{ type: 'data-project-document-updates', data: full }] }
const withReceipt = receipt => documentContextForRequest([{ id: 'assistant', parts: [], documentContextUsed: receipt }], 'next-user')(fullMessage)
assert.deepEqual(withReceipt(reordered), fullMessage, 'JSON key/document/commit ordering is not receipt identity')
for (const change of [{ revisionId: id(8) }, { artifactId: id(8) }, { documentId: id(8) }, { commitIds: [id(5)] }]) {
  const mismatched = { ...full, kind: 'updates', documents: [full.documents[0], { ...secondEntry, ...change }] }
  assert.equal(withReceipt(mismatched).parts.length, 0, 'different identity or incomplete commit set cannot authorize a failed plan')
}
const notice = { schemaVersion: 1, documents: [{ ...secondEntry, commitIds: undefined,
  title: 'F1', revisionNumber: 2, changes: [], omittedChangeCount: 0 }] }
delete notice.documents[0].commitIds
const noticeReceipt = { ...notice, kind: 'notices' }
assert.deepEqual(parseDocumentContextReceipt(notice), noticeReceipt)
assert.deepEqual(documentReceiptForParts([{ type: 'data-document-update-notices', data: notice }]), noticeReceipt)
assert.equal(withReceipt(noticeReceipt).parts.length, 0, 'a summary receipt does not prove full document context was used')
assert.throws(() => parseDocumentContextReceipt({ ...tagged, kind: 'future' }))
assert.throws(() => parseDocumentContextReceipt({ ...tagged, schemaVersion: 2 }))
assert.throws(() => parseDocumentContextReceipt({ ...tagged, documents: notice.documents }))
assert.throws(() => parseDocumentContextReceipt({ ...tagged, kind: null }))
const ordinary = { id: 'ordinary', role: 'user', parts: [{ type: 'text', text: 'hello' }] }
const lazy = documentContextForRequest([{ id: 'unused', get documentContextUsed() { throw new Error('must not scan receipts') } }])
assert.deepEqual(lazy(ordinary), ordinary)
console.log('PASS 收据判别及语义匹配：旧无标签兼容、未知协议拒绝、键序/集合无关、固定身份严格、摘要不冒充全文、普通请求不扫描')

const { restoreDocumentToolParts } = await import('../../lib/thread-chat/persistence/message-parts.ts')
const partial = { type: 'tool-updateProjectDocument', toolCallId: 'matched', state: 'input-available', input: {} }
const saved = { ...partial, state: 'output-available', output: { status: 'committed' } }
const missing = { ...saved, toolCallId: 'missing' }
const streamed = [{ type: 'text', text: 'before' }, partial, { type: 'text', text: 'after' }]
const restored = restoreDocumentToolParts(streamed, [missing, saved])
assert.deepEqual(restored, [streamed[0], saved, streamed[2], missing], 'matched result keeps its stream position; unmatched receipt is appended only as recovery fallback')
assert.equal(streamed[1], partial, 'recovery must not mutate checkpoint data')
assert.deepEqual(restoreDocumentToolParts(restored, [missing, saved]), restored, 'repeated recovery must not duplicate receipts')
console.log('PASS 工具结果恢复：原位替换、缺失位置末尾兜底、checkpoint 不变、重复恢复不重复追加')
