import { $applyNodeReplacement, $createTextNode, TextNode, type EditorConfig, type NodeKey, type SerializedTextNode } from "lexical"
import { messageContentPartInputSchema } from "@/lib/thread-chat/contracts/message-content"
import type { ComposerMessagePartDraft } from "@/lib/thread-chat/contracts/composer"

type CapsulePart = Exclude<ComposerMessagePartDraft, { type: "text" }>
type SerializedCapsule = SerializedTextNode & { part: CapsulePart; label: string }

/** 官方 token TextNode：正文不可编辑、删除为整体；不操作 Lexical 内部 DOM。 */
export class ComposerCapsuleNode extends TextNode {
  __part: CapsulePart
  __label: string
  static getType() { return "thread-chat-capsule" }
  static clone(node: ComposerCapsuleNode) { return new ComposerCapsuleNode(node.__part, node.__label, node.__key) }
  constructor(part: CapsulePart, label: string, key?: NodeKey) {
    super(label, key)
    this.__part = part
    this.__label = label
  }
  getPart() { return this.getLatest().__part }
  setPart(part: CapsulePart, label: string) {
    const node = this.getWritable()
    node.__part = part
    node.__label = label
    node.setTextContent(label)
    return node
  }
  static importJSON(serialized: SerializedCapsule) {
    const { localId, ...input } = serialized.part
    void localId
    // 未完成上传只在当前草稿中存在，剪贴板不复制它的上传身份。
    if (input.type === "upload" || input.type === "quote") return $createTextNode(serialized.label)
    const part = messageContentPartInputSchema.parse(input)
    if (part.type === "text") throw new Error("胶囊不能包含可编辑文字")
    return $createComposerCapsuleNode({ ...part, localId: crypto.randomUUID() }, serialized.label)
  }
  exportJSON(): SerializedCapsule { return { ...super.exportJSON(), type: ComposerCapsuleNode.getType(), version: 1, part: this.getPart(), label: this.getLatest().__label } }
  createDOM(config: EditorConfig) {
    const dom = super.createDOM(config)
    dom.classList.add("composer-capsule")
    dom.title = this.getPart().type === "quote" ? (this.getPart() as Extract<CapsulePart, {type:"quote"}>).quote.text : this.__label
    dom.draggable = false
    return dom
  }
  canInsertTextBefore() { return false }
  canInsertTextAfter() { return false }
  isTextEntity() { return true }
}
export function $createComposerCapsuleNode(part: CapsulePart, label: string) {
  return $applyNodeReplacement(new ComposerCapsuleNode(part, label)).setMode("token")
}
