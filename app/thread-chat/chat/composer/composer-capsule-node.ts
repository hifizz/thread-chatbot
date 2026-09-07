import { createElement, type ReactNode, type MouseEvent } from "react"
import { $applyNodeReplacement, $createTextNode, $getNodeByKey, DecoratorNode, type LexicalEditor, type NodeKey, type SerializedLexicalNode } from "lexical"
import { messageContentPartInputSchema } from "@/lib/thread-chat/contracts/message-content"
import type { ComposerMessagePartDraft } from "@/lib/thread-chat/contracts/composer"

type CapsulePart = Exclude<ComposerMessagePartDraft, { type: "text" }>
type SerializedCapsule = SerializedLexicalNode & { part: CapsulePart; label: string }

/** 官方行内 DecoratorNode：Lexical 将其设为不可编辑，光标只在胶囊两侧移动。 */
export class ComposerCapsuleNode extends DecoratorNode<ReactNode> {
  __part: CapsulePart
  __label: string
  static getType() { return "thread-chat-capsule" }
  static clone(node: ComposerCapsuleNode) { return new ComposerCapsuleNode(node.__part, node.__label, node.__key) }
  constructor(part: CapsulePart, label: string, key?: NodeKey) {
    super(key)
    this.__part = part
    this.__label = label
  }
  getPart() { return this.getLatest().__part }
  getTextContent() { return this.getLatest().__label }
  setPart(part: CapsulePart, label: string) {
    const node = this.getWritable()
    node.__part = part
    node.__label = label
    return node
  }
  static importJSON(serialized: SerializedCapsule) {
    const { localId, ...input } = serialized.part
    void localId
    // 未完成上传和 Quote 不通过剪贴板复制身份。
    if (input.type === "upload" || input.type === "quote") return $createTextNode(serialized.label)
    const part = messageContentPartInputSchema.parse(input)
    if (part.type === "text") throw new Error("胶囊不能包含可编辑文字")
    return $createComposerCapsuleNode({ ...part, localId: crypto.randomUUID() }, serialized.label)
  }
  exportJSON(): SerializedCapsule { return { ...super.exportJSON(), type: ComposerCapsuleNode.getType(), version: 1, part: this.getPart(), label: this.getTextContent() } }
  createDOM() {
    const dom = document.createElement("span")
    dom.className = "composer-capsule"
    dom.draggable = false
    return dom
  }
  updateDOM() { return false }
  exportDOM() {
    const element = document.createElement("span")
    element.textContent = this.getTextContent()
    return { element }
  }
  decorate(editor: LexicalEditor) {
    const part = this.getPart()
    const key = this.getKey()
    return createElement("span", {
      title: part.type === "quote" ? part.quote.text : this.getTextContent(),
      onMouseDown: (event: MouseEvent<HTMLSpanElement>) => {
        if (event.button !== 0 || !editor.isEditable()) return
        event.preventDefault()
        // 点击只将输入位置移到引用之后，不选择可被打字替换的节点。
        editor.update(() => { $getNodeByKey(key)?.selectNext() })
      },
    }, this.getTextContent())
  }
  isInline() { return true }
  isKeyboardSelectable() { return false }
}
export function $createComposerCapsuleNode(part: CapsulePart, label: string) {
  return $applyNodeReplacement(new ComposerCapsuleNode(part, label))
}
