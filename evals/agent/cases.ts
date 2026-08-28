import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { parseAgentCase, type AgentCase } from "@/evals/agent/schema"

export const AGENT_EVAL_ROOT = path.resolve(process.cwd(), "evals/agent")
export const AGENT_CASES_ROOT = path.join(AGENT_EVAL_ROOT, "cases")
export const AGENT_FIXTURES_ROOT = path.join(AGENT_EVAL_ROOT, "fixtures")

export async function loadAgentCases(
  root = AGENT_CASES_ROOT
): Promise<AgentCase[]> {
  const files = (await readdir(root, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(entry.parentPath, entry.name))
    .sort()
  const cases = (
    await Promise.all(
      files.map(async (file) => {
        const value: unknown = JSON.parse(await readFile(file, "utf8"))
        return (Array.isArray(value) ? value : [value]).map(parseAgentCase)
      })
    )
  ).flat()
  const ids = new Set<string>()
  for (const item of cases) {
    if (ids.has(item.id))
      throw new Error(`Duplicate evaluation case ID: ${item.id}`)
    ids.add(item.id)
  }
  return cases
}

export function resolveFixturePath(fixture: string): string {
  const resolved = path.resolve(AGENT_FIXTURES_ROOT, fixture)
  if (
    resolved !== AGENT_FIXTURES_ROOT &&
    !resolved.startsWith(`${AGENT_FIXTURES_ROOT}${path.sep}`)
  ) {
    throw new Error("Evaluation fixture path escapes fixtures root")
  }
  return resolved
}
