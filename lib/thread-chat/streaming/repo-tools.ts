// 仓库只读工具：listRepositoryFiles / readRepositoryFile / searchRepositoryCode。
// 数据来自服务端本地缓存的仓库 tarball 检出（见 lib/github/repo-cache.ts）。
// 仓库与 commit 由服务端闭包固定，模型不能通过参数指定其他仓库。

import { tool } from "ai"
import { z } from "zod"
import {
  ensureRepoCheckout,
  grepRepo,
  listRepoDir,
  readRepoFile,
  type RepoCheckout,
} from "@/lib/github/repo-cache"
import type { RepoReadError } from "@/lib/github/repo-reader"

// 测试阶段放宽上限；产品化时应收紧并结合 token 预算控制
const MAX_CALLS_PER_TURN = 100

export interface RepoToolContext {
  repositoryFullName: string
  branch: string
  commitSha: string
  token: string
}

export function createRepoReadTools(ctx: RepoToolContext) {
  let callsThisTurn = 0
  let checkoutPromise: Promise<RepoCheckout> | null = null

  // 首次调用（或创建时预热）触发 tarball 下载解压；同一 commit 命中进程/磁盘缓存。
  function checkout(): Promise<RepoCheckout> {
    if (!checkoutPromise) {
      checkoutPromise = ensureRepoCheckout({
        repositoryFullName: ctx.repositoryFullName,
        commitSha: ctx.commitSha,
        token: ctx.token,
      })
    }
    return checkoutPromise
  }
  // fire-and-forget 预热：模型思考期间先开始下载
  void checkout().catch(() => {})

  function checkBudget() {
    if (callsThisTurn >= MAX_CALLS_PER_TURN) {
      return {
        ok: false as const,
        code: "too_large" as const,
        message: `本轮仓库工具调用已达上限 (${MAX_CALLS_PER_TURN} 次)，请基于已读取的内容回答`,
      }
    }
    callsThisTurn++
    return null
  }

  async function withCheckout<T>(
    run: (checkout: RepoCheckout) => Promise<{ ok: true; data: T } | RepoReadError>
  ) {
    try {
      return await run(await checkout())
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false as const, code: "server_error" as const, message: `仓库检出失败：${message}` }
    }
  }

  const listRepositoryFilesTool = tool({
    description:
      "列出 GitHub 仓库中指定目录下的文件和子目录。path 为空或 '/' 表示仓库根目录。返回文件名、路径、类型和大小。",
    inputSchema: z.object({
      path: z
        .string()
        .describe("目录路径，如 'src/components'；空字符串或 '/' 表示根目录"),
    }),
    execute: async ({ path }) => {
      const budget = checkBudget()
      if (budget) return budget
      return withCheckout(async (c) => {
        const result = await listRepoDir(c, path || "/")
        if (!result.ok) return result
        return { ok: true as const, data: { entries: result.data, commitSha: ctx.commitSha } }
      })
    },
  })

  const readRepositoryFileTool = tool({
    description:
      "读取 GitHub 仓库中某个文本文件的内容，可指定行范围。返回文件内容、行号区间和截断标记。二进制、敏感和大型生成文件会被跳过。",
    inputSchema: z.object({
      path: z.string().describe("文件路径，如 'src/app/page.tsx'"),
      startLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("起始行号，从 1 开始"),
      endLine: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("结束行号"),
    }),
    execute: async ({ path, startLine, endLine }) => {
      const budget = checkBudget()
      if (budget) return budget
      return withCheckout((c) => readRepoFile(c, path, startLine, endLine))
    },
  })

  const searchRepositoryCodeTool = tool({
    description:
      "在仓库文件内容中做正则搜索（类似 grep）。query 是正则表达式，含大写字母时区分大小写；可选 path 限定搜索的子目录。返回匹配的文件路径、行号和行内容（最多 100 条）。",
    inputSchema: z.object({
      query: z
        .string()
        .describe("搜索正则，如 'useState'、'function\\s+auth'；非法正则自动按字面量处理"),
      path: z
        .string()
        .optional()
        .describe("限定搜索的子目录，如 'src'；缺省搜索整个仓库"),
    }),
    execute: async ({ query, path }) => {
      const budget = checkBudget()
      if (budget) return budget
      return withCheckout(async (c) => {
        const result = await grepRepo(c, query, path)
        if (!result.ok) return result
        return {
          ok: true as const,
          data: { ...result.data, matchCount: result.data.matches.length, commitSha: ctx.commitSha },
        }
      })
    },
  })

  return {
    listRepositoryFiles: listRepositoryFilesTool,
    readRepositoryFile: readRepositoryFileTool,
    searchRepositoryCode: searchRepositoryCodeTool,
  }
}

export type RepoReadTools = ReturnType<typeof createRepoReadTools>
