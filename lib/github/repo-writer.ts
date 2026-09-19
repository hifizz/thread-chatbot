// GitHub 仓库写入服务：通过 Git Data API 原子提交文件到新分支并创建 Draft PR。
// 不需要 clone 或沙箱——blobs → tree → commit → ref → pull request 全部走 REST。
// 仓库、base 分支由服务端闭包固定，模型不能通过参数指定其他仓库。

import type { RepoReadError, RepoReadResult } from "./repo-reader"
import { resolveBranchCommit } from "./repo-reader"

const MAX_FILES_PER_COMMIT = 30
const MAX_FILE_CHARS = 200_000
const MAX_COMMIT_MESSAGE_CHARS = 500
const MAX_PR_TITLE_CHARS = 200
const MAX_PR_BODY_CHARS = 20_000

export interface RepoCommitFile {
  path: string
  content: string
}

export interface RepoCommitResult {
  branch: string
  commitSha: string
  pullRequest: { url: string; number: number; draft: boolean } | null
  warning?: string
}

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  }
}

function apiError(code: RepoReadError["code"], message: string): RepoReadError {
  return { ok: false, code, message }
}

// 单次 GitHub 请求超时：挂起的连接不能无限等待，否则工具调用永不返回。
const REQUEST_TIMEOUT_MS = 30_000

async function ghPost(
  url: string,
  token: string,
  body: unknown,
  method = "POST",
  signal?: AbortSignal
): Promise<{ ok: true; data: Record<string, unknown> } | RepoReadError> {
  let res: Response
  try {
    res = await fetch(url, {
      method,
      headers: ghHeaders(token),
      signal: signal
        ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      ...(body !== null ? { body: JSON.stringify(body) } : {}),
    })
  } catch (e) {
    if (signal?.aborted) return apiError("unknown", "请求已取消")
    const isTimeout =
      e instanceof Error &&
      (e.name === "TimeoutError" || e.name === "AbortError")
    return apiError(
      "server_error",
      isTimeout ? `GitHub 请求超时（${REQUEST_TIMEOUT_MS / 1000}s）` : `GitHub 请求失败：${e instanceof Error ? e.message : "网络错误"}`
    )
  }
  const text = await res.text()
  if (!res.ok) {
    let detail = text.slice(0, 300)
    try {
      const parsed = JSON.parse(text) as { message?: string; errors?: unknown }
      detail = parsed.message ?? detail
    } catch { /* 保留原始文本 */ }
    if (res.status === 404) return apiError("not_found", `仓库或资源不存在：${detail}`)
    if (res.status === 403) return apiError("forbidden", `无权写入该仓库：${detail}`)
    if (res.status === 422) return apiError("unknown", `GitHub 拒绝请求：${detail}`)
    if (res.status >= 500) return apiError("server_error", `GitHub 服务暂时不可用 (${res.status})`)
    return apiError("unknown", `GitHub API 错误 ${res.status}：${detail}`)
  }
  try {
    return { ok: true, data: JSON.parse(text) as Record<string, unknown> }
  } catch {
    return apiError("unknown", "GitHub 返回了无法解析的响应")
  }
}

// ── 输入校验 ──────────────────────────────────────────────────

const BRANCH_NAME_RE = /^(?!\/)(?!.*\.\.)(?!.*\/\/)[\w./-]{1,100}$/

function validateBranchName(name: string): string | null {
  const n = name.trim()
  if (!BRANCH_NAME_RE.test(n) || n.endsWith("/") || n.endsWith(".") || n.endsWith(".lock"))
    return null
  return n
}

function validateFilePath(filePath: string): string | null {
  const p = filePath.trim().replace(/^\/+/, "")
  if (!p || p.includes("..") || p.includes("//") || p.endsWith("/")) return null
  return p
}

// ── 公开 API ──────────────────────────────────────────────────

