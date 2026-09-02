import { generateText, Output, type LanguageModel } from "ai"
import { z } from "zod"
import { resolveChatModel } from "@/lib/ai/provider"
import { buildAiTelemetryConfig } from "@/lib/observability/ai-sdk"
import type { AgentCase } from "@/evals/agent/schema"
import type {
  AgentExperimentResult,
  EvaluationScore,
} from "@/evals/agent/result"
import { MODEL_CALL_PURPOSE } from "@/constants/model-call"

export const DEFAULT_JUDGE_RUBRIC_VERSION = "agent-quality-rubric-v1"

const judgeOutputSchema = z.object({
  correctness: z.number().min(0).max(1),
  faithfulness: z.number().min(0).max(1),
  helpfulness: z.number().min(0).max(1),
  completeness: z.number().min(0).max(1),
  citationSupport: z.number().min(0).max(1),
  comment: z.string().max(500),
})

export type JudgeOutput = z.infer<typeof judgeOutputSchema>

export async function runModelJudge(input: {
  evaluationCase: AgentCase
  result: AgentExperimentResult
  judgeModelId: string
  rubricVersion?: string
  model?: LanguageModel
}): Promise<EvaluationScore[]> {
  const rubricVersion = input.rubricVersion ?? DEFAULT_JUDGE_RUBRIC_VERSION
  const model = input.model ?? resolveChatModel(input.judgeModelId)
  const response = await generateText({
    ...buildAiTelemetryConfig(MODEL_CALL_PURPOSE.evaluationJudge, {
      environment: "evaluation",
      caseId: input.evaluationCase.id,
      candidate: input.result.candidate,
    }),
    model,
    system: [
      `Rubric version: ${rubricVersion}`,
      "Score each named dimension from 0 to 1.",
      "Do not average dimensions and do not override deterministic safety failures.",
      "Judge only from the supplied synthetic/authorized case, expectation, and output.",
    ].join("\n"),
    prompt: JSON.stringify({
      input: input.evaluationCase.input,
      expected: input.evaluationCase.expected,
      output: input.result.output,
    }),
    output: Output.object({ schema: judgeOutputSchema }),
    maxOutputTokens: 800,
  })
  const judged = response.output
  return [
    "correctness",
    "faithfulness",
    "helpfulness",
    "completeness",
    "citationSupport",
  ].map((dimension) => ({
    name: `judge:${dimension}`,
    value: judged[dimension as keyof Omit<JudgeOutput, "comment">],
    deterministic: false,
    severity: "quality",
    signal: "judge",
    evaluatorVersion: `${input.judgeModelId}:${rubricVersion}`,
    comment: judged.comment,
  }))
}

export function calibrateJudge(
  samples: Array<{ human: number; judge: number }>
): { samples: number; meanAbsoluteError: number; withinPointTwoRate: number } {
  if (samples.length === 0) {
    return { samples: 0, meanAbsoluteError: 0, withinPointTwoRate: 0 }
  }
  const errors = samples.map((sample) => Math.abs(sample.human - sample.judge))
  return {
    samples: samples.length,
    meanAbsoluteError:
      errors.reduce((sum, error) => sum + error, 0) / samples.length,
    withinPointTwoRate:
      errors.filter((error) => error <= 0.2).length / samples.length,
  }
}
