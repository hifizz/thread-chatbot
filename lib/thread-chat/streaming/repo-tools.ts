// 仓库只读工具：listRepositoryFiles / readRepositoryFile / findRepositoryPaths。
// 仓库与 commit 由服务端闭包固定，模型不能通过参数指定其他仓库。

import { tool } from "ai"
import { z } from "zod"
import {
  findRepositoryPaths,
  listRepositoryFiles,
  readRepositoryFile,
  type RepositoryReadContext,
} from "@/lib/github/repo-reader"

const MAX_CALLS_PER_TURN = 30

export interface RepoToolContext {
  repositoryFullName: string
  branch: string
  commitSha: string
  token: string
}

export function createRepoReadTools(ctx: RepoToolContext) {
  let callsThisTurn = 0
  const readContext: RepositoryReadContext = {
    repositoryFullName: ctx.repositoryFullName,
    branch: ctx.branch,
    commitSha: ctx.commitSha,
    token: ctx.token,
  }

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
      const result = await listRepositoryFiles(readContext, path || "/")
      if (!result.ok) return result
      return { ok: true, data: { entries: result.data, commitSha: ctx.commitSha } }
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
      const result = await readRepositoryFile(readContext, path, startLine, endLine)
      return result
    },
  })

  const findRepositoryPathsTool = tool({
    description:
      "按文件路径关键词查找仓库中的文件路径（不是内容搜索）。query 是路径子串，如 'auth' 匹配所有路径含 'auth' 的文件。返回匹配的路径列表。",
    inputSchema: z.object({
      query: z.string().describe("路径关键词，如 'auth'、'login'、'api/route'"),
    }),
    execute: async ({ query }) => {
      const budget = checkBudget()
      if (budget) return budget
      const result = await findRepositoryPaths(readContext, query)
      if (!result.ok) return result
      return { ok: true, data: { ...result.data, commitSha: ctx.commitSha } }
    },
  })

  return {
    listRepositoryFiles: listRepositoryFilesTool,
    readRepositoryFile: readRepositoryFileTool,
    findRepositoryPaths: findRepositoryPathsTool,
  }
}

export type RepoReadTools = ReturnType<typeof createRepoReadTools>
