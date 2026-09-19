"use client"

/**
 * demo/demo-frame —— ThreadChat 工作台的高保真复刻外壳：
 * 仿制顶栏（brand / 会话树计数）+ 横向分栏 + 模拟光标 + 划选气泡。
 * 气泡与手动划选状态都收在这一层：剧本文本可以真实拖选，
 * 选完浮出提问气泡，提交才在父列右侧开出新 thread。
 */

import { ListTree, MessageSquarePlus } from "lucide-react"
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react"

import {
  branchOfAnchor,
  childrenOfColumns,
  findAnchor,
  type DemoColumn,
  type DemoScenario,
} from "@/constants/landing-demo"

import { ArtifactPicker } from "./artifact-picker"
import { DemoColumnView } from "./demo-column"
import { DemoCursor } from "./demo-cursor"
import { DemoSelBubble, SEL_BUBBLE_H, SEL_BUBBLE_W } from "./demo-sel-bubble"
import type { DemoView } from "./use-demo-player"

const PAD = 8

export interface ManualBranchOpts {
  quote: string
  question: string
  parentId?: string
}

interface ManualSel {
  text: string
  x: number
  y: number
  parentId?: string
}

interface Props {
  scenario: DemoScenario
  view: DemoView
  revealChars: number
  stepIndex: number
  /** 手动划选开出的列（与剧本列合并渲染） */
  manualColumns: readonly DemoColumn[]
  /** 点击已提交锚点 / 剧本气泡原样提交 */
  onAnchor: (anchorId: string) => void
  /** 手动划选提交（或剧本气泡被改写后提交）：开用户自己的分支 */
  onManualBranch: (opts: ManualBranchOpts) => void
  /** 用户手动划选：暂停播放并压住剧本气泡 */
  onUserInteract: () => void
  /** 剧本气泡输入框被聚焦/改写：只暂停，气泡保留 */
  onBubbleFocus: () => void
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
  manualColumns,
  onAnchor,
  onManualBranch,
  onUserInteract,
  onBubbleFocus,
  onCloseColumn,
  onSwitchColumn,
  onPick,
  onClosePicker,
}: Props): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null)
  const colsRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)

  /* 用户手动划选的状态：选区文本 + 气泡落点 + 所在列 */
  const [manualSel, setManualSel] = useState<ManualSel | null>(null)
  const [manualQ, setManualQ] = useState("")
  /* 剧本气泡被用户改写过的文本（null = 仍是剧本原文） */
  const [bubbleEdit, setBubbleEdit] = useState<string | null>(null)

  const allColumns = useMemo(
    () => [...scenario.columns, ...manualColumns],
    [scenario, manualColumns],
  )

  /* 章节推进 / 场景切换时清掉手动气泡与改写残留（渲染期调整状态） */
  const navKey = `${scenario.id}:${stepIndex}`
  const [prevNavKey, setPrevNavKey] = useState(navKey)
  if (prevNavKey !== navKey) {
    setPrevNavKey(navKey)
    setManualSel(null)
    setBubbleEdit(null)
  }

  /* 新列展开 / 回到主线：移动端把目标列滚进视野（滚动限制在演示容器内）。
     列数变化也触发：开列延迟到点后，目标列才挂载。 */
  useEffect(() => {
    const el = colsRef.current
    if (!el || !view.scrollTo) return
    el.scrollTo({
      left: view.scrollTo === "end" ? el.scrollWidth : 0,
      behavior: "smooth",
    })
  }, [stepIndex, view.scrollTo, view.columnIds.length])

  /* 真实文本划选：在消息内拖选 → 浮出提问气泡；点气泡外则关掉。 */
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onMouseUp = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed) return
      const text = sel.toString().trim()
      if (!text) return
      const anchorNode = sel.anchorNode
      const el =
        anchorNode?.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as Element)
          : anchorNode?.parentElement
      const msgEl = el?.closest(".message")
      if (!msgEl || !root.contains(msgEl)) return
      const colEl = el?.closest("[data-column]")
      const rr = root.getBoundingClientRect()
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      let y = rect.bottom - rr.top + PAD
      if (y + SEL_BUBBLE_H > rr.height - PAD)
        y = rect.top - rr.top - SEL_BUBBLE_H - PAD
      onUserInteract()
      setManualQ("")
      setManualSel({
        text,
        x: Math.max(
          PAD,
          Math.min(rect.left - rr.left, rr.width - SEL_BUBBLE_W - PAD),
        ),
        y,
        parentId: colEl?.getAttribute("data-column") ?? undefined,
      })
    }
    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".sel-bubble")) return
      setManualSel(null)
    }
    root.addEventListener("mouseup", onMouseUp)
    root.addEventListener("mousedown", onMouseDown)
    return () => {
      root.removeEventListener("mouseup", onMouseUp)
      root.removeEventListener("mousedown", onMouseDown)
    }
  }, [onUserInteract])

  /* 锚点：分支列已展开就滚过去；未展开交给播放器（开列/恢复，不弹气泡）。 */
  const handleAnchor = (anchorId: string) => {
    const branch = branchOfAnchor(scenario, anchorId)
    if (branch && view.columnIds.includes(branch.id)) {
      colsRef.current
        ?.querySelector(`[data-column="${branch.id}"]`)
        ?.scrollIntoView({
          behavior: "smooth",
          inline: "nearest",
          block: "nearest",
        })
    }
    onAnchor(anchorId)
  }

  /* 子树按钮：子分支已展开则滚过去，未展开则走锚点展开流程。 */
  const handleOpenChild = (columnId: string) => {
    const child = childrenOfColumns(allColumns, columnId)[0]
    if (!child) return
    if (view.columnIds.includes(child.id)) {
      colsRef.current
        ?.querySelector(`[data-column="${child.id}"]`)
        ?.scrollIntoView({
          behavior: "smooth",
          inline: "nearest",
          block: "nearest",
        })
    } else if (child.sourceAnchor) {
      handleAnchor(child.sourceAnchor)
    }
  }

  const submitManual = (opts: ManualBranchOpts) => {
    onManualBranch(opts)
    setManualSel(null)
    window.getSelection()?.removeAllRanges()
    requestAnimationFrame(() => {
      const el = colsRef.current
      if (el) el.scrollTo({ left: el.scrollWidth, behavior: "smooth" })
    })
  }

  const scriptedBubble = view.bubble
  const scriptedAnchor = scriptedBubble
    ? findAnchor(scenario, scriptedBubble.anchorId)
    : undefined

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
          const column = allColumns.find((c) => c.id === id)
          if (!column) return null
          return (
            <DemoColumnView
              key={id}
              scenario={scenario}
              column={column}
              allColumns={allColumns}
              view={view}
              revealChars={revealChars}
              onAnchor={handleAnchor}
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
      {scriptedBubble && (
        <DemoSelBubble
          quote={scriptedAnchor?.text ?? ""}
          value={
            bubbleEdit ??
            (scriptedBubble.typing
              ? scriptedBubble.text.slice(0, revealChars)
              : scriptedBubble.text)
          }
          editable
          anchorId={scriptedBubble.anchorId}
          rootRef={rootRef}
          onFocusEdit={onBubbleFocus}
          onChange={(v) => {
            onBubbleFocus()
            setBubbleEdit(v)
          }}
          onSubmit={() => {
            if (bubbleEdit !== null) {
              submitManual({
                quote: scriptedAnchor?.text ?? "",
                question: bubbleEdit,
                parentId: scriptedAnchor?.columnId,
              })
              setBubbleEdit(null)
            } else {
              handleAnchor(scriptedBubble.anchorId)
            }
          }}
        />
      )}
      {manualSel && (
        <DemoSelBubble
          key={`${manualSel.x}-${manualSel.y}-${manualSel.text}`}
          quote={manualSel.text}
          value={manualQ}
          editable
          autoFocus
          fixedPos={{ x: manualSel.x, y: manualSel.y }}
          rootRef={rootRef}
          onChange={setManualQ}
          onDismiss={() => setManualSel(null)}
          onSubmit={() =>
            submitManual({
              quote: manualSel.text,
              question: manualQ,
              parentId: manualSel.parentId,
            })
          }
        />
      )}
      <DemoCursor rootRef={rootRef} target={view.cursor} />
    </div>
  )
}
