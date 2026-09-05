export interface AttachmentContextCandidate {
  id: string
  status: string
  mimeType: string
  pages?: readonly string[] | null
}

export interface AttachmentCandidatePlan<T extends AttachmentContextCandidate> {
  explicit: T[]
  project: T[]
  ordered: T[]
}

function readableAttachment<T extends AttachmentContextCandidate>(
  row: T | undefined
): row is T {
  return Boolean(
    row &&
      row.status === "ready" &&
      (row.mimeType === "text/plain" ||
        (row.mimeType === "application/pdf" &&
          row.pages &&
          row.pages.length > 0))
  )
}

/**
 * 纯策略：显式 Message Attachments 始终优先；Project Files 中相同 id 去重。
 * 输入顺序稳定，因此 fallback 截断也可重复验证。
 */
export function planAttachmentCandidates<T extends AttachmentContextCandidate>({
  explicitIds,
  projectIds,
  rowById,
}: {
  explicitIds: readonly string[]
  projectIds: readonly string[]
  rowById: ReadonlyMap<string, T>
}): AttachmentCandidatePlan<T> {
  const explicitSet = new Set(explicitIds)
  const explicit = explicitIds.flatMap((id) => {
    const row = rowById.get(id)
    return readableAttachment(row) ? [row] : []
  })
  const project = projectIds.flatMap((id) => {
    if (explicitSet.has(id)) return []
    const row = rowById.get(id)
    return readableAttachment(row) ? [row] : []
  })
  return { explicit, project, ordered: [...explicit, ...project] }
}

/** 当前剩余预算在剩余文件之间确定性均分，至少给当前候选 1 字符。 */
export function attachmentBudgetAllocation(
  remainingBudget: number,
  remainingFiles: number
): number {
  if (remainingBudget <= 0 || remainingFiles <= 0) return 0
  return Math.max(1, Math.floor(remainingBudget / remainingFiles))
}
