import assert from 'node:assert/strict'
import * as nodeModule from 'node:module'
import { pathToFileURL } from 'node:url'

// 可在隔离 PostgreSQL（DATABASE_URL）上运行；本地 PGlite 适配只验证事务行为，
// 不将其串行连接视为真实多连接锁竞争验收。测试模块必须由运行者显式配置。
if (process.env.THREADCHAT_TEST_DB_MODULE) {
  const url = pathToFileURL(process.env.THREADCHAT_TEST_DB_MODULE).href
  assert.equal(typeof nodeModule.registerHooks, 'function', '内存数据库模式需要 Node 22.15+ 或 24+')
  nodeModule.registerHooks({ resolve(specifier, context, next) {
    if (specifier === '@/lib/db') return { url, shortCircuit: true }
    return next(specifier, context)
  } })
  if (process.env.THREADCHAT_TEST_DB_SETUP) await import(pathToFileURL(process.env.THREADCHAT_TEST_DB_SETUP).href)
}
const [{ db }, schema, service, repository, { and, eq, sql }, contextService, { requestMessageStop }, { toMessageDTO }, { finalizeGeneration }] = await Promise.all([
  import('../../lib/db/index.ts'), import('../../lib/db/schema.ts'),
  import('../../lib/thread-chat/application/documents/service.ts'),
  import('../../lib/thread-chat/persistence/documents/writes.ts'), import('drizzle-orm'),
  import('../../lib/thread-chat/application/documents/context.ts'),
  import('../../lib/thread-chat/application/stop-message.ts'), import('../../lib/thread-chat/persistence/mappers.ts'),
  import('../../lib/thread-chat/streaming/finalize.ts'),
])
// 上面的直接 db import 也使用显式测试模块，其他应用模块由 hook 获得同一连接。
const testDb = process.env.THREADCHAT_TEST_DB_MODULE ? (await import(pathToFileURL(process.env.THREADCHAT_TEST_DB_MODULE).href)).db : db
const documentQueries = await import('../../lib/thread-chat/persistence/documents/queries.ts')
const legacyContext = await import('./fixtures/legacy-document-updates.ts')
const contextRepository = await import('../../lib/thread-chat/persistence/documents/context.ts')
const { user, projects, threads, messages, artifacts, documents, documentRevisions } = schema
const id = () => crypto.randomUUID()
const userId = id(), projectId = id(), rootId = id(), sourceMessage = id(), threadA = id(), threadB = id(), messageA = id(), messageB = id()
const identities = [messageA, messageB].map((messageId, index) => ({ userId, projectId, threadId: index === 0 ? threadA : threadB, messageId }))
const baseContent = '# F1\n- [ ] TODO6\n方案：旧方案\nTODO2：待定'
let checks = 0
try {
  await testDb.insert(user).values({ id: userId, name: '文档测试', email: `${userId}@example.test`, emailVerified: true })
  await testDb.insert(projects).values({ id: projectId, userId })
  await testDb.insert(threads).values({ id: rootId, projectId, depth: 0, modelId: 'test-model' })
  await testDb.insert(messages).values({ id: sourceMessage, projectId, threadId: rootId,
    sequence: 1, role: 'assistant', parts: [], status: 'completed', finishedAt: new Date(), modelId: 'test-model' })
  await testDb.insert(threads).values([threadA, threadB].map((threadId, index) => ({
    id: threadId, projectId, parentId: rootId, depth: 1, footnote: index + 1,
    forkMessageId: sourceMessage, forkContext: [sourceMessage], anchorText: 'F1',
    forkAnchor: { quote: { exact: 'F1', prefix: '', suffix: '' } }, modelId: 'test-model',
  })))
  await testDb.update(projects).set({ nextFootnote: 3 }).where(eq(projects.id, projectId))
  await testDb.update(threads).set({ nextSequence: 2 }).where(eq(threads.id, rootId))
  await testDb.insert(messages).values([messageA, messageB].map((messageId, i) => ({
    id: messageId, projectId, threadId: identities[i].threadId, sequence: 1, role: 'assistant', parts: [], status: 'generating', modelId: 'test-model',
  })))
  const [artifact] = await testDb.insert(artifacts).values({ id: id(), projectId, threadId: rootId, sourceMessageId: sourceMessage,
    kind: 'markdown', title: 'F1', content: baseContent }).returning()
  const initial = await testDb.transaction(tx => repository.registerDocumentArtifact(tx, artifact, userId))
  const registeredAgain = await testDb.transaction(tx => repository.registerDocumentArtifact(tx, artifact, userId))
  assert.equal(registeredAgain.id, initial.id); checks++
  await assert.rejects(() => testDb.update(documentRevisions).set({ projectId: id() }).where(eq(documentRevisions.id, initial.id)),
    error => error.cause?.code === '23503')
  await assert.rejects(() => testDb.update(documentRevisions).set({ executionId: messageB }).where(eq(documentRevisions.id, initial.id)),
    error => (error.cause?.constraint_name ?? error.cause?.constraint) === 'document_revisions_artifact_source_fk')
  checks++
  const documentId = initial.documentId
  const originalManifest = await legacyContext.pendingDocumentUpdates(testDb, projectId, rootId)
  const reads = await Promise.all(identities.map((identity, i) => service.readProjectDocument(identity, { documentId }, `read-${i}`)))
  const input = { documentId, expectedRevisionId: initial.id, readId: reads[0].readId,
    edits: [{ oldText: '- [ ] TODO6', newText: '- [x] TODO6' }, { oldText: '方案：旧方案', newText: '方案：新方案' }], changeSummary: '更新 TODO6 并完成' }
  // 原生数据库先持有文档锁，确认 A/B 两条独立连接都在等待，再一起放行。
  // 内存模式没有多连接能力，明确跳过此门槛。
  let releaseLock = () => {}
  let blocker
  if (!process.env.THREADCHAT_TEST_DB_MODULE) {
    let locked
    const ready = new Promise(resolve => { locked = resolve })
    const release = new Promise(resolve => { releaseLock = resolve })
    blocker = testDb.transaction(async tx => {
      await tx.select().from(documents).where(eq(documents.id, documentId)).for('update')
      locked()
      await release
    })
    await Promise.race([ready, blocker])
  }
  const submissions = Promise.all([
    service.updateProjectDocument(identities[0], input, 'update-a'),
    service.updateProjectDocument(identities[1], { ...input, readId: reads[1].readId, edits: [{ oldText: 'TODO2：待定', newText: 'TODO2：六个维度' }] }, 'update-b'),
  ])
  void submissions.catch(() => {})
  if (blocker) {
    try {
      const deadline = Date.now() + 10000
      for (;;) {
        const waiting = await testDb.execute(sql`select count(*)::int as count from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid()
          and wait_event_type = 'Lock' and query like '%"documents"%for update%'`)
        if (waiting[0].count >= 2) break
        assert.ok(Date.now() < deadline, '必须观察到两个真实数据库连接同时等待文档锁；请设置 DB_POOL_MAX>=4')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
      console.log('PASS 原生 PostgreSQL：观察到 A/B 两条连接同时等待文档锁')
    } finally { releaseLock(); await blocker }
  }
  const [a, b] = await submissions
  assert.equal([a,b].filter(r => r.status === 'committed').length, 1)
  assert.equal([a,b].filter(r => r.status === 'conflict').length, 1); checks++
  const winner = a.status === 'committed' ? a : b
  const loserIndex = a.status === 'conflict' ? 0 : 1
  const reread = await service.readProjectDocument(identities[loserIndex], { documentId }, 'reread')
  const staleRead = await service.updateProjectDocument(identities[loserIndex], {
    ...input, expectedRevisionId: reread.revision.id, readId: reads[loserIndex].readId,
  }, 'stale-read')
  assert.equal(staleRead.code, 'READ_REQUIRED'); checks++
  const result = await service.updateProjectDocument(identities[loserIndex], {
    ...input, expectedRevisionId: reread.revision.id, readId: reread.readId,
    edits: loserIndex === 0 ? input.edits : [{ oldText: 'TODO2：待定', newText: 'TODO2：六个维度' }],
  }, 'second-update')
  assert.equal(result.status, 'committed'); checks++
  const current = await service.getProjectDocument(userId, documentId)
  const history = await service.getDocumentHistory(userId, documentId)
  assert.ok(history.length >= 2)
  assert.ok(history.every((revision) => !('content' in revision)), '版本目录不得携带历史全文')
  assert.equal(history[0].id, current.revision.id)
  checks++
  assert.ok(current.revision.content.includes('- [x] TODO6'))
  assert.ok(current.revision.content.includes('方案：新方案'))
  assert.ok(current.revision.content.includes('TODO2：六个维度')); checks++
  assert.equal((await service.getProjectDocument(userId, documentId, initial.id)).revision.content, baseContent); checks++
  const replay = await service.updateProjectDocument(identities[0], input, 'update-a')
  assert.deepEqual(replay, a); checks++
  await assert.rejects(() => service.updateProjectDocument(identities[0], { ...input, changeSummary: '篡改命令' }, 'update-a')); checks++
  const latestRead = await service.readProjectDocument(identities[0], { documentId }, 'latest-read')
  const latestInput = { ...input, expectedRevisionId: latestRead.revision.id, readId: latestRead.readId }
  const invalid = await service.updateProjectDocument(identities[0], { ...latestInput,
    edits: [{ oldText: 'TODO2：六个维度', newText: '改动' }, { oldText: '已经被删除', newText: '不得恢复' }] }, 'invalid')
  assert.equal(invalid.code, 'SOURCE_NOT_FOUND')
  assert.equal((await service.getProjectDocument(userId, documentId)).revision.id, current.revision.id); checks++
  const unchanged = await service.updateProjectDocument(identities[0], { ...latestInput, edits: [{ oldText: 'TODO6', newText: 'TODO6' }] }, 'unchanged')
  assert.equal(unchanged.status, 'unchanged'); checks++
  await assert.rejects(() => service.getProjectDocument('other-user', documentId)); checks++
  const foreignRead = await service.updateProjectDocument(identities[1], { ...latestInput, edits: [{ oldText: 'TODO6', newText: 'TODO7' }] }, 'foreign-read')
  assert.equal(foreignRead.code, 'READ_REQUIRED'); checks++
  const frozenExpansion = await contextService.expandDocumentUpdates(projectId, [{ id: id(), role: 'user', parts: [{ type: 'data-project-document-updates', data: originalManifest }] }])
  assert.ok(frozenExpansion[0].parts[0].text.includes(baseContent))
  assert.equal(frozenExpansion[0].parts[0].text.includes('方案：新方案'), false); checks++
  const manifest = await legacyContext.pendingDocumentUpdates(testDb, projectId, rootId)
  assert.equal(manifest.documents[0].commitIds.length, 3); checks++
  assert.equal((await legacyContext.pendingDocumentUpdates(testDb, projectId, rootId, [])).documents.length, 0); checks++
  const expanded = await contextService.expandDocumentUpdates(projectId, [{ id: id(), role: 'user', parts: [{ type: 'data-project-document-updates', data: manifest }] }])
  assert.ok(expanded[0].parts[0].text.includes(current.revision.content)); checks++
  await contextRepository.markDocumentContextUsed(testDb, sourceMessage, manifest)
  assert.equal((await legacyContext.pendingDocumentUpdates(testDb, projectId, rootId)).documents.length, 0); checks++
  const [savedMessage] = await testDb.select().from(messages).where(eq(messages.id, messageA))
  const restored = toMessageDTO({ ...savedMessage, parts: [] })
  assert.ok(restored.parts.some(part => part.type === 'tool-updateProjectDocument' && part.output.status === a.status)); checks++
  if (!process.env.THREADCHAT_TEST_DB_MODULE) {
    const [otherArtifact] = await testDb.insert(artifacts).values({ id: id(), projectId, threadId: rootId,
      sourceMessageId: sourceMessage, kind: 'markdown', title: '独立文档', content: '原方案' }).returning()
    const other = await testDb.transaction(tx => repository.registerDocumentArtifact(tx, otherArtifact, userId))
    const read = await service.readProjectDocument(identities[1], { documentId: other.documentId }, 'read-independent')
    let locked, release, timer
    const ready = new Promise(resolve => { locked = resolve })
    const gate = new Promise(resolve => { release = resolve })
    const holding = testDb.transaction(async tx => {
      await tx.select().from(documents).where(eq(documents.id, documentId)).for('update')
      locked()
      await gate
    })
    await Promise.race([ready, holding])
    try {
      const committed = await Promise.race([
        service.updateProjectDocument(identities[1], { documentId: other.documentId, expectedRevisionId: other.id,
          readId: read.readId, edits: [{ oldText: '原方案', newText: '独立更新成功' }], changeSummary: '独立更新' }, 'update-independent'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('其他文档锁不应阻塞独立更新')), 5000) }),
      ])
      assert.equal(committed.status, 'committed')
      console.log('PASS 原生 PostgreSQL：持有 F1 文档锁期间，另一份文档独立提交成功')
      checks++
    } finally { clearTimeout(timer); release(); await holding }
  }
  await requestMessageStop(userId, messageB, { commandId: id() })
  const stopped = await service.updateProjectDocument(identities[1], latestInput, 'after-stop')
  assert.equal(stopped.code, 'EXECUTION_INACTIVE'); checks++
  await testDb.update(projects).set({ archivedAt: new Date() }).where(eq(projects.id, projectId))
  const archived = await service.updateProjectDocument(identities[0], latestInput, 'archived')
  assert.equal(archived.code, 'DOCUMENT_READ_ONLY'); checks++
  await testDb.update(projects).set({ archivedAt: null }).where(eq(projects.id, projectId))
  assert.deepEqual(await service.updateProjectDocument(identities[0], input, 'update-a'), a); checks++
  await finalizeGeneration({ messageId: messageA, snapshot: { id: messageA, role: 'assistant', parts: [] }, status: 'failed' })
  assert.equal((await service.getProjectDocument(userId, documentId)).revision.id, current.revision.id); checks++
  const [artifact2] = await testDb.insert(artifacts).values({ id: id(), projectId, threadId: rootId, sourceMessageId: sourceMessage,
    kind: 'markdown', title: 'F1', content: '同名但不同文档' }).returning()
  const initial2 = await testDb.transaction(tx => repository.registerDocumentArtifact(tx, artifact2, userId))
  assert.notEqual(initial2.documentId, documentId)
  await assert.rejects(() => testDb.update(documents).set({ currentRevisionId: initial2.id }).where(eq(documents.id, documentId))); checks++
  // 关闭写入后历史与旧成功收据仍可读取；新提交明确拒绝。
  const previousWrites = process.env.THREAD_CHAT_DOCUMENT_WRITES
  try {
    process.env.THREAD_CHAT_DOCUMENT_WRITES = 'false'
    assert.equal((await service.updateProjectDocument(identities[0], latestInput, 'writes-disabled')).code, 'WRITES_DISABLED')
    assert.deepEqual(await service.updateProjectDocument(identities[0], input, 'update-a'), a)
    assert.equal((await service.getProjectDocument(userId, documentId, initial.id)).revision.content, baseContent)
    checks++
  } finally {
    if (previousWrites === undefined) delete process.env.THREAD_CHAT_DOCUMENT_WRITES
    else process.env.THREAD_CHAT_DOCUMENT_WRITES = previousWrites
  }
  // 旧 completed 产物：未登记不可写；中断后逐产物恢复，同名不合并。
  const { registerExistingDocument, registerExistingDocuments } = await import('../../lib/thread-chat/application/documents/register-existing.ts')
  const legacyIds = [id(), id()]
  await testDb.insert(artifacts).values(legacyIds.map(artifactId => ({ id: artifactId, projectId,
    threadId: rootId, sourceMessageId: sourceMessage, kind: 'markdown', title: 'F1', content: '旧文档原文' })))
  assert.equal(await documentQueries.documentForArtifact(testDb, userId, projectId, legacyIds[0]), null)
  assert.equal(await registerExistingDocument(legacyIds[0]), true)
  assert.equal(await registerExistingDocument(legacyIds[0]), false)
  assert.equal(await documentQueries.documentForArtifact(testDb, userId, projectId, legacyIds[1]), null)
  assert.equal(await registerExistingDocument(legacyIds[1]), true)
  assert.notEqual(await documentQueries.documentForArtifact(testDb, userId, projectId, legacyIds[0]),
    await documentQueries.documentForArtifact(testDb, userId, projectId, legacyIds[1]))
  assert.equal((await testDb.select().from(artifacts).where(eq(artifacts.id, legacyIds[0])))[0].content, '旧文档原文')
  // 不运行跨用户批处理；批处理的遍历仅在显式隔离内存数据库中验证。
  if (process.env.THREADCHAT_TEST_DB_MODULE) assert.equal(await registerExistingDocuments(), 0)
  checks++
  const unavailableId = id()
  await testDb.insert(artifacts).values({ id: unavailableId, projectId, threadId: threadB,
    sourceMessageId: messageB, kind: 'markdown', title: '未完成', content: '不能登记' })
  assert.equal(await registerExistingDocument(unavailableId), false); checks++
  // 所有 Thread 接收固定摘要；回执各自独立，重试不追随 head。
  const { sendMessage } = await import('../../lib/thread-chat/application/send-message.ts')
  const { retryMessage } = await import('../../lib/thread-chat/application/retry-message.ts')
  const { DEFAULT_THREAD_CHAT_MODEL_ID: modelId } = await import('../../constants/model.ts')
  const turn = (text) => ({ commandId: id(), userMessageId: id(), assistantMessageId: id(), modelId, parts: [{ type: 'text', text }] })
  const mainTurn = turn('继续推进')
  const sent = await sendMessage(userId, rootId, mainTurn)
  const savedParts = sent.result.userMessage.parts
  const frozen = savedParts.find(part => part.type === 'data-document-update-notices')
  assert.ok(frozen.data.documents.length > 0)
  assert.equal(JSON.stringify(frozen).includes(baseContent), false)
  const noticesBefore = await contextService.expandDocumentUpdates(projectId, [sent.result.userMessage])
  assert.equal(JSON.stringify(noticesBefore).includes('旧文档原文'), false, '摘要不展开全文')
  const rootIdentity = { userId, projectId, threadId: rootId, messageId: mainTurn.assistantMessageId }
  const lateRead = await service.readProjectDocument(rootIdentity, { documentId }, 'late-read')
  const lateUpdate = await service.updateProjectDocument(rootIdentity, { documentId,
    expectedRevisionId: lateRead.revision.id, readId: lateRead.readId,
    edits: [{ oldText: lateRead.revision.content, newText: lateRead.revision.content + '\n后续变化' }],
    changeSummary: '接受消息后提交的新变化' }, 'late-update')
  assert.equal(lateUpdate.status, 'committed')
  assert.deepEqual(await contextService.expandDocumentUpdates(projectId, [sent.result.userMessage]), noticesBefore)
  await contextRepository.markDocumentContextUsed(testDb, mainTurn.assistantMessageId, frozen.data)
  const nextRoot = await contextRepository.pendingDocumentNotices(testDb, projectId, rootId)
  assert.deepEqual(nextRoot.documents.map(d => d.revisionId), [lateUpdate.revisionId])
  assert.equal((await contextRepository.pendingDocumentNotices(testDb, projectId, threadA)).documents.length > 1, true,
    '主线收据不消费子线程的更新')
  checks++
  await testDb.update(messages).set({ status: 'failed', finishedAt: new Date() }).where(eq(messages.id, mainTurn.assistantMessageId))
  await retryMessage(userId, mainTurn.assistantMessageId, { commandId: id(), assistantMessageId: id(), modelId })
  const [originalUser] = await testDb.select().from(messages).where(eq(messages.id, mainTurn.userMessageId))
  assert.deepEqual(originalUser.parts, savedParts); checks++
  await testDb.update(threads).set({ nextSequence: 2 }).where(eq(threads.id, threadA))
  const branchTurn = await sendMessage(userId, threadA, turn('继续分支讨论'))
  const branchNotice = branchTurn.result.userMessage.parts.find(part => part.type === 'data-document-update-notices')
  assert.ok(branchNotice.data.documents.length > 0)
  assert.deepEqual(await contextRepository.pendingDocumentNotices(testDb, projectId, threadA), branchNotice.data,
    '仅接受消息而无有效响应，不推进通知位置')
  await contextRepository.markDocumentContextUsed(testDb, branchTurn.result.assistantMessage.id, branchNotice.data)
  assert.equal((await contextRepository.pendingDocumentNotices(testDb, projectId, threadA)).documents.length, 0)
  assert.deepEqual(await contextRepository.pendingDocumentNotices(testDb, projectId, rootId), nextRoot)
  checks++
  // 更新版本分叉的父节点来自其真实产物来源，不能改为创建文档的主线。
  const { forkThread } = await import('../../lib/thread-chat/application/fork-thread.ts')
  const fixed = await service.getProjectDocument(userId, documentId, winner.revisionId)
  const forkCommand = { commandId: id(), threadId: id(), sourceMessageId: fixed.revision.sourceMessageId,
    modelId, target: { type: 'artifact', artifactId: fixed.revision.artifactId,
      anchor: { quote: { exact: 'F1', prefix: '', suffix: '' } } } }
  await assert.rejects(() => forkThread(userId, fixed.revision.sourceThreadId, forkCommand))
  await testDb.update(messages).set({ status: 'completed', stopRequestedAt: null }).where(eq(messages.id, fixed.revision.sourceMessageId))
  const child = await forkThread(userId, fixed.revision.sourceThreadId, forkCommand)
  assert.equal(child.result.thread.parentId, fixed.revision.sourceThreadId)
  assert.equal(child.result.thread.forkArtifactId, fixed.revision.artifactId)
  const first = turn('分析这个文档')
  const childFirst = await forkThread(userId, fixed.revision.sourceThreadId, {
    ...forkCommand, commandId: id(), threadId: id(), firstTurn: first,
  })
  assert.ok(childFirst.result.generation.userMessage.parts.some(part => part.type === 'data-document-update-notices'))
  checks++
  await assert.rejects(() => forkThread(userId, rootId, { ...forkCommand, commandId: id(), threadId: id() })); checks++
  // 多轮变化只携带最近摘要；收据游标不增长为无界事件 ID 列表。
  const childIdentity = { userId, projectId, threadId: childFirst.result.thread.id,
    messageId: childFirst.result.generation.assistantMessage.id }
  for (let i = 0; i < 12; i++) {
    const read = await service.readProjectDocument(childIdentity, { documentId }, `many-read-${i}`)
    const result = await service.updateProjectDocument(childIdentity, { documentId,
      expectedRevisionId: read.revision.id, readId: read.readId,
      edits: [{ oldText: read.revision.content, newText: read.revision.content + `\n第 ${i} 次补充` }],
      changeSummary: `第 ${i} 次补充` }, `many-update-${i}`)
    assert.equal(result.status, 'committed')
  }
  let noticeRowCount = 0
  const bounded = await contextRepository.pendingDocumentNotices({ execute: async query => {
    const rows = await testDb.execute(query)
    noticeRowCount = rows.length
    return rows
  } }, projectId, childIdentity.threadId)
  assert.ok(noticeRowCount <= bounded.documents.length * 10, 'database result itself is bounded, not just the assembled notice')
  const boundedDoc = bounded.documents.find(d => d.documentId === documentId)
  assert.equal(boundedDoc.changes.length, 10)
  assert.equal(boundedDoc.omittedChangeCount, boundedDoc.revisionNumber - 10)
  assert.equal(boundedDoc.changes.at(-1).revisionNumber, boundedDoc.revisionNumber)
  assert.equal('commitIds' in boundedDoc, false)
  const sparseIds = [boundedDoc.changes[0].commitId, boundedDoc.changes.at(-1).commitId]
  await contextRepository.markDocumentContextUsed(testDb, childIdentity.messageId, { schemaVersion: 1, documents: [{
    documentId, revisionId: boundedDoc.revisionId, artifactId: boundedDoc.artifactId, commitIds: sparseIds,
  }] })
  const sparsePending = (await contextRepository.pendingDocumentNotices(testDb, projectId, childIdentity.threadId)).documents.find(d => d.documentId === documentId)
  assert.ok(sparsePending.changes.every(change => !sparseIds.includes(change.commitId)))
  assert.equal(sparsePending.omittedChangeCount, Math.max(0, boundedDoc.revisionNumber - sparseIds.length - 10))
  checks++
  await contextRepository.markDocumentContextUsed(testDb, childIdentity.messageId, bounded)
  assert.equal((await contextRepository.pendingDocumentNotices(testDb, projectId, childIdentity.threadId)).documents.length, 0)
  // 编辑产生新的消息快照；原用户通知不能被改写。
  const { editLatestTurn } = await import('../../lib/thread-chat/application/edit-turn.ts')
  const edited = await editLatestTurn(userId, branchTurn.result.userMessage.id, turn('更新问题：最新进展如何'))
  assert.ok(edited.result.generation.userMessage.parts.some(p => p.type === 'data-document-update-notices'))
  const [oldBranchUser] = await testDb.select().from(messages).where(eq(messages.id, branchTurn.result.userMessage.id))
  assert.deepEqual(oldBranchUser.parts, branchTurn.result.userMessage.parts)
  checks += 2
  // 普通创建工具成功后停止/失败，不登记新文档；已 committed 更新仍保留。
  for (const terminalStatus of ['failed', 'stopped']) {
    const messageId = id()
    await testDb.insert(messages).values({ id: messageId, projectId, threadId: rootId,
      sequence: terminalStatus === 'failed' ? 50 : 51, role: 'assistant', parts: [], status: 'generating', modelId: 'test-model' })
    await finalizeGeneration({ messageId, status: terminalStatus, snapshot: { id: messageId, role: 'assistant', parts: [{
      type: 'tool-createMarkdownArtifact', toolCallId: `create-${terminalStatus}`, state: 'output-available',
      input: { title: '未完成创建', content: '# 未完成' }, output: { created: true },
    }] } })
    const [sourceArtifact] = await testDb.select().from(artifacts).where(eq(artifacts.sourceMessageId, messageId))
    assert.ok(sourceArtifact, '普通固定产物保留原有阅读行为')
    assert.equal((await testDb.select().from(documentRevisions).where(eq(documentRevisions.artifactId, sourceArtifact.id))).length, 0)
    checks++
  }
  if (!process.env.THREADCHAT_TEST_DB_MODULE) {
    const before = await service.getProjectDocument(userId, documentId)
    let release, ready
    const gate = new Promise(resolve => { release = resolve })
    const held = new Promise(resolve => { ready = resolve })
    const writer = testDb.transaction(async tx => {
      await repository.lockDocument(tx, documentId)
      const next = await repository.appendDocumentRevision(tx, identities[0], {
        ...input, expectedRevisionId: before.revision.id, changeSummary: '目录快照并发检查',
      }, before.revision, before.revision.content + '\n快照检查', 'catalog-snapshot', id())
      ready()
      await gate
      return next
    })
    await Promise.race([held, writer])
    try {
      const during = await service.getProjectDocuments(userId, projectId)
      const head = during.documents.find(doc => doc.id === documentId)
      assert.equal(head.currentRevisionId, before.revision.id)
      assert.equal(during.artifacts.find(item => item.id === head.currentArtifactId).document.revisionId, before.revision.id)
    } finally { release() }
    const committed = await writer
    const after = await service.getProjectDocuments(userId, projectId)
    const head = after.documents.find(doc => doc.id === documentId)
    assert.equal(head.currentRevisionId, committed.revisionId)
    assert.equal(after.artifacts.find(item => item.id === head.currentArtifactId).document.revisionId, committed.revisionId)
    assert.equal(after.artifacts.filter(item => item.document?.id === documentId).length, 1)
    console.log('PASS 原生 PostgreSQL：并发写入提交前后目录均返回完整匹配的 head 与 Artifact')
    checks++
  }
  const { getProjectBootstrap, getArtifact } = await import('../../lib/thread-chat/application/queries.ts')
  const catalog = await getProjectBootstrap(userId, projectId)
  assert.equal(catalog.artifacts.filter(item => item.document?.id === documentId).length, 1,
    'bootstrap must return exactly one current entry for a document with many revisions')
  const { listOwnedProjectArtifactCatalog } = await import('../../lib/thread-chat/persistence/artifact-repository.ts')
  let catalogStatements = 0
  const observedExecutor = new Proxy(testDb, { get(target, name) {
    if (name === 'select') return (...args) => { catalogStatements++; return target.select(...args) }
    const value = target[name]
    return typeof value === 'function' ? value.bind(target) : value
  } })
  await listOwnedProjectArtifactCatalog(observedExecutor, userId, projectId)
  assert.equal(catalogStatements, 1, 'current heads and artifact metadata must share one SQL statement snapshot')
  const currentCatalog = await service.getProjectDocuments(userId, projectId)
  assert.deepEqual(currentCatalog.artifacts, catalog.artifacts)
  assert.deepEqual(currentCatalog.documents, catalog.documents)
  for (const document of currentCatalog.documents) {
    const entry = currentCatalog.artifacts.find(item => item.id === document.currentArtifactId)
    assert.equal(entry.document.revisionId, document.currentRevisionId)
  }
  const { getThreadArtifacts } = await import('../../lib/thread-chat/application/queries.ts')
  const sourceHistory = await getThreadArtifacts(userId, rootId)
  assert.ok(sourceHistory.some(item => item.id === artifact.id), 'opening source Thread loads its fixed historical cards')
  assert.ok(sourceHistory.every(item => item.threadId === rootId && !('content' in item)))
  assert.deepEqual(await getThreadArtifacts('other-user', rootId), [], 'history cannot cross ownership boundary')
  assert.ok(catalog.artifacts.every(artifact => !('content' in artifact)), 'bootstrap never returns artifact bodies')
  const fixedBody = await getArtifact(userId, artifact.id)
  assert.equal(typeof fixedBody.content, 'string')
  assert.ok(fixedBody.content.length > 0, 'fixed historical body remains available on demand')
  checks++
  if (!process.env.THREADCHAT_TEST_DB_MODULE) {
    const { lockOwnedMessageTurn } = await import('../../lib/thread-chat/persistence/message-repository.ts')
    let release, ready
    const gate = new Promise(resolve => { release = resolve })
    const held = new Promise(resolve => { ready = resolve })
    const blocker = testDb.transaction(async tx => {
      await tx.select().from(projects).where(eq(projects.id, projectId)).for('share')
      ready()
      await gate
    })
    await Promise.race([held, blocker])
    // 直接事务运行真实命令共用的锁入口，没有重试可掩盖 40P01。
    const turns = Promise.all([messageA, messageB].map(messageId => testDb.transaction(async tx => {
      const locked = await lockOwnedMessageTurn(tx, userId, messageId)
      assert.equal(locked.source.id, messageId)
      await tx.update(projects).set({ updatedAt: new Date() }).where(eq(projects.id, projectId))
      return locked.thread.id
    })))
    void turns.catch(() => {})
    try {
      const deadline = Date.now() + 10000
      for (;;) {
        const waiting = await testDb.execute(sql`select count(*)::int as count from pg_stat_activity
          where datname = current_database() and pid <> pg_backend_pid()
          and wait_event_type = 'Lock' and query like '%"projects"%for update%'`)
        if (waiting[0].count >= 2) break
        assert.ok(Date.now() < deadline, '两条命令必须在获取子级锁之前等待 Project 排他锁')
        await new Promise(resolve => setTimeout(resolve, 25))
      }
    } finally { release(); await blocker }
    assert.deepEqual((await turns).sort(), [threadA, threadB].sort())
    console.log('PASS 原生 PostgreSQL：两个 Thread 先等待 Project 排他锁，无锁升级、无事务重试')
    checks++
  }
  const { deleteProject } = await import('../../lib/thread-chat/application/project-mutations.ts')
  await deleteProject(userId, projectId, { commandId: id() })
  assert.equal((await testDb.select().from(documents).where(eq(documents.projectId, projectId))).length, 0); checks++
  console.log(`项目文档事务、CAS、收据、隔离、停止、固定上下文与整体删除：${checks} 项通过`)
} catch (error) { console.error("验收失败：", error); throw error } finally {
  await testDb.update(documents).set({ currentRevisionId: null }).where(eq(documents.projectId, projectId))
  await testDb.delete(documents).where(eq(documents.projectId, projectId))
  await testDb.delete(projects).where(eq(projects.id, projectId))
  await testDb.delete(user).where(eq(user.id, userId))
}
process.exit(0)
