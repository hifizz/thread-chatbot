import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { describe, it } from "node:test"
import { AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT } from "../../constants/web-search.ts"

const fixtureUrl = new URL("./fixtures/web-search-routing.json", import.meta.url)
const baselineUrl = new URL("./fixtures/web-search-baseline.json", import.meta.url)
const fixture = JSON.parse(await readFile(fixtureUrl, "utf8"))
const baseline = JSON.parse(await readFile(baselineUrl, "utf8"))

describe("GLM-5.2 Web Search 固定评测数据", () => {
  it("包含至少 60 条且 ID 唯一", () => {
    assert.ok(fixture.cases.length >= 60)
    assert.equal(
      new Set(fixture.cases.map((item) => item.id)).size,
      fixture.cases.length
    )
  })

  it("覆盖中英 must/no-search、歧义、always/off 和异常参数", () => {
    const labels = new Set(fixture.cases.map((item) => item.label))
    for (const label of [
      "must_search",
      "no_search",
      "ambiguous",
      "forced_search",
      "disabled",
      "invalid_tool_input",
    ]) {
      assert.ok(labels.has(label), label)
    }
    for (const language of ["zh", "en"]) {
      assert.ok(
        fixture.cases.some(
          (item) => item.language === language && item.label === "must_search"
        )
      )
      assert.ok(
        fixture.cases.some(
          (item) => item.language === language && item.label === "no_search"
        )
      )
    }
  })

  it("用占位符明确表达超长 synthetic 输入", () => {
    const overLimit = fixture.cases.find(
      (item) => item.toolInput?.query === "__OVER_QUERY_LIMIT__"
    )
    assert.ok(overLimit)
    overLimit.toolInput.query = "x".repeat(AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT + 1)
    assert.ok(overLimit.toolInput.query.length > AUTO_WEB_SEARCH_QUERY_CHAR_LIMIT)
  })

  it("基线保留已测数值并明确缺失项", () => {
    assert.equal(baseline.routingDecisionBaseline.englishPolicyAB.cases, 14)
    assert.equal(baseline.existingHeavySearchBaseline.providerCalls, 3)
    assert.equal(baseline.existingHeavySearchBaseline.credits, 6)
    assert.equal(baseline.existingHeavySearchBaseline.latencyMs, null)
    assert.equal(baseline.noSearchThreadChatBaseline.answerCapture, "not_recorded")
  })
})
