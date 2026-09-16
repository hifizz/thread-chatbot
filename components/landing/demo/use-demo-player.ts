"use client"

/**
 * demo/use-demo-player —— 剧本演示引擎。
 *
 * 状态完全由 (scenario, stepIndex, revealCount) 决定：
 *   - buildView 把 steps[0..k] 折叠成一份确定的分栏视图，因此「跳到任意章节」
 *     得到的是完整一致的画面，不依赖播放顺序；
 *   - 正在揭示的消息 / 输入框文本按 revealCount 截断；
 *   - playing 是派生值（可见 && 未暂停 && (自动播放 || 用户点过播放)），
 *     暂停只是停掉计时器，画面原样保留。
 */

import { useCallback, useEffect, useMemo, useState } from "react"

import {
  branchOfAnchor,
  findAnchor,
  findMessage,
  siblingsOf,
  messageTextLength,
  type DemoArtifact,
  type DemoScenario,
  type DemoStep,
} from "@/constants/landing-demo"

const DEFAULT_HOLD_MS = 900
const CHARS_PER_TICK = 3
const TICK_MS = 30

export interface DemoView {
  /** 当前可见列（按展开顺序） */
  columnIds: string[]
  /** 完整显示的消息 */
  shown: Set<string>
  /** 正在打字揭示的消息 */
  revealing?: string
  /** anchorId → 已分配脚注号 */
  footnotes: Record<string, number>
  /** 已提交划选的锚点（下划线 + 脚注 + 可点击） */
  selectedAnchors: Set<string>
  /** 正处于划选中的锚点（划选高亮，尚无脚注） */
  selectingAnchor?: string
  /** 当前步骤仍在逐字划选（revealChars 控制已选字数） */
  selectRevealing: boolean
  /** 划选气泡：划满后浮出，提交步骤仍保留，划选清除后消失 */
  bubble?: { anchorId: string; text: string; typing: boolean }
  /** 主线 composer 文本（完整目标值；渲染时按 revealChars 截断） */
  composerText: string
  /** composer 是否处于打字中 */
  composerTyping: boolean
  /** composer 里的 Artifact 胶囊 */
  capsule?: DemoArtifact
  /** 发送出去的用户消息应展示的胶囊（跟随实际 pick，可被手动选择覆盖） */
  sentCapsule?: DemoArtifact
  pickerOpen: boolean
  /** 模拟光标目标 */
  cursor?: string
  /** 列容器滚动意图（仅当前步骤读取一次） */
  scrollTo?: "start" | "end"
}

/** 步骤是否有「打字揭示」阶段。 */
function revealLenOf(scenario: DemoScenario, step: DemoStep): number {
  if (step.revealMessage) {
    const found = findMessage(scenario, step.revealMessage)
    return found ? messageTextLength(found.message) : 0
  }
  if (step.revealComposer) return step.revealComposer.length
  if (step.bubbleText) return step.bubbleText.length
  /* 纯划选步才按锚点字数逐字高亮；提交步（带 selectAnchor）立即生效 */
  if (step.selecting && !step.selectAnchor) {
    const found = findAnchor(scenario, step.selecting)
    return found ? found.text.length : 0
  }
  return 0
}

/**
 * 折叠 steps[0..stepIndex] 得到视图。
 * @param revealDone 当前步骤的揭示是否已完成（影响 sendComposer / openPicker 等「完成后生效」字段）
 */
