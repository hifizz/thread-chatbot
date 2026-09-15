import assert from 'node:assert/strict'
import { createConversationStore } from '../../app/thread-chat/core/store.ts'
import { startProjectDocumentSync } from '../../app/thread-chat/net/documents/sync.ts'
import { selectCurrentProjectArtifacts } from '../../lib/thread-chat/domain/artifacts/selectors.ts'

const store = createConversationStore()
store.setState({ project: { id: 'p' } })
const document = { id: 'd', currentRevisionId: 'r1', currentArtifactId: 'a1', sourceMessageStatus: 'generating' }
let requests = 0
const client = {
  async listDocuments() { return { documents: [{ ...document }], artifacts: [{ id: document.currentArtifactId, title: 'F1', createdAt: '2026-09-15',
    sourceMessageStatus: document.sourceMessageStatus, document: { id: 'd', revisionId: document.currentRevisionId } }] } },
  async getArtifact(id) { requests++; return { id, title: 'F1', content: id, createdAt: '2026-09-15',
    sourceMessageStatus: 'generating', document: { id: 'd', revisionId: document.currentRevisionId } } },
}
let intervalRegistrations = 0
const originalSetInterval = globalThis.setInterval
globalThis.setInterval = (...args) => { intervalRegistrations++; return originalSetInterval(...args) }
const sync = startProjectDocumentSync('p', client, store)
globalThis.setInterval = originalSetInterval
try {
  assert.equal(intervalRegistrations, 0, "runtime must not schedule background catalog polling")
  assert.deepEqual(store.getState().documentsById, {}, "startup must not duplicate Bootstrap catalog request")
  await sync.refresh()
  assert.equal(selectCurrentProjectArtifacts(store.getState())[0].sourceMessageStatus, 'generating')
  document.sourceMessageStatus = 'completed'
  await sync.refresh()
  assert.equal(selectCurrentProjectArtifacts(store.getState())[0].sourceMessageStatus, 'completed')
  assert.deepEqual(store.getState().artifactContentsById, {}, 'directory refresh never loads body')
  assert.equal(requests, 0, 'source metadata refresh does not reload immutable content')
  store.getState().upsertArtifact({ ...store.getState().artifactsById.a1, content: "fixed a1" })
  assert.equal('content' in store.getState().artifactsById.a1, false)
  const original = store.getState().artifactContentsById.a1
  let incompleteSnapshots = 0
  const unsubscribe = store.subscribe(state => {
    if (state.documentsById.d && !state.artifactsById[state.documentsById.d.currentArtifactId]) incompleteSnapshots++
  })
  document.currentArtifactId = 'a2'
  document.currentRevisionId = 'r2'
  await sync.refresh()
  unsubscribe()
  assert.equal(incompleteSnapshots, 0)
  assert.equal(store.getState().artifactContentsById.a1, original)
  assert.equal(selectCurrentProjectArtifacts(store.getState())[0].id, 'a2')
  const unchanged = store.getState()
  await sync.refresh()
  assert.equal(store.getState(), unchanged, "unchanged catalog must not rerender the conversation")
  const snapshot = store.getState()
  sync.dispose()
  await sync.refresh()
  assert.equal(store.getState(), snapshot)
  console.log('PASS 项目同步：无抽屉依赖、生成完成状态刷新、目录元数据原子更新、固定历史、释放后不写入')
} finally { sync.dispose() }

// 旧请求仍在途中时收到生成结束通知：不应用旧响应，合并为一次后续请求。
const orderedStore = createConversationStore()
orderedStore.setState({ project: { id: 'p' } })
const pending = []
const ordered = startProjectDocumentSync('p', {
  listDocuments() { return new Promise(resolve => pending.push(resolve)) },
}, orderedStore)
const catalog = (version) => ({ documents: [{ id: 'd', currentArtifactId: `a${version}`, currentRevisionId: `r${version}` }],
  artifacts: [{ id: `a${version}`, title: 'F1', createdAt: '2026-09-15', document: { id: 'd' } }] })
