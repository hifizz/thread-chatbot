type EnvironmentSource = Record<string, string | undefined>

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
  if (value === source.DATABASE_URL?.trim()) {
    throw new Error("EVAL_DATABASE_URL must differ from DATABASE_URL")
  }
  const url = new URL(value)
  const databaseName = url.pathname.slice(1).toLowerCase()
  if (!/(?:eval|test)/.test(databaseName)) {
    throw new Error("Evaluation database name must contain eval or test")
  }
  return value
}
