"use client"

import { DOCUMENT_RESULT_COPY } from "@/constants/project-documents"
import type { DocumentToolPart } from "../../branching/assistant/assistant-part-render-plan"
import { ArtifactThumb } from "../../orchestration/artifacts/markdown-artifact-card"
import {
  useArtifactNavigation,
  useArtifactResources,
  useDocumentResources,
} from "../composer/artifact-resources"
import { dc } from "../../theme"

/**
 * updateProjectDocument 的终态收据卡，与正文 artifact 卡同一视觉语言：
 * committed → 可点击卡片（文档标题 + 新版本号 + 变更摘要 + 「查看差异」入口，
 * 整卡打开该修订版本的版本/差异视图）；unchanged / conflict / rejected /
 * output-error → 静态收据，未保存类结果走 acard-failed 警示配色。
 * 进行中的调用由 DocumentTrace 时序行表达，这里不渲染半成品状态；
 * 同文档被后续提交覆盖的中间结果由调用方过滤，不重复出卡。
 */
export function DocumentUpdateTool({
  part,
  sourceDepth = null,
}: {
  part: DocumentToolPart
  sourceDepth?: number | null
}) {
  const open = useArtifactNavigation()
  const artifacts = useArtifactResources()
  const documents = useDocumentResources()
  if (part.type !== "tool-updateProjectDocument") return null
  if (part.state !== "output-available" && part.state !== "output-error")
    return null

  const result = part.state === "output-available" ? part.output : undefined
  const committed = result?.status === "committed"
  const committedArtifactId = committed ? result.artifactId : undefined
  const artifact = committedArtifactId
    ? artifacts[committedArtifactId]
    : undefined
  const title =
    (part.input?.documentId
      ? documents[part.input.documentId]?.title
      : undefined) ??
    artifact?.title ??
    "项目文档"

  const failed =
    part.state === "output-error" ||
    result?.status === "conflict" ||
    result?.status === "rejected"
  const caption =
    part.state === "output-error"
      ? "文档修改提交失败，请重试"
      : committed
        ? artifact?.document?.revisionNumber
          ? `已更新到 V${artifact.document.revisionNumber}`
          : "已保存修改"
        : result?.status === "unchanged"
          ? "内容已满足要求，无需修改"
          : result?.status === "conflict"
            ? "文档已有新版本，本次未保存"
            : (result?.status === "rejected" &&
                DOCUMENT_RESULT_COPY[result.code]) ||
              "本次修改未保存"

  const depthClass =
    sourceDepth !== null && sourceDepth > 0 ? `fc-${dc(sourceDepth)}` : ""
  const clickable = committedArtifactId !== undefined && open !== null
  const className =
    `acard tc-fork-context ${depthClass} ${clickable ? "" : "acard-static"} ${failed ? "acard-failed" : ""}`

  const inner = (
    <>
      <ArtifactThumb kind="markdown" />
      <span className="t">
        <span className="n">{title}</span>
        <span className="k">{caption}</span>
        {committed && result.changeSummary ? (
          <span className="s">{result.changeSummary}</span>
        ) : null}
      </span>
      {clickable ? (
        <button
          type="button"
          className="dl"
          onClick={(event) => {
            event.stopPropagation()
            open?.(committedArtifactId)
          }}
        >
          查看差异
        </button>
      ) : null}
    </>
  )

  if (clickable) {
    return (
      <div
        className={className}
        role="button"
        tabIndex={0}
        onClick={() => open?.(committedArtifactId)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            open?.(committedArtifactId)
          }
        }}
      >
        {inner}
      </div>
    )
  }
  return (
    <div className={className} role="status">
      {inner}
    </div>
  )
}
