"use client"

import { useState, type RefObject } from "react"
import { LexicalComposer } from "@lexical/react/LexicalComposer"
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin"
import { ContentEditable } from "@lexical/react/LexicalContentEditable"
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin"
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary"
import { EditorRefPlugin } from "@lexical/react/LexicalEditorRefPlugin"
import type { LexicalEditor } from "lexical"
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { ComposerClipboardPlugin } from "./composer-clipboard-plugin"
import { ComposerCapsuleNode } from "./composer-capsule-node"
import { $importComposerDraft } from "./composer-codec"
import { ComposerSyncPlugin } from "./composer-sync-plugin"
import { ComposerSubmitPlugin } from "./composer-submit-plugin"
import { ArtifactMentionPlugin } from "./artifact-mention-plugin"

export function MessageEditor({ draft, revision = 0, artifacts, onChange, onSubmit, editorRef, placeholder = "输入问题…", mentions = true, disabled = false }: {
  draft: ThreadComposerDraft; revision?: number; artifacts: Record<string, ArtifactDTO>;
  onChange: (draft: ThreadComposerDraft) => void; onSubmit?: () => void;
  editorRef?: RefObject<LexicalEditor | null>; placeholder?: string; mentions?: boolean; disabled?: boolean
}) {
  const [initialConfig] = useState(() => ({
    namespace: "thread-chat-message", nodes: [ComposerCapsuleNode],
    onError: (error: Error) => { throw error },
    editorState: () => $importComposerDraft(draft, artifacts),
  }))
  return <LexicalComposer initialConfig={initialConfig}>
    <div className="composer-editor-wrap">
      <PlainTextPlugin contentEditable={<ContentEditable className="composer-editor" aria-label={placeholder} placeholder={null} />} placeholder={<span className="composer-placeholder">{placeholder}</span>} ErrorBoundary={LexicalErrorBoundary} />
    </div>
    <HistoryPlugin />
    <ComposerClipboardPlugin />
    <ComposerSyncPlugin disabled={disabled} draft={draft} revision={revision} artifacts={artifacts} onChange={onChange} />
    <ComposerSubmitPlugin onSubmit={onSubmit} />
    {mentions && <ArtifactMentionPlugin artifacts={artifacts} />}
    {editorRef && <EditorRefPlugin editorRef={editorRef} />}
  </LexicalComposer>
}
