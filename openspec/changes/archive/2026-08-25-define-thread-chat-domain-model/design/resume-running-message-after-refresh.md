# 刷新后恢复正在生成的 assistant Message

## 这个流程解决什么

浏览器刷新、关闭页面或事件连接断开只取消本地订阅；后台 MessageRun 继续运行。重新加载包含该 assistant Message 的 ThreadMessageBundle 后，客户端必须：

1. 合并当前有效 Message 与独立 AssistantRunState。
2. 立即显示服务端持久化的 `checkpointParts`。
3. 使用 `assistantMessageId + eventSequence` 恢复订阅。
4. completed 事件直接携带 finalized Message，不再终态后二次 GET Message。
5. 不创建新的 Message 或 MessageRun。

Project 页如何恢复多个 Branch Column、并行加载各自 MessageBundle，见 [打开已有 Project 生命周期](../../design-thread-chat-client-api/design/open-existing-project-lifecycle.md)。

## 后端 Thread Bundle

```ts
async function loadThreadForRefresh(query: {
  actorId: UserId
  threadId: ThreadId
}): Promise<ThreadMessageBundle> {
  // 复用统一查询：active Message、sequence 窗口、独立 Run 与 Artifact。
  return loadThreadMessages({
    ...query,
    limit: 200,
  })
}
```

客户端按 `assistantMessageId` 关联 Message 与 Run；公开 DTO 不包含服务端内部 MessageRun ID。

## 前端合并与恢复

```ts
function applyThreadBundleAndResume(bundle: ThreadMessageBundle) {
  // 一次 Store Action 合并 Message、Run、Artifact 与 Thread ready 状态。
  store.getState().applyMessageBundle(bundle)

  for (const run of bundle.assistantRuns) {
    switch (run.status) {
      case "completed":
        // 最终内容已经位于对应 finalized Message.parts。
        generationCoordinator.unsubscribeAssistant(
          run.assistantMessageId,
        )
        break

      case "failed":
      case "stopped":
        // checkpoint 可以展示，但终态不自动重启或重连。
        generationCoordinator.unsubscribeAssistant(
          run.assistantMessageId,
        )
        break

      case "queued":
      case "running":
        // selector 立即用 checkpointParts 恢复画面，不等待下一 token。
        generationCoordinator.subscribeAssistant(
          run.assistantMessageId,
        )
        break
    }
  }
}
```

## 事件订阅

```ts
function subscribeAssistant(assistantMessageId: MessageId) {
  const current = selectAssistantRun(
    store.getState(),
    assistantMessageId,
  )

  if (!current || !isQueuedOrRunning(current.status)) return
  if (connections.has(assistantMessageId)) return

  const connection = api.subscribeAssistantEvents({
    assistantMessageId,
    afterEventSequence: current.eventSequence,

    onSnapshot(event) {
      /**
       * 首个业务事件固定为 run.snapshot：
       * - run.checkpointParts 是当前持久化内容；
       * - cursor === run.eventSequence；
       * - snapshot 可以是终态。
       */
      store.getState().applyRunEvent(event)
      streamBuffer.dropThrough({
        assistantMessageId,
        eventSequence: event.cursor,
      })

      if (isTerminal(event.run.status)) {
        connections.delete(assistantMessageId)
        connection.close()
      }
    },

    onDelta(event) {
      const latest = selectAssistantRun(
        store.getState(),
        assistantMessageId,
      )

      const lastReceived = selectLastReceivedEventSequence(
        store.getState(),
        assistantMessageId,
      )

      if (
        !latest ||
        event.eventSequence <= Math.max(
          latest.eventSequence,
          lastReceived,
        )
      ) return

      // 高频 chunk 先进入 buffer，按 UI frame 合并，不逐 token set Zustand。
      streamBuffer.enqueue(assistantMessageId, event)
    },

    onCompleted(event) {
      /**
       * completed 事件原子携带：
       * finalized Message、completed Run、includedArtifacts、Artifact Summary。
       * 不需要再 GET Message，也不能以前端累计 chunk 作为最终权威。
       */
      store.getState().applyRunEvent(event)
      streamBuffer.clear(assistantMessageId)
      connections.delete(assistantMessageId)
      connection.close()
    },

    onFailedOrStopped(event) {
      store.getState().applyRunEvent(event)
      streamBuffer.clear(assistantMessageId)
      connections.delete(assistantMessageId)
      connection.close()
    },
  })

  connections.set(assistantMessageId, connection)
}
```

`run.snapshot` 与 `run.completed` 携带的 Artifact Summary 必须按 `changeSequence` 合并；较小的乱序 Summary 不得覆盖较新的页面统计。

## 后台完成

```ts
async function completeMessageRun(input: {
  messageRunId: MessageRunId
  finalParts: UIMessagePart[]
}) {
  const completed = await database.transaction(async (tx) => {
    const run = await messageRunRepository.findByIdForUpdate(
      tx,
      input.messageRunId,
    )

    // 迟到结果不得覆盖 failed/stopped/completed 终态。
    if (run.status !== "running") return null

    const assistantMessage = await messageRepository.findByIdForUpdate(
      tx,
      run.assistantMessageId,
    )

    assert(assistantMessage.role === "assistant")
    assert(assistantMessage.finalizedAt === null)

    const thread = await threadRepository.findByIdTx(
      tx,
      assistantMessage.threadId,
    )
    if (!thread) throw new DataIntegrityError("message_thread_missing")

    const finalizedMessage =
      await messageRepository.finalizeAssistantMessageOnce(tx, {
        messageId: assistantMessage.id,
        parts: input.finalParts,
        finalizedAt: clock.now(),
      })

    const completedRun =
      await messageRunRepository.transitionIfCurrent(tx, {
        messageRunId: run.id,
        expectedStatus: "running",
        nextStatus: "completed",
        finishedAt: clock.now(),
      })

    if (!completedRun) {
      throw new ConcurrencyError("message_run_status_changed")
    }

    const includedArtifacts =
      await artifactQuery.loadRenderProjectionForMessagesTx(tx, {
        projectId: thread.projectId,
        sourceMessageIds: [assistantMessage.id],
      })

    const artifactSummary =
      await artifactQuery.loadProjectSummaryTx(tx, {
        projectId: thread.projectId,
      })

    return {
      message: finalizedMessage,
      run: completedRun,
      includedArtifacts,
      artifactSummary,
    }
  })

  if (!completed) return

  // 事务提交后发布；订阅者收到自包含的终态事件。
  await runEventPublisher.publishCompleted(completed)
}
```

## 决定性不变量

- 刷新和取消订阅不得改变 MessageRun 状态。
- queued/running 恢复来源是 `checkpointParts + eventSequence`。
- 客户端只按 `assistantMessageId` 关联和订阅 Run。
- 同一 assistantMessageId 的订阅必须去重。
- completed 最终内容来自事件携带的 finalized Message，不来自前端累计 chunk。
- completed/failed/stopped 终态不自动重启。
- 页面刷新不得创建第二条 assistant Message 或 MessageRun。
- MessageRun 终态转换使用条件更新，不需要通用 revision。
