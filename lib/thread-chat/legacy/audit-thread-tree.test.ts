import assert from "node:assert/strict"
import test from "node:test"

import { THREAD_TREE_SCHEMA_VERSION } from "../../../constants/thread-chat.ts"
import type { ThreadTreeState } from "../domain/types.ts"
import { auditLegacyConversation } from "./audit-thread-tree.ts"

function validState(): ThreadTreeState {
  return {
    schemaVersion: THREAD_TREE_SCHEMA_VERSION,
    threads: {
      main: {
        id: "main",
        modelId: "ark-glm-5.3",
        parentId: null,
        depth: 0,
        title: "根",
        anchorText: null,
        forkFromMsgId: null,
        footnote: null,
        children: [],
        messages: [
          {
            id: "user-1",
            parentMessageId: null,
            role: "user",
            text: "问题",
            forks: [],
          },
          {
            id: "assistant-1",
            parentMessageId: "user-1",
            role: "assistant",
            text: "回答",
            forks: [],
          },
        ],
        activeLeafMessageId: "assistant-1",
        lastActive: 1,
      },
    },
    artifacts: {},
    artifactOrder: [],
    recents: [],
    footnoteCounter: 0,
    seq: 2,
    tick: 1,
  }
}

test("合法遗留树产生确定映射且保持只读", () => {
  const state = validState()
  const before = structuredClone(state)
  const first = auditLegacyConversation({
    treeId: "audit-valid",
    ownerUserId: "owner-1",
    state,
    generations: [
      {
        id: "generation-1",
        threadId: "main",
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
      },
    ],
    feedback: [{ threadId: "main", messageId: "assistant-1" }],
  })
  const second = auditLegacyConversation({
    treeId: "audit-valid",
    ownerUserId: "owner-1",
    state,
    generations: [
      {
        id: "generation-1",
        threadId: "main",
        userMessageId: "user-1",
        assistantMessageId: "assistant-1",
      },
    ],
    feedback: [{ threadId: "main", messageId: "assistant-1" }],
  })

  assert.equal(first.disposition, "migratable")
  assert.deepEqual(first, second)
  assert.deepEqual(state, before)
  assert.equal(first.counts.threads, 1)
  assert.equal(first.counts.turns, 1)
  assert.equal(first.counts.messages, 2)
})

test("污染引用使用稳定错误码报告", () => {
  const state = validState() as unknown as Record<string, unknown>
  const threads = state.threads as Record<string, Record<string, unknown>>
  const main = threads.main!
  main.activeLeafMessageId = "missing-active"
  main.children = ["branch"]
  const mainMessages = main.messages as Array<Record<string, unknown>>
  mainMessages[1]!.forks = []
  threads.branch = {
    id: "branch",
    modelId: "ark-glm-5.3",
    parentId: "main",
    depth: 1,
    title: "分支",
    anchorText: "回答",
    forkFromMsgId: "missing-source",
    footnote: 1,
    children: [],
    messages: [
      {
        id: "assistant-1",
        parentMessageId: "missing-parent",
        role: "assistant",
        text: "重复 ID",
        forks: [],
      },
    ],
    activeLeafMessageId: "assistant-1",
    lastActive: 2,
  }
  state.artifacts = {
    artifact: {
      id: "artifact",
      title: "污染 Artifact",
      kind: "markdown",
      content: "x",
      sourceThreadId: "missing-thread",
      sourceMessageId: "missing-message",
    },
  }

  const report = auditLegacyConversation({
    treeId: "audit-invalid",
    ownerUserId: null,
    state,
    generations: [
      {
        id: "generation-invalid",
        ownerUserId: "other-owner",
        intentPresent: false,
        threadId: "missing-thread",
        userMessageId: "missing-user",
        assistantMessageId: "missing-assistant",
      },
    ],
    feedback: [
      {
        ownerUserId: "other-owner",
        threadId: "main",
        messageId: "missing-feedback-message",
      },
    ],
  })
  const codes = new Set(report.issues.map((entry) => entry.code))

  assert.equal(report.disposition, "rejected")
  for (const code of [
    "owner_missing",
    "duplicate_message_id",
    "message_parent_missing",
    "active_leaf_missing",
    "fork_source_missing",
    "artifact_source_thread_missing",
    "generation_thread_missing",
    "generation_owner_mismatch",
    "generation_intent_missing",
    "feedback_message_missing",
    "feedback_owner_mismatch",
    "canonical_projection_failed",
  ] as const)
    assert.ok(codes.has(code), `缺少稳定错误码 ${code}`)
})
