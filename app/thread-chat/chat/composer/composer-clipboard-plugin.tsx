"use client"
import { useEffect } from "react"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getClipboardDataFromSelection, $insertDataTransferForRichText, setLexicalClipboardDataTransfer } from "@lexical/clipboard"
import { $addUpdateTag, $getSelection, $isRangeSelection, COMMAND_PRIORITY_LOW, COPY_COMMAND, CUT_COMMAND, PASTE_COMMAND, PASTE_TAG } from "lexical"
import { LEXICAL_CLIPBOARD_MIME } from "@/constants/composer"
import { ComposerCapsuleNode } from "./composer-capsule-node"

/** PlainText 默认丢弃节点身份；胶囊使用官方剪贴板序列化和插入函数。 */
export function ComposerClipboardPlugin() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    const copy = (event: ClipboardEvent | KeyboardEvent | null, cut: boolean) => {
      const selection = $getSelection()
      if (!(event instanceof ClipboardEvent) || !event.clipboardData || !$isRangeSelection(selection) || !selection.getNodes().some((node) => node instanceof ComposerCapsuleNode)) return false
      event.preventDefault()
      setLexicalClipboardDataTransfer(event.clipboardData, $getClipboardDataFromSelection(selection))
      if (cut) selection.removeText()
      return true
    }
    const unregister = [
      editor.registerCommand(COPY_COMMAND, (event) => copy(event, false), COMMAND_PRIORITY_LOW),
      editor.registerCommand(CUT_COMMAND, (event) => copy(event, true), COMMAND_PRIORITY_LOW),
      editor.registerCommand(PASTE_COMMAND, (event) => {
        const selection = $getSelection()
        if (!(event instanceof ClipboardEvent) || !event.clipboardData?.types.includes(LEXICAL_CLIPBOARD_MIME) || !$isRangeSelection(selection)) return false
        event.preventDefault()
        $addUpdateTag(PASTE_TAG)
        $insertDataTransferForRichText(event.clipboardData, selection)
        return true
      }, COMMAND_PRIORITY_LOW),
    ]
    return () => { for (const cleanup of unregister) cleanup() }
  }, [editor])
  return null
}
