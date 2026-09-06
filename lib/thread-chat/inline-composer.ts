import type { InlineComposerPart } from "./contracts/artifact-reference"

/** 比较可编辑内容，忽略空文本和相邻文本分段，保留引用身份与位置。 */
export function inlineComposerPartsEqual(left: InlineComposerPart[], right: InlineComposerPart[]): boolean {
  const normalize = (parts: InlineComposerPart[]) => {
    const result: InlineComposerPart[] = []
    for (const part of parts) {
      if (part.type === "artifact-reference") {
        result.push({ type: "artifact-reference", artifactId: part.artifactId })
      } else if (part.text) {
        const previous = result.at(-1)
        if (previous?.type === "text") previous.text += part.text
        else result.push({ type: "text", text: part.text })
      }
    }
    return result
  }
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right))
}
