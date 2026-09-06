/** 云调研 demo 的资源上限与固定工作目录。 */
export const CLOUD_RESEARCH = {
  timeoutMs: 10 * 60_000,
  commandTimeoutMs: 30_000,
  archiveMaxBytes: 20 * 1024 * 1024,
  maxSteps: 16,
  maxReadSteps: 10,
  maxInspections: 20,
  root: "/tmp/threadchat-repository",
  archive: "/tmp/threadchat-repository.b64",
  reader: "/tmp/threadchat-read.py",
  reportDirectory: "docs/research",
} as const

export const CLOUD_RESEARCH_TOOL_LABELS: Record<string, string> = {
  prepareRepository: "准备代码环境",
  inspectRepository: "读取与检索代码",
  publishResearchReport: "提交调研报告 PR",
}
