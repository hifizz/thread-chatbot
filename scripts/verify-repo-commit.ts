// 真实验证 commitFilesToBranch：在 hifizz/playground.zilin.im 上
// 基于 main 建新分支、提交一个测试文件、创建 Draft PR。
// 运行：pnpm tsx scripts/verify-repo-commit.ts

import { readFileSync } from "node:fs"
import { commitFilesToBranch } from "../lib/github/repo-writer"

const env = readFileSync(".env.local", "utf8")
const token = env
  .split("\n")
  .find((l) => l.startsWith("GITHUB_TOKEN="))
  ?.split("=")[1]
  ?.trim()
  .replace(/^["']|["']$/g, "")
if (!token) throw new Error("GITHUB_TOKEN not found in .env.local")

const ts = new Date().toISOString().slice(11, 19).replaceAll(":", "")
const branch = `test/commit-files-${ts}`

const res = await commitFilesToBranch({
  repositoryFullName: "hifizz/playground.zilin.im",
  token,
  baseBranch: "main",
  branchName: branch,
  commitMessage: `test: thread-chat commitFilesToRepository e2e (${ts})`,
  files: [
    {
      path: `docs/thread-chat-e2e-${ts}.md`,
      content: `# ThreadChat e2e 验证\n\n由 commitFilesToRepository 工具经 Git Data API 提交（${ts}）。\n\n- blobs → tree → commit → ref → Draft PR\n- 无 clone、无沙箱\n`,
    },
    {
      path: `docs/nested/e2e-${ts}.txt`,
      content: "验证多级路径文件的 tree 创建。\n",
    },
  ],
  prTitle: `[e2e] commitFilesToRepository 验证 ${ts}`,
  prBody: "由 ThreadChat `commitFilesToRepository` 工具自动创建，验证后可直接关闭并删除分支。",
})

console.log(JSON.stringify(res, null, 2))
