"use client"

/**
 * scenario-demo —— 首页演示区：五类场景标签（专题学习含两个子标签）共用一个
 * ThreadChat 高保真演示窗口；播放/暂停/重播/章节跳转由 useDemoPlayer 驱动。
 */

import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react"

import {
  DEMO_SCENARIOS,
  DEMO_TABS,
  type ScenarioId,
} from "@/constants/landing-demo"

import { ChapterStepper } from "./demo/chapter-stepper"
import { DemoFrame } from "./demo/demo-frame"
import { useDemoPlayer } from "./demo/use-demo-player"

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
      mq.addEventListener("change", cb)
      return () => mq.removeEventListener("change", cb)
    },
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => false,
  )
}

export function ScenarioDemo(): ReactElement {
  const [tab, setTab] = useState(DEMO_TABS[0].tab)
  const [subId, setSubId] = useState<ScenarioId>("learn-ai")
  const [inView, setInView] = useState(false)
  const reduced = usePrefersReducedMotion()
  const rootRef = useRef<HTMLDivElement>(null)

  const group = DEMO_TABS.find((t) => t.tab === tab)!
  const scenarioId: ScenarioId =
    group.scenarios.length > 1 ? subId : group.scenarios[0]
  const scenario = DEMO_SCENARIOS.find((s) => s.id === scenarioId)!

  /* 进入视口才自动播放；滚出即暂停。 */
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.intersectionRatio >= 0.35),
      { threshold: [0, 0.35, 1] },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const player = useDemoPlayer(scenario, {
    active: inView,
    autoPlay: !reduced,
    instantReveal: reduced,
  })

  const switchTab = (next: string) => {
    if (next === tab) return
    setTab(next)
    const g = DEMO_TABS.find((t) => t.tab === next)!
    if (g.scenarios.length === 1) setSubId(g.scenarios[0])
    else if (!g.scenarios.includes(subId)) setSubId(g.scenarios[0])
  }

  return (
    <div ref={rootRef}>
      <div className="ld-tabs" role="tablist" aria-label="场景">
        {DEMO_TABS.map((t) => (
          <button
            key={t.tab}
            type="button"
            role="tab"
            aria-selected={t.tab === tab}
            className={`ld-tab${t.tab === tab ? " on" : ""}`}
            onClick={() => switchTab(t.tab)}
          >
            {t.tab}
          </button>
        ))}
      </div>
      {group.scenarios.length > 1 && (
        <div className="ld-tabs sub" role="tablist" aria-label="学习主题">
          {group.scenarios.map((id) => {
            const s = DEMO_SCENARIOS.find((x) => x.id === id)!
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={scenarioId === id}
                className={`ld-tab${scenarioId === id ? " on" : ""}`}
                onClick={() => setSubId(id)}
              >
                {s.subTab}
              </button>
            )
          })}
        </div>
      )}
      <p className="ld-desc">{scenario.description}</p>

      <ChapterStepper
        steps={scenario.steps}
        stepIndex={player.stepIndex}
        playing={player.playing}
        progress={player.progress}
        onPlay={player.play}
        onPause={player.pause}
        onReplay={player.replay}
        onJump={player.jumpTo}
      />

      <DemoFrame
        scenario={scenario}
        view={player.view}
        revealChars={player.revealChars}
        stepIndex={player.stepIndex}
        onAnchor={player.openAnchorBranch}
        onPick={player.pickArtifact}
        onClosePicker={player.closePicker}
      />

      <p className="ld-takeaway">{scenario.takeaway}</p>
    </div>
  )
}
