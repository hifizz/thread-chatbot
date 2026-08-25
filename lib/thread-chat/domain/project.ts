import type { ProjectId, UserId } from "./ids"

export type ProjectTarget = {
  ultimate: string | null
  shortTerm: string[]
  midTerm: string[]
}

export type Project = {
  id: ProjectId
  ownerUserId: UserId
  autoTitle: string | null
  customTitle: string | null
  target: ProjectTarget | null
  instruction: string | null
  archivedAt: Date | null
  artifactChangeSequence: number
  createdAt: Date
  updatedAt: Date
}

export function getProjectDisplayTitle(project: Project): string {
  return project.customTitle ?? project.autoTitle ?? "新对话"
}
