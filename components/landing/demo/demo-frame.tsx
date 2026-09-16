"use client"

/**
 * demo/demo-frame —— ThreadChat 工作台的高保真复刻外壳：
 * 仿制顶栏（brand / 会话树计数）+ 横向分栏 + 模拟光标。
 */

import { ListTree, MessageSquarePlus } from "lucide-react"
import {
  useEffect,
  useRef,
  type ReactElement,
} from "react"

import { childrenOf, type DemoScenario } from "@/constants/landing-demo"

import { ArtifactPicker } from "./artifact-picker"
import { DemoColumnView } from "./demo-column"
import { DemoCursor } from "./demo-cursor"
import type { DemoView } from "./use-demo-player"

interface Props {
  scenario: DemoScenario
  view: DemoView
  revealChars: number
  stepIndex: number
  onAnchor: (anchorId: string) => void
  onCloseColumn: (columnId: string) => void
  onSwitchColumn: (columnId: string) => void
  onPick: Parameters<typeof ArtifactPicker>[0]["onPick"]
  onClosePicker: () => void
}

export function DemoFrame({
  scenario,
  view,
  revealChars,
  stepIndex,
  onAnchor,
  onCloseColumn,
  onSwitchColumn,
  onPick,
  onClosePicker,
}: Props): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)

  /* 新列展开 / 回到主线：移动端把目标列滚进视野（滚动限制在演示容器内）。 */
  useEffect(() => {
    const el = colsRef.current
    if (!el || !view.scrollTo) return
    el.scrollTo({
      left: view.scrollTo === "end" ? el.scrollWidth : 0,
      behavior: "smooth",
    })
  }, [stepIndex, view.scrollTo])

  /* 子树按钮：子分支已展开则滚过去，未展开则走锚点展开流程。 */
  const handleOpenChild = (columnId: string) => {
    const child = childrenOf(scenario, columnId)[0]
    if (!child) return
    if (view.columnIds.includes(child.id)) {
      colsRef.current
        ?.querySelector(`[data-column="${child.id}"]`)
        ?.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" })
    } else if (child.sourceAnchor) {
      onAnchor(child.sourceAnchor)
    }
  }

  return (
    <div className="ld" ref={rootRef}>
      <div className="topbar">
        <span className="tbtn" aria-hidden>
          <MessageSquarePlus size={13} />
          新对话
        </span>
        <span className="brand">
          <span className="mark">
            Thread <em>Chat</em>
          </span>
        </span>
        <span className="spacer" />
        <span className="tbtn" aria-hidden>
          <ListTree size={13} />
          会话树<span className="cnt">{view.columnIds.length}</span>
        </span>
        <span className="seg" aria-hidden>
          <span className="seg-btn on">列</span>
          <span className="seg-btn">画布</span>
        </span>
      </div>
      <div className="cols" ref={colsRef}>
        {view.columnIds.map((id) => {
          const column = scenario.columns.find((c) => c.id === id)
          if (!column) return null
          return (
            <DemoColumnView
              key={id}
              scenario={scenario}
              column={column}
              view={view}
              revealChars={revealChars}
              onAnchor={onAnchor}
              onCloseColumn={onCloseColumn}
              onSwitchColumn={onSwitchColumn}
              onOpenChild={handleOpenChild}
              onPick={onPick}
              onClosePicker={onClosePicker}
              composerRef={column.depth === 0 ? composerRef : undefined}
            />
          )
        })}
      </div>
      <DemoCursor rootRef={rootRef} target={view.cursor} />
    </div>
  )
}
