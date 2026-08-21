import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import process from "node:process"

import { THREAD_TREE_LEGACY_ALLOWLIST } from "./thread-tree-legacy-allowlist.mjs"

const ROOT = process.cwd()
const SCAN_ROOTS = ["lib/thread-chat/domain", "lib/thread-chat/application"]
const LEGACY_PATTERNS = [
  ["ThreadTreeState", /\bThreadTreeState\b/u],
  ["threads.main", /\bthreads\.main\b/u],
  ["activeLeafMessageId", /\bactiveLeafMessageId\b/u],
  ["parentId", /\bparentId\b/u],
  ["children", /\bchildren\b/u],
  ["forkFromMsgId", /\bforkFromMsgId\b/u],
  ["Message.forks", /\bforks\b/u],
]

async function listSourceFiles(relativeDirectory) {
  const directory = path.join(ROOT, relativeDirectory)
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.posix.join(relativeDirectory, entry.name)
      if (entry.isDirectory()) return listSourceFiles(relativePath)
      return /\.(?:ts|tsx)$/u.test(entry.name) ? [relativePath] : []
    })
  )
  return nested.flat()
}

const allowlist = new Set(THREAD_TREE_LEGACY_ALLOWLIST)
const sourceFiles = (await Promise.all(SCAN_ROOTS.map(listSourceFiles))).flat()
const violations = []

for (const relativePath of sourceFiles) {
  const source = await readFile(path.join(ROOT, relativePath), "utf8")
  const tokens = LEGACY_PATTERNS.filter(([, pattern]) =>
    pattern.test(source)
  ).map(([name]) => name)
  if (tokens.length > 0 && !allowlist.has(relativePath))
    violations.push(`${relativePath}: ${tokens.join(", ")}`)
}

const staleEntries = THREAD_TREE_LEGACY_ALLOWLIST.filter(
  (entry) => !sourceFiles.includes(entry)
)
if (staleEntries.length > 0) {
  console.error("遗留字段允许列表包含不存在或不在审计范围内的文件：")
  for (const entry of staleEntries) console.error(`- ${entry}`)
  process.exitCode = 1
}

if (violations.length > 0) {
  console.error("发现允许列表之外的遗留 Thread Tree 字段：")
  for (const violation of violations) console.error(`- ${violation}`)
  process.exitCode = 1
} else if (process.exitCode !== 1) {
  console.log(
    `遗留边界审计通过：${sourceFiles.length} 个文件，${allowlist.size} 个临时允许项。`
  )
}
