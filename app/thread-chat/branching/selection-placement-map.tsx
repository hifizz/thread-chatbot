import type { PlacePreview, Slot } from "../orchestration/placement"

export function SelectionPlacementMap({
  sourceThreadId,
  slots,
  preview,
  override,
  titleOf,
  onToggleOverride,
}: {
  sourceThreadId: string
  slots: Slot[]
  preview: PlacePreview
  override: string | null
  titleOf: (threadId: string) => string
  onToggleOverride: (threadId: string) => void
}) {
  const cells: React.ReactNode[] = [
    <span
      key="main"
      className="smcell main"
      role="button"
      aria-disabled="true"
      title={titleOf("main")}
      aria-label={titleOf("main")}
    />,
  ]
  const ghost = (key: string) => (
    <span
      key={key}
      className="smcell ghost"
      title="新分支将插入此处"
      aria-hidden="true"
    >
      +
    </span>
  )
  const showGhost = preview.replaceId === null

  slots.forEach((slot, index) => {
    if (showGhost && preview.insertAt === index)
      cells.push(ghost(`ghost-${index}`))
    const title = titleOf(slot.id)
    const isSource = slot.id === sourceThreadId
    const willReplace = preview.replaceId === slot.id
    const willFold = preview.foldId === slot.id
    const caption = willReplace
      ? isSource
        ? "本列·替"
        : "将替换"
      : willFold
        ? isSource
          ? "本列·折"
          : "将折叠"
        : isSource
          ? "本列"
          : null
    const toggle = () => onToggleOverride(slot.id)
    cells.push(
      <span
        key={slot.id}
        className={`smcell${slot.folded ? "folded" : ""}${isSource ? "src" : ""}${
          willReplace ? "will-replace" : ""
        }${willFold ? "will-fold" : ""}${override === slot.id ? "ov" : ""}`}
        role="button"
        tabIndex={slot.folded ? -1 : 0}
        aria-disabled={slot.folded ? "true" : undefined}
        title={title}
        aria-label={title}
        onClick={slot.folded ? undefined : toggle}
        onKeyDown={
          slot.folded
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault()
                  toggle()
                }
              }
        }
      >
        {caption && <i className="cap">{caption}</i>}
      </span>
    )
  })
  if (showGhost && preview.insertAt === slots.length)
    cells.push(ghost("ghost-end"))

  return (
    <div
      className="slotmap"
      role="group"
      aria-label="新分支的放置目标（点小格指定让位列）"
    >
      {cells}
    </div>
  )
}
