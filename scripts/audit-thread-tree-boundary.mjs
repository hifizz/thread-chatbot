import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

const ROOT = process.cwd()
const SCAN_ROOTS = ["app", "lib", "constants"]
const LEGACY_PATTERNS = [
  ["ThreadTreeState", /\bThreadTreeState\b/u],
  ["branchTrees", /\bbranchTrees\b/u],
  ["branchGenerations", /\bbranchGenerations\b/u],
  ["branchMessageFeedback", /\bbranchMessageFeedback\b/u],
  ["activeLeafMessageId", /\bactiveLeafMessageId\b/u],
  ["forkFromMsgId", /\bforkFromMsgId\b/u],
  ["persistNow", /\bpersistNow\b/u],
  ["legacy branch API", /\/api\/(?:branch-trees|branch-generations)\b/u],
  ["legacy generation repository", /thread-chat-generation/u],
]

async function listSourceFiles(relativeDirectory) {
  const directory = path.join(ROOT, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) return listSourceFiles(relativePath)
      return /\.(?:ts|tsx|js|mjs)$/u.test(entry.name) &&
        !/\.(?:test|spec)\./u.test(entry.name)
        ? [relativePath]
        : []
    })
  )
  return nested.flat()
}

const sourceFiles = (await Promise.all(SCAN_ROOTS.map(listSourceFiles))).flat()
const violations = []
for (const relativePath of sourceFiles) {
  const source = await readFile(path.join(ROOT, relativePath), "utf8")
  const tokens = LEGACY_PATTERNS.filter(([, pattern]) =>
    pattern.test(source)
  ).map(([name]) => name)
  if (tokens.length > 0)
    violations.push(`${relativePath}: ${tokens.join(", ")}`)
}

if (violations.length > 0) {
  console.error("发现已退役 ThreadTree authority 运行时引用：")
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else {
  console.log(
    `ThreadTree authority 审计通过：${sourceFiles.length} 个运行时文件，0 个旧引用。`
  )
}
