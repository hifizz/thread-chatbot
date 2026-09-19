// POST /api/agent-tasks/:taskId/pause —— 请求暂停正在运行的任务。
// e2b 沙箱做完整快照（文件系统+内存），任务记录保留，可经 resume 恢复。

import { requestPause } from "@/lib/agent-demo/store";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const accepted = await requestPause(taskId);
  if (!accepted) {
    return Response.json({ error: "任务不在可暂停状态" }, { status: 409 });
  }
  return Response.json({ ok: true });
}
