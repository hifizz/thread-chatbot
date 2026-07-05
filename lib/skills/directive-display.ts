import { unstable_defaultDirectiveFormatter } from "@assistant-ui/core"

// 客户端安全（不依赖 node:fs），供纯文本展示场景使用。

/** 把文本中的 directive 语法（`:skill[label]{name=id}` 等）替换为其 label，用于线程标题等纯文本场景。 */
export function directiveTextToPlain(text: string): string {
  return unstable_defaultDirectiveFormatter
    .parse(text)
    .map((seg) => (seg.kind === "text" ? seg.text : seg.label))
    .join("")
}
