import { fromBuffer, type Entry } from "yauzl"
import { OFFICE_ATTACHMENT_LIMITS as LIMITS } from "@/constants/office-attachment"

/** 在专用解析器加载前验证 ZIP 实际解压体积；不落盘、不执行内嵌对象。 */
export function inspectOfficeArchive(bytes: Uint8Array, requiredPart: string): Promise<Map<string, string>> {
  return new Promise((resolve, reject) => {
    fromBuffer(Buffer.from(bytes), { lazyEntries: true, validateEntrySizes: true }, (error, zip) => {
      if (error || !zip) return reject(new Error("文件不是有效的 Office 文档，或已损坏/加密"))
      const parts = new Map<string, string>()
      const names = new Set<string>()
      let size = 0
      let settled = false
      const fail = (reason: Error) => {
        if (settled) return
        settled = true
        zip.close()
        reject(reason)
      }
      zip.on("error", fail)
      zip.on("entry", (entry: Entry) => {
        if (names.has(entry.fileName)) return fail(new Error("Office 文件包含重复部件"))
        names.add(entry.fileName)
        if (names.size > LIMITS.maxZipEntries || size + entry.uncompressedSize > LIMITS.maxUncompressedBytes) {
          return fail(new Error("文档解压后过大，请拆分后上传"))
        }
        if (entry.generalPurposeBitFlag & 1) return fail(new Error("暂不支持加密文档，请移除密码后上传"))
        if (entry.fileName.endsWith("/")) return zip.readEntry()
        zip.openReadStream(entry, (error, stream) => {
          if (error || !stream) return fail(new Error("Office 文档解压失败"))
          const xml = /\.(xml|rels)$/i.test(entry.fileName)
          const chunks: Buffer[] = []
          stream.on("error", fail)
          stream.on("data", (chunk: Buffer) => {
            size += chunk.length
            if (size > LIMITS.maxUncompressedBytes) {
              stream.destroy()
              fail(new Error("文档解压后过大，请拆分后上传"))
            } else if (xml) chunks.push(chunk)
          })
          stream.on("end", () => {
            if (settled) return
            if (xml) {
              const content = new TextDecoder("utf-8", { fatal: true })
              let text: string
              try {
                text = content.decode(Buffer.concat(chunks))
              } catch {
                return fail(new Error("Office 文档 XML 编码无效，请另存为新版文件"))
              }
              if (/<!DOCTYPE|<!ENTITY/i.test(text)) return fail(new Error("不支持包含自定义 XML 实体的文档"))
              // 仅保留 PPT 的顺序和备注关系，避免持有整个工作簿 XML。
              if (entry.fileName === "ppt/presentation.xml" || entry.fileName.endsWith(".rels")) {
                parts.set(entry.fileName, text)
              }
            }
            zip.readEntry()
          })
        })
      })
      zip.on("end", () => {
        if (settled) return
        if (!names.has(requiredPart)) return fail(new Error("文件内容与声明的 Office 类型不一致"))
        settled = true
        resolve(parts)
      })
      zip.readEntry()
    })
  })
}
