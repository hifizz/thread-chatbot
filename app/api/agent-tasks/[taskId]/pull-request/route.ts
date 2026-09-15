// GET /api/agent-tasks/:taskId/pull-request —— 从 GitHub 拉取该任务 PR 的权威状态。

import { getTask } from "@/lib/agent-demo/store";
import { getPullRequestState } from "@/lib/agent-demo/github";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const task = getTask(taskId);
  const pr = task?.result?.pullRequest;
  if (!task || !pr) {
    return Response.json({ pullRequest: null });
  }
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return Response.json({ error: "缺少 GITHUB_TOKEN" }, { status: 503 });
  }
  try {
    const state = await getPullRequestState(task.repo, token, pr.number);
    return Response.json({ pullRequest: state });
  } catch (error) {
    return Response.json(
      { pullRequest: null, error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
