// GET /api/agent-tasks/:id/events?after=N —— 补读并持续 SSE（方案 §9）。
// demo 按建议值每 500ms 轮询内存事件表，发送心跳。

import { getEventsAfter, getTask } from "@/lib/agent-demo/store";

export const dynamic = "force-dynamic";

const POLL_INTERVAL_MS = 500;
const HEARTBEAT_INTERVAL_MS = 15_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ taskId: string }> }
) {
  const { taskId } = await params;
  const task = getTask(taskId);
  if (!task) return Response.json({ error: "任务不存在" }, { status: 404 });

  const url = new URL(req.url);
  let cursor = Number(url.searchParams.get("after") ?? "0") || 0;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let lastHeartbeat = Date.now();
      let timer: ReturnType<typeof setInterval> | undefined;

      const close = () => {
        if (closed) return;
        closed = true;
        if (timer !== undefined) clearInterval(timer);
        try {
          controller.close();
        } catch {
          // 已关闭
        }
      };
      req.signal.addEventListener("abort", close);

      const flush = () => {
        const events = getEventsAfter(taskId, cursor);
        for (const event of events) {
          cursor = event.seq;
          controller.enqueue(
            encoder.encode(
              `id: ${event.seq}\nevent: task-event\ndata: ${JSON.stringify(event)}\n\n`
            )
          );
        }
        const current = getTask(taskId);
        if (current && Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
          lastHeartbeat = Date.now();
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        }
        // 终态且事件全部推完后主动结束，客户端无需一直挂着
        if (
          current &&
          (current.status === "completed" ||
            current.status === "failed" ||
            current.status === "cancelled") &&
          cursor >= current.nextEventSeq - 1
        ) {
          controller.enqueue(encoder.encode(`event: done\ndata: {}\n\n`));
          close();
        }
      };

      flush();
      if (!closed) timer = setInterval(flush, POLL_INTERVAL_MS);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
