import { parseAgentCase, type AgentCase } from "../schema"
import { createHash } from "node:crypto"

// 固定合成资料，既进入 dataset revision，也保证旧/新、不同重复次数之间完全一致。
const id = (n: number) => {
  const hex = createHash("sha256").update(`document-tool-fixture-v1:${n}`).digest("hex")
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}
const intervals = [17, 23, 41, 59, 67, 83, 97]
const documents = intervals.map((minutes, i) => ({
  id: id(i + 1), revisionId: id(i + 101), artifactId: id(i + 201), title: `方案${i + 1}.md`,
  content: `# 方案${i + 1}\n本方案同步间隔为 ${minutes} 分钟。`,
}))
const page = {
  url: "https://example.com/confidence", snapshotId: id(999),
  content: "置信度表示对判定正确性的估计。本测试页规定的置信度验收阈值是 86%。",
}
const definitions = [
  { id: "public-web", prompt: `读取 ${page.url} 的在线 API 文档，告诉我置信度验收阈值百分数。`,
    history: "none", knownDocumentIds: false, docIndexes: [], web: true, facts: { confidenceThresholdPercent: 86 } },
  { id: "old-web-id", prompt: "重新打开刚才的文档，核对当前置信度验收阈值百分数。", history: "web-snapshot",
    knownDocumentIds: false, docIndexes: [], web: true, facts: { confidenceThresholdPercent: 86 } },
  { id: "seven-documents", prompt: "读取本项目保存的方案1.md 到方案7.md 共七份文档，列出各自的同步间隔分钟数。", history: "none",
    knownDocumentIds: false, docIndexes: [0, 1, 2, 3, 4, 5, 6], web: false,
    facts: Object.fromEntries(intervals.map((value, i) => [`syncMinutes${i + 1}`, value])) },
  { id: "mixed-sources", prompt: `读取本项目保存的方案1.md，并读取 ${page.url}，分别给出同步间隔分钟数和置信度验收阈值百分数。`, history: "none",
    knownDocumentIds: false, docIndexes: [0], web: true, facts: { syncMinutes1: 17, confidenceThresholdPercent: 86 } },
  { id: "known-document-id", prompt: "读取方案1.md，告诉我同步间隔分钟数。", history: "none",
    knownDocumentIds: true, docIndexes: [0], web: false, facts: { syncMinutes1: 17 } },
  { id: "recover-after-failure", prompt: "刚才读取失败了，请重新定位本项目保存的方案1.md，读到内容后告诉我同步间隔分钟数。", history: "failed-document-read",
    knownDocumentIds: false, docIndexes: [0], web: false, facts: { syncMinutes1: 17 } },
] as const

/** 独立的专项题集，复用 agent schema/runner；不混入已有固定 fixture 基线。 */
export function documentToolCases(): AgentCase[] {
  return definitions.map((item) => parseAgentCase({
    schemaVersion: "agent-case-v1", id: `document-tools-${item.id}`, suite: "reliability",
    tags: ["document-tools", item.id], sensitivity: "synthetic", execution: "tool-simulation",
    input: {
      messages: [{ role: "user", text: `${item.prompt}\n最终只返回 JSON 对象，字段为 ${Object.keys(item.facts).join("、")}，值为核对后的数字，不要猜测。` }],
      documentTools: { documents, page, history: item.history, knownDocumentIds: item.knownDocumentIds },
    },
    expected: {
      terminalState: "completed",
      documentTools: { documentIds: item.docIndexes.map((i) => documents[i].id), urls: item.web ? [page.url] : [], answerFacts: item.facts },
      rubric: "读取指定来源、避免 ID 混用及重复失败、不得写文档；答案必须包含正确的字段与数字对应关系。",
    },
  }))
}
