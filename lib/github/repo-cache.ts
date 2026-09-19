// GitHub 仓库本地缓存：按 commit 拉取 tarball 解压到临时目录，提供 ls/grep/cat。
// 只读文本操作、不执行仓库代码，因此不需要沙箱隔离；commitSha 固定使缓存天然可复用。

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import type {
  RepoReadError,
  RepoReadResult,
  RepositoryDirEntry,
  RepositoryFileExcerpt,
} from "./repo-reader"

const execFileAsync = promisify(execFile)

// ── 限额 ──────────────────────────────────────────────────────

const CACHE_ROOT = path.join(os.tmpdir(), "thread-chat-repo-cache")
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_CACHED_REPOS = 20
const MAX_TARBALL_BYTES = 200 * 1024 * 1024
const MAX_FILE_BYTES = 1024 * 1024
const MAX_DIR_ENTRIES = 200
const MAX_GREP_MATCHES = 100
const MAX_GREP_FILES = 2000
const MAX_GREP_FILE_BYTES = 512 * 1024
const MAX_MATCH_LINE_CHARS = 200

const READY_MARKER = ".thread-chat-ready"

// ── 跳过规则（与 repo-reader 一致：敏感/二进制/大型生成文件） ──

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg", "tiff", "psd",
  "pdf", "zip", "gz", "tar", "rar", "7z", "bz2", "xz", "jar", "war",
  "class", "pyc", "pyo", "o", "so", "dll", "exe", "bin", "dat", "db",
  "sqlite", "mp3", "mp4", "avi", "mov", "flv", "wmv", "mpg", "woff",
  "woff2", "ttf", "otf", "eot", "ipynb", "pkl", "pickle", "h5", "hdf5",
  "npy", "npz", "parquet", "arrow", "feather", "msg",
])

const SENSITIVE_PATTERNS = [
  /\.env(\.|$)/i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /^id_rsa/i,
  /^secrets?/i,
  /credentials/i,
  /\.pypirc$/i,
  /\.npmrc$/i,
  /\.netrc$/i,
]

const LARGE_GENERATED_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)build\//,
  /(^|\/)\.next\//,
  /(^|\/)vendor\//,
  /(^|\/)target\//,
  /(^|\/)\.git\//,
  /(^|\/)__pycache__\//,
  /\.min\.js$/,
  /\.min\.css$/,
  /\.map$/,
  /(^|\/)package-lock\.json$/,
  /(^|\/)pnpm-lock\.yaml$/,
  /(^|\/)yarn\.lock$/,
  /(^|\/)Cargo\.lock$/,
  /(^|\/)composer\.lock$/,
  /(^|\/)go\.sum$/,
  /(^|\/)poetry\.lock$/,
]

function getExtension(filePath: string): string {
  const match = filePath.match(/\.([^.]+)$/)
  return match ? match[1].toLowerCase() : ""
}

function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(filePath))
}

function isSensitiveFile(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? filePath
  return SENSITIVE_PATTERNS.some((re) => re.test(base) || re.test(filePath))
}

function isLargeGenerated(filePath: string): boolean {
  return LARGE_GENERATED_PATTERNS.some((re) => re.test(filePath))
}

function shouldSkip(filePath: string): { skip: boolean; reason: string } {
  if (isSensitiveFile(filePath)) return { skip: true, reason: "敏感文件，已跳过" }
  if (isBinaryFile(filePath)) return { skip: true, reason: "二进制文件，已跳过" }
  if (isLargeGenerated(filePath)) return { skip: true, reason: "大型生成文件，已跳过" }
  return { skip: false, reason: "" }
}

// ── 检出 ──────────────────────────────────────────────────────

export interface RepoCheckout {
  dir: string
  commitSha: string
}

const inflight = new Map<string, Promise<RepoCheckout>>()

function cacheKey(repositoryFullName: string, commitSha: string): string {
  return `${repositoryFullName.replace(/[^\w.-]/g, "_")}__${commitSha}`
}

