// 仓库提交工具：commitFilesToRepository 把已知文件内容提交到新分支并创建 Draft PR。
// 用于交付物内容已在上下文中确定的场景（文档、Artifact、模型撰写的文件）；
// 需要在仓库里探索/写代码/跑测试的任务改用 dispatchAgentTask。
// 仓库与 base 分支由服务端闭包固定，模型不能通过参数指定其他仓库。

import { tool } from "ai"
import { z } from "zod"
import { commitFilesToBranch } from "@/lib/github/repo-writer"
import type { RepoToolContext } from "./repo-tools"

const MAX_COMMITS_PER_TURN = 3

export function createRepoWriteTools(ctx: RepoToolContext) {
  let commitCount = 0

  const commitFilesToRepository = tool({
    description:
      "把文件内容提交到新分支并创建 Draft PR（基于当前绑定分支）。当交付物的内容已经确定时使用：例如把本会话中的项目文档、Artifact 内容或你撰写的文件写入仓库。这是快速路径（秒级完成，不起沙箱）。files 中给出每个文件的完整内容；任务需要 agent 在仓库中探索、改代码或运行测试验证时，改用 dispatchAgentTask。",
    inputSchema: z.object({
      branchName: z
        .string()
        .describe("新分支名，如 docs/add-arch-notes、feat/add-login。不能与现有分支重复"),
      commitMessage: z.string().describe("提交信息，准确描述本次变更内容"),
      files: z
        .array(
          z.object({
            path: z.string().describe("仓库内相对路径，如 docs/arch.md"),
            content: z.string().describe("文件完整内容（utf-8 文本）"),
          })
        )
        .describe("要提交的文件列表，单次最多 30 个"),
      prTitle: z.string().describe("Draft PR 标题"),
      prBody: z.string().optional().describe("PR 描述正文（可选）"),
    }),
    execute: async ({ branchName, commitMessage, files, prTitle, prBody }, { abortSignal }) => {
      if (commitCount >= MAX_COMMITS_PER_TURN)
        return {
          ok: false as const,
          code: "too_many" as const,
          message: `本轮提交已达上限（${MAX_COMMITS_PER_TURN} 次），如需更多请分轮执行`,
        }
      commitCount++

      const res = await commitFilesToBranch({
        repositoryFullName: ctx.repositoryFullName,
        token: ctx.token,
        baseBranch: ctx.branch,
        branchName,
        commitMessage,
        files,
        prTitle,
        prBody,
        signal: abortSignal,
      })
      if (!res.ok) return { ok: false as const, code: res.code, message: res.message }
      return {
        ok: true as const,
        data: {
          branch: res.data.branch,
          commitSha: res.data.commitSha,
          commitUrl: `https://github.com/${ctx.repositoryFullName}/commit/${res.data.commitSha}`,
          pullRequest: res.data.pullRequest,
          warning: res.data.warning,
        },
      }
    },
  })

  return { commitFilesToRepository }
}

export type RepoWriteTools = ReturnType<typeof createRepoWriteTools>
