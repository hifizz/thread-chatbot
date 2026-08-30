import process from "node:process"
import { loadCanonicalSkillPackage } from "@/lib/skills/package-loader"
import { SkillPackageValidationError } from "@/lib/skills/package-error"

function option(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? null) : null
}

const packagePath = option("--path")
if (!packagePath) {
  console.error("用法：pnpm skills:validate -- --path <skill-directory>")
  process.exitCode = 1
} else {
  try {
    const skill = await loadCanonicalSkillPackage(packagePath)
    console.log(
      JSON.stringify(
        {
          schemaVersion: skill.schemaVersion,
          slug: skill.slug,
          version: skill.version,
          digest: skill.digest,
          activationMode: skill.activationMode,
          capabilityProfileId: skill.capabilityProfileId,
          totalBytes: skill.totalBytes,
          resources: skill.resources.map((resource) => ({
            path: resource.path,
            digest: resource.digest,
            byteSize: resource.byteSize,
          })),
        },
        null,
        2
      )
    )
  } catch (error) {
    const message =
      error instanceof SkillPackageValidationError
        ? error.message
        : "Skill 包校验失败"
    console.error(message)
    process.exitCode = 1
  }
}
