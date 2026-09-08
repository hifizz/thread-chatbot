"use client"

import { useEffect, useRef } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin"
import { CLEAR_HISTORY_COMMAND } from "lexical"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { ThreadComposerDraft } from "@/lib/thread-chat/contracts/composer"
import { $exportComposerDraft, $importComposerDraft } from "./composer-codec"

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
  }, [artifacts, draft, editor, revision])
  return <OnChangePlugin ignoreSelectionChange onChange={(state, _editor, tags) => {
    if (tags.has("composer-load")) return
    state.read(() => onChange($exportComposerDraft()))
  }} />
}
