// POST /api/agent-tasks/:taskId/resume —— 恢复已暂停的任务。
// 重连 paused 沙箱（内存快照还原），Agent 进程从冻结点继续执行。

import { requestResume } from "@/lib/agent-demo/store";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const accepted = await requestResume(taskId);
  if (!accepted) {
    return Response.json({ error: "任务不在已暂停状态" }, { status: 409 });
  }
  return Response.json({ ok: true });
}
