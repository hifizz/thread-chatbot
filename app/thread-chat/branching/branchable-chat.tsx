"use client"
/**
 * branching/branchable-chat —— 装饰层：把「分支能力」注入单会话 ChatView。
 *
 * 组装内容：
 * · 列头：面包屑（就地回退）/ L 深度徽章 / 子分支弹层按钮 / ⇄ 切换 / 收起；
 * · focus banner（讨论焦点 · 划选自 X）+「继承的上文」折叠区；
 * · assistant 正文的锚点高亮 + 脚注上标（点击 = 打开对应分支）；
 * · 消息下方的 artifact 卡片。
 * 本层只发出意图回调（打开会话 / 回退 / 收起…），列槽的增删换由 orchestration 决定。
 */

import React, { useEffect, useRef } from "react"
import { FileCode2, FileText, ListTree } from "lucide-react"
import type { Message, ThreadTreeState } from "../core/types"
import { collectInherited, lineage, threadTitle } from "../core/selectors"
import { dc } from "../theme"
import { ChatView } from "../chat/chat-view"
import { MarkdownBody } from "../chat/markdown-body"
import { useSmoothText } from "../chat/smooth-text"
// 锚点在「渲染后的 Markdown DOM」上模糊恢复定位（position→exact→fuzzy），与纯文本解耦
import { clearHighlights, locateAnchor, paintRange } from "./text-anchor"

export interface BranchableChatProps {
  state: ThreadTreeState
  threadId: string
  /** 主线列的副标题（demo 文案由壳层传入） */
  subtitle?: string
  /** 消息列表顶部的插卡（主线 hint） */
  intro?: React.ReactNode
  /** 统一意图：打开某会话（本列作为「来源列」参与放置策略）。
      opts.keepSource：⌘/Ctrl 点击 = 保留本列，把目标开在紧邻右侧 */
  onOpenThread: (targetId: string, opts?: { keepSource?: boolean }) => void
  onOpenArtifact: (artifactId: string) => void
  /** 面包屑就地回退（collapse 语义由 orchestration 实现） */
  onCrumbNav: (targetId: string) => void
  /** ⇄ 把本列切换为任意会话（弹出 local 切换器，锚定在按钮上） */
  onOpenSwitcher: (anchor: HTMLElement) => void
  /** 查看以本会话为根的子树（弹出 subtree 面板，锚定在按钮上） */
  onOpenSubtree: (anchor: HTMLElement) => void
  onCollapse: () => void
  /** 流式生成中：透传给 ChatView 禁用发送键 */
  busy?: boolean
  /** 错误消息下的「重试」按钮回调，透传给 ChatView */
  onRetry?: (msg: Message) => void
  /** busy 时发送键变「停止」的回调，透传给 ChatView */
  onStop?: () => void
  /** composer 预填文案（新开分支的代拟首问，待用户回车确认），透传给 ChatView */
  composerPrefill?: string
  onSend: (text: string) => void
}

