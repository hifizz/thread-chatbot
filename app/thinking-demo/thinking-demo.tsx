"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { ArrowDown, ArrowUpRight, BookOpen, Check, ChevronDown, ChevronRight, CirclePause, FlaskConical, Globe, LoaderCircle, Moon, Pause, Play, RotateCcw, Sparkles, Square, Sun, X, Search } from "lucide-react"
import { DEMO_ANSWER_MS, DEMO_SCENARIOS, DEMO_SOURCES, DEMO_TICK_MS, type DemoMode, type DemoSource, type DemoStep } from "@/constants/thinking-demo"

function ToolCard({ step, complete, failed, running, stopped, onSource, onRetry }: {
  step: DemoStep; complete: boolean; failed: boolean; running: boolean; stopped: boolean
  onSource: (source: DemoSource) => void; onRetry: () => void
}) {
  const [open, setOpen] = useState(true)
  const tool = step.tool!
  return <div className={`td-tool ${failed ? "td-failed" : ""}`}>
    <button className="td-tool-heading" aria-expanded={open} onClick={() => setOpen(!open)}>
      {tool.kind === "search" ? <Search size={14} /> : <BookOpen size={14} />}<span>{tool.kind === "search" ? "搜索网页" : "读取网页"}</span>
      <span className="td-tool-status">{complete ? "已完成" : stopped ? "已停止" : failed ? "连接超时" : running ? "进行中" : "已暂停"}</span>
      {complete ? <Check size={14} /> : running && !failed ? <LoaderCircle size={14} className="td-spin" /> : null}<ChevronDown size={14} className={open ? "td-rotated" : ""} />
    </button>
    {open && <div className="td-tool-body"><p className="td-query">{tool.input}</p>
      {complete && <div className="td-source-chips">{tool.sourceIds.map((id) => <button key={id} onClick={() => onSource(DEMO_SOURCES[id])}><Globe size={12} />{DEMO_SOURCES[id].title}<ArrowUpRight size={12} /></button>)}</div>}
      {failed && <div className="td-error">此次请求未完成，已保留前面的研究进度。<button disabled={stopped} onClick={onRetry}>重试此步骤</button></div>}
    </div>}
  </div>
}

