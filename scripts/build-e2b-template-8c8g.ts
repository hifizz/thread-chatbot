// 基于现有 devin-acp-agent 模板构建 8C8G 规格版本。
// 镜像内容与源模板一致（devin CLI 已烤入），仅资源规格不同。
// 运行：pnpm tsx scripts/build-e2b-template-8c8g.ts

import { readFileSync } from "node:fs"
import { Template } from "e2b"

const env = readFileSync(".env.local", "utf8")
const get = (k: string) =>
  env
    .split("\n")
    .find((l) => l.startsWith(`${k}=`))
    ?.split("=")[1]
    ?.trim()
    .replace(/^["']|["']$/g, "")

const apiKey = get("E2B_API_KEY")
const source = get("E2B_TEMPLATE") || "devin-acp-agent"
if (!apiKey) throw new Error("E2B_API_KEY not found in .env.local")

const name = `${source}-8c8g`
console.log(`基于模板 ${source} 构建 ${name}（8 CPU / 8192 MB）…`)

const template = Template().fromTemplate(source)
const info = await Template.build(template, name, {
  apiKey,
  cpuCount: 8,
  memoryMB: 8192,
  onBuildLogs: (entry) => console.log(`[build] ${String(entry)}`),
})
console.log("构建完成：", JSON.stringify(info, null, 2))
console.log(`\n使用方式：.env.local 中 E2B_TEMPLATE=${name}`)
