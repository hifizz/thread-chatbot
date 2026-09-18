"use client"

import { GenerationSettingsProvider } from "@/app/thread-chat/chat/composer/generation-settings-context"
import { MarkdownBody } from "@/app/thread-chat/chat/message/markdown-body"
import { ProjectListStoreProvider } from "@/app/thread-chat/core/project-list-store"
import { NormalizedThreadChat } from "@/app/thread-chat/thread-chat-demo"
import "@/app/thread-chat/thread-chat.css"
import { ShareBadge } from "@/app/thread-chat/orchestration/sharing/share-chrome"
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
    <div className="tc flex min-h-screen flex-col bg-[var(--tc-surface-base)]">
      <div className="topbar">
        <div className="brand">
          <span className="mark">Thread Chat</span>
          <ShareBadge />
        </div>
      </div>
      <main className="mx-auto w-full max-w-[760px] flex-1 px-5 pb-12 pt-6">
        <header className="mb-5 border-b border-[var(--tc-border-subtle)] pb-3">
          <h1 className="m-0 mb-1.5 font-[family-name:var(--tc-typography-family-read)] text-2xl font-semibold">
            {snapshot.document.title}
          </h1>
          <span className="text-xs text-[var(--tc-content-dim,var(--tc-depth-1))]">
            第 {snapshot.document.revisionNumber} 版 ·{" "}
            {snapshot.document.createdAt.slice(0, 10)}
          </span>
        </header>
        <MarkdownBody source={snapshot.content} />
      </main>
    </div>
  )
}
