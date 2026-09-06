import {
  $applyNodeReplacement, DecoratorNode,
  type NodeKey, type SerializedLexicalNode,
} from "lexical"

export type SerializedArtifactReferenceNode = SerializedLexicalNode & { artifactId: string; title: string }

/** 全文引用是不可分割的行内 token；其身份独立于显示标题。 */
export class ArtifactReferenceNode extends DecoratorNode<string> {
  __artifactId: string
  __title: string
  static getType() { return "artifact-reference" }
  static clone(node: ArtifactReferenceNode) {
    return new ArtifactReferenceNode(node.__artifactId, node.__title, node.__key)
  }
  constructor(artifactId: string, title: string, key?: NodeKey) {
    super(key)
    this.__artifactId = artifactId
    this.__title = title
  }
  getArtifactId() { return this.getLatest().__artifactId }
  getTitle() { return this.getLatest().__title }
  getTextContent() { return `@${this.getTitle()}` }
  decorate() { return this.getTextContent() }
  isInline() { return true }
  // 左右键跨过整个引用，始终保留文本光标，不进入无光标的 NodeSelection。
  isKeyboardSelectable() { return false }
  static importJSON(serialized: SerializedArtifactReferenceNode) {
    return $createArtifactReferenceNode(serialized.artifactId, serialized.title)
  }
  // 外部 HTML 只作为文本，不从可伪造的 DOM 属性恢复引用身份。
  static importDOM() { return null }
  exportJSON(): SerializedArtifactReferenceNode {
    return { ...super.exportJSON(), type: "artifact-reference", version: 1,
      artifactId: this.getArtifactId(), title: this.getTitle() }
  }
  createDOM(): HTMLElement {
    const element = document.createElement("span")
    element.contentEditable = "false"
    element.classList.add("artifact-reference-token")
    element.dataset.artifactId = this.__artifactId
    element.title = this.__title
    return element
  }
  exportDOM() {
    const element = this.createDOM()
    element.textContent = this.getTextContent()
    return { element }
  }
  updateDOM(previous: this, dom: HTMLElement): boolean {
    dom.dataset.artifactId = this.__artifactId
    dom.title = this.__title
    return false
  }
}

export function $createArtifactReferenceNode(artifactId: string, title: string) {
  return $applyNodeReplacement(new ArtifactReferenceNode(artifactId, title))
}
