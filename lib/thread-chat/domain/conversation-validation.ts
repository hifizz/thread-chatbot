import type {
  ConversationMessage,
  ConversationSnapshot,
  ConversationThread,
  ConversationTurn,
  MessageId,
  MessageRole,
  ThreadFork,
  ThreadId,
} from "./conversation-model.ts"

export type ConversationValidationCode =
  | "project_mismatch"
  | "registry_key_mismatch"
  | "magic_thread_id"
  | "root_thread_missing"
  | "root_thread_mismatch"
  | "root_thread_title_duplicate"
  | "thread_conversation_mismatch"
  | "fork_conversation_mismatch"
  | "fork_thread_missing"
  | "fork_source_message_missing"
  | "fork_source_message_mismatch"
  | "root_has_incoming_fork"
  | "non_root_missing_fork"
  | "duplicate_incoming_fork"
  | "fork_cycle"
  | "turn_thread_missing"
  | "turn_thread_mismatch"
  | "duplicate_turn_position"
  | "active_message_missing"
  | "active_message_mismatch"
  | "active_message_role_mismatch"
  | "message_turn_missing"
  | "message_thread_mismatch"
  | "message_variant_missing"
  | "message_variant_mismatch"
  | "generation_thread_missing"
  | "generation_turn_missing"
  | "generation_message_missing"
  | "generation_identity_mismatch"
  | "generation_role_mismatch"
  | "generation_source_mismatch"
  | "artifact_source_mismatch"

export interface ConversationValidationIssue {
  readonly code: ConversationValidationCode
  readonly path: string
  readonly message: string
}

export class InvalidConversationSnapshotError extends Error {
  readonly issues: readonly ConversationValidationIssue[]

  constructor(issues: readonly ConversationValidationIssue[]) {
    super(issues.map((issue) => `${issue.code}@${issue.path}`).join(", "))
    this.name = "InvalidConversationSnapshotError"
    this.issues = issues
  }
}

function issue(
  issues: ConversationValidationIssue[],
  code: ConversationValidationCode,
  path: string,
  message: string
): void {
  issues.push({ code, path, message })
}

function validateRegistry<T extends { readonly id: string }>(
  registry: Readonly<Record<string, T>>,
  path: string,
  issues: ConversationValidationIssue[]
): void {
  for (const [key, entity] of Object.entries(registry)) {
    if (key !== entity.id)
      issue(
        issues,
        "registry_key_mismatch",
        `${path}.${key}`,
        `注册键 ${key} 与实体 ID ${entity.id} 不一致`
      )
  }
}

function validateThreads(
  snapshot: ConversationSnapshot,
  issues: ConversationValidationIssue[]
): void {
  const { conversation, threads, messages, threadForks } = snapshot
  const root = threads[conversation.rootThreadId]

  if (!root) {
    issue(
      issues,
      "root_thread_missing",
      "conversation.rootThreadId",
      "根 Thread 不存在"
    )
  } else if (root.conversationId !== conversation.id) {
    issue(
      issues,
      "root_thread_mismatch",
      `threads.${root.id}`,
      "根 Thread 不属于当前 Conversation"
    )
  } else if (root.localTitle?.trim()) {
    issue(
      issues,
      "root_thread_title_duplicate",
      `threads.${root.id}.localTitle`,
      "根 Thread 不得重复保存 Conversation 标题"
    )
  }

  for (const thread of Object.values(threads)) {
    if (thread.id === ("main" as ThreadId))
      issue(
        issues,
        "magic_thread_id",
        `threads.${thread.id}`,
        '规范 Thread ID 不得使用遗留魔法值 "main"'
      )
    if (thread.conversationId !== conversation.id)
      issue(
        issues,
        "thread_conversation_mismatch",
        `threads.${thread.id}.conversationId`,
        "Thread 不属于当前 Conversation"
      )
  }

  const incoming = new Map<ThreadId, ThreadFork[]>()
  for (const fork of Object.values(threadForks)) {
    if (fork.conversationId !== conversation.id)
      issue(
        issues,
        "fork_conversation_mismatch",
        `threadForks.${fork.id}.conversationId`,
        "ThreadFork 不属于当前 Conversation"
      )
    const parent = threads[fork.parentThreadId]
    const child = threads[fork.childThreadId]
    if (!parent || !child)
      issue(
        issues,
        "fork_thread_missing",
        `threadForks.${fork.id}`,
        "ThreadFork 的上游或下游 Thread 不存在"
      )
    const source = messages[fork.sourceMessageId]
    if (!source)
      issue(
        issues,
        "fork_source_message_missing",
        `threadForks.${fork.id}.sourceMessageId`,
        "ThreadFork 来源 Message 不存在"
      )
    else if (source.threadId !== fork.parentThreadId)
      issue(
        issues,
        "fork_source_message_mismatch",
        `threadForks.${fork.id}.sourceMessageId`,
        "ThreadFork 来源 Message 不属于上游 Thread"
      )
    const list = incoming.get(fork.childThreadId) ?? []
    list.push(fork)
    incoming.set(fork.childThreadId, list)
  }

  for (const thread of Object.values(threads)) {
    const count = incoming.get(thread.id)?.length ?? 0
    if (thread.id === conversation.rootThreadId && count > 0)
      issue(
        issues,
        "root_has_incoming_fork",
        `threads.${thread.id}`,
        "根 Thread 不得有入向 ThreadFork"
      )
    if (thread.id !== conversation.rootThreadId && count === 0)
      issue(
        issues,
        "non_root_missing_fork",
        `threads.${thread.id}`,
        "非根 Thread 必须有唯一入向 ThreadFork"
      )
    if (count > 1)
      issue(
        issues,
        "duplicate_incoming_fork",
        `threads.${thread.id}`,
        "Thread 存在多个入向 ThreadFork"
      )
  }

  const parentByChild = new Map<ThreadId, ThreadId>()
  for (const fork of Object.values(threadForks)) {
    if (!parentByChild.has(fork.childThreadId))
      parentByChild.set(fork.childThreadId, fork.parentThreadId)
  }
  for (const thread of Object.values(threads)) {
    const visited = new Set<ThreadId>()
    let cursor: ThreadId | undefined = thread.id
    while (cursor) {
      if (visited.has(cursor)) {
        issue(
          issues,
          "fork_cycle",
          `threads.${thread.id}`,
          "ThreadFork 图存在环"
        )
        break
      }
      visited.add(cursor)
      cursor = parentByChild.get(cursor)
    }
  }
}

