export interface CloudResearchRequest {
  repository: string
  publish: boolean
}

/** Demo 的显式入口；不依赖模型推断仓库身份或写入权限。 */
export function parseCloudResearchRequest(text: string): CloudResearchRequest | null {
  if (!/@\s*github\b/i.test(text)) return null
  const matches = [...text.matchAll(/(?:https:\/\/github\.com\/|\bgithub\/)([a-z0-9][a-z0-9-]*\/[a-z0-9_.-]+)/gi)]
  const repositories = [...new Set(matches.map((match) => match[1].replace(/\.git$/, "").replace(/[.]+$/, "").toLowerCase()))]
  if (repositories.length !== 1) throw new Error("请在 @GitHub 后提供一个明确的 GitHub 仓库地址。")
  // 固定指令避免把“如何开发 PR 功能”等调研主题当成发布授权。
  const publish = /(?:^|\n)\s*\/publish-pr\s*(?:$|\n)/i.test(text)
  return { repository: repositories[0], publish }
}

export function requireCloudResearchConfig(userId: string, repository: string) {
  const env = process.env
  if (env.CLOUD_RESEARCH_DEMO_ENABLED !== "true") throw new Error("云调研 demo 尚未启用。")
  if (!userId || userId !== env.CLOUD_RESEARCH_DEMO_USER_ID) throw new Error("当前账号未开通云调研 demo。")
  const allowed = (env.CLOUD_RESEARCH_DEMO_REPOSITORIES ?? "").split(",").map((item) => item.trim().toLowerCase())
  if (!allowed.includes(repository)) throw new Error("该仓库尚未加入云调研 demo 的允许列表。")
  if (!env.CLOUD_RESEARCH_GITHUB_TOKEN || !env.E2B_API_KEY) throw new Error("请配置云调研的 GitHub Token 和 E2B API Key。")
  return { githubToken: env.CLOUD_RESEARCH_GITHUB_TOKEN, e2bApiKey: env.E2B_API_KEY }
}
