import assert from 'node:assert/strict'
import { convertToModelMessages } from 'ai'
import { expandArtifactReferencesInContext } from '../../lib/thread-chat/application/artifact-reference-context.ts'
import { documentContextForRequest } from '../../lib/thread-chat/domain/documents/context-history.ts'
import { messagePartsToContent } from '../../lib/thread-chat/contracts/message-content.ts'
import { documentUpdateNoticesSchema } from '../../lib/thread-chat/contracts/document.ts'
import { DOCUMENT_LIMITS } from '../../constants/project-documents.ts'
const id = n => `30000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const notices = { schemaVersion: 1, documents: [{ documentId: id(1), revisionId: id(2), artifactId: id(3),
  title: 'F1', revisionNumber: 2, omittedChangeCount: 0,
  changes: [{ commitId: id(2), revisionNumber: 2, summary: 'TODO6 完成', sourceThreadId: id(4), sourceMessageId: id(5) }] }] }
const user = { id: id(6), role: 'user', parts: [{ type: 'text', text: '继续' }, { type: 'data-document-update-notices', data: notices }] }
assert.deepEqual(documentUpdateNoticesSchema.parse(notices), notices)
assert.deepEqual(messagePartsToContent(user.parts).parts, [{ type: 'text', text: '继续' }])
const failedHistory = documentContextForRequest([], id(7))(user)
const receivedHistory = documentContextForRequest([{ id: id(8), parts: [], documentContextUsed: notices }], id(7))(user)
assert.deepEqual(failedHistory, user)
assert.deepEqual(receivedHistory, user, '收据不能改写旧通知前缀')
const wire = async messages => convertToModelMessages(expandArtifactReferencesInContext(messages, new Map()), { ignoreIncompleteToolCalls: true })
const first = await wire([user])
assert.match(JSON.stringify(first), /TODO6 完成/)
assert.match(JSON.stringify(first), /未读取全文/)
const read = { id: id(9), role: 'assistant', parts: [{ type: 'tool-readProjectDocument', toolCallId: 'read-1',
  state: 'output-available', input: { documentId: id(1) }, output: {
    document: { id: id(1), projectId: id(10), title: 'F1', currentRevisionId: id(2), archivedAt: null },
    revision: { id: id(2), documentId: id(1), artifactId: id(3), revisionNumber: 2, title: 'F1', content: '固定全文_V2',
      parentRevisionId: id(11), changeSummary: '完成', sourceThreadId: id(4), sourceMessageId: id(5), createdAt: '2026-09-15', sourceMessageStatus: 'completed' },
    readId: id(12), isCurrent: true } }] }
const secondUser = { ...user, id: id(13), parts: [{ type: 'text', text: '再继续' }, { type: 'data-document-update-notices', data: {
  ...notices, documents: [{ ...notices.documents[0], revisionId: id(14), artifactId: id(15), revisionNumber: 3,
    changes: [{ ...notices.documents[0].changes[0], commitId: id(14), revisionNumber: 3, summary: 'TODO2 完成' }] }] } }] }
const second = await wire([user, read])
const third = await wire([user, read, secondUser])
assert.deepEqual(third.slice(0, first.length), first)
assert.deepEqual(third.slice(0, second.length), second, '新版只追加，不删除之前读取的全文')
assert.match(JSON.stringify(third), /固定全文_V2/)
assert.match(JSON.stringify(third), /TODO2 完成/)
assert.throws(() => documentUpdateNoticesSchema.parse({ ...notices, documents: [{ ...notices.documents[0],
  changes: Array(DOCUMENT_LIMITS.noticeChanges + 1).fill(notices.documents[0].changes[0]) }] }))
console.log('PASS 隐藏通知：摘要校验、编辑过滤、失败/成功历史稳定、按需固定读取、最终模型前缀不变')
