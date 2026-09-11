"use client"
import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { COMMAND_PRIORITY_LOW, KEY_ENTER_COMMAND } from "lexical"
import { shouldSubmitComposerKey } from "@/lib/chat/composer-keyboard"
export function ComposerSubmitPlugin({ onSubmit }: { onSubmit?: () => void }) {
  const [editor] = useLexicalComposerContext()
  useEffect(() => editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
    if (!event || !onSubmit || editor.isComposing() || !shouldSubmitComposerKey(event)) return false
    event.preventDefault()
    onSubmit()
    return true
  }, COMMAND_PRIORITY_LOW), [editor, onSubmit])
  return null
}
