// GitHub 仓库只读服务：目录列举、文件读取、路径查找。
// 仓库与 commit 由服务端闭包固定，模型不能通过参数指定其他仓库。

export type RepoReadError = {
  ok: false
  code:
    | "not_found"
    | "forbidden"
    | "rate_limited"
    | "too_large"
    | "binary"
    | "skipped"
    | "server_error"
    | "unknown"
  message: string
}

export type RepoReadResult<T> = { ok: true; data: T } | RepoReadError

export interface RepositoryFileExcerpt {
  path: string
  commitSha: string
  startLine: number
  endLine: number
  content: string
  truncated: boolean
}

export interface RepositoryDirEntry {
  name: string
  path: string
  type: "file" | "dir"
  size: number
}

export interface RepositoryTreeEntry {
  path: string
  type: "blob" | "tree"
  size: number
}

export interface RepositoryReadContext {
  repositoryFullName: string
  branch: string
  commitSha: string
  token: string
}

// ── 限额 ──────────────────────────────────────────────────────

const MAX_FILE_BYTES = 1024 * 1024
const MAX_DIR_ENTRIES = 200
const MAX_FIND_RESULTS = 100
const MAX_TREE_ENTRIES = 5000

// ── 跳过规则 ──────────────────────────────────────────────────

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

function getExtension(path: string): string {
  const match = path.match(/\.([^.]+)$/)
  return match ? match[1].toLowerCase() : ""
}

function isBinaryFile(path: string): boolean {
  return BINARY_EXTENSIONS.has(getExtension(path))
}

function isSensitiveFile(path: string): boolean {
  const base = path.split("/").pop() ?? path
  return SENSITIVE_PATTERNS.some((re) => re.test(base) || re.test(path))
}

function isLargeGenerated(path: string): boolean {
  return LARGE_GENERATED_PATTERNS.some((re) => re.test(path))
}

function shouldSkip(path: string): { skip: boolean; reason: string } {
  if (isSensitiveFile(path)) return { skip: true, reason: "敏感文件，已跳过" }
  if (isBinaryFile(path)) return { skip: true, reason: "二进制文件，已跳过" }
  if (isLargeGenerated(path)) return { skip: true, reason: "大型生成文件，已跳过" }
  return { skip: false, reason: "" }
}

// ── GitHub API ────────────────────────────────────────────────

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  }
}

function shortSha(sha: string): string {
  return sha.slice(0, 7)
}

function classifyError(status: number, body: string): RepoReadError {
  if (status === 404)
    return { ok: false, code: "not_found", message: "路径或仓库不存在" }
  if (status === 403) {
    if (body.includes("rate limit"))
      return { ok: false, code: "rate_limited", message: "GitHub API 限流，请稍后重试" }
    return { ok: false, code: "forbidden", message: "无权访问该仓库或路径" }
  }
  if (status === 409)
    return { ok: false, code: "too_large", message: "仓库内容过大，GitHub 拒绝返回" }
  if (status >= 500)
    return { ok: false, code: "server_error", message: `GitHub 服务暂时不可用 (${status})` }
  return { ok: false, code: "unknown", message: `GitHub API 错误: ${status}` }
}

async function ghFetch(url: string, token: string): Promise<Response> {
  // 5xx 限流重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: ghHeaders(token) })
    if (res.status >= 500 || res.status === 403) {
      const body = await res.text()
      if (res.status === 403 && body.includes("rate limit") && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1000))
        continue
      }
      if (res.status >= 500 && attempt === 0) {
        await new Promise((r) => setTimeout(r, 500))
        continue
      }
    }
    return res
  }
  return await fetch(url, { headers: ghHeaders(token) })
}

// ── 公开 API ──────────────────────────────────────────────────

