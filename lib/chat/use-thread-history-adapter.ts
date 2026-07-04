"use client"

import { useMemo } from "react"
import { useAui, type ThreadHistoryAdapter } from "@assistant-ui/react"

type MessageRow = {
  id: string
  parentId: string | null
  format: string
  content: unknown
}

export function usePostgresThreadHistoryAdapter(): ThreadHistoryAdapter {
  const aui = useAui()

  return useMemo<ThreadHistoryAdapter>(
    () => ({
      // Never called directly: useChatRuntime always goes through withFormat().
      load: async () => ({ messages: [] }),
      append: async () => {},

      withFormat(formatAdapter) {
        return {
          async load() {
            const remoteId = aui.threadListItem.source
              ? aui.threadListItem().getState().remoteId
              : undefined
            if (!remoteId) return { messages: [] }

            const res = await fetch(`/api/threads/${remoteId}/messages`)
            if (!res.ok) return { messages: [] }

            const rows: MessageRow[] = await res.json()
            const messages = rows.map((row) =>
              formatAdapter.decode({
                id: row.id,
                parent_id: row.parentId,
                format: row.format,
                content: row.content as never,
              }),
            )
            return { headId: rows.at(-1)?.id ?? null, messages }
          },

          async append(item) {
            const remoteId = aui.threadListItem.source
              ? aui.threadListItem().getState().remoteId
              : undefined
            if (!remoteId) return

            await fetch(`/api/threads/${remoteId}/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: formatAdapter.getId(item.message),
                parentId: item.parentId,
                content: formatAdapter.encode(item),
              }),
            })
          },
        }
      },
    }),
    [aui],
  )
}
