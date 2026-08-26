import assert from "node:assert/strict"
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
)

const roots = [
  "app/api/thread-chat/v1",
  "lib/thread-chat/application",
  "lib/thread-chat/persistence",
  "lib/thread-chat/server",
  "lib/thread-chat/streaming",
]

const forbidden = [
  /["']@\/lib\/billing\//,
  /["']@\/lib\/payments\//,
  /["']@\/lib\/chat\/usage-store["']/,
  /["']@\/lib\/thread-chat-generation\//,
  /["']@\/app\/thread-chat\/net\/persistence\//,
  /["']@\/lib\/thread-chat\/contracts\/save-tree["']/,
  /GenerationBillingStatus/,
]

async function sourceFiles(directory) {
  try {
    if (!(await stat(directory)).isDirectory()) return []
  } catch {
    return []
  }

  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name)
      if (entry.isDirectory()) return sourceFiles(entryPath)
      return /\.(?:ts|tsx|mts)$/.test(entry.name) ? [entryPath] : []
    })
  )
  return nested.flat()
}

const violations = []
for (const root of roots) {
  for (const filename of await sourceFiles(path.join(repositoryRoot, root))) {
    const source = await readFile(filename, "utf8")
    for (const pattern of forbidden) {
      if (pattern.test(source))
        violations.push(`${path.relative(repositoryRoot, filename)}: ${pattern}`)
    }
  }
}

assert.deepEqual(
  violations,
  [],
  `ThreadChat v1 dependency boundary violations:\n${violations.join("\n")}`
)
console.log("PASS thread-chat v1 dependency boundaries")
