import type { AgentCase, AgentSuite } from "@/evals/agent/schema"

export type EvaluationSelection = {
  suites?: AgentSuite[]
  tags?: string[]
  caseIds?: string[]
}

export function selectAgentCases(
  cases: readonly AgentCase[],
  selection: EvaluationSelection = {}
): AgentCase[] {
  const selected = cases.filter(
    (item) =>
      (!selection.suites?.length || selection.suites.includes(item.suite)) &&
      (!selection.tags?.length ||
        selection.tags.every((tag) => item.tags.includes(tag))) &&
      (!selection.caseIds?.length || selection.caseIds.includes(item.id))
  )
  if (selection.caseIds?.length) {
    const found = new Set(selected.map((item) => item.id))
    const missing = selection.caseIds.filter((id) => !found.has(id))
    if (missing.length)
      throw new Error(`Unknown evaluation case IDs: ${missing.join(", ")}`)
  }
  return selected
}
