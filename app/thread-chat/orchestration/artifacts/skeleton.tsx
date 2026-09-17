"use client"


import { useI18n } from "@/lib/i18n/client"


/**
 * Drawer 内的骨架屏。可见性由 .skel 的延迟淡入控制（约 320ms），
 * 快加载时骨架对用户不可见，避免一闪而过。
 */

function Bar({
  width,
  height,
  radius,
}: {
  width: string
  height?: number
  radius?: number
}) {
  return (
    <i
      className="skel-bar"
      style={{ width, height, borderRadius: radius }}
    />
  )
}

/** Artifact 阅读屏正文：Markdown 文档形态（标题 + 段落行 + 小节）。 */
export function ArtifactBodySkeleton() {
  const { t } = useI18n()

  return (
    <div className="skel" role="status" aria-label={t("ui.loadingDocument")}>
      <Bar width="42%" height={18} />
      <Bar width="96%" />
      <Bar width="88%" />
      <Bar width="60%" />
      <Bar width="34%" height={14} />
      <Bar width="100%" />
      <Bar width="92%" />
      <Bar width="72%" />
    </div>
  )
}

/** 「文档与产物」/ 文件目录：卡片形态的行骨架。 */
export function ResourceListSkeleton({ count = 3 }: { count?: number }) {
  const { t } = useI18n()

  return (
    <div className="skel" role="status" aria-label={t("ui.loadingList")}>
      {Array.from({ length: count }, (_, index) => (
        <div className="skel-card" key={index}>
          <i className="skel-bar skel-thumb" />
          <span className="skel-card-main">
            <Bar width="52%" />
            <Bar width="74%" />
          </span>
        </div>
      ))}
    </div>
  )
}

/** Project 管理屏整体加载：区块标题 + 大块内容。 */
export function ProjectPanelSkeleton() {
  const { t } = useI18n()

  return (
    <div className="skel" role="status" aria-label={t("ui.loadingProject")}>
      <Bar width="34%" height={14} />
      <Bar width="100%" height={56} />
      <Bar width="28%" height={14} />
      <Bar width="100%" height={96} />
    </div>
  )
}

/** 版本差异浮层加载：几行带缩进的 diff 条。 */
export function ArtifactDiffSkeleton() {
  const { t } = useI18n()

  return (
    <div className="skel" role="status" aria-label={t("ui.loadingChanges")}>
      <Bar width="72%" />
      <Bar width="58%" />
      <Bar width="84%" />
      <Bar width="40%" />
    </div>
  )
}

/** 版本历史尚未返回时的胶囊占位。 */
export function VersionPillSkeleton() {
  const { t } = useI18n()

  return (
    <div className="skel" role="status" aria-label={t("ui.loadingVersions")}>
      <Bar width="64px" height={18} radius={999} />
    </div>
  )
}