export function ensureRepoCheckout(input: {
  repositoryFullName: string
  commitSha: string
  token: string
}): Promise<RepoCheckout> {
  const key = cacheKey(input.repositoryFullName, input.commitSha)
  const pending = inflight.get(key)
  if (pending) return pending
  const promise = checkout(input, key).finally(() => inflight.delete(key))
  inflight.set(key, promise)
  return promise
}

async function checkout(
  input: { repositoryFullName: string; commitSha: string; token: string },
  key: string
): Promise<RepoCheckout> {
  const dir = path.join(CACHE_ROOT, key)
  if (existsSync(path.join(dir, READY_MARKER))) {
    return { dir, commitSha: input.commitSha }
  }
  await pruneCache()
  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`
  const tarPath = `${tmp}.tgz`
  try {
    const res = await fetch(
      `https://api.github.com/repos/${input.repositoryFullName}/tarball/${input.commitSha}`,
      {
        headers: {
          Authorization: `Bearer ${input.token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "follow",
      }
    )
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(
        res.status === 404
          ? "仓库或 commit 不存在"
          : res.status === 403
            ? body.includes("rate limit")
              ? "GitHub API 限流，请稍后重试"
              : "无权访问该仓库"
            : `GitHub tarball 下载失败 (${res.status})`
      )
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_TARBALL_BYTES) {
      throw new Error(`仓库压缩包过大（${Math.round(buf.length / 1048576)}MB），超过 200MB 上限`)
    }
    await mkdir(tmp, { recursive: true })
    await writeFile(tarPath, buf)
    await execFileAsync("tar", ["-xzf", tarPath, "-C", tmp, "--strip-components=1"])
    await writeFile(path.join(tmp, READY_MARKER), input.commitSha)
    await rm(dir, { recursive: true, force: true })
    await rename(tmp, dir)
    return { dir, commitSha: input.commitSha }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => {})
    await rm(tarPath, { force: true }).catch(() => {})
  }
}

async function pruneCache(): Promise<void> {
  const names = await readdir(CACHE_ROOT).catch(() => [] as string[])
  const now = Date.now()
  const alive: { name: string; mtimeMs: number }[] = []
  for (const name of names) {
    if (name.includes(".tmp-") || name.endsWith(".tgz")) continue
    const st = await stat(path.join(CACHE_ROOT, name)).catch(() => null)
    if (!st?.isDirectory()) continue
    if (now - st.mtimeMs > CACHE_TTL_MS) {
      await rm(path.join(CACHE_ROOT, name), { recursive: true, force: true }).catch(() => {})
    } else {
      alive.push({ name, mtimeMs: st.mtimeMs })
    }
  }
  alive.sort((a, b) => a.mtimeMs - b.mtimeMs)
  while (alive.length >= MAX_CACHED_REPOS) {
    const oldest = alive.shift()
    if (!oldest) break
    await rm(path.join(CACHE_ROOT, oldest.name), { recursive: true, force: true }).catch(() => {})
  }
}

// ── 路径安全 ──────────────────────────────────────────────────

function resolveInside(root: string, relPath: string): string | null {
  const clean = relPath.replace(/^\/+/, "").replace(/\/+$/, "")
  const abs = path.resolve(root, clean)
  if (abs !== root && !abs.startsWith(root + path.sep)) return null
  return abs
}

function err(code: RepoReadError["code"], message: string): RepoReadError {
  return { ok: false, code, message }
}

// ── ls ────────────────────────────────────────────────────────

export async function listRepoDir(
  checkout: RepoCheckout,
  dirPath: string
): Promise<RepoReadResult<RepositoryDirEntry[]>> {
  const abs = resolveInside(checkout.dir, dirPath)
  if (!abs) return err("not_found", "路径越界或不存在")
  const st = await stat(abs).catch(() => null)
  if (!st) return err("not_found", "路径不存在")
  if (!st.isDirectory()) return err("not_found", "路径不是目录")

  const clean = dirPath.replace(/^\/+/, "").replace(/\/+$/, "")
  const dirents = (await readdir(abs, { withFileTypes: true }))
    .filter((d) => d.name !== READY_MARKER)
    .slice(0, MAX_DIR_ENTRIES)
  const entries: RepositoryDirEntry[] = []
  for (const d of dirents) {
    const rel = clean ? `${clean}/${d.name}` : d.name
    if (d.isDirectory()) {
      entries.push({ name: d.name, path: rel, type: "dir", size: 0 })
    } else {
      const fst = await stat(path.join(abs, d.name)).catch(() => null)
      entries.push({ name: d.name, path: rel, type: "file", size: fst?.size ?? 0 })
    }
  }
  return { ok: true, data: entries }
}

// ── cat ───────────────────────────────────────────────────────

export async function readRepoFile(
  checkout: RepoCheckout,
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<RepoReadResult<RepositoryFileExcerpt>> {
  const clean = filePath.replace(/^\/+/, "")
  const skip = shouldSkip(clean)
  if (skip.skip) return err("skipped", skip.reason)

  const abs = resolveInside(checkout.dir, clean)
  if (!abs) return err("not_found", "路径越界或不存在")
  const st = await stat(abs).catch(() => null)
  if (!st || !st.isFile()) return err("not_found", "文件不存在")
  if (st.size > MAX_FILE_BYTES) {
    return err("too_large", `文件过大 (${Math.round(st.size / 1024)}KB)，超过读取上限`)
  }

  const full = await readFile(abs, "utf-8")
  if (full.includes("\0")) return err("binary", "文件无法以文本方式读取")
  const allLines = full.split("\n")
  const s = Math.max(1, startLine ?? 1)
  const e = Math.min(allLines.length, endLine ?? allLines.length)
  return {
    ok: true,
    data: {
      path: clean,
      commitSha: checkout.commitSha,
      startLine: s,
      endLine: e,
      content: allLines.slice(s - 1, e).join("\n"),
      truncated: false,
    },
  }
}

// ── grep ──────────────────────────────────────────────────────

export interface RepoGrepMatch {
  path: string
  line: number
  text: string
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export async function grepRepo(
  checkout: RepoCheckout,
  query: string,
  scopePath?: string
): Promise<RepoReadResult<{ matches: RepoGrepMatch[]; truncated: boolean }>> {
  let re: RegExp
  try {
    // smart-case：含大写字母时区分大小写
    re = new RegExp(query, /[A-Z]/.test(query) ? "" : "i")
  } catch {
    re = new RegExp(escapeRegExp(query), "i")
  }

  const root = scopePath ? resolveInside(checkout.dir, scopePath) : checkout.dir
  if (!root) return err("not_found", "搜索范围路径越界")
  const rootSt = await stat(root).catch(() => null)
  if (!rootSt?.isDirectory()) return err("not_found", "搜索范围不是目录")

  const matches: RepoGrepMatch[] = []
  let scanned = 0
  let truncated = false

  async function walk(absDir: string): Promise<void> {
    if (truncated) return
    const dirents = await readdir(absDir, { withFileTypes: true }).catch(() => [])
    for (const d of dirents) {
      if (truncated) return
      if (d.name === READY_MARKER || d.name === ".git") continue
      const abs = path.join(absDir, d.name)
      const rel = path.relative(checkout.dir, abs).split(path.sep).join("/")
      if (d.isDirectory()) {
        if (!isLargeGenerated(`${rel}/`)) await walk(abs)
        continue
      }
      if (shouldSkip(rel).skip) continue
      const fst = await stat(abs).catch(() => null)
      if (!fst || fst.size > MAX_GREP_FILE_BYTES) continue
      scanned++
      if (scanned > MAX_GREP_FILES) {
        truncated = true
        return
      }
      const content = await readFile(abs, "utf-8").catch(() => "")
      if (!content || content.includes("\0")) continue
      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          const text = lines[i].trim()
          matches.push({
            path: rel,
            line: i + 1,
            text: text.length > MAX_MATCH_LINE_CHARS ? `${text.slice(0, MAX_MATCH_LINE_CHARS)}…` : text,
          })
          if (matches.length >= MAX_GREP_MATCHES) {
            truncated = true
            return
          }
        }
      }
    }
  }

  await walk(root)
  return { ok: true, data: { matches, truncated } }
}
