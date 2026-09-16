// GET /api/agent-repos/branches?repo=owner/name —— 列出分支与默认分支。

import { listBranches } from "@/lib/agent-demo/github";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) {
    return Response.json({ error: "缺少 GITHUB_TOKEN" }, { status: 503 });
  }
  const repo = new URL(req.url).searchParams.get("repo")?.replace(/\.git$/, "") ?? "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return Response.json({ error: "repo 必须是 owner/name 形式" }, { status: 400 });
  }
  try {
    const data = await listBranches(repo, token);
    return Response.json(data);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
