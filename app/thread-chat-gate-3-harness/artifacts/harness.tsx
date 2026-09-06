"use client"

import { useState } from "react"
import { ArtifactComposerProvider } from "../../thread-chat/chat/composer/artifact-composer-context"
import { ConversationComposer } from "../../thread-chat/chat/composer/conversation-composer"
import { InlineArtifactEditor } from "../../thread-chat/chat/composer/inline-artifact-editor"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { InlineComposerPart } from "@/lib/thread-chat/contracts/artifact-reference"
import type { MessageContentPartInput } from "@/lib/thread-chat/contracts/message-content"
import "../../thread-chat/thread-chat.css"

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const artifacts: ArtifactDTO[] = [
  ["研究结论", "深层分支", "completed"],
  ["研究结论", "兄弟分支", "completed"],
  ["本轮方案", "当前 Thread", "completed"],
  ["未完成产物", "深层分支", "generating"],
].map(([title, sourceThreadTitle, status], i) => ({
  id: id(i + 10), projectId: id(1), threadId: id(i + 2), sourceMessageId: id(i + 20),
  title, sourceThreadTitle, sourceThreadFootnote: i, sourceMessageStatus: status as ArtifactDTO["sourceMessageStatus"],
  kind: "markdown", content: `完整正文 ${i}`, language: null, metadata: {},
  createdAt: "2026-09-06T00:00:00.000Z", updatedAt: "2026-09-06T00:00:00.000Z",
}))

/** 无认证、数据库或模型依赖的开发测试页面；生产环境不可访问。 */
export function ArtifactReferenceHarness() {
  const [thread, setThread] = useState(id(4))
  const [variant, setVariant] = useState<"column" | "canvas">("column")
  const [fail, setFail] = useState(false)
  const [sent, setSent] = useState<MessageContentPartInput[]>([])
  const [opened, setOpened] = useState("")
  const [editing, setEditing] = useState(false)
  const [edit, setEdit] = useState<InlineComposerPart[]>([])
  return <ArtifactComposerProvider artifacts={artifacts} openArtifact={setOpened}>
    <main className="tc" style={{ padding: 24, height: "100vh", overflow: "auto" }}>
      <h1>Artifact 行内引用测试</h1>
      <nav style={{ display: "flex", gap: 16, margin: "20px 0" }}>
        <button onClick={() => setThread(thread === id(4) ? id(3) : id(4))}>切换 Thread（{thread === id(4) ? "当前" : "兄弟"}）</button>
        <button onClick={() => setVariant(variant === "column" ? "canvas" : "column")}>切换视图（{variant}）</button>
        <label><input type="checkbox" checked={fail} onChange={(e) => setFail(e.target.checked)} />模拟发送失败</label>
      </nav>
      <section style={{ maxWidth: 680 }}>
        <ConversationComposer key={`${thread}-${variant}`} threadId={thread} variant={variant}
          isMain={thread === id(4)} busy={false} modelSelectorDisabled
          onSend={async (_text, _files, parts) => {
            if (fail) throw new Error("测试发送失败")
            setSent(parts ?? [])
          }} />
      </section>
      <pre aria-label="已发送 Parts">{JSON.stringify(sent, null, 2)}</pre>
      <p>已打开：<output aria-label="已打开 Artifact">{opened}</output></p>
      <button onClick={() => {
        setEdit(sent.filter((p): p is InlineComposerPart => p.type === "text" || p.type === "artifact-reference"))
        setEditing(true)
      }}>编辑已发送内容</button>
      {editing && <section style={{ maxWidth: 680, marginTop: 16 }}>
        <InlineArtifactEditor value={edit} onChange={setEdit} label="编辑测试输入框" />
        <pre aria-label="编辑 Parts">{JSON.stringify(edit, null, 2)}</pre>
      </section>}
    </main>
  </ArtifactComposerProvider>
}
