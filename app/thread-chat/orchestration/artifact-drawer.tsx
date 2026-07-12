"use client";
/**
 * orchestration/artifact-drawer —— Artifact 右侧抽屉「舞台」（全局唯一）。
 * 标签页管理全部 artifact（深度色圆点标来源会话），code 深底 pre / note 衬线段落，
 * 底部「定位来源会话」走壳层的统一打开意图。
 */

import React from "react";
import { LocateFixed, PanelRightOpen, X } from "lucide-react";
import type { Artifact, ThreadTreeState } from "../core/types";
import { dotColorOf } from "../theme";

export interface ArtifactDrawerProps {
  state: ThreadTreeState;
  open: boolean;
  /** 当前激活的 artifact id（null 时回退到第一个） */
  activeId: string | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  /** 定位来源会话（壳层用 openBranchUI 打开） */
  onLocate: (threadId: string) => void;
}

export function ArtifactDrawer({ state, open, activeId, onClose, onSelect, onLocate }: ArtifactDrawerProps) {
  const a: Artifact | null =
    (activeId && state.artifacts[activeId]) || state.artifacts[state.artifactOrder[0]] || null;
  const src = a ? state.threads[a.sourceThreadId] : null;

  return (
    <div className={`art-drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="art-head">
        <PanelRightOpen size={16} color="#6a6357" />
        <h3>
          Artifact 舞台 <span className="sub">全局唯一 · 标签页管理</span>
        </h3>
        <button className="art-x" title="收起抽屉" onClick={onClose}>
          <X size={13} />
        </button>
      </div>
      {state.artifactOrder.length > 0 && (
        <div className="art-tabs">
          {state.artifactOrder.map((aid) => {
            const art = state.artifacts[aid];
            if (!art) return null;
            const sb = state.threads[art.sourceThreadId];
            return (
              <button
                key={aid}
                className={`art-tab ${a?.id === aid ? "on" : ""}`}
                style={{ "--dc": sb ? dotColorOf(sb) : "#8a8377" } as React.CSSProperties}
                title={`来自「${sb?.title ?? "?"}」`}
                onClick={() => onSelect(aid)}
              >
                <span className="dot" />
                {art.title}
              </button>
            );
          })}
        </div>
      )}
      <div className="art-body">
        {!a && <div className="art-empty">还没有 Artifact——在主线或分支里生成后会出现在这里。</div>}
        {a && a.kind === "code" && <pre className="art-code">{a.content}</pre>}
        {a && a.kind === "note" && (
          <div className="art-note">
            {a.content.split("\n\n").map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        )}
      </div>
      {a && src && (
        <div className="art-src" style={{ "--dc": dotColorOf(src) } as React.CSSProperties}>
          <span className="dot" />
          <span className="nm">
            来源会话：{src.title}
            {src.footnote !== null ? ` · 脚注 ${src.footnote}` : ""}
          </span>
          <button
            className="loc"
            title="打开产生这个 Artifact 的会话"
            onClick={() => onLocate(src.id)}
          >
            <LocateFixed size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            定位来源会话
          </button>
        </div>
      )}
    </div>
  );
}