// 受控时间线改编自 Beautiful UI ThinkingState；定时器只用于此演示。
function DemoSession({ mode }: { mode: DemoMode }) {
  const scenario = DEMO_SCENARIOS[mode]
  const messageArea = useRef<HTMLDivElement>(null)
  const [following, setFollowing] = useState(true)
  const [elapsed, setElapsed] = useState(0)
  const [playback, setPlayback] = useState<"playing" | "paused" | "stopped">("playing")
  const [speed, setSpeed] = useState(1)
  const [manualExpanded, setManualExpanded] = useState<boolean | null>(null)
  const [source, setSource] = useState<DemoSource | null>(null)
  const [failNextTool, setFailNextTool] = useState(false)
  const traceDuration = scenario.steps.reduce((sum, step) => sum + step.duration, 0)
  const totalDuration = traceDuration + DEMO_ANSWER_MS
  const done = elapsed >= totalDuration
  const answering = elapsed >= traceDuration
  const expanded = manualExpanded ?? !answering
  const steps = scenario.steps.map((step, index) => {
    const start = scenario.steps.slice(0, index).reduce((sum, previous) => sum + previous.duration, 0)
    return { ...step, start, end: start + step.duration }
  })
  const current = steps.find((step) => elapsed < step.end)
  const failed = Boolean(failNextTool && current?.tool && elapsed >= current.start + current.duration / 2)
  const playing = playback === "playing" && !failed && !done
  const completed = steps.filter((step) => elapsed >= step.end)
  const sourceIds = [...new Set(completed.flatMap((step) => step.tool?.sourceIds ?? []))]
  const toolCount = completed.filter((step) => step.tool).length
  const status = done ? "任务已完成" : playback === "stopped" ? "已停止，保留已有进度" : failed ? "请求遇到问题，等待重试" : playback === "paused" ? "演示已暂停" : answering ? "正在整理回答" : current?.title ?? "准备中"

  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setElapsed((value) => Math.min(value + DEMO_TICK_MS * speed, totalDuration)), DEMO_TICK_MS)
    return () => window.clearInterval(timer)
  }, [playing, speed, totalDuration])

  useEffect(() => {
    if (following && messageArea.current) {
      messageArea.current.scrollTop = messageArea.current.scrollHeight
    }
  }, [elapsed, following, expanded])

  function restart() {
    setElapsed(0); setPlayback("playing"); setManualExpanded(null); setSource(null); setFailNextTool(false); setFollowing(true)
  }

  return <>
    <div className="td-workspace">
      <section className="td-conversation" aria-label="对话演示">
        <div className="td-conversation-top"><span><span className="td-live-dot" />交互预览</span><span>示例数据 · 不调用模型</span></div>
        <div className="td-message-area" ref={messageArea} onScroll={(event) => {
          const area = event.currentTarget
          setFollowing(area.scrollHeight - area.scrollTop - area.clientHeight < 64)
        }}>
          <div className="td-user"><span className="td-user-label">你</span><p>{scenario.prompt}</p></div>
          <div className="td-assistant"><span className="td-avatar"><Sparkles size={18} /></span><div className="td-assistant-content">
            <div className="td-assistant-name">Thread <span>研究助手</span></div>
            <p className="td-intro">{mode === "research" ? "我会先拆解问题、查阅资料，再复核遗漏，整理成可落地的建议。" : mode === "search" ? "我会检索相关资料，核对来源后再整理回答。" : "我会从信息反馈与用户控制两个角度梳理这个问题。"}</p>
            <div className="td-trace" data-playing={playing}>
              <button className="td-trace-toggle" aria-expanded={expanded} aria-controls="thinking-trace" onClick={() => setManualExpanded(!expanded)}>
                {playing ? <LoaderCircle size={16} className="td-spin" /> : done ? <Check size={16} /> : <CirclePause size={16} />}
                <span className={playing ? "td-shimmer" : ""}>{status}</span><span className="td-elapsed">{(elapsed / 1000).toFixed(1)} 秒</span><ChevronDown size={14} className={expanded ? "td-rotated" : ""} />
              </button>
              <div role="status" className="td-sr-only">{status}</div>
              <div id="thinking-trace" className="td-trace-expand" data-expanded={expanded} inert={!expanded}>
                <div className="td-trace-clip"><ol className="td-timeline">
                  {steps.filter((step) => elapsed >= step.start).map((step) => {
                    const complete = elapsed >= step.end
                    const active = !complete
                    return <li key={step.title} className={active ? "td-step-active" : ""}>
                      <span className="td-step-dot">{complete ? <Check size={12} /> : <span />}</span>
                      <div className="td-step-title">{step.title}<span>{complete ? "已完成" : playback === "stopped" ? "已停止" : failed ? "待重试" : playing ? "进行中" : "已暂停"}</span></div>
                      <p>{step.summary.slice(0, complete ? undefined : Math.max(1, Math.floor((elapsed - step.start) / (step.duration * .55) * step.summary.length)))}</p>
                      {step.tool && <ToolCard step={step} complete={complete} failed={active && failed} running={active && playing} stopped={playback === "stopped"} onSource={setSource} onRetry={() => { setFailNextTool(false); setPlayback("playing") }} />}
                    </li>
                  })}
                </ol></div>
              </div>
              {answering && <div className="td-trace-summary">{completed.length} 个步骤{toolCount > 0 ? ` · ${toolCount} 次工具调用 · ${sourceIds.length} 个来源` : " · 推理摘要"}</div>}
            </div>
            {answering && <article className="td-answer" aria-label="演示回答"><div className="td-answer-label"><Sparkles size={13} />{done ? "回答已完成" : "正在生成回答"}</div>{scenario.answer.slice(0, Math.floor(Math.min(1, (elapsed - traceDuration) / DEMO_ANSWER_MS) * scenario.answer.length)).split("\n\n").map((paragraph, i) => <p key={i}>{paragraph}</p>)}{!done && <span className="td-caret" />}</article>}
          </div></div>
        </div>
        {!following && <button className="td-follow" onClick={() => setFollowing(true)}><ArrowDown size={12} />回到最新进度</button>}
        <div className="td-composer"><div><Sparkles size={15} /><span>{done ? "演示结束，可以切换场景或重新播放" : "观察过程，也可以随时暂停或停止"}</span></div><button aria-label={done || playback === "stopped" ? "重新播放演示" : "停止演示"} onClick={done || playback === "stopped" ? restart : () => setPlayback("stopped")}>{done || playback === "stopped" ? <RotateCcw size={16} /> : <Square size={13} />}</button></div>
      </section>
      <aside className="td-inspector" aria-label="研究概览">
        <div className="td-panel-heading"><BookOpen size={16} /><h2>{source ? "来源详情" : "研究概览"}</h2>{source && <button aria-label="关闭来源详情" onClick={() => setSource(null)}><X size={16} /></button>}</div>
        {source ? <div className="td-source-detail"><Globe size={24} /><h3>{source.title}</h3><span>{source.domain}</span><p>{source.note}</p><a href={source.url} target="_blank" rel="noreferrer">打开原始链接<ArrowUpRight size={14} /></a></div> : <>
          <p className="td-panel-caption">每一步都有迹可循</p>
          <div className="td-metrics"><div><strong>{completed.length}<small> / {steps.length}</small></strong><span>已完成步骤</span></div><div><strong>{sourceIds.length.toString().padStart(2, "0")}</strong><span>已找到来源</span></div></div>
          <h3 className="td-section-label">{mode === "research" ? "研究计划" : "任务步骤"}</h3>
          <ol className="td-plan">{steps.map((step, i) => <li key={step.title} data-state={elapsed >= step.end ? "done" : elapsed >= step.start ? "active" : "pending"}><span>{elapsed >= step.end ? <Check size={12} /> : i + 1}</span>{step.title}{elapsed >= step.start && elapsed < step.end && <span className="td-plan-now">{playing ? "当前" : "暂停"}</span>}</li>)}</ol>
          <div className="td-sources-heading"><h3 className="td-section-label">参考来源</h3><span>{sourceIds.length}</span></div>
          {sourceIds.length ? <div className="td-source-list">{sourceIds.map((id) => <button key={id} onClick={() => setSource(DEMO_SOURCES[id])}><span className="td-source-icon"><Globe size={15} /></span><span><strong>{DEMO_SOURCES[id].title}</strong><small>{DEMO_SOURCES[id].domain}</small></span><ChevronRight size={14} /></button>)}</div> : <p className="td-empty">{mode === "reasoning" ? "此场景无需联网检索。" : "搜索完成后，来源会出现在这里。"}</p>}
          <div className="td-inspector-note"><span />{mode === "research" ? "发现遗漏时继续研究，新的工具调用会接在当前过程里。" : "过程可随时展开回看，最终回答独立呈现。"}</div>
        </>}
      </aside>
    </div>
    <footer className="td-controls">
      <div className="td-playback"><button className="td-primary-control" disabled={failed || playback === "stopped"} onClick={() => done ? restart() : setPlayback(playing ? "paused" : "playing")}>{playing ? <Pause size={14} /> : <Play size={14} />}{done ? "再看一次" : playing ? "暂停" : "继续"}</button><button aria-label="重播" onClick={restart}><RotateCcw size={15} /></button><span className="td-control-divider" /><label>播放速度<select aria-label="播放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label></div>
      <div className="td-secondary-controls"><button disabled={!steps.some((step) => step.tool && elapsed < step.end) || failed || playback === "stopped"} aria-pressed={failNextTool} onClick={() => setFailNextTool(!failNextTool)}>{failNextTool ? "已安排超时" : "模拟工具超时"}</button><button disabled={done || failed || playback === "stopped"} onClick={() => setElapsed(totalDuration)}>查看完整结果<ArrowDown size={13} /></button></div>
    </footer>
  </>
}

