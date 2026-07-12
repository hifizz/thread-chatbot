"use client";
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

import React from "react";
import { FileCode2, FileText, ListTree } from "lucide-react";
import type { Fork, Message, ThreadTreeState } from "../core/types";
import { collectInherited, lineage, threadTitle } from "../core/selectors";
import { dc } from "../theme";
import { ChatView, withBreaks } from "../chat/chat-view";

/* ---------------- 划选锚点 → 高亮区间 ---------------- */
interface AnchorRange {
  start: number;
  end: number;
  fork: Fork;
}

/** 把消息上的 forks 换算成互不重叠的原文区间（同文重复出现时向后顺延） */
function computeRanges(msg: Message): AnchorRange[] {
  const t = msg.text;
  const ranges: AnchorRange[] = [];
  msg.forks.forEach((f) => {
    let i = t.indexOf(f.text);
    while (i !== -1 && ranges.some((r) => !(i + f.text.length <= r.start || i >= r.end)))
      i = t.indexOf(f.text, i + 1);
    if (i !== -1) ranges.push({ start: i, end: i + f.text.length, fork: f });
  });
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

export interface BranchableChatProps {
  state: ThreadTreeState;
  threadId: string;
  /** 主线列的副标题（demo 文案由壳层传入） */
  subtitle?: string;
  /** 消息列表顶部的插卡（主线 hint） */
  intro?: React.ReactNode;
  /** 统一意图：打开某会话（本列作为「来源列」参与放置策略）。
      opts.keepSource：⌘/Ctrl 点击 = 保留本列，把目标开在紧邻右侧 */
  onOpenThread: (targetId: string, opts?: { keepSource?: boolean }) => void;
  onOpenArtifact: (artifactId: string) => void;
  /** 面包屑就地回退（collapse 语义由 orchestration 实现） */
  onCrumbNav: (targetId: string) => void;
  /** ⇄ 把本列切换为任意会话（弹出 local 切换器，锚定在按钮上） */
  onOpenSwitcher: (anchor: HTMLElement) => void;
  /** 查看以本会话为根的子树（弹出 subtree 面板，锚定在按钮上） */
  onOpenSubtree: (anchor: HTMLElement) => void;
  onCollapse: () => void;
  /** 流式生成中：透传给 ChatView 禁用发送键 */
  busy?: boolean;
  /** 错误消息下的「重试」按钮回调，透传给 ChatView */
  onRetry?: (msg: Message) => void;
  onSend: (text: string) => void;
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
  onSend,
}: BranchableChatProps) {
  const thread = state.threads[threadId];
  if (!thread) return null;
  const isMain = threadId === "main";
  const chain = isMain ? [] : lineage(state, threadId);
  const inherited = isMain ? [] : collectInherited(state, thread);
  const childCount = thread.children.length;

  /* ---------- 注入：assistant 正文（锚点高亮 + 脚注上标） ---------- */
  const renderAssistantBody = (msg: Message) => {
    const ranges = computeRanges(msg);
    const t = msg.text;
    const paras: { start: number; text: string }[] = [];
    let off = 0;
    t.split("\n\n").forEach((pt) => {
      paras.push({ start: off, text: pt });
      off += pt.length + 2;
    });

    return paras.map((p) => {
      const pEnd = p.start + p.text.length;
      const nodes: React.ReactNode[] = [];
      let pos = p.start;
      ranges.forEach((r, ri) => {
        if (r.end <= p.start || r.start >= pEnd) return;
        const s0 = Math.max(r.start, p.start);
        const e0 = Math.min(r.end, pEnd);
        if (s0 > pos) nodes.push(...withBreaks(t.slice(pos, s0), `t${pos}`));
        const forkTitle = `分支「${threadTitle(state, r.fork.threadId)}」· 点击打开 · ⌘点击保留本列在右侧打开`;
        const openFork = (e: React.MouseEvent) =>
          onOpenThread(r.fork.threadId, { keepSource: e.metaKey || e.ctrlKey });
        nodes.push(
          <span
            key={`a${ri}-${s0}`}
            className={`anchored fc-${dc(r.fork.depth)}`}
            title={forkTitle}
            onClick={openFork}
          >
            {withBreaks(t.slice(s0, e0), `at${s0}`)}
          </span>,
        );
        if (r.end <= pEnd)
          nodes.push(
            <sup
              key={`f${ri}`}
              className={`fnote fc-${dc(r.fork.depth)}`}
              title={forkTitle}
              onClick={openFork}
            >
              {r.fork.num}
            </sup>,
          );
        pos = e0;
      });
      if (pos < pEnd) nodes.push(...withBreaks(t.slice(pos, pEnd), `t${pos}`));
      return <p key={p.start}>{nodes}</p>;
    });
  };

  /* ---------- 注入：消息下方的 artifact 卡片 ---------- */
  const renderAfterMessage = (msg: Message) => {
    if (!msg.artifactIds?.length) return null;
    return msg.artifactIds.map((aid) => {
      const a = state.artifacts[aid];
      if (!a) return null;
      const src = state.threads[a.sourceThreadId];
      const cls = src && src.depth > 0 ? `fc-${dc(src.depth)}` : "";
      return (
        <button key={aid} className={`acard ${cls}`} onClick={() => onOpenArtifact(aid)}>
          <span className="ic">
            {a.kind === "code" ? <FileCode2 size={15} /> : <FileText size={15} />}
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
      );
    });
  };

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
  );

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
                const here = i === chain.length - 1;
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
                );
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
  );

  /* ---------- focus banner + 继承的上文（仅分支列） ----------
     父级（列）没有水平 padding，用 .lane.pad 承担 18px 侧距并居中通道 */
  const banner = isMain ? null : (
    <div className="lane pad">
      <div className="focus-banner">
        <span className="fn">{thread.footnote}</span>
        <div className="ft">
          <span className="lbl">
            讨论焦点 · 划选自
            {thread.parentId === "main" ? "主线" : `「${threadTitle(state, thread.parentId!)}」`}
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
  );

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
      onSend={onSend}
    />
  );
}
