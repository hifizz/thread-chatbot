"use client"
import { useMemo, useRef, useState } from "react"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"
import { composerDraftToMessageContent } from "@/lib/thread-chat/contracts/message-content"
import { artifactReferenceData } from "@/lib/thread-chat/contracts/artifact-reference"
import type { ConversationViewMessage } from "@/app/thread-chat/core/types"
import { EditableUserMessage } from "@/app/thread-chat/chat/message/editable-user-message"
import { MessageEditor } from "@/app/thread-chat/chat/composer/message-editor"
import { ConversationComposer } from "@/app/thread-chat/chat/composer/conversation-composer"
import { ComposerDraftProvider } from "@/app/thread-chat/chat/composer/composer-drafts"
import { ArtifactResourcesProvider } from "@/app/thread-chat/chat/composer/artifact-resources"
import { createConversationStore } from "@/app/thread-chat/core/store"
import "@/app/thread-chat/thread-chat.css"
export function ContentHarness() {
  const [draft, setDraft] = useState<ThreadComposerDraft>({ parts: [] })
  const [full, setFull] = useState(false)
  const [bottom, setBottom] = useState(false)
  const [submitted, setSubmitted] = useState("")
  const artifacts = useMemo(() => Object.fromEntries(Array.from({ length: 8 }, (_, index) => {
    const id = `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`
    return [id, { id, projectId: "10000000-0000-4000-8000-000000000010", threadId: "10000000-0000-4000-8000-000000000011", sourceMessageId: "10000000-0000-4000-8000-000000000012", sourceThreadTitle: "研究分支", sourceThreadFootnote: 1, sourceMessageStatus: "completed", kind: "markdown", title: `测试文档 ${index + 1}`, content: "冻结正文", language: null, metadata: {}, createdAt: "2026-09-07", updatedAt: "2026-09-07" } satisfies ArtifactDTO]
  })), [])
  if (full) return <DraftHarness artifacts={artifacts} />
  return <main className="tc" style={{ padding: 24 }}>
    <button onClick={() => setFull(true)}>完整输入框</button>
    <button onClick={() => setBottom(!bottom)}>切换底部输入框</button>
    <pre data-testid="submitted">{submitted}</pre>
    <section style={bottom ? { position: "fixed", bottom: 16, left: 24, width: 320 } : { marginTop: 24, width: 320 }}>
      <MessageEditor draft={draft} artifacts={artifacts} onChange={setDraft} onSubmit={() => { try { setSubmitted(JSON.stringify(composerDraftToMessageContent(draft))) } catch (error) { setSubmitted(String(error)) } }} />
    </section>
  </main>
}

function DraftHarness({ artifacts }: { artifacts: Record<string, ArtifactDTO> }) {
  const [store] = useState(() => { const store = createConversationStore(); store.setState({ artifactsById: artifacts }); return store })
  const [editMode, setEditMode] = useState(false)
  const [threadId, setThreadId] = useState("thread-a")
  const [canvas, setCanvas] = useState(false)
  const [submitted, setSubmitted] = useState("")
  const artifact = Object.values(artifacts)[0]
  const message: ConversationViewMessage = {
    id: "original-user", role: "user", parentMessageId: null, forks: [], text: "前文 后文",
    uiParts: [
      { type: "text", text: "前文 " },
      { type: "file", url: "/api/attachments/10000000-0000-4000-8000-000000000050", mediaType: "text/plain", filename: "notes.txt" },
      { type: "data-artifact-reference", data: artifactReferenceData(artifact) },
      { type: "data-quote", data: { text: "旧 Quote 原文" } },
      { type: "text", text: " 后文" },
      { type: "data-artifact-reference", data: artifactReferenceData(artifact) },
    ],
  }
  const pending = useRef<{ resolve: () => void; reject: (error: Error) => void } | null>(null)
  return <main className="tc" style={{ padding: 24 }}>
    <button onClick={() => setEditMode(true)}>混排消息编辑</button>
    <button onClick={() => setThreadId(threadId === "thread-a" ? "thread-b" : "thread-a")}>切换 Thread</button>
    <button onClick={() => setCanvas(!canvas)}>切换视图</button>
    <button onClick={() => pending.current?.resolve()}>完成发送</button>
    <button onClick={() => pending.current?.reject(new Error("测试发送失败"))}>发送失败</button>
    <pre data-testid="submitted">{submitted}</pre>
    <ArtifactResourcesProvider store={store}><ComposerDraftProvider>
      <section key={canvas ? "canvas" : "column"} style={{ width: 360 }}>
        {editMode ? <EditableUserMessage threadId={threadId} message={message} editable commands={{
          retryUserTurn: async () => ({ ok: false, code: "invalid_request", message: "测试页不调用模型" }),
          editAndRegenerate: async (_threadId, _messageId, content) => {
            setSubmitted(JSON.stringify(content))
            return { ok: true, generationId: "test-generation", userMessageId: "test-user", assistantMessageId: "test-assistant" }
          },
        }} /> : <ConversationComposer threadId={threadId} variant={canvas ? "canvas" : "column"} busy={false} isMain modelSelectorDisabled onSend={(content) => {
          setSubmitted(JSON.stringify(content))
          return new Promise<void>((resolve, reject) => { pending.current = { resolve, reject } })
        }} />}
      </section>
    </ComposerDraftProvider></ArtifactResourcesProvider>
  </main>
}
