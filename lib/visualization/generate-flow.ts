import { generateText, Output } from "ai"
import { getChatModel } from "@/constants/model"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"
import { isModelConfigured, resolveChatModel } from "@/lib/ai/llm/providers"
import { withModelCallLogging } from "@/lib/ai/model-call-logger"
import { buildAiTelemetryConfig } from "@/lib/observability/ai-sdk"
import { logger } from "@/lib/axiom/server"
import { flowSpecSchema } from "@/lib/visualization/schema"
import type {
  FlowSpec,
  GenerateVisualizationInput,
  GenerateVisualizationResult,
} from "@/lib/visualization/types"
import {
  verifyFlowGraph,
  type FlowVerificationError,
} from "@/lib/visualization/verify-flow"

export const DEFAULT_VISUALIZATION_MODEL_ID = "private-relay-gpt-5.6-luna"
export const MAX_VISUALIZATION_ATTEMPTS = 3

export function getVisualizationModelId(): string {
  return process.env.VISUALIZATION_MODEL_ID?.trim() || DEFAULT_VISUALIZATION_MODEL_ID
}

function visualizationModel() {
  const modelId = getVisualizationModelId()
  if (!getChatModel(modelId)) throw new Error("VISUALIZATION_MODEL_NOT_ALLOWED")
  if (!isModelConfigured(modelId)) throw new Error("VISUALIZATION_MODEL_NOT_CONFIGURED")
  return { modelId, model: resolveChatModel(modelId) }
}

function basePrompt(input: GenerateVisualizationInput): string {
  return [
    "Convert the user's request into a concise user-flow graph.",
    "Return only the structured object requested by the schema.",
    "Rules:",
    "- Describe semantic flow only. Never emit coordinates, styles, handles, React Flow, Dagre, ELK, SVG, or HTML fields.",
    "- Prefer 5-15 nodes unless the request genuinely needs more.",
    "- Use stable kebab-case ids.",
    "- Keep labels short and put extra context in description.",
    "- Use decision nodes only for actual branching decisions.",
    "- Every edge endpoint and group node id must reference an existing node.",
    "- Do not invent unnecessary product steps.",
    `- Direction: ${input.direction ?? "LR"}.`,
    "",
    "User request:",
    input.prompt,
  ].join("\n")
}

function repairPrompt(
  input: GenerateVisualizationInput,
  spec: FlowSpec,
  errors: readonly FlowVerificationError[]
): string {
  return [
    basePrompt(input),
    "",
    "Repair the previous graph. Preserve valid semantics and change only what is needed to satisfy verification.",
    "Previous graph:",
    JSON.stringify(spec),
    "Verification errors:",
    ...errors.map((error) => `- ${error.code} at ${error.path}: ${error.message}`),
  ].join("\n")
}

async function generateCandidate(input: {
  model: ReturnType<typeof resolveChatModel>
  prompt: string
}) {
  return generateText({
    model: withModelCallLogging(
      input.model,
      MODEL_CALL_PURPOSE.visualizationGenerate
    ),
    ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.visualizationGenerate),
    reasoning: "low",
    system:
      "You generate ThreadChat user-flow domain data. Follow the schema exactly and never emit renderer-specific implementation fields.",
    prompt: input.prompt,
    output: Output.object({ schema: flowSpecSchema }),
    maxOutputTokens: 4_000,
    maxRetries: 1,
  })
}

export async function generateVerifiedVisualization(
  input: GenerateVisualizationInput
): Promise<GenerateVisualizationResult> {
  const startedAt = performance.now()
  const { modelId, model } = visualizationModel()
  let previousSpec: FlowSpec | null = null
  let previousErrors: FlowVerificationError[] = []
  let firstPass: "passed" | "failed" = "failed"
  let lastError: unknown

  for (let attempt = 1; attempt <= MAX_VISUALIZATION_ATTEMPTS; attempt++) {
    try {
      const response = await generateCandidate({
        model,
        prompt:
          previousSpec && previousErrors.length > 0
            ? repairPrompt(input, previousSpec, previousErrors)
            : basePrompt(input),
      })
      const spec = response.output
      const verification = verifyFlowGraph(spec)
      if (attempt === 1) firstPass = verification.valid ? "passed" : "failed"
      if (verification.valid) {
        const result: GenerateVisualizationResult = {
          visualization: { kind: "user-flow", spec },
          verification: {
            schema: "passed",
            graph: "passed",
            semantic: "skipped",
          },
          generation: {
            modelId,
            attempts: attempt,
            repairs: attempt - 1,
            firstPass,
            durationMs: Math.round(performance.now() - startedAt),
          },
        }
        logger.info("visualization.generate", {
          modelId,
          attempts: attempt,
          repairs: attempt - 1,
          firstPass,
          durationMs: result.generation.durationMs,
          usage: response.usage,
          success: true,
        })
        return result
      }
      previousSpec = spec
      previousErrors = verification.errors
    } catch (error) {
      lastError = error
      previousSpec = null
      previousErrors = []
      if (attempt === 1) firstPass = "failed"
    }
  }

  logger.error("visualization.generate", {
    modelId,
    attempts: MAX_VISUALIZATION_ATTEMPTS,
    repairs: Math.max(0, MAX_VISUALIZATION_ATTEMPTS - 1),
    firstPass,
    durationMs: Math.round(performance.now() - startedAt),
    success: false,
    error: lastError instanceof Error ? lastError.message : String(lastError ?? "verification_failed"),
  })
  throw new Error("VISUALIZATION_GENERATION_FAILED")
}
