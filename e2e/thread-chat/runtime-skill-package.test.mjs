import assert from "node:assert/strict"
import { chmod, mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import {
  loadCanonicalSkillPackage,
  normalizeSkillResourcePath,
} from "../../lib/skills/package-loader.ts"
import { SkillPackageValidationError } from "../../lib/skills/package-error.ts"

const projectRoot = process.cwd()
const research = await loadCanonicalSkillPackage(
  path.join(projectRoot, "runtime-skills/research"),
  { projectRoot }
)
assert.equal(research.slug, "research")
assert.equal(research.version, "1.0.0")
assert.equal(research.activationMode, "sticky")
assert.equal(research.capabilityProfileId, "research-v1")
assert.deepEqual(
  research.resources.map((resource) => resource.path),
  [
    "references/output-template.md",
    "references/quality-checklist.md",
  ]
)
assert.match(research.digest, /^[a-f0-9]{64}$/)
assert.equal(research.instructions.includes("检查点 A"), true)

assert.throws(
  () => normalizeSkillResourcePath("../secret.md"),
  SkillPackageValidationError
)
assert.throws(
  () => normalizeSkillResourcePath("/secret.md"),
  SkillPackageValidationError
)
assert.throws(
  () => normalizeSkillResourcePath("references\\secret.md"),
  SkillPackageValidationError
)

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "thread-chat-skills-"))

async function createPackage(
  directoryName,
  {
    slug = directoryName,
    versionLine = "    version: 1.0.0\n",
    activation = "sticky",
    profile = "skill-core-v1",
    lineEnding = "\n",
    bom = false,
  } = {}
) {
  const root = path.join(temporaryRoot, directoryName)
  await mkdir(path.join(root, "references"), { recursive: true })
  const source = [
    "---",
    `name: ${slug}`,
    `description: ${slug} description`,
    "metadata:",
    "  threadchat:",
    versionLine.trimEnd(),
    `    activation-mode: ${activation}`,
    `    capability-profile: ${profile}`,
    "---",
    "",
    `# ${slug}`,
    "",
    "Instructions",
    "",
  ].join("\n")
  const normalized = source.replaceAll("\n", lineEnding)
  await writeFile(
    path.join(root, "SKILL.md"),
    `${bom ? "\uFEFF" : ""}${normalized}`
  )
  await writeFile(
    path.join(root, "references/example.md"),
    `# Example${lineEnding}`
  )
  return root
}

try {
  const lfRoot = await createPackage("normal-lf", { slug: "normal" })
  const crlfRoot = await createPackage("normal-crlf", {
    slug: "normal",
    lineEnding: "\r\n",
    bom: true,
  })
  const lf = await loadCanonicalSkillPackage(lfRoot, { projectRoot })
  const crlf = await loadCanonicalSkillPackage(crlfRoot, { projectRoot })
  assert.equal(lf.digest, crlf.digest)

  const fallbackRoot = await createPackage("missing-version", {
    versionLine: "",
  })
  const fallback = await loadCanonicalSkillPackage(fallbackRoot, {
    projectRoot,
  })
  assert.equal(fallback.version, `0.0.0+${fallback.digest.slice(0, 12)}`)

  const badYamlRoot = await createPackage("bad-yaml")
  await writeFile(
    path.join(badYamlRoot, "SKILL.md"),
    "---\nname: bad-yaml\n description: invalid indent\n---\nbody\n"
  )
  await assert.rejects(
    () => loadCanonicalSkillPackage(badYamlRoot, { projectRoot }),
    SkillPackageValidationError
  )

  const unknownProfileRoot = await createPackage("unknown-profile", {
    profile: "shell-root-v1",
  })
  await assert.rejects(
    () => loadCanonicalSkillPackage(unknownProfileRoot, { projectRoot }),
    /未批准的 capability-profile/
  )

  const scriptsRoot = await createPackage("with-scripts")
  await mkdir(path.join(scriptsRoot, "scripts"))
  await writeFile(path.join(scriptsRoot, "scripts/run.sh"), "echo unsafe\n")
  await assert.rejects(
    () => loadCanonicalSkillPackage(scriptsRoot, { projectRoot }),
    /只允许 references/
  )

  const executableRoot = await createPackage("executable-reference")
  const executablePath = path.join(executableRoot, "references/example.md")
  await chmod(executablePath, 0o755)
  await assert.rejects(
    () => loadCanonicalSkillPackage(executableRoot, { projectRoot }),
    /可执行权限/
  )

  const symlinkRoot = await createPackage("symlink-reference")
  await symlink(
    path.join(symlinkRoot, "SKILL.md"),
    path.join(symlinkRoot, "references/link.md")
  )
  await assert.rejects(
    () => loadCanonicalSkillPackage(symlinkRoot, { projectRoot }),
    /符号链接/
  )

  const oversizedRoot = await createPackage("oversized-reference")
  await writeFile(
    path.join(oversizedRoot, "references/example.md"),
    "x".repeat(128 * 1024 + 1)
  )
  await assert.rejects(
    () => loadCanonicalSkillPackage(oversizedRoot, { projectRoot }),
    /超过大小限制/
  )

  const binaryRoot = await createPackage("binary-reference")
  await writeFile(
    path.join(binaryRoot, "references/example.md"),
    Buffer.from([0xc3, 0x28])
  )
  await assert.rejects(
    () => loadCanonicalSkillPackage(binaryRoot, { projectRoot }),
    /有效 UTF-8/
  )
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}

console.log("runtime Skill package tests passed")