function validateTurnsAndMessages(
  snapshot: ConversationSnapshot,
  issues: ConversationValidationIssue[]
): void {
  const { turns, messages, threads } = snapshot
  const positions = new Set<string>()
  for (const turn of Object.values(turns)) {
    if (!threads[turn.threadId])
      issue(
        issues,
        "turn_thread_missing",
        `turns.${turn.id}.threadId`,
        "Turn 所属 Thread 不存在"
      )
    const positionKey = `${turn.threadId}:${turn.position}`
    if (positions.has(positionKey))
      issue(
        issues,
        "duplicate_turn_position",
        `turns.${turn.id}.position`,
        "同一 Thread 中存在重复 Turn 位置"
      )
    positions.add(positionKey)

    validateActiveMessage(
      turn,
      turn.activeUserMessageId,
      "user",
      snapshot,
      issues
    )
    validateActiveMessage(
      turn,
      turn.activeAssistantMessageId,
      "assistant",
      snapshot,
      issues
    )
  }

  for (const message of Object.values(messages)) {
    const turn = turns[message.turnId]
    if (!turn) {
      issue(
        issues,
        "message_turn_missing",
        `messages.${message.id}.turnId`,
        "Message 所属 Turn 不存在"
      )
      continue
    }
    if (message.threadId !== turn.threadId)
      issue(
        issues,
        "message_thread_mismatch",
        `messages.${message.id}.threadId`,
        "Message 与 Turn 不属于同一 Thread"
      )
    if (message.variantOfMessageId) {
      const source = messages[message.variantOfMessageId]
      if (!source)
        issue(
          issues,
          "message_variant_missing",
          `messages.${message.id}.variantOfMessageId`,
          "Message 变体来源不存在"
        )
      else if (
        source.threadId !== message.threadId ||
        source.turnId !== message.turnId ||
        source.role !== message.role
      )
        issue(
          issues,
          "message_variant_mismatch",
          `messages.${message.id}.variantOfMessageId`,
          "Message 变体来源必须属于同一 Thread/Turn 且角色一致"
        )
    }
  }
}

function validateActiveMessage(
  turn: ConversationTurn,
  activeMessageId: MessageId,
  expectedRole: MessageRole,
  snapshot: ConversationSnapshot,
  issues: ConversationValidationIssue[]
): void {
  const active = snapshot.messages[activeMessageId]
  const path = `turns.${turn.id}.${
    expectedRole === "user" ? "activeUserMessageId" : "activeAssistantMessageId"
  }`
  if (!active) {
    issue(issues, "active_message_missing", path, "当前有效 Message 不存在")
    return
  }
  if (active.turnId !== turn.id || active.threadId !== turn.threadId)
    issue(
      issues,
      "active_message_mismatch",
      path,
      "当前有效 Message 不属于该 Thread/Turn"
    )
  if (active.role !== expectedRole)
    issue(
      issues,
      "active_message_role_mismatch",
      path,
      `当前有效 Message 角色必须是 ${expectedRole}`
    )
}