export function buildView(
  scenario: DemoScenario,
  stepIndex: number,
  revealDone: boolean,
  pickedId?: string,
  pickerClosed?: boolean,
  closedColumns?: ReadonlySet<string>,
  swappedColumns?: ReadonlyMap<string, string>,
): DemoView {
  const view: DemoView = {
    columnIds: ["main"],
    shown: new Set(),
    footnotes: {},
    selectedAnchors: new Set(),
    selectRevealing: false,
    composerText: "",
    composerTyping: false,
    pickerOpen: false,
  }
  let fnote = 0
  const last = Math.min(stepIndex, scenario.steps.length - 1)
  let bubbleText = ""
  let bubbleTyping = false

  for (let i = 0; i <= last; i++) {
    const step = scenario.steps[i]
    const isCurrent = i === last
    const done = !isCurrent || revealDone

    if (step.addColumn && !view.columnIds.includes(step.addColumn))
      view.columnIds.push(step.addColumn)
    for (const id of step.showMessages ?? []) view.shown.add(id)
    if (step.revealMessage) {
      if (done) view.shown.add(step.revealMessage)
      else view.revealing = step.revealMessage
    }

    /* 划选状态：selecting 字段驱动，缺省即清除；逐字划选只在
       「纯划选」步骤进行（带 bubbleText 的步骤划选已完成，改在气泡里打字）。 */
    view.selectingAnchor = step.selecting
    view.selectRevealing = false
    if (
      step.selecting &&
      isCurrent &&
      !done &&
      !step.bubbleText &&
      !step.selectAnchor
    )
      view.selectRevealing = true
    if (step.bubbleText !== undefined) {
      bubbleText = step.bubbleText
      bubbleTyping = isCurrent && !done
    }
    if (step.selectAnchor) {
      if (!(step.selectAnchor in view.footnotes))
        view.footnotes[step.selectAnchor] = ++fnote
      view.selectedAnchors.add(step.selectAnchor)
    }

    if (step.cursor !== undefined)
      view.cursor = step.cursor === null ? undefined : step.cursor

    if (step.revealComposer) {
      view.composerText = step.revealComposer
      if (!done) view.composerTyping = true
    }
    if (step.pickArtifact) {
      view.capsule =
        scenario.pickerItems?.find((a) => a.id === pickedId) ??
        step.pickArtifact
      view.pickerOpen = false
    }
    if (done && step.openPicker && !pickerClosed) view.pickerOpen = true
    if (done && step.sendComposer) {
      view.sentCapsule = view.capsule
      view.shown.add(step.sendComposer)
      view.composerText = ""
      view.capsule = undefined
      view.composerTyping = false
    }
    if (isCurrent && step.scrollTo) view.scrollTo = step.scrollTo
  }

  /* 划满之后才浮出气泡；提交步（selecting 仍在）保留气泡，
     后续不带 selecting 的步骤把它清掉。 */
  if (view.selectingAnchor && !view.selectRevealing)
    view.bubble = {
      anchorId: view.selectingAnchor,
      text: bubbleText,
      typing: bubbleTyping,
    }
  if (closedColumns?.size)
    view.columnIds = view.columnIds.filter((id) => !closedColumns.has(id))
  /* 「⇄ 切换」：把列槽位换成兄弟分支；换进来的列按完整会话展示。 */
  if (swappedColumns?.size) {
    const swappedIn = new Set<string>()
    view.columnIds = view.columnIds.map((id) => {
      const to = swappedColumns.get(id)
      if (to) swappedIn.add(to)
      return to ?? id
    })
    view.columnIds = view.columnIds.filter(
      (id, i) => view.columnIds.indexOf(id) === i,
    )
    for (const to of swappedIn) {
      const col = scenario.columns.find((c) => c.id === to)
      for (const m of col?.messages ?? []) view.shown.add(m.id)
    }
  }
  return view
}

export interface DemoPlayer {
  stepIndex: number
  playing: boolean
  view: DemoView
  /** 当前步骤已揭示的字符数（revealing 目标用它截断渲染） */
  revealChars: number
  /** 当前步骤揭示进度 0..1 */
  progress: number
  play(): void
  pause(): void
  replay(): void
  jumpTo(step: number): void
  /** 点击锚点：停自动播放，直接展开对应分支的完整状态 */
  openAnchorBranch(anchorId: string): void
  /** 列头「收起」：手动关掉该列并暂停 */
  closeColumn(columnId: string): void
  /** 列头「⇄ 切换」：本列轮换到下一个兄弟分支并暂停 */
  switchColumn(columnId: string): void
  /** picker 打开期间的手动选择 */
  pickArtifact(artifact: DemoArtifact): void
  closePicker(): void
}

