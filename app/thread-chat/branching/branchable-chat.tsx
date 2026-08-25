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

import React from "react"
import { ListTree } from "lucide-react"
import type { Message, ThreadTreeState } from "../core/types"
import {
  activeMessagePath,
  collectInherited,
  lineage,
  messagesByIdOrder,
  threadTitle,
} from "../core/selectors"
import { ChatView } from "../chat/chat-view"
import { MessageArtifacts } from "../orchestration/artifacts/message-artifacts"
import { AnchoredAssistantBody } from "./assistant/anchored-assistant-body"
import type { MessageActionViewState } from "../chat/actions/message-action-types"
import type { ThreadMessageActionCommands } from "../chat/actions/message-action-commands"

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
  /** 根 Thread 模型切换意图；分支 selector 仍由本层锁定。 */
  onModelChange: (modelId: string) => void
  onSend: (text: string) => void
  messageActionState?: MessageActionViewState
  messageCommands?: ThreadMessageActionCommands
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
  onModelChange,
  onSend,
  messageActionState,
  messageCommands,
}: BranchableChatProps) {
  const thread = state.threads[threadId]
  if (!thread) return null
  const isMain = thread.parentId === null
  const chain = isMain ? [] : lineage(state, threadId)
  const inherited = isMain ? [] : collectInherited(state, thread)
  const childCount = thread.children.length
  const presentation = messageActionState?.presentationByThreadId.get(threadId)
  const sourceProvenance = presentation?.sourceProvenance ?? null
  const visibleMessages = messageActionState
    ? messagesByIdOrder(
        thread.messages,
        messageActionState.activePathByThreadId.get(threadId) ?? []
      )
    : activeMessagePath(thread)

  /* ---------- 注入：assistant 正文（Markdown 渲染 + 渲染后手绘锚点高亮/脚注） ---------- */
  const renderAssistantBody = (msg: Message) => {
    return (
      <AnchoredAssistantBody
        state={state}
        message={msg}
        onOpenThread={onOpenThread}
      />
    )
  }

  /* ---------- 注入：消息下方的 artifact 卡片 ---------- */
  const renderAfterMessage = (msg: Message) => {
    return (
      <MessageArtifacts
        state={state}
        message={msg}
        sourceDepth={thread.depth}
        onOpen={onOpenArtifact}
      />
    )
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
            {state.threads[thread.parentId ?? ""]?.parentId === null
              ? "主线"
              : `「${threadTitle(state, thread.parentId!)}」`}
          </span>
          <q>{thread.anchorText}</q>
        </div>
        {sourceProvenance && !sourceProvenance.isOnActivePath && (
          <div className="inactive-source">
            <span>
              基于回复
              {sourceProvenance.alternativeIndex === null
                ? ""
                : " " +
                  (sourceProvenance.alternativeIndex + 1) +
                  "/" +
                  sourceProvenance.alternativeCount}{" "}
              · 当前未展示
            </span>
            <button
              type="button"
              onClick={() => {
                if (!thread.parentId || !thread.forkFromMsgId) return
                void messageCommands
                  ?.switchTurnVariant(thread.parentId, thread.forkFromMsgId)
                  .then((result) => {
                    if (result.ok) onOpenThread(thread.parentId!)
                  })
              }}
            >
              查看来源
            </button>
          </div>
        )}
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
      messages={visibleMessages}
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
      modelId={thread.modelId}
      modelSelectorDisabled={!isMain || Boolean(busy)}
      modelSelectorDisabledReason={
        !isMain ? "branch" : busy ? "busy" : undefined
      }
      onModelChange={onModelChange}
      onSend={onSend}
      messageActionState={messageActionState}
      messageCommands={messageCommands}
      editableUserMessageId={presentation?.latestUserMessageId}
      regeneratableAssistantMessageId={presentation?.latestAssistantMessageId}
      turnAlternatives={presentation?.alternatives}
    />
  )
}