export default function ThinkingDemo() {
  const [mode, setMode] = useState<DemoMode>("research")
  const [dark, setDark] = useState(false)
  return <main className="thinking-demo" data-theme={dark ? "dark" : "light"} lang="zh-CN">
    <header className="td-header"><Link className="td-brand" href="/thread-chat"><span><Sparkles size={20} /></span>Thread<span className="td-brand-divider" />交互实验室</Link><div><span className="td-demo-badge">本地 Demo</span><button aria-label={dark ? "切换浅色模式" : "切换深色模式"} onClick={() => setDark(!dark)}>{dark ? <Sun size={17} /> : <Moon size={17} />}</button></div></header>
    <div className="td-page"><div className="td-page-intro"><div><p className="td-eyebrow">THINKING, MADE VISIBLE</p><h1>等待，也能清晰可见。</h1><p>从理解问题到找到答案，让思考摘要、工具与研究进度自然衔接。</p></div><a href="https://www.beautifului.dev/r/thinking-state.json" target="_blank" rel="noreferrer">基于 Beautiful UI<ArrowUpRight size={14} /></a></div>
      <nav className="td-modes" aria-label="演示场景">{(Object.entries(DEMO_SCENARIOS) as [DemoMode, typeof DEMO_SCENARIOS[DemoMode]][]).map(([key, scene]) => <button key={key} aria-pressed={mode === key} onClick={() => setMode(key)}>{key === "reasoning" ? <Sparkles size={16} /> : key === "search" ? <Globe size={16} /> : <FlaskConical size={16} />}<span>{scene.label}</span><small>{scene.description}</small></button>)}</nav>
      <DemoSession key={mode} mode={mode} />
      <p className="td-footnote">演示中的摘要、检索与回答均为预设脚本，用于体验展示节奏。</p>
    </div>
  </main>
}
