import assert from "node:assert/strict"
import path from "node:path"
import {
  DEVELOPMENT_AGENT_SKILL_DIRECTORIES,
  RUNTIME_SKILLS_DIRECTORY,
  SKILL_ACTIVATION_MODES,
  SKILL_CACHE_POLICY_VERSION,
  SKILL_CAPABILITY_PROFILE_IDS,
  SKILL_ERROR_CODES,
  SKILL_PACKAGE_LIMITS,
  SKILL_PROMPT_POLICY_VERSION,
  SKILL_SOURCE_TYPES,
  SKILL_VERSION_STATUSES,
} from "../../constants/skill.ts"
import { resolveRuntimeSkillFeatureConfig } from "../../lib/skills/config.ts"
import {
  assertRuntimeSkillImportPath,
  isDevelopmentAgentSkillPath,
  runtimeSkillDiscoveryRoot,
} from "../../lib/skills/runtime-paths.ts"

assert.deepEqual(SKILL_ACTIVATION_MODES, {
  sticky: "sticky",
  oneShot: "one-shot",
})
assert.deepEqual(SKILL_SOURCE_TYPES, {
  builtin: "builtin",
  admin: "admin",
})
assert.deepEqual(SKILL_VERSION_STATUSES, {
  current: "current",
  superseded: "superseded",
  revoked: "revoked",
})
assert.deepEqual(SKILL_CAPABILITY_PROFILE_IDS, {
  core: "skill-core-v1",
  research: "research-v1",
})
assert.equal(SKILL_ERROR_CODES.packageInvalid, "SKILL_PACKAGE_INVALID")
assert.equal(SKILL_PACKAGE_LIMITS.skillFileBytes, 128 * 1024)
assert.equal(SKILL_PACKAGE_LIMITS.referenceFileBytes, 128 * 1024)
assert.equal(SKILL_PACKAGE_LIMITS.totalBytes, 512 * 1024)
assert.equal(SKILL_PACKAGE_LIMITS.referenceCount, 32)
assert.equal(SKILL_PROMPT_POLICY_VERSION, "thread-chat-skill-prompt-v1")
assert.equal(SKILL_CACHE_POLICY_VERSION, "thread-chat-skill-cache-v1")

const projectRoot = path.resolve("/tmp/thread-chat-skill-foundation")
assert.equal(
  runtimeSkillDiscoveryRoot(projectRoot),
  path.join(projectRoot, RUNTIME_SKILLS_DIRECTORY)
)

for (const directory of DEVELOPMENT_AGENT_SKILL_DIRECTORIES) {
  const candidate = path.join(projectRoot, directory, "research", "SKILL.md")
  assert.equal(isDevelopmentAgentSkillPath(candidate, projectRoot), true)
  assert.throws(
    () => assertRuntimeSkillImportPath(candidate, projectRoot),
    /开发代理 Skill 目录/
  )
}

assert.equal(
  isDevelopmentAgentSkillPath(
    path.join(projectRoot, ".agents-skills", "research", "SKILL.md"),
    projectRoot
  ),
  false
)
assert.doesNotThrow(() =>
  assertRuntimeSkillImportPath(
    path.join(projectRoot, RUNTIME_SKILLS_DIRECTORY, "research"),
    projectRoot
  )
)

assert.deepEqual(resolveRuntimeSkillFeatureConfig({}), {
  catalogDiscoveryEnabled: true,
  composerUiEnabled: true,
})
assert.deepEqual(
  resolveRuntimeSkillFeatureConfig({
    THREAD_CHAT_SKILLS_CATALOG_ENABLED: "false",
    THREAD_CHAT_SKILLS_UI_ENABLED: "true",
  }),
  {
    catalogDiscoveryEnabled: false,
    composerUiEnabled: false,
  }
)
assert.deepEqual(
  resolveRuntimeSkillFeatureConfig({
    THREAD_CHAT_SKILLS_CATALOG_ENABLED: "true",
    THREAD_CHAT_SKILLS_UI_ENABLED: "off",
  }),
  {
    catalogDiscoveryEnabled: true,
    composerUiEnabled: false,
  }
)
assert.deepEqual(
  Object.keys(resolveRuntimeSkillFeatureConfig({})).sort(),
  ["catalogDiscoveryEnabled", "composerUiEnabled"]
)

console.log("runtime Skill foundation tests passed")