export async function resolveBranchCommit(
  repo: string,
  branch: string,
  token: string
): Promise<{ ok: true; commitSha: string } | RepoReadError> {
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`,
    token
  )
  if (!res.ok) {
    const body = await res.text()
    return classifyError(res.status, body)
  }
  const data = (await res.json()) as { commit: { sha: string } }
  return { ok: true, commitSha: data.commit.sha }
}

export async function listRepositoryFiles(
  ctx: RepositoryReadContext,
  dirPath: string
): Promise<RepoReadResult<RepositoryDirEntry[]>> {
  const cleanPath = dirPath.replace(/^\/+/, "").replace(/\/+$/, "")
  const url = `https://api.github.com/repos/${ctx.repositoryFullName}/contents/${cleanPath}?ref=${ctx.commitSha}`
  const res = await ghFetch(url, ctx.token)
  if (!res.ok) return classifyError(res.status, await res.text())
  const data = (await res.json()) as Array<{
    name: string
    path: string
    type: string
    size: number
  }>
  if (!Array.isArray(data))
    return { ok: false, code: "not_found", message: "路径不是目录" }
  const entries: RepositoryDirEntry[] = data
    .slice(0, MAX_DIR_ENTRIES)
    .map((item) => ({
      name: item.name,
      path: item.path,
      type: item.type === "dir" ? "dir" : "file",
      size: item.size ?? 0,
    }))
  return { ok: true, data: entries }
}

export async function readRepositoryFile(
  ctx: RepositoryReadContext,
  filePath: string,
  startLine?: number,
  endLine?: number
): Promise<RepoReadResult<RepositoryFileExcerpt>> {
  const cleanPath = filePath.replace(/^\/+/, "")
  const skip = shouldSkip(cleanPath)
  if (skip.skip)
    return { ok: false, code: "skipped", message: skip.reason }

  const url = `https://api.github.com/repos/${ctx.repositoryFullName}/contents/${cleanPath}?ref=${ctx.commitSha}`
  const res = await ghFetch(url, ctx.token)
  if (!res.ok) return classifyError(res.status, await res.text())
  const data = (await res.json()) as {
    content: string | null
    encoding: string
    size: number
  }
  if (data.encoding !== "base64" || data.content === null)
    return { ok: false, code: "binary", message: "文件无法以文本方式读取" }
  if (data.size > MAX_FILE_BYTES * 2)
    return { ok: false, code: "too_large", message: `文件过大 (${Math.round(data.size / 1024)}KB)，超过读取上限` }

  const fullContent = Buffer.from(data.content, "base64").toString("utf-8")
  const allLines = fullContent.split("\n")
  const s = Math.max(1, startLine ?? 1)
  const e = Math.min(allLines.length, endLine ?? allLines.length)
  const slice = allLines.slice(s - 1, e)
  const content = slice.join("\n")
  const truncated = false
  return {
    ok: true,
    data: {
      path: cleanPath,
      commitSha: ctx.commitSha,
      startLine: s,
      endLine: e,
      content,
      truncated,
    },
  }
}

export async function findRepositoryPaths(
  ctx: RepositoryReadContext,
  query: string
): Promise<RepoReadResult<{ matches: string[]; truncated: boolean }>> {
  const url = `https://api.github.com/repos/${ctx.repositoryFullName}/git/trees/${ctx.commitSha}?recursive=1`
  const res = await ghFetch(url, ctx.token)
  if (!res.ok) return classifyError(res.status, await res.text())
  const data = (await res.json()) as {
    tree: Array<{ path: string; type: string; size?: number }>
    truncated?: boolean
  }
  const q = query.toLowerCase()
  const matches: string[] = []
  let apiTruncated = Boolean(data.truncated)
  let entryCount = 0
  for (const item of data.tree) {
    entryCount++
    if (entryCount > MAX_TREE_ENTRIES) {
      apiTruncated = true
      break
    }
    if (item.type === "tree") continue
    if (item.path.toLowerCase().includes(q)) {
      const skip = shouldSkip(item.path)
      if (!skip.skip) matches.push(item.path)
      if (matches.length >= MAX_FIND_RESULTS) break
    }
  }
  return {
    ok: true,
    data: { matches, truncated: apiTruncated || matches.length >= MAX_FIND_RESULTS },
  }
}

export function githubFileUrl(repo: string, sha: string, path: string, startLine?: number, endLine?: number): string {
  const base = `https://github.com/${repo}/blob/${sha}/${path}`
  if (startLine && endLine && startLine !== endLine) return `${base}#L${startLine}-L${endLine}`
  if (startLine) return `${base}#L${startLine}`
  return base
}

export { shortSha }
