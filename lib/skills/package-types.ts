import type {
  SkillActivationMode,
  SkillCapabilityProfileId,
} from "@/constants/skill"

export interface SkillResourceSnapshot {
  path: string
  mediaType: "text/markdown"
  digest: string
  byteSize: number
  content: string
}

export interface CanonicalSkillPackage {
  schemaVersion: "thread-chat-skill-package-v1"
  slug: string
  name: string
  description: string
  version: string
  digest: string
  activationMode: SkillActivationMode
  capabilityProfileId: SkillCapabilityProfileId
  manifest: Record<string, unknown>
  instructions: string
  resources: SkillResourceSnapshot[]
  totalBytes: number
}
