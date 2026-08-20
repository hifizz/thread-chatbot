"use client"

import { useEffect, useRef, useState } from "react"
import type { ThreadStore } from "../../core/store"
import {
  normalizeForReplace,
  place,
  trimSlots,
  type PlaceEffect,
  type PlacementHint,
  type PlacementMode,
  type Slot,
} from "./placement"

export interface UseColumnSlotsArgs {
  store: ThreadStore
  /** 展开列上限（= 总列数 - 主线一列） */
  maxExpanded: number
  /** 列满策略：替换⑥ / 细条⑤ */
  mode: PlacementMode
  /** 可选初始槽位（工作台记忆恢复用，调用方已校验 threadId 存在性） */
  initialSlots?: Slot[]
  /** 可选初始列宽映射；不传 = 全部自动均分 */
  initialWidths?: Record<string, number>
}

/** 从宽度映射里删掉若干条目；全都不存在时保留原引用。 */
function omitWidths(
  widths: Record<string, number>,
  ids: readonly string[]
): Record<string, number> {
  if (!ids.some((id) => widths[id] !== undefined)) return widths
  return Object.fromEntries(
    Object.entries(widths).filter(([id]) => !ids.includes(id))
  )
}

/** 列槽、显式列宽与放置策略组成的视口状态能力。 */
export function useColumnSlots({
  store,
  maxExpanded,
  mode,
  initialSlots,
  initialWidths,
}: UseColumnSlotsArgs) {
  const [slots, setSlots] = useState<Slot[]>(initialSlots ?? [])
  /** 显式列宽（px，threadId → width）：有值的列以 flex-basis 承载宽度，无值 = 自动均分。
      拖拽/键盘 commit 以整行为单位落条目（fill 模型下 basis 总和==容器才无跳动），
      双击复位删除整行条目。条目跟随「槽位空间」走：替换/原地切换会话时转移给新 id；
      收起/裁掉清条目；fold/unfold 保留条目（细条固定 30px 不参与）。 */
  const [widths, setWidths] = useState<Record<string, number>>(
    initialWidths ?? {}
  )
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null)
  const flashSequence = useRef(0)
  const colsRef = useRef<HTMLDivElement | null>(null)

  // 窗口变窄 / 强制列数调小时：从左裁掉最早的槽（细条一并参与，见 trimSlots）。
  // 这是 React 官方的「渲染期间调整派生状态」写法：条件自熄，比 effect 少一轮往返。
  const effectiveSlots = trimSlots(slots, maxExpanded)
  if (effectiveSlots.length !== slots.length) {
    setSlots(effectiveSlots)
    const kept = new Set(effectiveSlots.map((slot) => slot.id))
    const dropped = slots
      .filter((slot) => !kept.has(slot.id))
      .map((slot) => slot.id)
    if (dropped.length) setWidths((current) => omitWidths(current, dropped))
  }

  /** 闪烁提示某列（并滚动到可视区）。 */
  const flashThread = (id: string) =>
    setFlash({ id, n: ++flashSequence.current })

  useEffect(() => {
    if (!flash) return
    const element = colsRef.current?.querySelector(
      `.column[data-thread-id="${flash.id}"]`
    )
    element?.scrollIntoView({
      inline: "nearest",
      block: "nearest",
      behavior: "smooth",
    })
    const timer = setTimeout(() => setFlash(null), 950)
    return () => clearTimeout(timer)
  }, [flash])

  /** 统一放置入口；返回发生的替换/折叠副作用供上层提示。 */
  function openThread(
    id: string,
    sourceId: string | null,
    hint?: PlacementHint
  ): PlaceEffect {
    store.touch(id)
    const state = store.getState()
    const { slots: next, effect } = place(mode, effectiveSlots, id, {
      sourceId,
      maxExpanded,
      lastActiveOf: (threadId) => state.threads[threadId]?.lastActive ?? 0,
      hint,
    })
    setSlots(next)
    if (effect.kind === "replaced") {
      setWidths((current) => {
        const inherited = current[effect.replacedId]
        const rest = omitWidths(current, [effect.replacedId, id])
        return inherited !== undefined ? { ...rest, [id]: inherited } : rest
      })
    }
    flashThread(id)
    return effect
  }

  /** 列内导航：面包屑 = collapse（收起重复列）；切换器 = swap（交换两列）。 */
  function navColumn(
    viewportIndex: number,
    targetId: string,
    duplicate: "collapse" | "swap" = "collapse"
  ) {
    const next = effectiveSlots.map((slot) => ({ ...slot }))
    const fromId = next[viewportIndex].id
    if (targetId === "main") {
      next.splice(viewportIndex, 1)
      setSlots(next)
      setWidths((current) => omitWidths(current, [fromId]))
      flashThread("main")
      return
    }
    store.touch(targetId)
    const other = next.findIndex((slot) => slot.id === targetId)
    if (other >= 0 && other !== viewportIndex) {
      if (duplicate === "swap") {
        const otherId = next[other].id
        next[other].id = next[viewportIndex].id
        next[viewportIndex].id = otherId
        setWidths((current) => {
          const fromWidth = current[fromId]
          const targetWidth = current[targetId]
          if (fromWidth === undefined && targetWidth === undefined)
            return current
          return {
            ...omitWidths(current, [fromId, targetId]),
            ...(fromWidth !== undefined ? { [targetId]: fromWidth } : null),
            ...(targetWidth !== undefined ? { [fromId]: targetWidth } : null),
          }
        })
      } else {
        next[other].folded = false
        next.splice(viewportIndex, 1)
        setWidths((current) => omitWidths(current, [fromId]))
      }
    } else {
      next[viewportIndex].id = targetId
      if (fromId !== targetId) {
        setWidths((current) => {
          const fromWidth = current[fromId]
          const rest = omitWidths(current, [fromId, targetId])
          return fromWidth !== undefined
            ? { ...rest, [targetId]: fromWidth }
            : rest
        })
      }
    }
    setSlots(next)
    flashThread(targetId)
  }

  function closeColumn(viewportIndex: number) {
    const next = effectiveSlots.map((slot) => ({ ...slot }))
    const removed = next.splice(viewportIndex, 1)
    setSlots(next)
    if (removed.length)
      setWidths((current) =>
        omitWidths(
          current,
          removed.map((slot) => slot.id)
        )
      )
  }

  /** 撤销 replace 策略：整体恢复替换前的槽位。 */
  function restoreSlots(previous: Slot[]) {
    setSlots(previous)
  }

  /** fold → replace：细条全部展开，从左裁掉超限列。 */
  function normalizeToReplace(): string[] {
    const { slots: next, dropped } = normalizeForReplace(
      effectiveSlots,
      maxExpanded
    )
    setSlots(next)
    if (dropped.length) setWidths((current) => omitWidths(current, dropped))
    return dropped
  }

  function commitWidths(patch: Record<string, number>) {
    setWidths((current) => ({ ...current, ...patch }))
  }

  function resetWidths(ids: string[]) {
    setWidths((current) => omitWidths(current, ids))
  }

  return {
    slots: effectiveSlots,
    widths,
    flashId: flash?.id ?? null,
    colsRef,
    openThread,
    navColumn,
    closeColumn,
    restoreSlots,
    flashThread,
    normalizeToReplace,
    commitWidths,
    resetWidths,
  }
}
