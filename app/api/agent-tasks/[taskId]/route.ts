// GET /api/agent-tasks/:id —— 当前快照及 lastSeq（方案 §9）。

import { getSnapshot } from "@/lib/agent-demo/store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const snapshot = getSnapshot(taskId);
  if (!snapshot) return Response.json({ error: "任务不存在" }, { status: 404 });
  return Response.json(snapshot);
}
