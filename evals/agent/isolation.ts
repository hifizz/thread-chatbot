type EnvironmentSource = Record<string, string | undefined>

const EVALUATION_DATABASE_NAME = /^thread_chat_eval(?:_[a-z0-9-]+)?$/
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"])

export type EvaluationDatabaseIdentity = {
  host: string
  database: string
}

export function canonicalEvaluationDatabaseIdentity(
  value: string
): EvaluationDatabaseIdentity {
  const url = new URL(value)
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("Evaluation database URL must use postgres or postgresql")
  }
  const database = decodeURIComponent(url.pathname.replace(/^\/+/, ""))
    .trim()
    .toLowerCase()
  if (!database) throw new Error("Evaluation database name is required")
  const hostname = url.hostname.toLowerCase()
  return {
    host: LOOPBACK_HOSTS.has(hostname) ? "loopback" : hostname,
    database,
  }
}

export function assertEvaluationEnvironment(
  source: EnvironmentSource = process.env
): void {
  if (source.AI_OBSERVABILITY_ENVIRONMENT !== "evaluation") {
    throw new Error(
      "Agent evals require AI_OBSERVABILITY_ENVIRONMENT=evaluation"
    )
  }
}

export function evaluationDatabaseUrl(
  source: EnvironmentSource = process.env
): string {
  assertEvaluationEnvironment(source)
  if (source.EVAL_ALLOW_DATABASE_WRITES !== "true") {
    throw new Error("Lifecycle evals require EVAL_ALLOW_DATABASE_WRITES=true")
  }
  const value = source.EVAL_DATABASE_URL?.trim()
  if (!value) throw new Error("Lifecycle evals require EVAL_DATABASE_URL")
  const evaluation = canonicalEvaluationDatabaseIdentity(value)
  const productionValue = source.DATABASE_URL?.trim()
  if (productionValue) {
    const production = canonicalEvaluationDatabaseIdentity(productionValue)
    if (
      evaluation.host === production.host &&
      evaluation.database === production.database
    ) {
      throw new Error("EVAL_DATABASE_URL resolves to the production database")
    }
  }
  if (!EVALUATION_DATABASE_NAME.test(evaluation.database)) {
    throw new Error(
      "Evaluation database name must match thread_chat_eval[_suffix]"
    )
  }
  return value
}

export async function assertEvaluationDatabaseGuard(input: {
  readGuard: () => Promise<string | null | undefined>
  source?: EnvironmentSource
}): Promise<void> {
  const source = input.source ?? process.env
  const expected = source.EVAL_DATABASE_GUARD_TOKEN?.trim()
  if (!expected || expected.length < 24) {
    throw new Error(
      "Lifecycle evals require a 24+ character EVAL_DATABASE_GUARD_TOKEN"
    )
  }
  const actual = (await input.readGuard())?.trim()
  if (!actual || actual !== expected) {
    throw new Error("Evaluation database guard does not match")
  }
}
