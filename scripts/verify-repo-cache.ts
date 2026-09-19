// 验证 repo-cache：对真实仓库跑 ensureRepoCheckout + ls/read/grep，并测缓存命中。
// 用法：pnpm tsx scripts/verify-repo-cache.ts

import { readFileSync } from "node:fs"
import { ensureRepoCheckout, grepRepo, listRepoDir, readRepoFile } from "../lib/github/repo-cache"
import { resolveBranchCommit } from "../lib/github/repo-reader"

const env = readFileSync(".env.local", "utf-8")
const token = (env.match(/^GITHUB_TOKEN=(.+)$/m)?.[1]?.trim() ?? "").replace(/^"|"$/g, "")
if (!token) throw new Error("GITHUB_TOKEN missing")

const repo = "hifizz/playground.zilin.im"
const commit = await resolveBranchCommit(repo, "main", token)
if (!commit.ok) throw new Error(commit.message)
console.log(`commit: ${commit.commitSha.slice(0, 7)}`)

let t = Date.now()
const c1 = await ensureRepoCheckout({ repositoryFullName: repo, commitSha: commit.commitSha, token })
console.log(`首次检出: ${Date.now() - t}ms → ${c1.dir}`)

t = Date.now()
const c2 = await ensureRepoCheckout({ repositoryFullName: repo, commitSha: commit.commitSha, token })
console.log(`缓存命中: ${Date.now() - t}ms`)

const ls = await listRepoDir(c2, "/")
if (!ls.ok) throw new Error(ls.message)
console.log(`根目录 ${ls.data.length} 项:`, ls.data.slice(0, 8).map((e) => `${e.type === "dir" ? "d" : "f"} ${e.name}`).join(", "))

const read = await readRepoFile(c2, "README.md", 1, 10)
if (!read.ok) throw new Error(read.message)
console.log(`README.md 第 ${read.data.startLine}-${read.data.endLine} 行:\n${read.data.content.slice(0, 300)}`)

const grep = await grepRepo(c2, "export")
if (!grep.ok) throw new Error(grep.message)
console.log(`grep "export": ${grep.data.matches.length} 个匹配 (truncated=${grep.data.truncated})`)
for (const m of grep.data.matches.slice(0, 6)) console.log(`  ${m.path}:${m.line}: ${m.text.slice(0, 80)}`)

const grepScoped = await grepRepo(c2, "TODO|FIXME|todo", "app")
if (!grepScoped.ok) {
  console.log(`scoped grep: ${grepScoped.message}`)
} else {
  console.log(`grep "TODO|FIXME" in app/: ${grepScoped.data.matches.length} 个匹配`)
}

const pathGrep = await grepRepo(c2, "function\\s+\\w+")
if (pathGrep.ok) console.log(`grep "function\\\\s+\\\\w+": ${pathGrep.data.matches.length} 个匹配`)

console.log("PASS")
