"use client"

import { ChevronRight } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { diffLines, diffWordsWithSpace } from "diff"
import { DOCUMENT_UI_KEYS } from "@/constants/project-documents"
import type { ArtifactDTO } from "@/lib/thread-chat/contracts/dto"
import type { DocumentRevisionSummaryDTO } from "@/lib/thread-chat/contracts/document"
import type { ThreadChatClient } from "../../../net/client"
import { ArtifactDiffSkeleton } from "../skeleton"
import { useI18n } from "@/lib/i18n/client"


/** 变更行上下保留的上下文行数；更长的未变更段折叠成「省略 N 行」。 */
const DIFF_CONTEXT_LINES = 1

type DiffWord = { value: string; added?: boolean; removed?: boolean }
type DiffLineRow =
  | { kind: "context"; text: string }
  | { kind: "added"; text: string; words?: DiffWord[] }
  | { kind: "removed"; text: string; words?: DiffWord[] }
type DiffRow = DiffLineRow | { kind: "gap"; count: number }

/**
 * 行级 diff → 只保留变更附近的上下文（hunk），相邻「删 → 增」行再按序配对
 * 做词级高亮：Markdown 常见整段重写但只改几个词，词级高亮才看得出差异。
 */
function buildDiffRows(previous: string, current: string) {
  const lines: DiffLineRow[] = []
  for (const chunk of diffLines(previous, current)) {
    const kind = chunk.added ? "added" : chunk.removed ? "removed" : "context"
    for (const text of chunk.value.replace(/\n$/, "").split("\n"))
      lines.push({ kind, text })
  }
  const stats = { added: 0, removed: 0 }
  const ranges: Array<[number, number]> = []
  lines.forEach((line, index) => {
    if (line.kind === "context") return
    if (line.kind === "added") stats.added++
    else stats.removed++
    const low = Math.max(0, index - DIFF_CONTEXT_LINES)
    const high = Math.min(lines.length - 1, index + DIFF_CONTEXT_LINES)
    const last = ranges[ranges.length - 1]
    if (last && low <= last[1] + 1) last[1] = Math.max(last[1], high)
    else ranges.push([low, high])
  })
  const rows: DiffRow[] = []
  let cursor = 0
  for (const [low, high] of ranges) {
    if (low > cursor) rows.push({ kind: "gap", count: low - cursor })
    rows.push(...lines.slice(low, high + 1))
    cursor = high + 1
  }
  if (cursor < lines.length)
    rows.push({ kind: "gap", count: lines.length - cursor })
  for (let index = 0; index < rows.length; index++) {
    if (rows[index].kind !== "removed") continue
    let removedEnd = index
    while (rows[removedEnd + 1]?.kind === "removed") removedEnd++
    let addedEnd = removedEnd
    while (rows[addedEnd + 1]?.kind === "added") addedEnd++
    const pairs = Math.min(removedEnd - index + 1, addedEnd - removedEnd)
    for (let offset = 0; offset < pairs; offset++) {
      const removed = rows[index + offset]
      const added = rows[removedEnd + 1 + offset]
      if (removed.kind !== "removed" || added.kind !== "added") continue
      const words = diffWordsWithSpace(removed.text, added.text)
      removed.words = words.filter((word) => !word.added)
      added.words = words.filter((word) => !word.removed)
    }
    index = addedEnd
  }
  return { rows, stats }
}

function DiffLineText({ row }: { row: DiffLineRow }) {
  if (!("words" in row) || !row.words) return <>{row.text || " "}</>
  return (
    <>
      {row.words.map((word, index) =>
        word.added ? (
          <ins key={index}>{word.value}</ins>
        ) : word.removed ? (
          <del key={index}>{word.value}</del>
        ) : (
          <span key={index}>{word.value}</span>
        )
      )}
    </>
  )
}

/** 当前版本正文已经在阅读区；只在展开差异后请求其父版本。 */
export function DocumentDiff({
  before,
  after,
  client,
}: {
  before: DocumentRevisionSummaryDTO
  after: ArtifactDTO
  client: ThreadChatClient
}) {
  const { t } = useI18n()

  const [open, setOpen] = useState(false)
  const [previous, setPrevious] = useState<ArtifactDTO | null>(null)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const artifactId = before.artifactId
  useEffect(() => {
    if (!open) return
    let active = true
    void client
      .getArtifact(artifactId)
      .then((artifact) => {
        if (active) {
          setPrevious(artifact)
          setError(false)
        }
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
    }
  }, [client, artifactId, open, retry])
  const result = useMemo(
    () =>
      previous?.id === artifactId
        ? buildDiffRows(previous.content, after.content)
        : null,
    [previous, artifactId, after.content]
  )
  return (
    <>
      <button
        type="button"
        className="artifact-diff-trigger"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronRight size={12} aria-hidden="true" />
        {t("ui.versionChanges")}</button>
      {open && (
        <div className="artifact-diff-panel" aria-label={t("ui.versionChanges")}>
          <p className="artifact-diff-head">
            <span>
              V{before.revisionNumber} → V{after.document?.revisionNumber}
            </span>
            {result && (
              <span className="artifact-diff-stats">
                ＋{result.stats.added} −{result.stats.removed}
              </span>
            )}
          </p>
          {error ? (
            <p role="alert">
              {t(DOCUMENT_UI_KEYS.diffFailed)}
              <button type="button" onClick={() => setRetry((v) => v + 1)}>
                {t("ui.reloadChanges")}</button>
            </p>
          ) : !result ? (
            <ArtifactDiffSkeleton />
          ) : result.rows.length === 0 ? (
            <p role="status">{t("ui.theseVersionsHaveIdenticalContent")}</p>
          ) : (
            result.rows.map((row, index) =>
              row.kind === "gap" ? (
                <p key={index} className="artifact-diff-gap">
                  {t("ui.omitted")}{row.count} {t("ui.unchangedLines")}</p>
              ) : (
                <div key={index} className={`artifact-diff-line ${row.kind}`}>
                  <span className="artifact-diff-sign" aria-hidden="true">
                    {row.kind === "added"
                      ? "+"
                      : row.kind === "removed"
                        ? "−"
                        : ""}
                  </span>
                  <span className="artifact-diff-text">
                    <DiffLineText row={row} />
                  </span>
                </div>
              )
            )
          )}
        </div>
      )}
    </>
  )
}
