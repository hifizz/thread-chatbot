import { shareLayoutSchema } from "../../lib/thread-chat/sharing/contracts.ts"

/** 全部内容为人工测试数据，不读取用户会话。 */
export function sharingFixture() {
  const now = new Date("2026-09-05T12:00:00Z")
  const project = { id: "project", userId: "owner", customTitle: "从一个问题展开的研究", autoTitle: null, target: "PRIVATE_SENTINEL", instructions: "PRIVATE_SENTINEL", memory: "PRIVATE_SENTINEL", createdAt: now, updatedAt: now }
  const root = { id: "root", projectId: "project", parentId: null, forkMessageId: null, forkContext: [], forkAnchor: null, anchorText: null, footnote: null, depth: 0, customTitle: "研究主线", autoTitle: null, modelId: "PRIVATE_SENTINEL", createdAt: now, updatedAt: now }
  const branch = { ...root, id: "branch", parentId: "root", depth: 1, forkMessageId: "old-answer", forkContext: ["question", "old-answer"], forkAnchor: { quote: { exact: "探索分支", prefix: "", suffix: "" } }, anchorText: "探索分支", footnote: 1, customTitle: "技术可行性" }
  const deep = { ...branch, id: "deep", parentId: "branch", depth: 2, forkMessageId: "branch-answer", forkContext: ["question", "old-answer", "branch-answer"], footnote: 2, customTitle: "交付清单" }
  const message = (id, threadId, sequence, text, extra = {}) => ({ id, projectId: "project", threadId, sequence, role: "assistant", parts: [{ type: "text", text, providerMetadata: { secret: "PRIVATE_SENTINEL" } }], status: "completed", modelId: "test-model", supersededAt: null, finishedAt: now, createdAt: now, updatedAt: now, providerUsage: { secret: "PRIVATE_SENTINEL" }, errorMessage: "PRIVATE_SENTINEL", ...extra })
  const messages = [
    message("question", "root", 1, "如何让复杂研究更容易阅读？", { role: "user", modelId: null }),
    message("old-answer", "root", 2, "先整理问题，再探索分支。这是分支仍然引用的旧回答。", { supersededAt: now }),
    message("unrelated-old", "root", 3, "PRIVATE_SENTINEL", { supersededAt: now }),
    message("new-answer", "root", 4, "## 让阅读从全局开始\n\n沿主线理解目标，打开分支检查依据。\n\n[资料](https://example.com/reference)\n\n![图片](https://example.com/PRIVATE_SENTINEL)\n\n附件 /api/attachments/PRIVATE_SENTINEL", { parts: [{ type: "text", text: "## 让阅读从全局开始\n\n沿主线理解目标，打开分支检查依据。\n\n[资料](https://example.com/reference)" }, { type: "file", filename: "PRIVATE_SENTINEL", url: "/api/attachments/PRIVATE_SENTINEL" }] }),
    message("branch-answer", "branch", 1, "探索分支后，我们保留 Markdown 文档。\n\n| 能力 | 范围 |\n|---|---|\n| 分享 | 冻结快照 |\n| 阅读 | 全部分支 |\n\n```ts\nconst mode = 'readonly'\n```"),
    message("pending", "deep", 1, "PRIVATE_SENTINEL", { status: "generating", finishedAt: null }),
  ]
  const artifacts = [{ id: "document", projectId: "project", threadId: "branch", sourceMessageId: "branch-answer", kind: "markdown", title: "阅读体验设计", content: "# 阅读体验设计\n\n> 内容与布局一起保存。\n\n## 交付范围\n\n- 匿名只读\n- 冻结快照\n- 可撤销链接\n\n| 有效期 | 默认 |\n|---|---|\n| 无限 | 是 |\n| 3 / 7 / 30 天 | 否 |\n\n```ts\nconst snapshot = { readOnly: true }\n```\n\n![附件](/api/attachments/PRIVATE_SENTINEL)", language: null, metadata: { secret: "PRIVATE_SENTINEL" }, createdAt: now, updatedAt: now }]
  const layout = shareLayoutSchema.parse({ view: "columns", slots: [{ id: "deep", folded: false }, { id: "branch", folded: true }], widths: { root: 480, deep: 360 }, focusId: "deep", pins: [{ id: "root", x: 40, y: 80 }, { id: "branch", x: 500, y: 100 }], viewport: { x: 40, y: 60, zoom: 0.75 }, artifactId: "document", panelWidth: 420 })
  return { project, threads: [root, branch, deep], messages, artifacts, layout }
}