/** 把文件内容原子提交到新分支，并创建指向 base 分支的 Draft PR。 */
export async function commitFilesToBranch(input: {
  repositoryFullName: string
  token: string
  baseBranch: string
  branchName: string
  commitMessage: string
  files: RepoCommitFile[]
  prTitle?: string
  prBody?: string
  signal?: AbortSignal
}): Promise<RepoReadResult<RepoCommitResult>> {
  const branch = validateBranchName(input.branchName)
  if (!branch) return apiError("unknown", `分支名非法：${input.branchName}`)
  if (!input.files.length) return apiError("unknown", "files 为空，没有可提交的内容")
  if (input.files.length > MAX_FILES_PER_COMMIT)
    return apiError("too_large", `单次最多提交 ${MAX_FILES_PER_COMMIT} 个文件`)
  const files: { path: string; content: string }[] = []
  const seen = new Set<string>()
  for (const f of input.files) {
    const p = validateFilePath(f.path)
    if (!p) return apiError("unknown", `文件路径非法：${f.path}`)
    if (seen.has(p)) return apiError("unknown", `文件路径重复：${p}`)
    seen.add(p)
    if (f.content.length > MAX_FILE_CHARS)
      return apiError("too_large", `文件 ${p} 超过 ${MAX_FILE_CHARS / 1000}K 字符上限`)
    files.push({ path: p, content: f.content })
  }
  const commitMessage = input.commitMessage.trim().slice(0, MAX_COMMIT_MESSAGE_CHARS)
  if (!commitMessage) return apiError("unknown", "commitMessage 为空")

  const base = await resolveBranchCommit(input.repositoryFullName, input.baseBranch, input.token, input.signal)
  if (!base.ok) return base
  const baseSha = base.commitSha

  // 1. base commit → base tree
  const baseCommit = await ghPost(
    `https://api.github.com/repos/${input.repositoryFullName}/git/commits/${baseSha}`,
    input.token,
    null,
    "GET",
    input.signal
  )
  if (!baseCommit.ok) return baseCommit
  const baseTreeSha = (baseCommit.data.tree as { sha: string } | undefined)?.sha
  if (!baseTreeSha) return apiError("unknown", "无法解析 base commit 的 tree")

  // 2. blobs
  const blobs: { path: string; sha: string }[] = []
  for (const f of files) {
    const blob = await ghPost(
      `https://api.github.com/repos/${input.repositoryFullName}/git/blobs`,
      input.token,
      { content: f.content, encoding: "utf-8" },
      "POST",
      input.signal
    )
    if (!blob.ok) return blob
    blobs.push({ path: f.path, sha: blob.data.sha as string })
  }

  // 3. tree（基于 base tree 的增量，未列文件保持不变）
  const tree = await ghPost(
    `https://api.github.com/repos/${input.repositoryFullName}/git/trees`,
    input.token,
    {
      base_tree: baseTreeSha,
      tree: blobs.map((b) => ({ path: b.path, mode: "100644", type: "blob", sha: b.sha })),
    },
    "POST",
    input.signal
  )
  if (!tree.ok) return tree

  // 4. commit
  const commit = await ghPost(
    `https://api.github.com/repos/${input.repositoryFullName}/git/commits`,
    input.token,
    { message: commitMessage, tree: tree.data.sha, parents: [baseSha] },
    "POST",
    input.signal
  )
  if (!commit.ok) return commit
  const commitSha = commit.data.sha as string

  // 5. 新分支 ref
  const ref = await ghPost(
    `https://api.github.com/repos/${input.repositoryFullName}/git/refs`,
    input.token,
    { ref: `refs/heads/${branch}`, sha: commitSha },
    "POST",
    input.signal
  )
  if (!ref.ok) {
    if (ref.code === "unknown")
      return apiError("unknown", `创建分支 ${branch} 失败（可能已存在同名分支）：${ref.message}`)
    return ref
  }

  // 6. Draft PR（失败时保留分支和 commit，如实返回）
  const title = (input.prTitle ?? commitMessage).trim().slice(0, MAX_PR_TITLE_CHARS)
  const pr = await ghPost(
    `https://api.github.com/repos/${input.repositoryFullName}/pulls`,
    input.token,
    {
      title,
      head: branch,
      base: input.baseBranch,
      body: (input.prBody ?? "").slice(0, MAX_PR_BODY_CHARS),
      draft: true,
    },
    "POST",
    input.signal
  )
  const pullRequest = pr.ok
    ? {
        url: (pr.data.html_url ?? pr.data.url) as string,
        number: pr.data.number as number,
        draft: true,
      }
    : null

  return {
    ok: true,
    data: {
      branch,
      commitSha,
      pullRequest,
      ...(pullRequest ? {} : { warning: `PR 创建失败：${!pr.ok ? pr.message : "未知错误"}` }),
    },
  }
}