try {
  assert.equal(pending.length, 0)
  orderedStore.getState().requestDocumentRefresh("p")
  assert.equal(pending.length, 1)
  orderedStore.getState().requestDocumentRefresh('p')
  orderedStore.getState().requestDocumentRefresh('p')
  assert.equal(pending.length, 1, 'generation completion must not open a second request')
  pending[0](catalog(1))
  await new Promise(setImmediate)
  assert.deepEqual(orderedStore.getState().documentsById, {}, 'invalidated response must not be applied')
  assert.equal(pending.length, 2, 'in-flight invalidations are coalesced, not dropped')
  pending[1](catalog(2))
  await new Promise(setImmediate)
  assert.equal(selectCurrentProjectArtifacts(orderedStore.getState())[0].id, 'a2')
  const finishing = ordered.refresh()
  const before = orderedStore.getState()
  ordered.dispose()
  pending[2](catalog(1))
  await finishing
  assert.equal(orderedStore.getState(), before, 'disposed runtime cannot roll the catalog back')
  orderedStore.getState().requestDocumentRefresh('p')
  assert.equal(pending.length, 3, 'dispose unsubscribes invalidation notifications')
  console.log('PASS 目录响应顺序：单入口、丢弃旧请求、合并生成结束通知、释放后不写入')
} finally { ordered.dispose() }

// 按已打开 Thread 加载历史；重复目录刷新不重拉历史，也不能把 head 改回旧版。
const { startThreadArtifactHistory } = await import('../../app/thread-chat/net/artifacts/history.ts')
const historyStore = createConversationStore()
historyStore.setState({ project: { id: 'p', rootThreadId: 't1' },
  threadsById: { t1: { id: 't1' }, t2: { id: 't2' } },
  messagesById: { m1: { id: 'm1', status: 'generating' } }, messageIdsByThread: { t1: ['m1'] } })
historyStore.getState().syncDocuments(catalog(2).documents, catalog(2).artifacts)
const historyRequests = []
let failHistory = false
const historySync = startThreadArtifactHistory('p', { async listThreadArtifacts(threadId) {
  historyRequests.push(threadId)
  if (failHistory) throw new Error('offline')
  return [{ ...catalog(1).artifacts[0], sourceMessageStatus: 'completed' }]
} }, historyStore)
try {
  await new Promise(setImmediate)
  assert.deepEqual(historyRequests, ['t1'], 'closed Thread history is not requested')
  assert.equal(historyStore.getState().artifactsById.a1.id, 'a1', 'historical message card is cached')
  assert.equal(selectCurrentProjectArtifacts(historyStore.getState())[0].id, 'a2')
  assert.deepEqual(historyStore.getState().artifactContentsById, {})
  historySync.refresh()
  await new Promise(setImmediate)
  assert.deepEqual(historyRequests, ['t1'], 'unchanged refresh does not refetch historical metadata')
  historyStore.setState({ messagesById: { m1: { id: 'm1', status: 'completed' } } })
  await new Promise(setImmediate)
  assert.deepEqual(historyRequests, ['t1', 't1'], 'source completion refreshes the opened Thread')
  failHistory = true
  historyStore.getState().setWorkspace({ openThreadIds: ['t2'] })
  await new Promise(setImmediate)
  assert.deepEqual(historyRequests, ['t1', 't1', 't2'], 'failed history load must not spin')
  failHistory = false
  historySync.refresh()
  await new Promise(setImmediate)
  assert.deepEqual(historyRequests, ['t1', 't1', 't2', 't2'], 'failed load can retry on next catalog refresh')
  historySync.dispose()
  historyStore.setState({ messagesById: {} })
  assert.equal(historyRequests.length, 4)
  console.log('PASS 历史元数据：按打开路径加载、未变化不重取、终态刷新、失败重试、不能覆盖当前目录')
} finally { historySync.dispose() }
