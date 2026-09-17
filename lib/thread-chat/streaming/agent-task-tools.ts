// 编码任务工具：dispatchAgentTask 派发写代码任务，checkAgentTask 查询进度。
// 仓库与目标分支由服务端闭包固定（来自 Thread 绑定），模型不能指定其他仓库。

import { tool } from "ai"
import { z } from "zod"
import { createTask, getSnapshot } from "@/lib/agent-demo/store"
import { startRunner } from "@/lib/agent-demo/runner"
import { prepareWorkspace } from "@/lib/agent-demo/workspace"

const MAX_DISPATCH_PER_TURN = 3

export interface AgentTaskContext {
  repositoryFullName: string
  baseBranch: string
}

export function createAgentTaskTools(ctx: AgentTaskContext) {
  const dispatched = new Set<string>()
  let dispatchCount = 0

  const dispatchAgentTask = tool({
    description:
      "派发一个编码任务到远程沙箱。Agent 会在当前绑定的 GitHub 仓库上工作：检出新任务分支、编写或修改代码/文档、提交 commit、推送并创建 Draft PR（目标分支为当前绑定分支）。当用户要求实现功能、修复问题、编写代码或文档并交付 PR 时使用；只读分析或讨论不要调用。任务是异步执行的，派发后用 checkAgentTask 查询进度。",
    inputSchema: z.object({
      goal: z
        .string()
        .describe(
          "任务目标的自然语言描述。写清楚需求、涉及的模块和验收标准；可以先结合已读取的代码上下文给出实现要点"
        ),
    }),
    execute: async ({ goal }) => {
      const trimmed = goal.trim()
      if (!trimmed)
        return { ok: false as const, code: "invalid" as const, message: "任务目标为空" }
      if (dispatchCount >= MAX_DISPATCH_PER_TURN)
        return {
          ok: false as const,
          code: "too_many" as const,
          message: `本轮派发已达上限（${MAX_DISPATCH_PER_TURN} 个），如需更多任务请分轮派发`,
        }
      if (dispatched.has(trimmed))
        return {
          ok: false as const,
          code: "duplicate" as const,
          message: "本轮已派发过相同任务，请勿重复派发",
        }
      dispatched.add(trimmed)
      dispatchCount++

      const hasGithub = Boolean(process.env.GITHUB_TOKEN?.trim())
      const environment =
        hasGithub && process.env.E2B_API_KEY?.trim()
          ? "e2b"
          : hasGithub && process.env.BOXD_API_KEY?.trim()
            ? "boxd"
            : "local"
      const title = trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed
      const task = createTask({
        goal: trimmed,
        title,
        repo: ctx.repositoryFullName,
        branch: "",
        baseBranch: ctx.baseBranch,
        environment,
        workspacePath: "",
      })
      task.branch = `agent/${task.id}`
      if (environment === "local")
        task.workspacePath = await prepareWorkspace(task.id)
      startRunner(task.id)
      return {
        ok: true as const,
        data: {
          taskId: task.id,
          title,
          repo: task.repo,
          branch: task.branch,
          baseBranch: task.baseBranch,
          environment,
          watchUrl: `/agent-demo?task=${task.id}`,
        },
      }
    },
  })

  const checkAgentTask = tool({
    description:
      "查询已派发编码任务的状态和结果。返回任务状态、当前阶段、变更文件列表、验证结果和 Draft PR 链接（如已创建）。",
    inputSchema: z.object({
      taskId: z.string().describe("任务 ID，形如 task-xxxxxxxx"),
    }),
    execute: async ({ taskId }) => {
      const snap = getSnapshot(taskId)
      if (!snap)
        return {
          ok: false as const,
          code: "not_found" as const,
          message: `任务 ${taskId} 不存在`,
        }
      return {
        ok: true as const,
        data: {
          taskId: snap.taskId,
          title: snap.title,
          status: snap.status,
          phase: snap.phase,
          repo: snap.repo,
          branch: snap.branch,
          baseBranch: snap.baseBranch,
          result: snap.result
            ? {
                outcome: snap.result.outcome,
                summary: snap.result.summary.slice(0, 2000),
                changedFiles: snap.result.changedFiles,
                commitSha: snap.result.commitSha,
                pullRequest: snap.result.pullRequest,
              }
            : null,
          error: snap.error,
        },
      }
    },
  })

  return { dispatchAgentTask, checkAgentTask }
}

export type AgentTaskTools = ReturnType<typeof createAgentTaskTools>
