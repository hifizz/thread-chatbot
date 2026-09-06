import { CLOUD_RESEARCH } from "@/constants/cloud-research"

export class ResearchGitHub {
  constructor(
    private readonly repository: string,
    private readonly token: string,
    private readonly signal: AbortSignal,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  private async request(path: string, method = "GET", body?: unknown) {
    this.signal.throwIfAborted()
    const response = await this.fetcher(`https://api.github.com/repos/${this.repository}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.any([this.signal, AbortSignal.timeout(CLOUD_RESEARCH.commandTimeoutMs)]),
    })
    // 不将上游响应、凭据或带签名的 archive URL 写入模型与消息。
    if (!response.ok) throw new Error(`GitHub 操作失败（${response.status}）。请检查仓库权限。`)
    return response
  }

  async snapshot() {
    const repo = await (await this.request("")).json() as { default_branch: string }
    const commit = await (await this.request(`/commits/${encodeURIComponent(repo.default_branch)}`)).json() as { sha: string }
    return { branch: repo.default_branch, sha: commit.sha }
  }

  async archive(sha: string): Promise<string> {
    const response = await this.request(`/zipball/${sha}`)
    const reader = response.body?.getReader()
    if (!reader) throw new Error("GitHub 未返回仓库文件。")
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > CLOUD_RESEARCH.archiveMaxBytes) throw new Error("仓库压缩包超过 demo 的 20 MB 上限。")
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
    return Buffer.concat(chunks).toString("base64")
  }

  async publish(input: { messageId: string; base: string; sha: string; title: string; content: string }) {
    if (!/^[a-zA-Z0-9-]+$/.test(input.messageId)) throw new Error("无效的任务标识。")
    const branch = `threadchat/research-${input.messageId}`
    const path = `${CLOUD_RESEARCH.reportDirectory}/${input.messageId}.md`
    // 同一条消息仅有一个发布调用；分支冲突时停止，不覆盖已有工作。
    await this.request("/git/refs", "POST", { ref: `refs/heads/${branch}`, sha: input.sha })
    await this.request(`/contents/${path}`, "PUT", {
      branch,
      message: `docs: ${input.title}`,
      content: Buffer.from(input.content).toString("base64"),
    })
    const pr = await (await this.request("/pulls", "POST", {
      head: branch,
      base: input.base,
      title: input.title,
      draft: true,
      body: `ThreadChat 云调研报告。\n\n代码依据：${this.repository}@${input.sha}\n\n仅新增报告：\`${path}\`。`,
    })).json() as { html_url: string; number: number }
    return { url: pr.html_url, number: pr.number, branch, path }
  }
}
