import { createElement, type ReactNode, type MouseEvent } from "react"
import { $applyNodeReplacement, $createTextNode, $getNodeByKey, DecoratorNode, type LexicalEditor, type NodeKey, type SerializedLexicalNode } from "lexical"
import { messageContentPartInputSchema } from "@/lib/thread-chat/contracts/message-content"
import type { ComposerMessagePartDraft } from "@/lib/thread-chat/contracts/composer"
import { useArtifactNavigation } from "./artifact-resources"

type CapsulePart = Exclude<ComposerMessagePartDraft, { type: "text" }>
type SerializedCapsule = SerializedLexicalNode & { part: CapsulePart; label: string }

function CapsuleContent({ part, label, editor, nodeKey }: { part: CapsulePart; label: string; editor: LexicalEditor; nodeKey: NodeKey }) {
  const openArtifact = useArtifactNavigation()
  const onMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0 || !editor.isEditable()) return
    event.preventDefault()
    // 预览引用时仍保留胶囊右侧的输入位置，不选中可被打字替换的节点。
    editor.update(() => { $getNodeByKey(nodeKey)?.selectNext() })
  }
  if (part.type === "artifact-reference") return createElement("button", {
    type: "button", className: "composer-capsule-action", title: `预览 ${label}`,
    disabled: !openArtifact, onMouseDown,
    onClick: () => openArtifact?.(part.artifactId),
  }, label)
  return createElement("span", { title: part.type === "quote" ? part.quote.text : label, onMouseDown }, label)
}

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
  static importJSON(serialized: SerializedCapsule) {
    const { localId, ...input } = serialized.part
    void localId
    // Quote 不通过剪贴板复制身份。
    if (input.type === "quote") return $createTextNode(serialized.label)
    const part = messageContentPartInputSchema.parse(input)
    if (part.type === "text") throw new Error("胶囊不能包含可编辑文字")
    return $createComposerCapsuleNode({ ...part, localId: crypto.randomUUID() }, serialized.label)
  }
  exportJSON(): SerializedCapsule { return { ...super.exportJSON(), type: ComposerCapsuleNode.getType(), version: 1, part: this.getPart(), label: this.getTextContent() } }
  createDOM() {
    const dom = document.createElement("span")
    dom.className = this.getPart().type === "artifact-reference" ? "composer-capsule composer-capsule-artifact" : "composer-capsule"
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
    return createElement(CapsuleContent, { part: this.getPart(), label: this.getTextContent(), editor, nodeKey: this.getKey() })
  }
  isInline() { return true }
  isKeyboardSelectable() { return false }
}
export function $createComposerCapsuleNode(part: CapsulePart, label: string) {
  return $applyNodeReplacement(new ComposerCapsuleNode(part, label))
}
