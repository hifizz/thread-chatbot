// POST /api/agent-tasks —— 创建任务并立即返回 taskId（方案 §9）。
// demo 版：幂等键可选；持久化为内存；worker 为进程内 runner；执行环境为真实 boxd VM。

import { createTask } from "@/lib/agent-demo/store";
import { startRunner } from "@/lib/agent-demo/runner";
import { prepareWorkspace } from "@/lib/agent-demo/workspace";

export const dynamic = "force-dynamic";

const pendingIdempotency = new Map<string, string>();
const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/;
const DEFAULT_REPO = "hifizz/ai-daily";

export async function POST(req: Request) {
  let body: { goal?: string; repo?: string; idempotencyKey?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const goal = body.goal?.trim();
  if (!goal) {
    return Response.json({ error: "缺少 goal" }, { status: 400 });
  }
  const repo = (body.repo?.trim() || DEFAULT_REPO).replace(/\.git$/, "");
  if (!REPO_PATTERN.test(repo)) {
    return Response.json({ error: "repo 必须是 owner/name 形式" }, { status: 400 });
  }

  if (body.idempotencyKey) {
    const existing = pendingIdempotency.get(body.idempotencyKey);
    if (existing) {
      return Response.json({ taskId: existing, deduplicated: true });
    }
  }

  // 与 runner 的 remoteReady 判定保持一致：远端环境需要沙箱 key + GITHUB_TOKEN。
  const hasGithub = Boolean(process.env.GITHUB_TOKEN?.trim());
  const environment = hasGithub && process.env.E2B_API_KEY?.trim()
    ? "e2b"
    : hasGithub && process.env.BOXD_API_KEY?.trim()
      ? "boxd"
      : "local";
  const title = goal.length > 40 ? `${goal.slice(0, 40)}…` : goal;
  const task = createTask({
    goal,
    title,
    repo,
    branch: "",
    environment,
    workspacePath: "",
  });
  task.branch = `agent/${task.id}`;
  if (environment === "local") task.workspacePath = await prepareWorkspace(task.id);
  if (body.idempotencyKey) pendingIdempotency.set(body.idempotencyKey, task.id);

  startRunner(task.id);
  return Response.json({
    taskId: task.id,
    runId: task.currentRunId,
    title: task.title,
    repo: task.repo,
    branch: task.branch,
  });
}
