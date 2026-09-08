import { z } from "zod"
import {
  ARTIFACT_REFERENCE_SCHEMA_VERSION,
} from "@/constants/artifact-reference"

/** 网络输入不接受客户端提供的正文、标题或来源关系。 */
export const artifactReferenceInputSchema = z.object({
  type: z.literal("artifact-reference"),
  artifactId: z.uuid(),
}).strict()

export const artifactReferenceDataSchema = z.object({
  schemaVersion: z.literal(ARTIFACT_REFERENCE_SCHEMA_VERSION),
  artifactId: z.uuid(),
  title: z.string(),
  kind: z.enum(["markdown", "code", "note"]),
  threadId: z.uuid(),
  sourceMessageId: z.uuid(),
}).strict()

export type ArtifactReferenceData = z.infer<typeof artifactReferenceDataSchema>
export type ArtifactReferenceInput = z.infer<typeof artifactReferenceInputSchema>

export interface ReferenceArtifact {
  id: string
  title: string
  content: string
  kind: "markdown" | "code" | "note"
  threadId: string
  sourceMessageId: string
}

export function artifactReferenceData(artifact: ReferenceArtifact): ArtifactReferenceData {
  return {
    schemaVersion: ARTIFACT_REFERENCE_SCHEMA_VERSION,
    artifactId: artifact.id,
    title: artifact.title,
    kind: artifact.kind,
    threadId: artifact.threadId,
    sourceMessageId: artifact.sourceMessageId,
  }
}

