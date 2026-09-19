// POST /api/agent-tasks/:taskId/cancel —— 请求取消正在运行的任务。

import { requestCancel } from "@/lib/agent-demo/store";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const accepted = await requestCancel(taskId);
  if (!accepted) {
    return Response.json({ error: "任务不在运行中" }, { status: 409 });
  }
  return Response.json({ ok: true });
}
