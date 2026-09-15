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
const sync = startProjectDocumentSync('p', client, store)
try {
  await new Promise(setImmediate)
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

// 旧轮询仍在途中时收到生成结束通知：不应用旧响应，合并为一次后续请求。
const orderedStore = createConversationStore()
orderedStore.setState({ project: { id: 'p' } })
const pending = []
const ordered = startProjectDocumentSync('p', {
  listDocuments() { return new Promise(resolve => pending.push(resolve)) },
}, orderedStore)
const catalog = (version) => ({ documents: [{ id: 'd', currentArtifactId: `a${version}`, currentRevisionId: `r${version}` }],
  artifacts: [{ id: `a${version}`, title: 'F1', createdAt: '2026-09-15', document: { id: 'd' } }] })
try {
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
  console.log('PASS 目录响应顺序：单入口、丢弃旧轮询、合并生成结束通知、释放后不写入')
} finally { ordered.dispose() }
