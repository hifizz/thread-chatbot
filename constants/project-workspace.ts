// Project Workspace 的服务端校验、上下文预算与用户文案单一来源。
export const PROJECT_TARGET_MAX_CHARS = 4_000
export const PROJECT_INSTRUCTIONS_MAX_CHARS = 20_000

/** Artifacts 达到此总数后显示抽屉内搜索。 */
export const ARTIFACT_SEARCH_THRESHOLD = 6

/** Message attachments 与 Project Files 共用的单次模型上下文字符预算。 */
export const PROJECT_FILE_CONTEXT_CHAR_BUDGET = 120_000

export const PROJECT_WORKSPACE_COPY = {
  contractConflict: "Project 设置已在其他页面更新，请重新加载后再保存",
  archivedReadOnly: "已归档 Project 只能查看，取消归档后才能修改",
  fileAlreadyAssigned: "该文件已经属于另一个 Project",
  fileNotFound: "Project 文件不存在",
} as const
