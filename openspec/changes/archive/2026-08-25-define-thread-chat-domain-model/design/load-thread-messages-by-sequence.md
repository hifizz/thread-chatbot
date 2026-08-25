# 按 sequence 拉取 Thread 当前有效消息

## 这个流程解决什么

给定已有 `threadId`，服务端返回该 Thread 当前有效时间线的一个窗口：

- 只返回 `supersededAt IS NULL` 的 Message。
- 默认读取最新最多 200 条，再按 `sequence ASC` 输出。
- user Message 没有 MessageRun；assistant Message 必须有唯一 MessageRun。
- Bundle 同时返回本窗口渲染所需且允许内联的 Artifact。
- 不假设 user/assistant 交替，也不依赖客户端时间或 `prevMessageId/nextMessageId`。

## 核心伪代码

```ts
async function loadThreadMessages(query: {
  actorId: UserId
  threadId: ThreadId
  limit?: number
  beforeSequence?: number
}): Promise<ThreadMessageBundle> {
  const limit = validateIntegerRange(query.limit ?? 200, 1, 200)
  const beforeSequence = validateOptionalPositiveInteger(
    query.beforeSequence,
  )

  const thread = await threadRepository.findById(query.threadId)
  if (!thread) throw new DomainError("thread_not_found")

  await authorization.requireProjectReadAccess({
    actorId: query.actorId,
    projectId: thread.projectId,
  })

  /**
   * DESC + limit+1 用于高效取得“最新窗口”和 hasOlderMessages；
   * 输出前再翻转为 UI 所需的 sequence ASC。
   */
  const rows = await messageRepository.findActiveWindow({
    threadId: thread.id,
    sequenceLessThan: beforeSequence,
    orderBy: { sequence: "desc" },
    limit: limit + 1,
  })

  const hasOlderMessages = rows.length > limit
  const selected = rows.slice(0, limit).reverse()

  assertStrictlyIncreasingAndUnique(
    selected.map((message) => message.sequence),
  )

  const assistantMessageIds = selected
    .filter((message) => message.role === "assistant")
    .map((message) => message.id)

  const runsByAssistantMessageId =
    await messageRunRepository.findByAssistantMessageIds(
      assistantMessageIds,
    )

  for (const assistantMessageId of assistantMessageIds) {
    if (!runsByAssistantMessageId.has(assistantMessageId)) {
      throw new DataIntegrityError("assistant_message_run_missing")
    }
  }

  const includedArtifacts =
    await artifactQuery.loadRenderProjectionForMessages({
      projectId: thread.projectId,
      sourceMessageIds: selected.map((message) => message.id),
    })

  return {
    threadId: thread.id,
    messages: selected.map(toMessageDTO),
    assistantRuns: assistantMessageIds.map((messageId) =>
      toAssistantRunStateDTO(runsByAssistantMessageId.get(messageId)!),
    ),
    includedArtifacts,
    hasOlderMessages,
    oldestReturnedSequence: selected[0]?.sequence ?? null,
    newestReturnedSequence: selected.at(-1)?.sequence ?? null,
  }
}
```

## 对应查询语义

```sql
SELECT messages.*
FROM messages
WHERE messages.thread_id = :threadId
  AND messages.superseded_at IS NULL
  AND (
    :beforeSequence IS NULL
    OR messages.sequence < :beforeSequence
  )
ORDER BY messages.sequence DESC
LIMIT :limit + 1;
```

服务端丢弃多取的一条后，将窗口翻转为 `sequence ASC`。`beforeSequence` 是独占边界。

## sequence 有空缺是正常结果

```text
数据库历史：
seq=1  U1  active
seq=2  A1  superseded
seq=3  A2  active，replaces A1
seq=4  U2  active

当前有效时间线：
seq=1  U1
seq=3  A2
seq=4  U2
```

系统不得为了消除空缺而重排或重写 sequence。

## 决定性不变量

- sequence 只由服务端分配，在同一 Thread 内唯一且单调递增。
- sequence 表示写入顺序，不表示 user/assistant 配对。
- replacement 获得新 sequence；旧 Message 保留原 sequence。
- `supersededAt` 决定 Message 是否进入默认有效时间线。
- `beforeSequence` 是独占边界；返回窗口按 sequence 升序。
- `assistantRuns` 必须且只覆盖本窗口中的 assistant Message。
- `includedArtifacts` 只包含渲染本窗口 Message 所需且允许内联的 Artifact。
- Thread 读取权限必须通过所属 Project 校验。
- 查询不得创建 Message、MessageRun、Artifact 或 BaseContext。
