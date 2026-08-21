import assert from "node:assert/strict"
import test from "node:test"

import type { ConversationSnapshotResult } from "../application/conversation-command-contracts.ts"
import {
  conversationId,
  messageId,
  projectId,
  threadId,
  turnId,
  workspaceId,
  type ConversationMessage,
} from "../domain/conversation-model.ts"
import { compileCanonicalGenerationMessages } from "./canonical-ai-generation-executor.ts"

function message(input: {
  id: ReturnType<typeof messageId>
  thread: ReturnType<typeof threadId>
  turn: ReturnType<typeof turnId>
  role: "user" | "assistant"
  text: string
}): ConversationMessage {
  return {
    id: input.id,
    threadId: input.thread,
    turnId: input.turn,
    role: input.role,
    content: {
      schemaVersion: 1,
      parts: [{ type: "text", text: input.text }],
    },
    contentState: "complete",
    createdAt: "2026-08-22T00:00:00.000Z",
  }
}

test("较早 Turn 重新生成保留继承上下文并排除当前 Thread 后续 Turn", () => {
  const conversation = conversationId("conversation-compiler")
  const root = threadId("thread-compiler-root")
  const child = threadId("thread-compiler-child")
  const inheritedTurn = turnId("turn-inherited")
  const targetTurn = turnId("turn-target")
  const laterTurn = turnId("turn-later")
  const inherited = messageId("message-inherited")
  const targetInput = messageId("message-target-input")
  const targetOutput = messageId("message-target-output")
  const laterInput = messageId("message-later-input")
  const laterOutput = messageId("message-later-output")
  const loaded: ConversationSnapshotResult = {
    snapshot: {
      schemaVersion: 1,
      project: {
        id: projectId("project-compiler"),
        workspaceId: workspaceId("workspace-compiler"),
        title: "编译测试",
        revision: 0,
        lifecycle: "active",
      },
      conversation: {
        id: conversation,
        projectId: projectId("project-compiler"),
        rootThreadId: root,
        autoTitle: null,
        customTitle: null,
        revision: 0,
        lifecycle: "active",
      },
      threads: {
        [root]: {
          id: root,
          conversationId: conversation,
          modelId: "glm-5.3",
          localTitle: null,
          revision: 0,
          lifecycle: "active",
        },
        [child]: {
          id: child,
          conversationId: conversation,
          modelId: "glm-5.3",
          localTitle: null,
          revision: 0,
          lifecycle: "active",
        },
      },
      threadForks: {},
      turns: {
        [inheritedTurn]: {
          id: inheritedTurn,
          threadId: root,
          position: 0,
          activeUserMessageId: inherited,
          activeAssistantMessageId: inherited,
          revision: 0,
        },
        [targetTurn]: {
          id: targetTurn,
          threadId: child,
          position: 0,
          activeUserMessageId: targetInput,
          activeAssistantMessageId: targetOutput,
          revision: 0,
        },
        [laterTurn]: {
          id: laterTurn,
          threadId: child,
          position: 1,
          activeUserMessageId: laterInput,
          activeAssistantMessageId: laterOutput,
          revision: 0,
        },
      },
      messages: {
        [inherited]: message({
          id: inherited,
          thread: root,
          turn: inheritedTurn,
          role: "user",
          text: "继承消息",
        }),
        [targetInput]: message({
          id: targetInput,
          thread: child,
          turn: targetTurn,
          role: "user",
          text: "目标输入",
        }),
        [targetOutput]: message({
          id: targetOutput,
          thread: child,
          turn: targetTurn,
          role: "assistant",
          text: "旧目标输出",
        }),
        [laterInput]: message({
          id: laterInput,
          thread: child,
          turn: laterTurn,
          role: "user",
          text: "后续输入",
        }),
        [laterOutput]: message({
          id: laterOutput,
          thread: child,
          turn: laterTurn,
          role: "assistant",
          text: "后续输出",
        }),
      },
      generations: {},
      artifactProvenance: {},
    },
    generations: [],
    contextMessageIdsByThread: {
      [child]: [inherited, targetInput, targetOutput, laterInput, laterOutput],
    },
  }

  assert.deepEqual(
    compileCanonicalGenerationMessages({
      loaded,
      generation: {
        threadId: child,
        turnId: targetTurn,
        outputMessageId: targetOutput,
      },
    }),
    [
      { role: "user", content: "继承消息" },
      { role: "user", content: "目标输入" },
    ]
  )
})
