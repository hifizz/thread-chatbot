// 仓库接入的最小实现：GitHub REST 直接接入（方案 P1），
// 负责默认分支查询与 Draft PR 的创建/查重，不碰 git 传输本身。

export type PullRequestInfo = { number: number; url: string; headSha: string };

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

export async function getDefaultBranch(repo: string, token: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`查询仓库失败: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { default_branch: string };
  return data.default_branch;
}

/** 按 head 分支查重后创建 Draft PR；已存在则直接复用（方案 §11 的 PR 查重要求）。 */
export async function publishDraftPr(input: {
  repo: string;
  token: string;
  head: string;
  base: string;
  title: string;
  body: string;
  expectedHeadSha: string;
}): Promise<PullRequestInfo> {
  const owner = input.repo.split("/")[0];

  const existing = await fetch(
    `https://api.github.com/repos/${input.repo}/pulls?head=${owner}:${input.head}&state=open`,
    { headers: headers(input.token) }
  );
  if (existing.ok) {
    const list = (await existing.json()) as { number: number; html_url: string; head: { sha: string } }[];
    if (list.length > 0) {
      return { number: list[0].number, url: list[0].html_url, headSha: list[0].head.sha };
    }
  }

  const res = await fetch(`https://api.github.com/repos/${input.repo}/pulls`, {
    method: "POST",
    headers: headers(input.token),
    body: JSON.stringify({
      title: input.title,
      head: input.head,
      base: input.base,
      body: input.body,
      draft: true,
    }),
  });
  if (!res.ok) throw new Error(`创建 PR 失败: ${res.status} ${await res.text()}`);
  const pr = (await res.json()) as { number: number; html_url: string; head: { sha: string } };
  return { number: pr.number, url: pr.html_url, headSha: pr.head.sha };
}
