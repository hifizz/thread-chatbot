"use client"

import { useEffect } from "react"
import { useStore } from "zustand"
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext"
import { $getRoot, $createTextNode, HISTORY_PUSH_TAG } from "lexical"
import { useComposerDraftStore } from "./composer-drafts"
import { $exportComposerDraft, capsuleLabel } from "./composer-codec"
import { $createComposerCapsuleNode } from "./composer-capsule-node"

/** 划选引用经当前编辑器插入，保留草稿、节点身份和撤销历史。
 * 未挂载或发送中的编辑器稍后消费请求，附件队列不参与这条路径。 */
export function ComposerQuotePlugin({ scope, disabled }: { scope: string; disabled: boolean }) {
  const [editor] = useLexicalComposerContext()
  const store = useComposerDraftStore()
  const requests = useStore(store, (state) => state.quoteRequests[scope])
  useEffect(() => {
    if (disabled || !requests?.length) return
    let cancelled = false
    // Lexical 的 Decorator 提交内部会 flushSync，必须离开 React effect 再执行。
    // cleanup 取消过期任务，避免卸载、切换 thread 或严格模式重放时消费请求。
    queueMicrotask(() => {
      if (cancelled || !editor.isEditable() || !editor.getRootElement()) return
      // 先取走这批请求，避免严格模式重复消费；后续新请求不会被删除。
      if (store.getState().quoteRequests[scope] !== requests) return
      store.setState((state) => {
        const quoteRequests = { ...state.quoteRequests }
        delete quoteRequests[scope]
        return { quoteRequests }
      })
      editor.update(() => {
        const parts = $exportComposerDraft().parts
        for (const quote of requests) {
          if (parts.some((part) => part.type === "quote" && JSON.stringify(part.quote) === JSON.stringify(quote))) continue
          const part = { type: "quote" as const, quote, localId: crypto.randomUUID() }
          $getRoot().selectEnd().insertNodes([$createComposerCapsuleNode(part, capsuleLabel(part, {})), $createTextNode(" ")])
          parts.push(part)
        }
        $getRoot().selectEnd()
      }, { tag: HISTORY_PUSH_TAG, discrete: true })
      editor.focus()
      editor.getRootElement()?.scrollIntoView({ block: "nearest", inline: "nearest" })
    })
    return () => { cancelled = true }
  }, [disabled, editor, requests, scope, store])
  return null
}
