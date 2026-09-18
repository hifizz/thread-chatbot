"use client"

import { useRef, useState } from "react"
import { GitBranch, Loader2 } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { MESSAGE_FORK_LABELS } from "@/constants/message-fork"
import { isMessageFork } from "@/lib/thread-chat/domain/fork-origin"
import type { Message, ThreadTreeState } from "../core/types"
import { threadTitle } from "../core/selectors"
import { hasCompletedAssistantActions } from "../chat/actions/message-action-types"

/** 无选区分支的创建与回访：与复制/点赞同排的消息动作图标 + 分支计数菜单。 */
export function MessageForkActions({
  state,
  message,
  onFork,
  onOpenThread,
}: {
  state: ThreadTreeState
  message: Message
  onFork?: () => Promise<void>
  onOpenThread: (id: string, options?: { keepSource?: boolean }) => void
}) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!hasCompletedAssistantActions(message)) return null
  const branches = message.forks.filter(isMessageFork)
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

  const label = busy ? MESSAGE_FORK_LABELS.creating : MESSAGE_FORK_LABELS.create
  const createButton = (
    <button
      type="button"
      className="message-action"
      aria-label={label}
      aria-busy={busy || undefined}
      disabled={busy}
      onClick={() => void createBranch()}
    >
      {busy ? (
        <Loader2 size={14} className="is-spinning" aria-hidden="true" />
      ) : (
        <GitBranch size={14} aria-hidden="true" />
      )}
    </button>
  )

  return (
    <>
      {onFork && (
        <TooltipProvider delay={300}>
          <Tooltip>
            <TooltipTrigger
              render={
                busy ? (
                  <span className="message-action-trigger" tabIndex={0} />
                ) : (
                  createButton
                )
              }
            >
              {busy ? createButton : undefined}
            </TooltipTrigger>
            <TooltipContent side="top">{label}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
      {branches.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger className="message-fork-count">
            {MESSAGE_FORK_LABELS.branchCount(branches.length)}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {branches.map((fork) => (
              <DropdownMenuItem
                key={fork.threadId}
                onClick={(event) =>
                  onOpenThread(fork.threadId, {
                    keepSource: event.metaKey || event.ctrlKey,
                  })
                }
              >
                {fork.num} · {threadTitle(state, fork.threadId)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {error && (
        <div className="message-action-error" role="alert">
          {error}
        </div>
      )}
    </>
  )
}
