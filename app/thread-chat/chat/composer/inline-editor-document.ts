import {
  $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot,
  $isElementNode, $isLineBreakNode, $isTextNode, $getSelection, $isRangeSelection, type LexicalNode, type TextNode,
} from "lexical"
import type { InlineComposerPart } from "@/lib/thread-chat/contracts/artifact-reference"
import { ArtifactReferenceNode, $createArtifactReferenceNode } from "./artifact-reference-node"

export function inlineComposerText(parts: InlineComposerPart[]) {
  return parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("")
}

/** 工具栏插入复用原光标；尚未进入编辑器时落到文档末尾。 */
export function $insertInlineText(text: string) {
  const current = $getSelection()
  const selection = $isRangeSelection(current) ? current : $getRoot().selectEnd()
  selection.insertText(text)
}

/** 插入后落在真实可编辑文本中；避免末尾引用只留下不可见的元素选区。 */
export function $insertArtifactReference(artifactId: string, title: string, queryNode: TextNode | null) {
  const node = $createArtifactReferenceNode(artifactId, title)
  if (queryNode) queryNode.replace(node)
  else {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    selection.insertNodes([node])
  }
  const next = node.getNextSibling()
  if ($isTextNode(next) && next.isSimpleText() && next.getTextContent().startsWith(" ")) {
    next.select(1, 1)
  } else {
    const space = $createTextNode(" ")
    node.insertAfter(space)
    space.selectEnd()
  }
}

/** 点击胶囊只定位到两侧，不把选区放入冻结标题。 */
export function $selectArtifactBoundary(node: ArtifactReferenceNode, before: boolean) {
  const sibling = before ? node.getPreviousSibling() : node.getNextSibling()
  if ($isTextNode(sibling)) {
    if (before) sibling.selectEnd()
    else sibling.selectStart()
  } else {
    const index = node.getIndexWithinParent() + (before ? 0 : 1)
    node.getParentOrThrow().select(index, index)
  }
}

export function $readInlineDocument(): InlineComposerPart[] {
  const parts: InlineComposerPart[] = []
  const appendText = (text: string) => {
    const last = parts.at(-1)
    if (last?.type === "text") last.text += text
    else if (text) parts.push({ type: "text", text })
  }
  const visit = (node: LexicalNode) => {
    if (node instanceof ArtifactReferenceNode)
      parts.push({ type: "artifact-reference", artifactId: node.getArtifactId() })
    else if ($isTextNode(node)) appendText(node.getTextContent())
    else if ($isLineBreakNode(node)) appendText("\n")
    else if ($isElementNode(node)) node.getChildren().forEach(visit)
  }
  $getRoot().getChildren().forEach((node, index) => {
    if (index > 0) appendText("\n")
    visit(node)
  })
  return parts
}

export function $writeInlineDocument(parts: InlineComposerPart[], titleFor: (id: string) => string) {
  const root = $getRoot()
  root.clear()
  const paragraph = $createParagraphNode()
  root.append(paragraph)
  for (const part of parts) {
    if (part.type === "artifact-reference") {
      paragraph.append($createArtifactReferenceNode(part.artifactId, titleFor(part.artifactId)))
    } else {
      part.text.split("\n").forEach((line, index) => {
        if (index) paragraph.append($createLineBreakNode())
        if (line) paragraph.append($createTextNode(line))
      })
    }
  }
}
