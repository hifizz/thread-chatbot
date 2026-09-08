"use client"

import { useEffect, useState } from "react"
import { SelectionBubble, type SelectionInfo } from "@/app/thread-chat/branching/selection/selection-bubble"
import type { ThreadTreeState } from "@/app/thread-chat/core/types"
import { DEFAULT_THREAD_CHAT_MODEL_ID } from "@/constants/models"
import { THREAD_TREE_SCHEMA_VERSION } from "@/constants/thread-chat"

const messageId = "20000000-0000-4000-8000-000000000001"
const text = "这是一段可以划选的回答，用于验证引用后继续提问和开启新的分支。"
export function SelectionFixture({ threadId }: { threadId: string }) {
  const [sel, setSel] = useState<SelectionInfo | null>(null)
  const [fork, setFork] = useState("")
  const state: ThreadTreeState = {
    schemaVersion: THREAD_TREE_SCHEMA_VERSION, artifacts: {}, artifactOrder: [], recents: [], footnoteCounter: 0, seq: 0, tick: 0,
    threads: { [threadId]: { id: threadId, modelId: DEFAULT_THREAD_CHAT_MODEL_ID, parentId: null, depth: 0, title: "测试",
      anchorText: null, forkFromMsgId: null, footnote: null, children: [], activeLeafMessageId: messageId, lastActive: 0,
      messages: [{ id: messageId, parentMessageId: null, role: "assistant", status: "done", text, forks: [] }],
    } },
  }
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.isComposing) setSel(null) }
    document.addEventListener("keydown", close)
    return () => document.removeEventListener("keydown", close)
  }, [])
  return <>
    <div className="msg-list" data-list={threadId} style={{ marginTop: 80 }}>
      <div className="message" data-msg-id={messageId}><div className="md-body" data-testid="selection-source">{text}</div></div>
    </div>
    <output data-testid="selection-fork">{fork}</output>
    <SelectionBubble state={state} sel={sel} onSelChange={setSel} onFork={(selection, hint, question) => setFork(JSON.stringify({ selection, hint, question }))}
      slots={[]} mode="replace" maxExpanded={3} lastActiveOf={() => 0} />
  </>
}
