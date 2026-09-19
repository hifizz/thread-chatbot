// GitHub 仓库只读服务：分支 commit 解析与源码链接工具。
// 文件内容的 ls/grep/cat 由 lib/github/repo-cache.ts 的本地 tarball 检出提供。
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

export interface RepositoryReadContext {
  repositoryFullName: string
  branch: string
  commitSha: string
  token: string
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

async function ghFetch(url: string, token: string, signal?: AbortSignal): Promise<Response> {
  // 5xx 限流重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, { headers: ghHeaders(token), signal })
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
  return await fetch(url, { headers: ghHeaders(token), signal })
}

// ── 公开 API ──────────────────────────────────────────────────

export async function resolveBranchCommit(
  repo: string,
  branch: string,
  token: string,
  signal?: AbortSignal
): Promise<{ ok: true; commitSha: string } | RepoReadError> {
  const res = await ghFetch(
    `https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`,
    token,
    signal
  )
  if (!res.ok) {
    const body = await res.text()
    return classifyError(res.status, body)
  }
  const data = (await res.json()) as { commit: { sha: string } }
  return { ok: true, commitSha: data.commit.sha }
}

export function githubFileUrl(repo: string, sha: string, path: string, startLine?: number, endLine?: number): string {
  const base = `https://github.com/${repo}/blob/${sha}/${path}`
  if (startLine && endLine && startLine !== endLine) return `${base}#L${startLine}-L${endLine}`
  if (startLine) return `${base}#L${startLine}`
  return base
}

export { shortSha }
