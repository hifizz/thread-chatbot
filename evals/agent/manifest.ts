import { createHash } from "node:crypto"
import manifestSource from "@/evals/agent/manifests/v1.json"
import { AGENT_CASE_SCHEMA_VERSION, type AgentCase } from "@/evals/agent/schema"

export const AGENT_CASE_MANIFEST_SCHEMA_VERSION =
  "agent-case-manifest-v1" as const
export type EvaluationRunMode = "smoke" | "ci" | "scheduled" | "release"

export type EvaluationCaseManifest = {
  schemaVersion: typeof AGENT_CASE_MANIFEST_SCHEMA_VERSION
  mode: EvaluationRunMode
  profile: "default" | "ad-hoc"
  caseIds: string[]
  fingerprint: string
}

const MODES: EvaluationRunMode[] = ["smoke", "ci", "scheduled", "release"]

function uniqueIds(ids: readonly string[], label: string): string[] {
  if (ids.length === 0) throw new Error(`${label} case manifest is empty`)
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
  }
  if (duplicates.size > 0) {
    throw new Error(
      `${label} case manifest has duplicate IDs: ${[...duplicates].join(", ")}`
    )
  }
  return [...ids]
}

function caseIndex(cases: readonly AgentCase[]): Map<string, AgentCase> {
  const ids = uniqueIds(
    cases.map((item) => item.id),
    "Evaluation dataset"
  )
  return new Map(ids.map((id, index) => [id, cases[index]]))
}

function fingerprint(input: Omit<EvaluationCaseManifest, "fingerprint">) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex")
}

export function createEvaluationCaseManifest(input: {
  mode: EvaluationRunMode
  profile: EvaluationCaseManifest["profile"]
  caseIds: readonly string[]
}): EvaluationCaseManifest {
  const value = {
    schemaVersion: AGENT_CASE_MANIFEST_SCHEMA_VERSION,
    mode: input.mode,
    profile: input.profile,
    caseIds: uniqueIds(input.caseIds, `${input.mode}/${input.profile}`),
  }
  return { ...value, fingerprint: fingerprint(value) }
}

export function resolveDefaultEvaluationManifest(
  cases: readonly AgentCase[],
  mode: EvaluationRunMode
): { manifest: EvaluationCaseManifest; cases: AgentCase[] } {
  if (manifestSource.schemaVersion !== "agent-case-manifests-v1") {
    throw new Error("Unsupported evaluation mode manifest schema")
  }
  if (manifestSource.caseSchemaVersion !== AGENT_CASE_SCHEMA_VERSION) {
    throw new Error("Evaluation mode manifest case schema is incompatible")
  }
  const byId = caseIndex(cases)
  for (const knownMode of MODES) {
    const ids = uniqueIds(
      manifestSource.modes[knownMode],
      `${knownMode}/default`
    )
    const missing = ids.filter((id) => !byId.has(id))
    if (missing.length > 0) {
      throw new Error(
        `${knownMode} case manifest references missing IDs: ${missing.join(", ")}`
      )
    }
  }
  for (const exhaustiveMode of ["scheduled", "release"] as const) {
    const manifestIds = new Set(manifestSource.modes[exhaustiveMode])
    const omitted = [...byId.keys()].filter((id) => !manifestIds.has(id))
    if (omitted.length > 0) {
      throw new Error(
        `${exhaustiveMode} case manifest omits dataset IDs: ${omitted.join(", ")}`
      )
    }
  }
  const manifest = createEvaluationCaseManifest({
    mode,
    profile: "default",
    caseIds: manifestSource.modes[mode],
  })
  return {
    manifest,
    cases: manifest.caseIds.map((id) => byId.get(id)!),
  }
}

export function createAdHocEvaluationManifest(
  cases: readonly AgentCase[],
  mode: EvaluationRunMode
): EvaluationCaseManifest {
  return createEvaluationCaseManifest({
    mode,
    profile: "ad-hoc",
    caseIds: cases.map((item) => item.id),
  })
}
