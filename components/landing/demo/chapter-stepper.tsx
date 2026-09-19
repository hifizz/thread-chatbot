"use client"

/**
 * demo/chapter-stepper —— 剧本演示控制条：播放/暂停（最左）、章节步进器（点击跳转）、
 * 重播、当前章节指示。
 */

import { Pause, Play, RotateCcw } from "lucide-react"
import type { ReactElement } from "react"

interface Props {
  steps: { id: string; label: string }[]
  stepIndex: number
  playing: boolean
  onPlay(): void
  onPause(): void
  onReplay(): void
  onJump(i: number): void
}

export function ChapterStepper({
  steps,
  stepIndex,
  playing,
  onPlay,
  onPause,
  onReplay,
  onJump,
}: Props): ReactElement {
  return (
    <div className="ld-controls" role="group" aria-label="剧本演示">
      <span className="ld-controls-label">剧本演示</span>
      <button
        type="button"
        className="ld-ctl-btn primary"
        onClick={playing ? onPause : onPlay}
        aria-label={playing ? "暂停" : "播放"}
      >
        {playing ? <Pause size={14} /> : <Play size={14} />}
      </button>
      <div className="ld-steps" role="tablist" aria-label="章节">
        {steps.map((s, i) => {
          const status =
            i < stepIndex ? "done" : i === stepIndex ? "active" : "upcoming"
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={status === "active"}
              className={`ld-step ${status}`}
              onClick={() => onJump(i)}
            >
              <span className="ld-step-dot">{i + 1}</span>
              <span className="ld-step-label">{s.label}</span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        className="ld-ctl-btn"
        onClick={onReplay}
        aria-label="重播"
      >
        <RotateCcw size={13} />
      </button>
      <span className="ld-step-count" aria-hidden>
        {stepIndex + 1}/{steps.length}
      </span>
    </div>
  )
}
