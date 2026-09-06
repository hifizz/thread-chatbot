import {
  $createLineBreakNode, $createParagraphNode, $createTextNode, $getRoot,
  $isElementNode, $isLineBreakNode, $isTextNode, type LexicalNode,
} from "lexical"
import type { InlineComposerPart } from "@/lib/thread-chat/contracts/artifact-reference"
import { ArtifactReferenceNode, $createArtifactReferenceNode } from "./artifact-reference-node"

export function inlineComposerText(parts: InlineComposerPart[]) {
  return parts.flatMap((part) => part.type === "text" ? [part.text] : []).join("")
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
