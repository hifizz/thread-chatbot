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

export type RepoSummary = {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  updatedAt: string;
};

/** 列出 token 可见的全部仓库（own + collaborator + org），分页拉取，上限 500。 */
export async function listUserRepos(token: string): Promise<RepoSummary[]> {
  const out: RepoSummary[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      { headers: headers(token) }
    );
    if (!res.ok) throw new Error(`拉取仓库列表失败: ${res.status}`);
    const list = (await res.json()) as {
      full_name: string;
      default_branch: string;
      private: boolean;
      description: string | null;
      updated_at: string;
    }[];
    for (const r of list) {
      out.push({
        fullName: r.full_name,
        defaultBranch: r.default_branch,
        private: r.private,
        description: r.description,
        updatedAt: r.updated_at,
      });
    }
    if (list.length < 100) break;
  }
  return out;
}

export type RepoBranches = { defaultBranch: string; branches: string[] };

/** 列出仓库分支（上限 300）及默认分支。 */
export async function listBranches(repo: string, token: string): Promise<RepoBranches> {
  const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers: headers(token) });
  if (!repoRes.ok) throw new Error(`查询仓库失败: ${repoRes.status}`);
  const repoData = (await repoRes.json()) as { default_branch: string };

  const names: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/branches?per_page=100&page=${page}`,
      { headers: headers(token) }
    );
    if (!res.ok) break;
    const list = (await res.json()) as { name: string }[];
    names.push(...list.map((b) => b.name));
    if (list.length < 100) break;
  }
  return { defaultBranch: repoData.default_branch, branches: names };
}

export type PrCheck = { name: string; status: string; conclusion: string | null };

export type PullRequestState = {
  number: number;
  url: string;
  state: string;
  draft: boolean;
  merged: boolean;
  headSha: string;
  baseBranch: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: PrCheck[];
  /** checks 汇总：pending / success / failure / none */
  checksState: "none" | "pending" | "success" | "failure";
  updatedAt: string;
};

/** 查询 PR 的权威状态（含检查运行）。API 失败时抛错，由调用方决定是否保留旧状态。 */
export async function getPullRequestState(
  repo: string,
  token: string,
  number: number
): Promise<PullRequestState> {
  const res = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
    headers: headers(token),
  });
  if (!res.ok) throw new Error(`查询 PR 失败: ${res.status}`);
  const pr = (await res.json()) as {
    number: number;
    html_url: string;
    state: string;
    draft: boolean;
    merged: boolean;
    head: { sha: string };
    base: { ref: string };
    additions: number;
    deletions: number;
    changed_files: number;
    updated_at: string;
  };

  let checks: PrCheck[] = [];
  const checksRes = await fetch(
    `https://api.github.com/repos/${repo}/commits/${pr.head.sha}/check-runs`,
    { headers: headers(token) }
  );
  if (checksRes.ok) {
    const data = (await checksRes.json()) as {
      check_runs: { name: string; status: string; conclusion: string | null }[];
    };
    checks = data.check_runs.map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion }));
  }

  const checksState: PullRequestState["checksState"] =
    checks.length === 0
      ? "none"
      : checks.some((c) => c.status !== "completed")
        ? "pending"
        : checks.every((c) => c.conclusion === "success" || c.conclusion === "skipped" || c.conclusion === "neutral")
          ? "success"
          : "failure";

  return {
    number: pr.number,
    url: pr.html_url,
    state: pr.state,
    draft: pr.draft,
    merged: pr.merged,
    headSha: pr.head.sha,
    baseBranch: pr.base.ref,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changed_files,
    checks,
    checksState,
    updatedAt: pr.updated_at,
  };
}
