/**
 * smooth-text —— 本地复刻 assistant-ui 的 TextStreamAnimator 流式打字平滑。
 *
 * 目标：store 里的 assistant 正文按网络 chunk 节奏「大块跳变」增长，直接渲染会一顿一顿；
 * 这里用一个 rAF 逐字揭示的 animator，让显示文本平滑地「追赶」目标文本，得到打字机效果。
 *
 * 算法（照搬 assistant-ui，常量一致）：
 *   - targetText：外部传入的完整文本（随流式增长）；currentText：当前已显示的文本。
 *   - 每帧：remainingChars = targetText.length - currentText.length；
 *     baseTimePerChar = min(MAX_CHAR_INTERVAL_MS, DRAIN_MS / remainingChars)；
 *     charsToAdd = min(floor(本帧耗时 / baseTimePerChar), remainingChars)（无每帧上限，即 Infinity）；
 *     currentText = targetText.slice(0, currentText.length + charsToAdd)，emit 通知重渲。
 *     揭示到追平（remainingChars<=0）时停 rAF，等待下一次 target 变化再重启。
 *
 * 工程约束（对齐本仓库 core/store 的做法，规避新版 react-hooks 规则）：
 *   animator 不是 class 实例、也不把可变字段放在 useState 返回值上，而是一个「闭包 + 订阅」的
 *   外部可变对象（createTextStreamAnimator）——所有 mutation 收敛在闭包内的非 React 代码里，
 *   React 侧用 useSyncExternalStore 订阅，永不在 effect 里直接 setState，也就不会触发
 *   react-hooks/immutability、react-hooks/set-state-in-effect、react-hooks/refs 这些规则。
 */

import { useEffect, useState, useSyncExternalStore } from "react"

/** 追平剩余文本的目标总时长预算（毫秒）：剩得越多，每字给的时间越短（追得越快） */
const DRAIN_MS = 250
/** 每字最长间隔（毫秒）：剩余不多时也不至于慢到一字一字磨蹭 */
const MAX_CHAR_INTERVAL_MS = 5

type TextStreamAnimator = ReturnType<typeof createTextStreamAnimator>

/**
 * 创建一个流式打字 animator（外部可变、可订阅；对象身份稳定，字段在闭包里原地变更）。
 * @param initial 初始完整文本（首渲 / SSR 快照即为它）
 */
function createTextStreamAnimator(initial: string) {
  let targetText = initial
  let currentText = initial
  let frameId: number | null = null
  let lastTime = 0
  const listeners = new Set<() => void>()

  const emit = () => listeners.forEach((fn) => fn())

  const animate = () => {
    const now = performance.now()
    const deltaTime = now - lastTime

    const remainingChars = targetText.length - currentText.length
    if (remainingChars <= 0) {
      // 追平：停循环，等下一次 target 变化再由 start() 重启
      frameId = null
      return
    }

    const baseTimePerChar = Math.min(
      MAX_CHAR_INTERVAL_MS,
      DRAIN_MS / remainingChars
    )
    const charsToAdd = Math.min(
      Math.floor(deltaTime / baseTimePerChar),
      remainingChars
    )

    if (charsToAdd > 0) {
      currentText = targetText.slice(0, currentText.length + charsToAdd)
      lastTime = now
      emit()
    }

    frameId = requestAnimationFrame(animate)
  }

  const start = () => {
    if (frameId !== null) return
    lastTime = performance.now()
    frameId = requestAnimationFrame(animate)
  }

  const stop = () => {
    if (frameId === null) return
    cancelAnimationFrame(frameId)
    frameId = null
  }

  return {
    subscribe(fn: () => void) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    getSnapshot: () => currentText,

    /**
     * 推入新的目标文本与激活态。
     * @param text 最新完整目标文本
     * @param active true=流式中，跑动画追赶；false=完成，直接 snap 到完整 text（不留半截）
     */
    setTarget(text: string, active: boolean) {
      if (!active) {
        stop()
        targetText = text
        if (currentText !== text) {
          currentText = text
          emit()
        }
        return
      }
      // 流式中：新 target 不是当前已显示文本的前缀（如重试清空重来）→ 归零重来
      if (!text.startsWith(currentText)) {
        currentText = ""
        emit()
      }
      targetText = text
      start()
    },

    stop,
  }
}

/**
 * 平滑显示随流式增长的文本。
 * @param target 完整目标文本（流式期间不断增长）
 * @param active 是否处于流式中（true=跑动画追赶；false=完成，直接 snap 到完整 target）
 * @returns 当前该显示的文本
 */
export function useSmoothText(target: string, active: boolean): string {
  const [animator] = useState<TextStreamAnimator>(() =>
    createTextStreamAnimator(target)
  )

  // 订阅 animator 的内部真源（currentText）——外部系统驱动重渲，React 侧不 setState
  const displayed = useSyncExternalStore(
    animator.subscribe,
    animator.getSnapshot,
    animator.getSnapshot
  )

  // 把最新 target/active 推给外部系统（animator）——只调方法，不在 effect 里 setState / 改 useState 值
  useEffect(() => {
    animator.setTarget(target, active)
  }, [animator, target, active])

  // 卸载停 rAF，避免泄漏
  useEffect(() => () => animator.stop(), [animator])

  return displayed
}