export function useDemoPlayer(
  scenario: DemoScenario,
  opts: { active: boolean; autoPlay: boolean; instantReveal?: boolean },
): DemoPlayer {
  const [stepIndex, setStepIndex] = useState(0)
  const [revealCount, setRevealCount] = useState(0)
  const [userPaused, setUserPaused] = useState(false)
  const [userStarted, setUserStarted] = useState(false)
  const [prevScenario, setPrevScenario] = useState(scenario.id)
  /** 手动在弹层里选过的 artifact（覆盖剧本默认 pick） */
  const [pickedId, setPickedId] = useState<string>()
  /** 手动 Esc 关闭过弹层 */
  const [pickerClosed, setPickerClosed] = useState(false)
  /** 手动收起的列 */
  const [closedCols, setClosedCols] = useState<ReadonlySet<string>>(new Set())
  /** 手动切换的列：槽位 id → 当前显示的兄弟列 id */
  const [swappedCols, setSwappedCols] = useState<ReadonlyMap<string, string>>(
    new Map(),
  )

  /* 场景切换在渲染期归零（React 认可的 adjust-state-during-render），
     避免 effect 里的同步 setState 造成二次渲染。 */
  if (prevScenario !== scenario.id) {
    setPrevScenario(scenario.id)
    setStepIndex(0)
    setRevealCount(0)
    setUserPaused(false)
    setUserStarted(false)
    setPickedId(undefined)
    setPickerClosed(false)
    setClosedCols(new Set())
    setSwappedCols(new Map())
  }

  const step = scenario.steps[Math.min(stepIndex, scenario.steps.length - 1)]
  const revealLen = opts.instantReveal ? 0 : revealLenOf(scenario, step)
  const revealDone = revealLen === 0 || revealCount >= revealLen
  const playing =
    opts.active && !userPaused && (opts.autoPlay || userStarted)

  const view = useMemo(
    () =>
      buildView(
        scenario,
        stepIndex,
        revealDone,
        pickedId,
        pickerClosed,
        closedCols,
        swappedCols,
      ),
    [
      scenario,
      stepIndex,
      revealDone,
      pickedId,
      pickerClosed,
      closedCols,
      swappedCols,
    ],
  )

  /* 主循环：揭示 → 停留 → 下一章。每个 effect 只清自己创建的计时器。 */
  useEffect(() => {
    if (!playing) return
    let cancelled = false

    if (!revealDone) {
      const id = window.setInterval(() => {
        if (cancelled) return
        setRevealCount((n) => Math.min(n + CHARS_PER_TICK, revealLen))
      }, TICK_MS)
      return () => {
        cancelled = true
        window.clearInterval(id)
      }
    }

    const id = window.setTimeout(
      () => {
        if (cancelled) return
        if (stepIndex >= scenario.steps.length - 1) setUserPaused(true)
        else {
          setStepIndex(stepIndex + 1)
          setRevealCount(0)
        }
      },
      step.holdMs ?? DEFAULT_HOLD_MS,
    )
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [playing, stepIndex, revealDone, revealLen, scenario, step.holdMs])

  const play = useCallback(() => {
    setUserPaused(false)
    setUserStarted(true)
  }, [])
  const pause = useCallback(() => setUserPaused(true), [])

  const jumpTo = useCallback((i: number) => {
    setStepIndex(i)
    setRevealCount(0)
    setUserPaused(false)
    setUserStarted(true)
    setPickedId(undefined)
    setPickerClosed(false)
    setClosedCols(new Set())
    setSwappedCols(new Map())
  }, [])

  const replay = useCallback(() => jumpTo(0), [jumpTo])

  /** 定格到某章的完整状态（锚点脚注、分支首问、揭示全部完成）。 */
  const settleAt = useCallback(
    (i: number) => {
      setUserPaused(true)
      setStepIndex(i)
      setRevealCount(revealLenOf(scenario, scenario.steps[i]))
    },
    [scenario],
  )

  const openAnchorBranch = useCallback(
    (anchorId: string) => {
      const branch = branchOfAnchor(scenario, anchorId)
      if (!branch) return
      const openIdx = scenario.steps.findIndex((s) => s.addColumn === branch.id)
      if (openIdx < 0) return
      setClosedCols((prev) => {
        if (!prev.has(branch.id)) return prev
        const next = new Set(prev)
        next.delete(branch.id)
        return next
      })
      settleAt(openIdx)
    },
    [scenario, settleAt],
  )

  const closeColumn = useCallback((columnId: string) => {
    if (columnId === "main") return
    setUserPaused(true)
    setClosedCols((prev) => new Set(prev).add(columnId))
  }, [])

  const switchColumn = useCallback(
    (columnId: string) => {
      const sibs = siblingsOf(scenario, columnId)
      if (!sibs.length) return
      setUserPaused(true)
      setSwappedCols((prev) => {
        const cur = prev.get(columnId) ?? columnId
        const idx = sibs.findIndex((s) => s.id === cur)
        const next = new Map(prev)
        next.set(columnId, sibs[(idx + 1) % sibs.length].id)
        return next
      })
    },
    [scenario],
  )

  const pickArtifact = useCallback(
    (artifact: DemoArtifact) => {
      const idx = scenario.steps.findIndex((s) => s.pickArtifact)
      if (idx < 0) return
      setPickedId(artifact.id)
      settleAt(idx)
    },
    [scenario, settleAt],
  )

  const closePicker = useCallback(() => {
    setPickerClosed(true)
    setUserPaused(true)
  }, [])

  return {
    stepIndex,
    playing,
    view,
    revealChars: revealCount,
    progress: revealLen === 0 ? 1 : revealCount / revealLen,
    play,
    pause,
    replay,
    jumpTo,
    openAnchorBranch,
    closeColumn,
    switchColumn,
    pickArtifact,
    closePicker,
  }
}
