// GET /api/agent-repos —— 列出 GITHUB_TOKEN 可见的全部仓库（新建任务表单的候选集）。

import { listUserRepos } from "@/lib/agent-demo/github";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return Response.json({ error: "缺少 GITHUB_TOKEN" }, { status: 503 });
  }
  try {
    const repos = await listUserRepos(token);
    return Response.json({ repos });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
