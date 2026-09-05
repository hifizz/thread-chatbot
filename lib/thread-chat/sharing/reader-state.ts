import { THREAD_TREE_SCHEMA_VERSION } from "@/constants/thread-chat"
import { SHARE_PENDING } from "@/constants/sharing"
import type { ThreadTreeState, Message } from "../domain/types"
import type { PublicMessage, PublicProjectSnapshot } from "./contracts"

export function readerThreadId(snapshot: PublicProjectSnapshot, id: string) { return id === snapshot.rootThreadId ? "main" : id }
export function readerMessage(message: PublicMessage): Message {
  return { id: message.id, parentMessageId: null, role: message.role,
    text: message.status === "generating" ? SHARE_PENDING : message.parts.filter((part) => part.type === "text").map((part) => part.text).join("\n"),
    forks: [], status: message.status === "failed" ? "error" : message.status === "stopped" ? "stopped" : "done",
  }
}
/** 仅适配现有纯阅读组件；不实例化私有会话 store。 */
export function readerTree(snapshot: PublicProjectSnapshot): ThreadTreeState {
  const idOf = (id: string) => readerThreadId(snapshot, id)
  return {
    schemaVersion: THREAD_TREE_SCHEMA_VERSION, recents: [], footnoteCounter: 0, seq: 0, tick: 0,
    threads: Object.fromEntries(snapshot.threads.map((thread) => {
      const visible = snapshot.messages.filter((m) => m.threadId === thread.id && !m.historical).map(readerMessage)
      visible.forEach((message, i) => { message.parentMessageId = visible[i - 1]?.id ?? null; message.artifactIds = snapshot.artifacts.filter((a) => a.sourceMessageId === message.id).map((a) => a.id) })
      return [idOf(thread.id), { id: idOf(thread.id), modelId: "", parentId: thread.parentId ? idOf(thread.parentId) : null, title: thread.title, depth: thread.depth, footnote: thread.footnote, anchorText: thread.anchorText, forkFromMsgId: thread.forkMessageId,
        children: snapshot.threads.filter((t) => t.parentId === thread.id).map((t) => idOf(t.id)), messages: visible, activeLeafMessageId: visible.at(-1)?.id ?? null, lastActive: 0 }]
    })),
    artifacts: Object.fromEntries(snapshot.artifacts.map((a) => [a.id, { id: a.id, title: a.title, kind: "markdown", content: a.content, sourceThreadId: idOf(a.threadId), sourceMessageId: a.sourceMessageId }])),
    artifactOrder: snapshot.artifacts.map((a) => a.id),
  }
}
