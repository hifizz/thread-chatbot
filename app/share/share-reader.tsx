"use client"
import { useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { MarkdownBody, PublicMarkdownContext } from "@/app/thread-chat/chat/message/markdown-body"
import { ConversationMessage } from "@/app/thread-chat/chat/message/conversation-message"
import { ThreadColumns } from "@/app/thread-chat/orchestration/columns/thread-columns"
import type { CanvasViewState } from "@/app/thread-chat/orchestration/canvas/use-canvas-layout"
import { buildMessageActionViewState } from "@/app/thread-chat/chat/actions/message-action-presentation"
import { readerMessage, readerThreadId, readerTree } from "@/lib/thread-chat/sharing/reader-state"
import { safePublicHref } from "@/lib/thread-chat/sharing/content"
import type { PublicMessage, PublicProjectSnapshot, PublicSnapshot } from "@/lib/thread-chat/sharing/contracts"
import { SHARE_ATTACHMENT, SHARE_PENDING } from "@/constants/sharing"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { AnchoredMarkdown } from "@/app/thread-chat/branching/assistant/anchored-markdown"
import type { ThreadTreeState, Message } from "@/lib/thread-chat/domain/types"
import { useCopyMarkdown } from "@/app/thread-chat/chat/actions/use-copy-markdown"

const ThreadCanvas = dynamic(() => import("@/app/thread-chat/orchestration/canvas/thread-canvas").then((m) => m.ThreadCanvas), { ssr: false })

function CopyButton({ text }: { text: string }) {
  const [label, setLabel] = useState("复制正文")
  const { copied, copy } = useCopyMarkdown(() => setLabel("复制失败，请手动选择正文"))
  return <button className="cbtn" onClick={() => void copy(text)}>{copied ? "已复制" : label}</button>
}
function MessageBody({ message, tree, display, onOpenThread }: { message: PublicMessage; tree: ThreadTreeState; display: Message; onOpenThread(id: string): void }) {
  if (message.status === "generating") return <p>{SHARE_PENDING}</p>
  return message.parts.map((part, index) => {
    if (part.type === "attachment") return <p key={index}>[{SHARE_ATTACHMENT}]</p>
    if (part.type === "quote") return <blockquote key={index}>{part.text}</blockquote>
    if (part.type === "reasoning") return <details key={index}><summary>思考过程</summary><MarkdownBody source={part.text} /></details>
    if (part.type === "source") {
      const href = safePublicHref(part.url)
      return href ? <p key={index}><a href={href} target="_blank" rel="noopener noreferrer nofollow">{part.title} ↗</a></p> : null
    }
    return <AnchoredMarkdown key={index} state={tree} msg={display} source={part.text} onOpenThread={onOpenThread} />
  })
}
function ProjectReader({ snapshot }: { snapshot: PublicProjectSnapshot }) {
  const idOf = (id: string) => readerThreadId(snapshot, id)
  const tree = useMemo(() => readerTree(snapshot), [snapshot])
  const store = useMemo(() => ({ subscribe: () => () => {}, getVersion: () => 0, getState: () => tree, setThreadModel: () => {} }), [tree])
  const actions = useMemo(() => buildMessageActionViewState({ state: tree, recoverableByUserMessageId: new Map(), feedbackByMessageId: new Map() }), [tree])
  const [view, setView] = useState(snapshot.layout.view)
  const [slots, setSlots] = useState(() => snapshot.layout.slots.map((s) => ({ id: idOf(s.id), folded: s.folded })))
  const [widths, setWidths] = useState(() => Object.fromEntries(Object.entries(snapshot.layout.widths).map(([id, width]) => [idOf(id), width])))
  const [focus, setFocus] = useState(idOf(snapshot.layout.focusId || snapshot.rootThreadId))
  const [artifactId, setArtifactId] = useState(snapshot.layout.artifactId)
  const [sourceId, setSourceId] = useState<string | null>(null)
  const [canvas] = useState<CanvasViewState>(() => ({ pins: new Map(snapshot.layout.pins.map((p) => [idOf(p.id), { x: p.x, y: p.y }])), viewport: snapshot.layout.viewport ?? undefined, selectedId: snapshot.layout.focusId ? idOf(snapshot.layout.focusId) : null }))
  const colsRef = useRef<HTMLDivElement>(null)
  const messageMap = useMemo(() => new Map(snapshot.messages.map((m) => [m.id, m])), [snapshot])
  const artifact = snapshot.artifacts.find((a) => a.id === artifactId)
  useEffect(() => {
    if (view !== "columns") return
    const target = colsRef.current?.querySelector<HTMLElement>(`[data-thread-id="${CSS.escape(focus)}"]`)
    target?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [view, focus, slots])
  const openThread = (id: string) => {
    if (!tree.threads[id]) return
    setFocus(id); setView("columns"); setSourceId(null)
    if (id !== "main") setSlots((current) => {
      const next = current.some((s) => s.id === id) ? current.map((s) => s.id === id ? { ...s, folded: false } : s) : [...current, { id, folded: false }]
      const overflow = next.filter((s) => !s.folded).length - Math.max(1, snapshot.layout.columnCount - 1)
      const retire = new Set(next.filter((s) => !s.folded && s.id !== id).slice(0, Math.max(0, overflow)).map((s) => s.id))
      return snapshot.layout.placementMode === "replace" ? next.filter((s) => !retire.has(s.id)) : next.map((s) => retire.has(s.id) ? { ...s, folded: true } : s)
    })
  }
  const renderMessage = (message: PublicMessage) => {
    const display = readerMessage(message)
    display.forks = snapshot.threads.filter((t) => t.forkMessageId === message.id && t.footnote !== null).map((t) => ({ threadId: idOf(t.id), num: t.footnote!, depth: t.depth, text: t.anchorText || "", anchor: t.forkAnchor ?? undefined }))
    const body = <MessageBody message={message} tree={tree} display={display} onOpenThread={openThread} />
    return <div key={message.id} className="share-message" data-public-message={message.id}>
    {message.historical && <p className="share-status">分支保留的旧来源，原消息已被替换</p>}
    <ConversationMessage threadId={idOf(message.threadId)} message={display} showRoleLabel userRoleLabel="提问"
      hasSupplementalContent={message.parts.length > 0}
      renderAssistantBody={() => body}
      renderUserFallback={() => <div className="bubble" data-role="user">{body}</div>} />
    <div className="share-message-links">
      {message.status !== "generating" && <CopyButton text={message.parts.filter((p) => p.type === "text").map((p) => p.text).join("\n")} />}
      {snapshot.threads.filter((t) => t.forkMessageId === message.id).map((t) => <button className="cbtn" key={t.id} onClick={() => openThread(idOf(t.id))}>[{t.footnote}] {t.title}</button>)}
      {snapshot.artifacts.filter((a) => a.sourceMessageId === message.id).map((a) => <button className="cbtn" key={a.id} onClick={() => setArtifactId(a.id)}>Markdown · {a.title}</button>)}
    </div>
  </div>
  }
  const renderThread = (id: string, inCanvas = false) => {
    const thread = snapshot.threads.find((t) => idOf(t.id) === id)!
    return <>
      <header className="share-thread-head"><h2>{thread.footnote ? `[${thread.footnote}] ` : ""}{thread.title}</h2>{id !== "main" && !inCanvas && <>
        <button className="cbtn" onClick={() => setSlots((s) => s.map((slot) => slot.id === id ? { ...slot, folded: true } : slot))}>折叠</button>
        <button className="cbtn" onClick={() => setSlots((s) => s.filter((slot) => slot.id !== id))}>关闭</button>
      </>}</header>
      <div className="msg-list share-thread-body" onFocusCapture={() => setFocus(id)} onPointerDown={() => setFocus(id)}>
        {thread.anchorText && <blockquote className="share-anchor">{thread.anchorText}<button className="cbtn" onClick={() => setSourceId(thread.forkMessageId)}>查看来源</button></blockquote>}
        {thread.forkContext.length > 0 && <details className="share-history"><summary>继承的上文 · {thread.forkContext.length} 条</summary>{thread.forkContext.map((mid) => messageMap.get(mid)).filter((m): m is PublicMessage => !!m).map(renderMessage)}</details>}
        {snapshot.messages.filter((m) => m.threadId === thread.id && !m.historical).map(renderMessage)}
      </div>
    </>
  }
  return <>
    <nav className="share-tools" aria-label="阅读布局">
      <button className="cbtn" aria-pressed={view === "columns"} onClick={() => setView("columns")}>列视图</button>
      <button className="cbtn" aria-pressed={view === "canvas"} onClick={() => setView("canvas")}>画布</button>
      <label>全部分支 <select value={focus} onChange={(e) => openThread(e.target.value)}>{snapshot.threads.map((t) => <option value={idOf(t.id)} key={t.id}>{t.footnote ? `[${t.footnote}] ` : ""}{t.title}</option>)}</select></label>
      <label>Markdown <select value={artifactId || ""} onChange={(e) => setArtifactId(e.target.value || null)}><option value="">选择文档</option>{snapshot.artifacts.map((a) => <option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
    </nav>
    <div className="share-workspace">
      {view === "columns" ? <ThreadColumns state={tree} slots={slots} widths={widths} flashId={focus} colsRef={colsRef} renderThread={(id) => renderThread(id)} onExpandStrip={openThread} onCommitWidths={(patch) => setWidths((w) => ({ ...w, ...patch }))} onResetWidths={(ids) => setWidths((w) => Object.fromEntries(Object.entries(w).filter(([id]) => !ids.includes(id))))} /> : <ThreadCanvas store={store} viewState={canvas} messageActionState={actions} onOpenThread={openThread} onOpenArtifact={setArtifactId} renderReadOnlyThread={(id) => renderThread(id, true)} />}
      {artifact && <aside className="share-artifact" style={{ width: snapshot.layout.panelWidth }} aria-label="Markdown 文档"><header><h2>{artifact.title}</h2><button className="cbtn" onClick={() => setArtifactId(null)}>关闭文档</button><CopyButton text={artifact.content} /></header><MarkdownBody source={artifact.content} /></aside>}
    </div>
    {sourceId && messageMap.has(sourceId) && <Dialog open onOpenChange={(open) => { if (!open) setSourceId(null) }}><DialogContent className="tc share-source" aria-describedby={undefined}><DialogTitle>分支来源</DialogTitle><button className="cbtn" onClick={() => setSourceId(null)}>关闭来源</button>{renderMessage(messageMap.get(sourceId)!)}</DialogContent></Dialog>}
  </>
}
export function ShareReader({ snapshot, createdAt, expiresAt }: { snapshot: PublicSnapshot; createdAt: string; expiresAt: string | null }) {
  const [revision, setRevision] = useState(0)
  return <PublicMarkdownContext.Provider value={true}><main className="tc share-reader">
    <header className="share-heading"><div><span className="share-status">只读快照 · {createdAt.slice(0, 10)} · {expiresAt ? `有效至 ${expiresAt.replace("T", " ").slice(0, 16)} UTC` : "无限期"}</span><h1>{snapshot.title}</h1></div>{snapshot.resourceType === "project" && <button className="cbtn" onClick={() => setRevision((n) => n + 1)}>恢复初始布局</button>}</header>
    {snapshot.resourceType === "project" ? <ProjectReader key={revision} snapshot={snapshot} /> : <article className="share-document"><CopyButton text={snapshot.content} /><MarkdownBody source={snapshot.content} /></article>}
    <footer className="share-footer">内容与布局已冻结。外部链接内容不属于本快照。</footer>
  </main></PublicMarkdownContext.Provider>
}
