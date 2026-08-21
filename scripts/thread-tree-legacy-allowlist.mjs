/**
 * Issue #34 迁移期间允许读取遗留整树字段的边界。
 *
 * 新增条目前必须说明为何不能改用规范 Conversation 实体；迁移完成后应删除本文件。
 */
export const THREAD_TREE_LEGACY_ALLOWLIST = Object.freeze([
  "lib/thread-chat/application/compile-thread-chat-messages.ts",
  "lib/thread-chat/application/merge-generation-result.ts",
  "lib/thread-chat/application/reconcile-turns.ts",
  "lib/thread-chat/application/serialize-message-for-model.ts",
  "lib/thread-chat/domain/conversation-model.test.ts",
  "lib/thread-chat/domain/generation.ts",
  "lib/thread-chat/domain/message-graph.ts",
  "lib/thread-chat/domain/regeneration.ts",
  "lib/thread-chat/domain/selectors.ts",
  "lib/thread-chat/domain/types.ts",
])
