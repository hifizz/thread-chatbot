/**
 * 纯离线重放已保存的 20-case raw answers，验证当前 URL guard + source footer。
 * 不调用模型或 Tavily，也不改变原始 rawAnswer/baselineAnswer 证据。
 */
import { readFile, writeFile } from "node:fs/promises"

import {
  buildSourceFooter,
  sanitizeSourceUrls,
} from "../../lib/chat/source-url-guard.ts"

const reportUrl = new URL(
  "../../openspec/changes/add-proactive-web-search/research/eval-live-programming-glm52.json",
  import.meta.url
)
const report = JSON.parse(await readFile(reportUrl, "utf8"))

function urlsFromText(text) {
  return [
    ...new Set(
      (text.match(/https?:\/\/[^\s)\]>"'，。；：！？、（）【】《》]+/g) ?? []).map(
        (value) => value.replace(/[.,;:!?]+$/, "")
      )
    ),
  ]
}

for (const row of report.rows) {
  const sources = new Map(
    row.returnedSources.map((source) => [source.url, source.title])
  )
  const rawAnswer = row.rawAnswer ?? row.answer
  const answer =
    sanitizeSourceUrls(rawAnswer, new Set(sources.keys())).text +
    buildSourceFooter(sources)
  const answerUrls = urlsFromText(answer)
  row.rawAnswer = rawAnswer
  row.answer = answer
  row.citedUrlCount = answerUrls.length
  row.sourceValidity = answerUrls.every((url) => sources.has(url))
  row.passed =
    answer.trim().length >= 80 &&
    sources.size > 0 &&
    answerUrls.length > 0 &&
    row.sourceValidity &&
    row.providerCalls <= 2
}

report.automatedPassRate =
  report.rows.filter((row) => row.passed).length / report.rows.length
report.sourceValidityRate =
  report.rows.filter((row) => row.sourceValidity).length / report.rows.length
report.sourceGuardReevaluatedAt = new Date().toISOString()
report.sourceGuardReevaluation =
  "Offline replay of preserved rawAnswer + returnedSources; no model or provider calls."

await writeFile(reportUrl, `${JSON.stringify(report, null, 2)}\n`)
console.log(
  JSON.stringify(
    {
      sampleCount: report.sampleCount,
      automatedPassRate: report.automatedPassRate,
      sourceValidityRate: report.sourceValidityRate,
      modelOrProviderCalls: 0,
    },
    null,
    2
  )
)
if (report.sourceValidityRate < 1 || report.automatedPassRate < 1) {
  process.exitCode = 1
}