function validateGenerations(
  snapshot: ConversationSnapshot,
  issues: ConversationValidationIssue[]
): void {
  for (const generation of Object.values(snapshot.generations)) {
    const thread = snapshot.threads[generation.threadId]
    const turn = snapshot.turns[generation.turnId]
    const input = snapshot.messages[generation.inputMessageId]
    const output = snapshot.messages[generation.outputMessageId]
    if (!thread)
      issue(
        issues,
        "generation_thread_missing",
        `generations.${generation.id}.threadId`,
        "Generation 所属 Thread 不存在"
      )
    if (!turn)
      issue(
        issues,
        "generation_turn_missing",
        `generations.${generation.id}.turnId`,
        "Generation 所属 Turn 不存在"
      )
    if (!input || !output) {
      issue(
        issues,
        "generation_message_missing",
        `generations.${generation.id}`,
        "Generation 输入或输出 Message 不存在"
      )
      continue
    }
    if (
      !turn ||
      input.threadId !== generation.threadId ||
      output.threadId !== generation.threadId ||
      input.turnId !== generation.turnId ||
      output.turnId !== generation.turnId ||
      turn.threadId !== generation.threadId
    )
      issue(
        issues,
        "generation_identity_mismatch",
        `generations.${generation.id}`,
        "Generation、Turn 与输入输出 Message 身份不一致"
      )
    if (input.role !== "user" || output.role !== "assistant")
      issue(
        issues,
        "generation_role_mismatch",
        `generations.${generation.id}`,
        "Generation 输入必须是 user，输出必须是 assistant"
      )

    const sourceId =
      generation.intent.kind === "regenerate-assistant"
        ? generation.intent.sourceAssistantMessageId
        : generation.intent.kind === "edit-user"
          ? generation.intent.sourceUserMessageId
          : undefined
    if (sourceId) {
      const source = snapshot.messages[sourceId]
      if (
        !source ||
        source.threadId !== generation.threadId ||
        source.turnId !== generation.turnId
      )
        issue(
          issues,
          "generation_source_mismatch",
          `generations.${generation.id}.intent`,
          "Generation 变体来源不属于同一 Thread/Turn"
        )
    }
  }
}

function validateArtifacts(
  snapshot: ConversationSnapshot,
  issues: ConversationValidationIssue[]
): void {
  for (const artifact of Object.values(snapshot.artifactProvenance)) {
    const source = snapshot.messages[artifact.sourceMessageId]
    if (
      !source ||
      source.threadId !== artifact.sourceThreadId ||
      source.role !== "assistant"
    )
      issue(
        issues,
        "artifact_source_mismatch",
        `artifactProvenance.${artifact.id}`,
        "Artifact 来源必须是声明 Thread 中的 assistant Message"
      )
  }
}

export function validateConversationSnapshot(
  snapshot: ConversationSnapshot
): readonly ConversationValidationIssue[] {
  const issues: ConversationValidationIssue[] = []
  if (snapshot.project.id !== snapshot.conversation.projectId)
    issue(
      issues,
      "project_mismatch",
      "conversation.projectId",
      "Conversation 不属于快照 Project"
    )

  validateRegistry(snapshot.threads, "threads", issues)
  validateRegistry(snapshot.threadForks, "threadForks", issues)
  validateRegistry(snapshot.turns, "turns", issues)
  validateRegistry(snapshot.messages, "messages", issues)
  validateRegistry(snapshot.generations, "generations", issues)
  validateRegistry(snapshot.artifactProvenance, "artifactProvenance", issues)
  validateThreads(snapshot, issues)
  validateTurnsAndMessages(snapshot, issues)
  validateGenerations(snapshot, issues)
  validateArtifacts(snapshot, issues)
  return issues
}

export function assertValidConversationSnapshot(
  snapshot: ConversationSnapshot
): void {
  const issues = validateConversationSnapshot(snapshot)
  if (issues.length > 0) throw new InvalidConversationSnapshotError(issues)
}

export type ThreadRole = "main" | "branch"

export function deriveThreadRole(
  snapshot: ConversationSnapshot,
  thread: ConversationThread
): ThreadRole {
  return thread.id === snapshot.conversation.rootThreadId ? "main" : "branch"
}
