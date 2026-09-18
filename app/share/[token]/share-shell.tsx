"use client"

import { GenerationSettingsProvider } from "@/app/thread-chat/chat/composer/generation-settings-context"
import { MarkdownBody } from "@/app/thread-chat/chat/message/markdown-body"
import { ProjectListStoreProvider } from "@/app/thread-chat/core/project-list-store"
import { NormalizedThreadChat } from "@/app/thread-chat/thread-chat-demo"
import "@/app/thread-chat/thread-chat.css"
import { SHARE_UI_COPY } from "@/constants/sharing"
import type { PublicSnapshot } from "@/lib/thread-chat/sharing/contracts"
import { useShareRuntime } from "../read-only-runtime"

/**
 * 只读分享壳：与正式页同一组件树（NormalizedThreadChat），runtime 由快照 hydrate，
 * commands 是空实现，readOnly 关掉所有写入口。本地布局操作只改内存状态，
 * 重开链接恢复分享时布局——不碰 localStorage workspace、轮询、订阅。
 */
export function ShareShell({ snapshot }: { snapshot: PublicSnapshot }) {
  if (snapshot.kind === "document")
    return <DocumentShareShell snapshot={snapshot} />
  return <ProjectShareShell snapshot={snapshot} />
}

function ProjectShareShell({
  snapshot,
}: {
  snapshot: Extract<PublicSnapshot, { kind: "project" }>
}) {
  const runtime = useShareRuntime(snapshot)
  return (
    <GenerationSettingsProvider>
      <ProjectListStoreProvider client={runtime.client}>
        <NormalizedThreadChat
          treeId={`share:${snapshot.createdAt}`}
          runtime={runtime}
          readOnly
          initialOverlay={runtime.initialOverlay}
        />
      </ProjectListStoreProvider>
    </GenerationSettingsProvider>
  )
}

function DocumentShareShell({
  snapshot,
}: {
  snapshot: Extract<PublicSnapshot, { kind: "document" }>
}) {
  return (
    <div className="tc share-document">
      <div className="topbar">
        <div className="brand">
          <span className="mark">Thread Chat</span>
          <span className="share-badge">{SHARE_UI_COPY.readOnlyBadge}</span>
        </div>
      </div>
      <main className="share-document-body">
        <header className="share-document-head">
          <h1>{snapshot.document.title}</h1>
          <span className="share-document-meta">
            第 {snapshot.document.revisionNumber} 版 ·{" "}
            {snapshot.document.createdAt.slice(0, 10)}
          </span>
        </header>
        <MarkdownBody source={snapshot.content} />
      </main>
    </div>
  )
}
