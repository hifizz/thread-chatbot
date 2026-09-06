import { posix } from "node:path"
import { DOMParser } from "@xmldom/xmldom"
import type { OfficeContentNode } from "officeparser"

function elements(xml: string, localName: string) {
  const doc = new DOMParser({ onError: () => { throw new Error("PPT 文件结构无效") } })
    .parseFromString(xml, "text/xml")
  return Array.from(doc.getElementsByTagNameNS("*", localName))
}

function relationships(xml: string | undefined, directory: string) {
  return new Map((xml ? elements(xml, "Relationship") : []).map((element) => {
    const target = element.getAttribute("Target") ?? ""
    return [element.getAttribute("Id") ?? "", {
      type: element.getAttribute("Type") ?? "",
      external: element.getAttribute("TargetMode") === "External",
      path: posix.normalize(target.startsWith("/") ? target.slice(1) : posix.join(directory, target)),
    }]
  }))
}

/** officeparser 7.8 按文件编号组合幻灯片；实际页序和备注必须由 OOXML 关系决定。 */
export function orderPresentationNodes(nodes: OfficeContentNode[], parts: Map<string, string>): OfficeContentNode[] {
  const presentation = parts.get("ppt/presentation.xml")
  if (!presentation) throw new Error("PPT 缺少页面顺序信息")
  const rels = relationships(parts.get("ppt/_rels/presentation.xml.rels"), "ppt")
  const slides = new Map(nodes.flatMap((node) => node.type === "slide" ? [[node.metadata?.slideNumber, node] as const] : []))
  const notes = new Map(nodes.flatMap((node) => (node.notes ?? []).flatMap((note) =>
    note.type === "note" ? [[note.metadata?.slideNumber, note] as const] : []
  )))
  return elements(presentation, "sldId").map((element, index) => {
    const id = Array.from(element.attributes).find((attribute) => attribute.localName === "id" && attribute.prefix)?.value
    const rel = id ? rels.get(id) : undefined
    const match = rel?.path.match(/^ppt\/slides\/slide(\d+)\.xml$/)
    if (!rel || rel.external || !rel.type.endsWith("/slide") || !match) {
      throw new Error("PPT 页面关系无效，请重新另存后上传")
    }
    const original = slides.get(Number(match[1]))
    const slideRels = relationships(parts.get(`ppt/slides/_rels/slide${match[1]}.xml.rels`), "ppt/slides")
    const noteRel = [...slideRels.values()].find((item) => !item.external && item.type.endsWith("/notesSlide"))
    const noteNumber = noteRel?.path.match(/^ppt\/notesSlides\/notesSlide(\d+)\.xml$/)?.[1]
    const note = noteNumber ? notes.get(Number(noteNumber)) : undefined
    // 空页仍保留序号；不能用原来的错误备注归属作为回退。
    return {
      type: "slide",
      children: original?.children ?? [],
      notes: note ? [note] : [],
      metadata: { slideNumber: index + 1 },
    }
  })
}
