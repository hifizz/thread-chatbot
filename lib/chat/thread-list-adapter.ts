import type { RemoteThreadListAdapter } from "@assistant-ui/react"
import type { RemoteThreadMetadata } from "@assistant-ui/core"
import { createAssistantStream } from "assistant-stream"

type ThreadRow = {
  id: string
  title: string | null
  status: "regular" | "archived"
  lastMessageAt: string | null
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  })
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${path} failed: ${res.status}`)
  // DELETE 返回 204 No Content（空 body），res.json() 对空 body 会抛 SyntaxError
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const toMetadata = (row: ThreadRow): RemoteThreadMetadata => ({
  remoteId: row.id,
  status: row.status,
  title: row.title ?? undefined,
  lastMessageAt: row.lastMessageAt ? new Date(row.lastMessageAt) : undefined,
})

export const postgresThreadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const { threads } = await api<{ threads: ThreadRow[] }>("/api/threads")
    return { threads: threads.map(toMetadata) }
  },

  async initialize(threadId) {
    const thread = await api<ThreadRow>("/api/threads", {
      method: "POST",
      body: JSON.stringify({ id: threadId }),
    })
    return { remoteId: thread.id, externalId: undefined }
  },

  async rename(remoteId, newTitle) {
    await api(`/api/threads/${remoteId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: newTitle }),
    })
  },

  async archive(remoteId) {
    await api(`/api/threads/${remoteId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "archived" }),
    })
  },

  async unarchive(remoteId) {
    await api(`/api/threads/${remoteId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "regular" }),
    })
  },

  async delete(remoteId) {
    await api(`/api/threads/${remoteId}`, { method: "DELETE" })
  },

  async fetch(threadId) {
    const row = await api<ThreadRow>(`/api/threads/${threadId}`)
    return toMetadata(row)
  },

  async generateTitle(remoteId, messages) {
    // MVP: derive the title from the first user message's text instead of an
    // extra LLM round-trip. Swappable for a real summary later without
    // changing the adapter contract.
    const firstUserText = messages
      .find((m) => m.role === "user")
      ?.content.find((part) => part.type === "text")

    const title = ((firstUserText as { text?: string } | undefined)?.text ?? "New Chat")
      .slice(0, 60)

    await api(`/api/threads/${remoteId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    })

    return createAssistantStream((controller) => {
      controller.appendText(title)
    })
  },
}
