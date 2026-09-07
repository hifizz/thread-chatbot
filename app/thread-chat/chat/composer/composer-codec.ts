import { $createParagraphNode, $createTextNode, $createLineBreakNode, $getRoot, $isElementNode, $isLineBreakNode, $isTextNode, type LexicalNode } from "lexical"
import type { ThreadComposerDraft, ComposerMessagePartDraft } from "@/lib/thread-chat/contracts/composer"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import { ComposerCapsuleNode, $createComposerCapsuleNode } from "./composer-capsule-node"

export function capsuleLabel(part: Exclude<ComposerMessagePartDraft, {type:"text"}>, artifacts: Record<string, ArtifactDTO>) {
  switch (part.type) {
    case "artifact-reference": return `@${artifacts[part.artifactId]?.title ?? "Artifact"}`
    case "quote": return `引用：${part.quote.text.slice(0, 40)}`
    case "file": return `附件：${part.file.filename ?? "文件"}`
    case "upload": return `${part.error ? "上传失败，可删除后重试" : "上传中"}：${part.filename}`
  }
}
export function $importComposerDraft(draft: ThreadComposerDraft, artifacts: Record<string, ArtifactDTO>) {
  const paragraph = $createParagraphNode()
  for (const part of draft.parts) {
    if (part.type === "text") {
      part.text.split("\n").forEach((line, index) => {
        if (index) paragraph.append($createLineBreakNode())
        if (line) paragraph.append($createTextNode(line))
      })
    } else paragraph.append($createComposerCapsuleNode(part, capsuleLabel(part, artifacts)))
  }
  $getRoot().clear().append(paragraph)
}
export function $exportComposerDraft(): ThreadComposerDraft {
  const parts: ComposerMessagePartDraft[] = []
  const appendText = (text: string, localId: string) => {
    const last = parts.at(-1)
    if (last?.type === "text") last.text += text
    else if (text) parts.push({ type: "text", text, localId })
  }
  const walk = (node: LexicalNode) => {
    if (node instanceof ComposerCapsuleNode) parts.push(node.getPart())
    else if ($isLineBreakNode(node)) appendText("\n", node.getKey())
    else if ($isTextNode(node)) appendText(node.getTextContent(), node.getKey())
    else if ($isElementNode(node)) node.getChildren().forEach(walk)
    else throw new Error(`不支持的编辑器节点：${node.getType()}`)
  }
  $getRoot().getChildren().forEach((node, index) => {
    if (index) appendText("\n", node.getKey())
    walk(node)
  })
  return { parts }
}
