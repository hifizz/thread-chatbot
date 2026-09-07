"use client"

import { useEffect, useRef } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { $nodesOfType, CLEAR_HISTORY_COMMAND } from "lexical"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"
import { ComposerCapsuleNode } from "./composer-capsule-node"
import { $exportComposerDraft, $importComposerDraft, capsuleLabel } from "./composer-codec"

export function ComposerSyncPlugin({ draft, revision, artifacts, onChange, disabled }: {
  draft: ThreadComposerDraft; revision: number; artifacts: Record<string, ArtifactDTO>;
  disabled?: boolean; onChange: (draft: ThreadComposerDraft) => void
}) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => { editor.setEditable(!disabled) }, [disabled, editor])
  const loadedRevision = useRef(revision)
  useEffect(() => {
    if (loadedRevision.current !== revision) {
      loadedRevision.current = revision
      editor.update(() => $importComposerDraft(draft, artifacts), { tag: "composer-load" })
      editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined)
      return
    }
    // 上传完成只更新相同 localId 的胶囊，不重写文档或选区。
    editor.update(() => {
      const parts = new Map(draft.parts.map((part) => [part.localId, part]))
      for (const node of $nodesOfType(ComposerCapsuleNode)) {
        const previous = node.getPart()
        const next = parts.get(previous.localId)
        if (previous.type === "upload" && (next?.type === "file" || (next?.type === "upload" && next.error !== previous.error))) node.setPart(next, capsuleLabel(next, artifacts))
      }
    }, { tag: "composer-upload" })
  }, [artifacts, draft, editor, revision])
  return <OnChangePlugin ignoreSelectionChange onChange={(state, _editor, tags) => {
    if (tags.has("composer-load")) return
    state.read(() => onChange($exportComposerDraft()))
  }} />
}
