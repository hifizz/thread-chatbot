"use client"

import { useRef, useState } from "react"
import { GitBranch } from "lucide-react"
import { MESSAGE_FORK_LABELS } from "@/constants/message-fork"
import type { Message, ThreadTreeState } from "../core/types"
import { threadTitle } from "../core/selectors"
import { hasCompletedAssistantActions } from "../chat/actions/message-action-types"

/** 无选区分支的创建和回访入口，挂在共享消息后置区。 */
export function MessageForkActions({
  state,
  message,
  onFork,
  onOpenThread,
}: {
  state: ThreadTreeState
  message: Message
  onFork?: () => Promise<unknown>
  onOpenThread: (id: string, options?: { keepSource?: boolean }) => void
}) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!hasCompletedAssistantActions(message)) return null
  const branches = message.forks.filter((fork) => !fork.anchor && !fork.text)
  if (!onFork && branches.length === 0) return null

  const createBranch = async () => {
    if (!onFork || pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      await onFork()
    } catch {
      setError(MESSAGE_FORK_LABELS.failed)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return (
    <div className="message-fork-actions">
      {onFork && (
        <button
          type="button"
          className="cbtn"
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={() => void createBranch()}
        >
          <GitBranch size={14} aria-hidden="true" />
          {busy ? MESSAGE_FORK_LABELS.creating : MESSAGE_FORK_LABELS.create}
        </button>
      )}
      {branches.map((fork) => (
        <button
          key={fork.threadId}
          type="button"
          className="cbtn"
          onClick={(event) => onOpenThread(fork.threadId, {
            keepSource: event.metaKey || event.ctrlKey,
          })}
        >
          {fork.num} · {threadTitle(state, fork.threadId)}
        </button>
      ))}
      {error && <div className="message-action-error" role="alert">{error}</div>}
    </div>
  )
}
