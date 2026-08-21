/** 主线与分支共用的标题生成请求契约。 */
export type ThreadTitleInput =
  | {
      kind: "main"
      question: string
    }
  | {
      kind: "branch"
      anchorText: string
      question: string
      answer: string
    }

/**
 * 只接受带显式 kind 的统一标题请求；旧分支请求体不会被隐式兼容。
 */
export function parseThreadTitleInput(input: unknown): ThreadTitleInput | null {
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>

  if (record.kind === "main" && typeof record.question === "string") {
    return record.question.trim()
      ? { kind: "main", question: record.question }
      : null
  }

  if (
    record.kind === "branch" &&
    typeof record.anchorText === "string" &&
    typeof record.question === "string" &&
    typeof record.answer === "string" &&
    record.anchorText.trim() &&
    record.question.trim()
  ) {
    return {
      kind: "branch",
      anchorText: record.anchorText,
      question: record.question,
      answer: record.answer,
    }
  }

  return null
}
