import { SKILL_ERROR_CODES } from "@/constants/skill"

export class SkillPackageValidationError extends Error {
  readonly code = SKILL_ERROR_CODES.packageInvalid

  constructor(
    message: string,
    readonly resourcePath?: string
  ) {
    super(resourcePath ? `${message}：${resourcePath}` : message)
    this.name = "SkillPackageValidationError"
  }
}
