// 仓库提交工具：commitFilesToRepository 把已知文件内容提交到新分支并创建 Draft PR。
// 用于交付物内容已在上下文中确定的场景（文档、Artifact、模型撰写的文件）；
// 需要在仓库里探索/写代码/跑测试的任务改用 dispatchAgentTask。
// 仓库与 base 分支由服务端闭包固定，模型不能通过参数指定其他仓库。
//
// files 支持两种内容来源：
// - content：模型本轮新撰写的完整内容；
// - documentId：项目文档引用，服务端直接取最新版本内容——
//   避免模型把已有文档全文逐 token 重新生成为工具入参（慢且可能被改写）。

import { tool } from "ai"
import { z } from "zod"
import { db } from "@/lib/db"
import { commitFilesToBranch } from "@/lib/github/repo-writer"
import {
  findOwnedDocument,
  readDocumentRevision,
} from "@/lib/thread-chat/persistence/documents/queries"
import type { RepoToolContext } from "./repo-tools"

const MAX_COMMITS_PER_TURN = 3

export interface RepoWriteContext extends RepoToolContext {
  userId: string
  projectId: string
}

const commitFileSchema = z
  .object({
    path: z.string().describe("仓库内相对路径，如 docs/arch.md"),
    content: z
      .string()
      .optional()
      .describe("文件完整内容。仅用于本轮新撰写、不来自项目文档的内容"),
    documentId: z
      .string()
      .optional()
      .describe(
        "项目文档 ID。提交已有项目文档时用引用：服务端直接取该文档最新版本内容，不要把全文放进 content 重新生成"
      ),
  })
  // 模型常把未用的字段补成空串；只有非空值才算"提供了"
  .refine(
    (f) =>
      (typeof f.content === "string" && f.content.length > 0) !==
      (typeof f.documentId === "string" && f.documentId.length > 0),
    { message: "每个文件必须提供 content 或 documentId 之一" }
  )

export function createRepoWriteTools(ctx: RepoWriteContext) {
  let commitCount = 0

  const commitFilesToRepository = tool({
    description:
      "把文件内容提交到新分支并创建 Draft PR（基于当前绑定分支）。当交付物的内容已经确定时使用：例如把本会话中的项目文档、Artifact 内容或你撰写的文件写入仓库。这是快速路径（秒级完成，不起沙箱）。files 中每个文件给 path + content（本轮新撰写的内容）或 path + documentId（已有项目文档，服务端取最新版本内容）；任务需要 agent 在仓库中探索、改代码或运行测试验证时，改用 dispatchAgentTask。",
    inputSchema: z.object({
      branchName: z
        .string()
        .describe("新分支名，如 docs/add-arch-notes、feat/add-login。不能与现有分支重复"),
      commitMessage: z.string().describe("提交信息，准确描述本次变更内容"),
      files: z
        .array(commitFileSchema)
        .describe(
          "要提交的文件列表，单次最多 30 个。每个文件给 content 或 documentId 之一；已有项目文档用 documentId 引用"
        ),
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

      // documentId 引用 → 服务端查库取最新版本内容（校验归属与项目）
      const resolved: { path: string; content: string }[] = []
      for (const f of files) {
        if (typeof f.documentId === "string" && f.documentId.length > 0) {
          const doc = await findOwnedDocument(db, ctx.userId, f.documentId)
          if (!doc || doc.projectId !== ctx.projectId || !doc.currentRevisionId)
            return {
              ok: false as const,
              code: "not_found" as const,
              message: `文档 ${f.documentId} 不存在或不属于当前项目`,
            }
          const revision = await readDocumentRevision(db, doc.id, doc.currentRevisionId)
          if (!revision)
            return {
              ok: false as const,
              code: "not_found" as const,
              message: `文档 ${f.documentId} 当前版本不可读`,
            }
          resolved.push({ path: f.path, content: revision.content })
        } else {
          resolved.push({ path: f.path, content: f.content! })
        }
      }

      const res = await commitFilesToBranch({
        repositoryFullName: ctx.repositoryFullName,
        token: ctx.token,
        baseBranch: ctx.branch,
        branchName,
        commitMessage,
        files: resolved,
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
