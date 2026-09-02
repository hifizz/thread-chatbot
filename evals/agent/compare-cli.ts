import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { AgentRunSnapshot } from "@/evals/agent/baseline"
import {
  compareAgentRuns,
  formatAgentComparisonMarkdown,
} from "@/evals/agent/compare"

function requiredArgument(name: string): string {
  const prefix = `--${name}=`
  const value = process.argv.find((argument) => argument.startsWith(prefix))
  if (!value) throw new Error(`${prefix}<path> is required`)
  return value.slice(prefix.length)
}

const baseline = JSON.parse(
  await readFile(path.resolve(requiredArgument("baseline")), "utf8")
) as AgentRunSnapshot
const candidate = JSON.parse(
  await readFile(path.resolve(requiredArgument("candidate")), "utf8")
) as AgentRunSnapshot
const comparison = compareAgentRuns(baseline, candidate)
const markdown = formatAgentComparisonMarkdown(comparison)
const output = process.argv
  .find((argument) => argument.startsWith("--output="))
  ?.slice("--output=".length)
if (output) await writeFile(path.resolve(output), markdown)
else console.log(markdown)
if (comparison.blockingRegressions.length > 0) process.exitCode = 1
