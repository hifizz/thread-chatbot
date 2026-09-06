import {
  $applyNodeReplacement, TextNode,
  type EditorConfig, type NodeKey, type SerializedTextNode,
} from "lexical"

export type SerializedArtifactReferenceNode = SerializedTextNode & { artifactId: string; title: string }

/** 全文引用是不可分割的行内 token；其身份独立于显示标题。 */
export class ArtifactReferenceNode extends TextNode {
  __artifactId: string
  __title: string
  static getType() { return "artifact-reference" }
  static clone(node: ArtifactReferenceNode) {
    return new ArtifactReferenceNode(node.__artifactId, node.__title, node.__key)
  }
  constructor(artifactId: string, title: string, key?: NodeKey) {
    super(`@${title}`, key)
    this.__artifactId = artifactId
    this.__title = title
  }
  getArtifactId() { return this.getLatest().__artifactId }
  getTitle() { return this.getLatest().__title }
  static importJSON(serialized: SerializedArtifactReferenceNode) {
    return $createArtifactReferenceNode(serialized.artifactId, serialized.title)
  }
  exportJSON(): SerializedArtifactReferenceNode {
    return { ...super.exportJSON(), type: "artifact-reference", version: 1,
      artifactId: this.getArtifactId(), title: this.getTitle() }
  }
  createDOM(config: EditorConfig): HTMLElement {
    const element = super.createDOM(config)
    element.classList.add("artifact-reference-token")
    element.dataset.artifactId = this.__artifactId
    element.title = this.__title
    return element
  }
  updateDOM(previous: this, dom: HTMLElement, config: EditorConfig): boolean {
    dom.dataset.artifactId = this.__artifactId
    dom.title = this.__title
    return super.updateDOM(previous, dom, config)
  }
  canInsertTextBefore() { return false }
  canInsertTextAfter() { return false }
  isTextEntity() { return true }
}

export function $createArtifactReferenceNode(artifactId: string, title: string) {
  return $applyNodeReplacement(new ArtifactReferenceNode(artifactId, title).setMode("token"))
}
