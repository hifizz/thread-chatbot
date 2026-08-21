import assert from "node:assert/strict"
import test from "node:test"

import { THREAD_TREE_SCHEMA_VERSION } from "../../../constants/thread-chat.ts"
import type { Message, ThreadTreeState } from "../domain/types.ts"
import {
  conversationId,
  projectId,
  workspaceId,
} from "../domain/conversation-model.ts"
import { projectLegacyThreadTree } from "../legacy/project-thread-tree.ts"
import { buildLegacyConversationImportPlan } from "./legacy-conversation-import.ts"

function message(
  id: string,
  parentMessageId: string | null,
  role: "user" | "assistant",
  text: string
): Message {
  return { id, parentMessageId, role, text, forks: [] }
}

function state(): ThreadTreeState {
  const mainUser = message("a-user", null, "user", "A")
  const mainAssistant = message("a-assistant", "a-user", "assistant", "A答")
  mainAssistant.forks.push({
    text: "A答",
    num: 1,
    threadId: "b",
    depth: 1,
  })
  const bUser = message("b-user", null, "user", "B")
  const bAssistant = message("b-assistant", "b-user", "assistant", "B答")
  bAssistant.forks.push({ text: "B答", num: 2, threadId: "c", depth: 2 })
  const cUser = message("c-user", null, "user", "C")
  const cAssistant = {
    ...message("c-assistant", "c-user", "assistant", "C partial"),
    status: "error" as const,
    artifactIds: ["artifact-c"],
  }
  return {
    schemaVersion: THREAD_TREE_SCHEMA_VERSION,
    threads: {
      main: {
        id: "main",
        modelId: "glm-5.3",
        parentId: null,
        depth: 0,
        title: "A",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: ["b"],
        messages: [mainUser, mainAssistant],
        activeLeafMessageId: "a-assistant",
        lastActive: 1,
      },
      b: {
        id: "b",
        modelId: "glm-5.3",
        parentId: "main",
        depth: 1,
        title: "B",
        anchorText: "A答",
        forkFromMsgId: "a-assistant",
        footnote: 1,
        children: ["c"],
        messages: [bUser, bAssistant],
        activeLeafMessageId: "b-assistant",
        lastActive: 2,
      },
      c: {
        id: "c",
        modelId: "glm-5.3",
        parentId: "b",
        depth: 2,
        title: "C",
        anchorText: "B答",
        forkFromMsgId: "b-assistant",
        footnote: 2,
        children: [],
        messages: [cUser, cAssistant],
        activeLeafMessageId: "c-assistant",
        lastActive: 3,
      },
    },
    artifacts: {
      "artifact-c": {
        id: "artifact-c",
        title: "C 结论",
        kind: "markdown",
        content: "# C 结论",
        sourceThreadId: "c",
        sourceMessageId: "c-assistant",
      },
    },
    artifactOrder: ["artifact-c"],
    recents: [],
    footnoteCounter: 2,
    seq: 6,
    tick: 3,
  }
}

test("导入计划确定性拆分 A → B → C、partial Generation、Artifact 与反馈", () => {
  const now = new Date("2026-08-22T00:00:00.000Z")
  const input = {
    treeId: "tree-import",
    ownerUserId: "owner-import",
    title: "自动标题",
    customTitle: "归档标题",
    state: state(),
    generations: [
      {
        id: "generation-c",
        userId: "owner-import",
        threadId: "c",
        userMessageId: "c-user",
        assistantMessageId: "c-assistant",
        attempt: 1,
        isCurrent: true,
        status: "stopped" as const,
        modelId: "glm-5.3",
        intent: { kind: "persisted-turn" as const },
        result: {
          version: 1 as const,
          generationId: "generation-c",
          text: "C partial",
          status: "error" as const,
          artifactIds: ["artifact-c"],
          artifacts: {},
          usage: { inputTokens: 10, outputTokens: 5 },
        },
        billingStatus: "settled" as const,
        heartbeatAt: now,
        stopRequestedAt: now,
        finishedAt: now,
        createdAt: now,
        updatedAt: now,
        error: "stopped",
      },
    ],
    feedback: [
      {
        userId: "owner-import",
        threadId: "c",
        messageId: "c-assistant",
        feedback: "positive" as const,
        createdAt: now,
        updatedAt: now,
      },
    ],
  }

  projectLegacyThreadTree({
    legacyTreeId: input.treeId,
    workspaceId: workspaceId("workspace-test"),
    projectId: projectId("project-test"),
    conversationId: conversationId("conversation-test"),
    projectTitle: "测试",
    conversationAutoTitle: null,
    conversationCustomTitle: null,
    actorId: input.ownerUserId,
    state: input.state,
  })

  const first = buildLegacyConversationImportPlan(input)
  const second = buildLegacyConversationImportPlan(input)
  assert.deepEqual(first, second)
  assert.equal(Object.keys(first.snapshot.threads).length, 3)
  assert.equal(Object.keys(first.snapshot.threadForks).length, 2)
  assert.equal(first.artifacts[0]?.content, "# C 结论")
  assert.equal(first.generations[0]?.checkpoint.body, "C partial")
  assert.equal(first.generations[0]?.checkpoint.artifactIds.length, 1)
  assert.equal(first.generations[0]?.billingStatus, "settled")
  assert.equal(first.feedback[0]?.feedback, "positive")
  assert.ok(
    first.mappings.some(
      (entry) =>
        entry.entityType === "generation" && entry.localId === "generation-c"
    )
  )
})