export function BranchableChat({
  state,
  threadId,
  subtitle,
  intro,
  onOpenThread,
  onOpenArtifact,
  onCrumbNav,
  onOpenSwitcher,
  onOpenSubtree,
  onCollapse,
  busy,
  onRetry,
  onStop,
  composerPrefill,
  onSend,
}: BranchableChatProps) {
  const thread = state.threads[threadId]
  if (!thread) return null
  const isMain = threadId === "main"
  const chain = isMain ? [] : lineage(state, threadId)
  const inherited = isMain ? [] : collectInherited(state, thread)
  const childCount = thread.children.length

  /* ---------- 注入：assistant 正文（Markdown 渲染 + 渲染后手绘锚点高亮/脚注） ---------- */
  const renderAssistantBody = (msg: Message) => (
    <AnchoredMarkdown state={state} msg={msg} onOpenThread={onOpenThread} />
  )

  /* ---------- 注入：消息下方的 artifact 卡片 ---------- */
  const renderAfterMessage = (msg: Message) => {
    if (!msg.artifactIds?.length) return null
    return msg.artifactIds.map((aid) => {
      const a = state.artifacts[aid]
      if (!a) return null
      const src = state.threads[a.sourceThreadId]
      const cls = src && src.depth > 0 ? `fc-${dc(src.depth)}` : ""
      return (
        <button
          key={aid}
          className={`acard ${cls}`}
          onClick={() => onOpenArtifact(aid)}
        >
          <span className="ic">
            {a.kind === "code" ? (
              <FileCode2 size={15} />
            ) : (
              <FileText size={15} />
            )}
          </span>
          <span className="t">
            <span className="n" style={{ display: "block" }}>
              {a.title}
            </span>
            <span className="k" style={{ display: "block" }}>
              ARTIFACT · {a.kind === "code" ? (a.lang ?? "code") : "note"}
            </span>
          </span>
          <span className="go">抽屉打开 →</span>
        </button>
      )
    })
  }

  /* ---------- 列头（主线 / 分支两种形态，子分支按钮两者都有） ---------- */
  const subtreeBtn = (
    <button
      className="cbtn tree"
      title={`查看子分支（${childCount}）`}
      onClick={(e) => onOpenSubtree(e.currentTarget)}
    >
      <ListTree size={12} />
      <span className="n">{childCount}</span>
    </button>
  )

  const header = (
    <div className="col-head">
      {/* 列头背景 / 底部分隔线随列通栏，内容收敛在 .lane 阅读通道内（与消息流对齐） */}
      <div className="lane">
        {isMain ? (
          <>
            <div className="ctitle-row">
              <span className="anchor-tag">锚定</span>
              <span className="ctitle main">主线</span>
              <div className="cactions">{subtreeBtn}</div>
            </div>
            {subtitle && <div className="col-sub">{subtitle}</div>}
          </>
        ) : (
          <>
            <div className="crumb">
              {chain.map((c, i) => {
                const here = i === chain.length - 1
                return (
                  <React.Fragment key={c.id}>
                    <span
                      className={here ? "here" : "seg2"}
                      onClick={here ? undefined : () => onCrumbNav(c.id)}
                      title={here ? undefined : `回到「${c.title}」`}
                    >
                      {c.title}
                    </span>
                    {!here && <span className="chev">›</span>}
                  </React.Fragment>
                )
              })}
            </div>
            <div className="ctitle-row">
              <span className="depth-badge">L{thread.depth}</span>
              <span className="ctitle">{thread.title}</span>
              <div className="cactions">
                {subtreeBtn}
                <button
                  className="cbtn"
                  title="把本列切换为任意会话"
                  onClick={(e) => onOpenSwitcher(e.currentTarget)}
                >
                  ⇄ 切换
                </button>
                <button className="cbtn" title="收起本列" onClick={onCollapse}>
                  收起
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )

  /* ---------- focus banner + 继承的上文（仅分支列） ----------
     父级（列）没有水平 padding，用 .lane.pad 承担 18px 侧距并居中通道 */
  const banner = isMain ? null : (
    <div className="lane pad">
      <div className="focus-banner">
        <span className="fn">{thread.footnote}</span>
        <div className="ft">
          <span className="lbl">
            讨论焦点 · 划选自
            {thread.parentId === "main"
              ? "主线"
              : `「${threadTitle(state, thread.parentId!)}」`}
          </span>
          <q>{thread.anchorText}</q>
        </div>
      </div>
      <details className="inherited">
        <summary>
          <span className="tw">▸</span>继承的上文 · {inherited.length} 条
        </summary>
        <div className="inherited-body">
          {inherited.map((m) => (
            <div key={m.id} className="inh-msg">
              <span className="who">{m.role === "user" ? "你" : "AI"}</span>
              {m.text.length > 130 ? m.text.slice(0, 130) + "…" : m.text}
            </div>
          ))}
        </div>
      </details>
    </div>
  )

  return (
    <ChatView
      threadId={threadId}
      messages={thread.messages}
      isMain={isMain}
      header={header}
      banner={banner}
      intro={intro}
      renderAssistantBody={renderAssistantBody}
      renderAfterMessage={renderAfterMessage}
      busy={busy}
      onRetry={onRetry}
      onStop={onStop}
      composerPrefill={composerPrefill}
      onSend={onSend}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* assistant 正文：Markdown 渲染 + 渲染后手绘锚点高亮 / 脚注上标                  */
/* -------------------------------------------------------------------------- */
/**
 * 为什么「手绘」而非 React 渲染高亮：锚点定位发生在**渲染后的真实 DOM**上
 * （locateAnchor 三层降级），坐标系 = .md-body 的 textContent，对 Markdown 结构免疫。
 *
 * 导出供画布模式复用（openspec: add-canvas-conversations D2）：节点外挂面板的
 * assistant 正文必须与列模式同一套渲染（.md-body 容器 + 锚点 effect + SmoothText），
 * 否则划选反查（以 .md-body 为坐标系）在画布内直接失效。
 *
 * React 与手绘 DOM 的冲突规避：
 * · MarkdownBody 按 source 用 memo——source 不变则不重渲染，手绘的高亮/脚注不被 reconcile 抹掉；
 * · source 变化只发生在流式增量时，而流式中的消息尚无 fork（fork 只在已完成消息上创建），
 *   故无高亮与 React 更新的冲突；
 * · 只在 commit 后的 effect 里绘制（deps = [msg.text, forksKey]），绝不在 render / setState 里绘。
 * · 定位失败（locateAnchor 返回 null 或 fuzzy 低于阈值）静默跳过该 fork——不高亮，
 *   但分支本体 / 脚注列表 / ⌘K 不受影响。
 *
 * 平滑打字（useSmoothText）与锚点 effect 的不变式：
 * · display 是 msg.text 的「追赶态」，deps 仍是 [msg.text, forksKey]（原文，非 display）——
 *   锚点定位坐标系必须是渲染后的完整正文，不能跟着平滑的中间态重绘；
 * · fork 只在已完成消息（active=false）上创建，此时 useSmoothText 已把 display snap 到
 *   与 msg.text 完全一致，二者恒等，故锚点效果不受平滑影响，无需改锚点代码。
 */
export function AnchoredMarkdown({
  state,
  msg,
  onOpenThread,
}: {
  state: ThreadTreeState
  msg: Message
  onOpenThread: (targetId: string, opts?: { keepSource?: boolean }) => void
}) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  // forksKey 只随 fork 的增删与编号变化——source 未变、仅新增 fork 时也能触发重绘
  const forksKey = msg.forks.map((f) => `${f.threadId}:${f.num}`).join("|")
  const active = msg.status === "streaming" || msg.status === "pending"
  const display = useSmoothText(msg.text, active)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const md = host.querySelector<HTMLElement>(".md-body")
    if (!md) return

    const wipe = () => {
      clearHighlights(md)
      md.querySelectorAll("sup.fn-mark").forEach((n) => n.remove())
    }
    wipe()

    for (const fork of msg.forks) {
      if (!fork.anchor) continue
      const located = locateAnchor(md, fork.anchor)
      if (!located) continue // 定位失败：静默跳过（fuzzy 默认阈值 0.7）
      const color = `color-mix(in srgb, var(--d${dc(fork.depth)}) 20%, transparent)`
      paintRange(located.range, fork.threadId, color)
      // 高亮 span 补上 data-fork-id + 深度色类，使点击高亮亦能打开分支
      const marks = md.querySelectorAll<HTMLElement>(
        `[data-text-anchor-mark="${cssEscape(fork.threadId)}"]`
      )
      marks.forEach((m) => {
        m.setAttribute("data-fork-id", fork.threadId)
        m.classList.add("anchored-mark", `fc-${dc(fork.depth)}`)
        m.title = `分支「${threadTitle(state, fork.threadId)}」· 点击打开 · ⌘点击保留本列在右侧打开`
      })
      // range 末尾插入脚注上标（同样带 data-fork-id）
      const last = marks[marks.length - 1]
      if (last) {
        const sup = document.createElement("sup")
        sup.className = `fn-mark fc-${dc(fork.depth)}`
        sup.setAttribute("data-fork-id", fork.threadId)
        sup.textContent = String(fork.num)
        last.after(sup)
      }
    }

    return wipe
    // state 仅用于 title 文案，不参与重绘时机；有意省略以免每次 version 变动都重绘
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.text, forksKey])

  // 点击冒泡到稳定容器：命中高亮 / 脚注（data-fork-id）即打开对应分支。
  // 高亮与脚注是手绘 DOM，但事件冒泡到此 React onClick，重绘不丢 handler。
  const onClick = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest?.("[data-fork-id]")
    if (!el) return
    const id = el.getAttribute("data-fork-id")
    if (!id) return
    onOpenThread(id, { keepSource: e.metaKey || e.ctrlKey })
  }

  return (
    <div ref={hostRef} onClick={onClick}>
      <MarkdownBody source={display} />
    </div>
  )
}

/** querySelector 属性值转义（thread id 形如 b1，仍走标准转义以防特殊字符） */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function")
    return CSS.escape(value)
  return value.replace(/"/g, '\\"')
}
