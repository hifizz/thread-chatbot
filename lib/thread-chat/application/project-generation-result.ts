import type { UIMessage } from "ai"
import type { Artifact } from "@/lib/thread-chat/domain/types"
import type {
  GenerationResultV1,
  GenerationUsageMetadata,
} from "@/lib/thread-chat/domain/generation"
import { generationResultV1Schema } from "@/lib/thread-chat/contracts/generation-result"
import {
  GENERATION_ERRORS,
  GENERATION_RESULT_VERSION,
} from "@/constants/generation"
import {
  MARKDOWN_ARTIFACT_TOOL_NAME,
  markdownArtifactInputSchema,
} from "@/lib/chat/markdown-artifact"
import type { ResearchPlan, ResearchRoute } from "@/lib/chat/research-router"
import type {
  WebResearchActivity,
  WebResearchSource,
} from "@/lib/chat/web-research-activity"

type ProjectTerminalStatus = "completed" | "stopped" | "failed"

export type ProjectGenerationResultInput = {
  generationId: string
  threadId: string
  assistantMessageId: string
  responseMessage: Pick<UIMessage, "parts">
  terminalStatus: ProjectTerminalStatus
  error?: string
  researchRoute?: ResearchRoute
  researchPlan?: ResearchPlan
  usage?: GenerationUsageMetadata
}

export type ProjectGenerationResultOutput = {
  result: GenerationResultV1
  hasDisplayableOutput: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export function generationArtifactId(
  generationId: string,
  toolCallId: string
): string {
  return `ga_${generationId}_${stableHash(toolCallId)}`
}

function toolName(part: Record<string, unknown>): string | null {
  if (part.type === "dynamic-tool") {
    return typeof part.toolName === "string" ? part.toolName : null
  }
  if (typeof part.type !== "string" || !part.type.startsWith("tool-"))
    return null
  return part.type.slice("tool-".length)
}

function sourcesFromOutput(output: unknown): WebResearchSource[] {
  if (!isRecord(output) || !Array.isArray(output.results)) return []
  const seen = new Set<string>()
  return output.results.flatMap((candidate) => {
    if (!isRecord(candidate) || typeof candidate.url !== "string") return []
    const url = candidate.url.trim()
    if (!url || seen.has(url)) return []
    seen.add(url)
    const title =
      typeof candidate.title === "string" && candidate.title.trim()
        ? candidate.title.trim()
        : url
    return [{ title, url }]
  })
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function projectGenerationResult({
  generationId,
  threadId,
  assistantMessageId,
  responseMessage,
  terminalStatus,
  error,
  researchRoute: knownRoute,
  researchPlan: knownPlan,
  usage,
}: ProjectGenerationResultInput): ProjectGenerationResultOutput {
  const textParts: string[] = []
  const artifacts: Record<string, Artifact> = {}
  const artifactIds: string[] = []
  const researchByCall = new Map<string, WebResearchActivity>()
  let webResearchTextOffset: number | undefined
  let receivedTextLength = 0
  let researchRoute = knownRoute
  let researchPlan = knownPlan

  for (const rawPart of responseMessage.parts) {
    if (!isRecord(rawPart) || typeof rawPart.type !== "string") continue
    const part: Record<string, unknown> = rawPart
    if (part.type === "text" && typeof part.text === "string") {
      textParts.push(part.text)
      receivedTextLength += part.text.length
      continue
    }
    if (part.type === "data-research-route" && isRecord(part.data)) {
      researchRoute = part.data as ResearchRoute
      continue
    }
    if (part.type === "data-research-plan" && isRecord(part.data)) {
      researchPlan = part.data as unknown as ResearchPlan
      continue
    }

    const name = toolName(part)
    const toolCallId = optionalString(part.toolCallId)
    if (!name || !toolCallId) continue
    const input = part.input

    if (name === MARKDOWN_ARTIFACT_TOOL_NAME) {
      const parsed = markdownArtifactInputSchema.safeParse(input)
      if (!parsed.success) continue
      const id = generationArtifactId(generationId, toolCallId)
      artifacts[id] = {
        id,
        sourceThreadId: threadId,
        sourceMessageId: assistantMessageId,
        kind: "markdown",
        title: parsed.data.title,
        content: parsed.data.content,
      }
      if (!artifactIds.includes(id)) artifactIds.push(id)
      continue
    }

    if (name === "webSearch" || name === "readUrl") {
      webResearchTextOffset ??= receivedTextLength
      const inputRecord = isRecord(input) ? input : {}
      const output = part.output
      researchByCall.set(toolCallId, {
        toolCallId,
        kind: name === "webSearch" ? "search" : "read",
        status: "complete",
        query:
          name === "webSearch" ? optionalString(inputRecord.query) : undefined,
        url: name === "readUrl" ? optionalString(inputRecord.url) : undefined,
        sources: name === "webSearch" ? sourcesFromOutput(output) : [],
      })
    }
  }

  const text = textParts.join("")
  const webResearch = [...researchByCall.values()]
  const hasDisplayableOutput =
    text.trim().length > 0 ||
    artifactIds.length > 0 ||
    webResearch.length > 0 ||
    researchPlan !== undefined

  let status: GenerationResultV1["status"] = "done"
  let resultError: string | undefined
  if (terminalStatus === "failed") {
    status = "error"
    resultError = error || GENERATION_ERRORS.streamFailed
  } else if (terminalStatus === "stopped") {
    status = "error"
    resultError = GENERATION_ERRORS.stopped
  } else if (terminalStatus === "completed" && !hasDisplayableOutput) {
    status = "error"
    resultError = GENERATION_ERRORS.emptyResponse
  }

  return {
    hasDisplayableOutput,
    result: generationResultV1Schema.parse({
      version: GENERATION_RESULT_VERSION,
      generationId,
      text,
      status,
      ...(resultError ? { error: resultError } : {}),
      artifactIds,
      artifacts,
      ...(webResearch.length > 0 ? { webResearch } : {}),
      ...(webResearchTextOffset !== undefined ? { webResearchTextOffset } : {}),
      ...(researchRoute ? { researchRoute } : {}),
      ...(researchPlan ? { researchPlan } : {}),
      ...(usage ? { usage } : {}),
    }),
  }
}
