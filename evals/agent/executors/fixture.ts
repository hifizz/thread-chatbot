import type { AgentCase } from "@/evals/agent/schema"
import type { AgentExecutionOutput } from "@/evals/agent/result"

export async function executeFixtureCase(
  evaluationCase: AgentCase
): Promise<AgentExecutionOutput> {
  if (!evaluationCase.fixtureResult) {
    throw new Error(`Fixture result missing for case ${evaluationCase.id}`)
  }
  return {
    text: evaluationCase.fixtureResult.text,
    ...(evaluationCase.fixtureResult.route
      ? { route: evaluationCase.fixtureResult.route }
      : {}),
    tools: evaluationCase.fixtureResult.tools,
    terminalState: evaluationCase.fixtureResult.terminalState,
    usage: evaluationCase.fixtureResult.usage ?? {},
  }
}
