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
  const originalManifest = await contextRepository.pendingDocumentUpdates(testDb, projectId, rootId)
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
  const manifest = await contextRepository.pendingDocumentUpdates(testDb, projectId, rootId)
  assert.equal(manifest.documents[0].commitIds.length, 3); checks++
  assert.equal((await contextRepository.pendingDocumentUpdates(testDb, projectId, rootId, [])).documents.length, 0); checks++
  const expanded = await contextService.expandDocumentUpdates(projectId, [{ id: id(), role: 'user', parts: [{ type: 'data-project-document-updates', data: manifest }] }])
  assert.ok(expanded[0].parts[0].text.includes(current.revision.content)); checks++
  await contextRepository.markDocumentContextUsed(testDb, sourceMessage, manifest)
  assert.equal((await contextRepository.pendingDocumentUpdates(testDb, projectId, rootId)).documents.length, 0); checks++
  const [savedMessage] = await testDb.select().from(messages).where(eq(messages.id, messageA))
  const restored = toMessageDTO({ ...savedMessage, parts: [] })
  assert.ok(restored.parts.some(part => part.type === 'tool-updateProjectDocument' && part.output.status === a.status)); checks++
  await requestMessageStop(userId, messageB, { commandId: id() })
  const stopped = await service.updateProjectDocument(identities[1], latestInput, 'after-stop')
  assert.equal(stopped.code, 'EXECUTION_INACTIVE'); checks++
  await testDb.update(documents).set({ archivedAt: new Date() }).where(eq(documents.id, documentId))
  const archived = await service.updateProjectDocument(identities[0], latestInput, 'archived')
  assert.equal(archived.code, 'DOCUMENT_READ_ONLY'); checks++
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
  // 固定主线清单在重试中不追随新 head，子线程不注入项目更新。
  const { sendMessage } = await import('../../lib/thread-chat/application/send-message.ts')
  const { retryMessage } = await import('../../lib/thread-chat/application/retry-message.ts')
  const { DEFAULT_THREAD_CHAT_MODEL_ID: modelId } = await import('../../constants/model.ts')
  const turn = (text) => ({ commandId: id(), userMessageId: id(), assistantMessageId: id(), modelId, parts: [{ type: 'text', text }] })
  const mainTurn = turn('继续推进')
  const sent = await sendMessage(userId, rootId, mainTurn)
  const savedParts = sent.result.userMessage.parts
  const frozen = savedParts.find(part => part.type === 'data-project-document-updates')
  assert.ok(frozen.data.documents.length > 0)
  await testDb.update(messages).set({ status: 'failed', finishedAt: new Date() }).where(eq(messages.id, mainTurn.assistantMessageId))
  await retryMessage(userId, mainTurn.assistantMessageId, { commandId: id(), assistantMessageId: id(), modelId })
  const [originalUser] = await testDb.select().from(messages).where(eq(messages.id, mainTurn.userMessageId))
  assert.deepEqual(originalUser.parts, savedParts); checks++
  await testDb.update(threads).set({ nextSequence: 2 }).where(eq(threads.id, threadA))
  const branchTurn = await sendMessage(userId, threadA, turn('继续分支讨论'))
  assert.equal(branchTurn.result.userMessage.parts.some(part => part.type === 'data-project-document-updates'), false); checks++
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
  await assert.rejects(() => forkThread(userId, rootId, { ...forkCommand, commandId: id(), threadId: id() })); checks++
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
