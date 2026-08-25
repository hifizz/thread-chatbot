# Regenerate：创建 replacement assistant Message

## 这个流程解决什么

Regenerate 的含义不是“修改旧回答”，而是：

```text
旧 assistant Message 退出当前有效时间线
                    +
创建新的 assistant Message 和新的 MessageRun
```

```text
Regenerate 前：
seq=1  U1  active
seq=2  A1  active       ── R1 completed

Regenerate 后：
seq=1  U1  active
seq=2  A1  superseded   ── R1 completed
seq=3  A2  active       ── R2 queued
            replaces A1
```

A1 不会被删除、清空或改写。既有 BaseContext 即使引用 A1，也继续解析 A1，不会自动切换到 A2。

A1、A2、R1 和 R2 都通过 Thread 归属于同一个 Project；Project 是权限与永久删除边界。

## 核心伪代码

```ts
async function regenerateAssistantMessage(command: {
  actorId: UserId
  sourceAssistantMessageId: MessageId
  requestedModelId?: ModelId
}): Promise<ReplacementBundle> {
  const result = await database.transaction(async (tx) => {
    /**
     * 锁定来源 Message，把“它是否仍然 active”变成事务内事实。
     * 不使用 Project revision 或 Thread revision。
     */
    const sourceMessage = await messageRepository.findByIdForUpdate(
      tx,
      command.sourceAssistantMessageId,
    )

    if (!sourceMessage) {
      throw new DomainError("message_not_found")
    }

    await authorization.requireThreadWriteAccess({
      actorId: command.actorId,
      threadId: sourceMessage.threadId,
    })

    /**
     * MVP 只允许重新生成当前时间线末尾已经完成的 assistant Message。
     * 历史位置需要保留另一条路线时，使用 Fork。
     */
    assert(sourceMessage.role === "assistant")
    assert(sourceMessage.supersededAt === null)
    assert(sourceMessage.finalizedAt !== null)
    assert(
      await messageRepository.isLastActiveMessage(tx, {
        threadId: sourceMessage.threadId,
        messageId: sourceMessage.id,
      }),
    )

    const sourceRun =
      await messageRunRepository.findByAssistantMessageIdForUpdate(
        tx,
        sourceMessage.id,
      )

    if (!sourceRun) {
      throw new DataIntegrityError("assistant_message_run_missing")
    }

    if (sourceRun.status !== "completed") {
      throw new DomainError("assistant_message_not_regeneratable")
    }

    /**
     * sequence allocator 必须在 Thread 范围内串行化，
     * 让并发写入也只能得到不同、递增的 sequence。
     */
    const replacementSequence =
      await messageRepository.allocateNextSequence(tx, {
        threadId: sourceMessage.threadId,
      })

    /**
     * 这是 Regenerate 的核心：创建一条全新的 Message。
     * finalized Message 的 role、parts、sequence 绝不能原地更新。
     */
    const replacementAssistantMessage = await messageRepository.insert(
      tx,
      {
        id: idGenerator.newMessageId(),
        threadId: sourceMessage.threadId,
        sequence: replacementSequence,
        role: "assistant",
        parts: null, // 最终 parts 只在 completed 时写入一次
        replacesMessageId: sourceMessage.id,
        supersededAt: null,
        finalizedAt: null,
        createdAt: clock.now(),
      },
    )

    /**
     * 一条 assistant Message 恰有一条 MessageRun。
     * A2 获得 R2；不会给 A1/R1 增加 attempt=2。
     */
    const replacementMessageRun = await messageRunRepository.insert(
      tx,
      {
        id: idGenerator.newMessageRunId(),
        assistantMessageId: replacementAssistantMessage.id,
        status: "queued",
        modelId: await modelPolicy.resolve({
          actorId: command.actorId,
          threadId: sourceMessage.threadId,
          requestedModelId: command.requestedModelId,
        }),
        eventSequence: 0,
        checkpointParts: [],
        createdAt: clock.now(),
      },
    )

    /**
     * A1 只退出默认有效时间线：
     * - 不改 A1.parts；
     * - 不改 A1.sequence；
     * - 不删除 A1/R1；
     * - 不修改引用 A1 的既有 BaseContext。
     */
    const superseded = await messageRepository.markSupersededIfActive(
      tx,
      {
        messageId: sourceMessage.id,
        supersededAt: clock.now(),
      },
    )

    if (!superseded) {
      throw new ConcurrencyError("message_already_superseded")
    }

    return {
      supersededMessageId: sourceMessage.id,
      replacementAssistantMessage,
      replacementMessageRun,
    }
  })

  /**
   * 先提交 durable queued Run，再唤醒后台执行器。
   * 唤醒失败时，queued Run 扫描器仍可恢复执行。
   */
  try {
    await messageRunDispatcher.wakeUpAfterCommit(
      result.replacementMessageRun.id,
    )
  } catch (error) {
    logger.error("replacement_run_wakeup_failed", error)
    // durable queued Run 由扫描器恢复；不能把已提交 replacement 误报为回滚。
  }

  /**
   * API 不向客户端暴露内部 MessageRun ID；客户端使用 assistantMessageId
   * 关联运行状态并订阅事件。
   */
  return {
    supersededMessageIds: [result.supersededMessageId],
    createdMessages: [toMessageDTO(result.replacementAssistantMessage)],
    assistantRun: toAssistantRunStateDTO(result.replacementMessageRun),
  }
}
```

## 为什么顺序是“先创建 replacement，再标记旧消息”

这些写入处在同一事务，外部不可观察到中间状态。先插入 replacement 可以让数据库的：

```text
UNIQUE(replaces_message_id)
```

尽早阻止两个并发请求同时替换 A1；随后使用条件更新将 A1 标记为 superseded。任一步失败都回滚全部写入。

## 决定性不变量

- Regenerate 只接受当前末尾、active、finalized 且 Run=completed 的 assistant Message。
- A1 的 ID、parts、sequence、finalizedAt 和 R1 运行事实保持不变。
- A2 由服务端生成新 ID，使用 Thread 的下一个 sequence，并通过 `replacesMessageId` 指向 A1。
- A2 与 R2 必须在同一事务创建；A2 只对应 R2。
- 对客户端返回 `ReplacementBundle`；MessageRun 内部 ID 不进入普通客户端模型。
- replacement、来源 Message 与 Thread 必须属于同一个 Project。
- replacement 事务不需要 Thread/Project revision。
- 单条 Message 永不 hard delete；A1 只在 Project 永久删除时统一清理。
