"use client";
/**
 * orchestration/thread-switcher —— 会话切换 / 会话树面板，三种模式复用同一套行渲染：
 * · global（⌘K）：居中大面板，可搜索（标题 / 划选原文）、最近访问 chips、↑↓⏎ 键盘导航；
 * · column（每列 ⇄）：锚定在按钮下的小面板，点击 = 把本列切换为目标会话（swap 语义）；
 * · subtree（列头子分支按钮）：只列出以该列会话为根的整棵子树（不含根），无搜索框。
 *
 * 面板每次打开都以新 key 重挂（壳层负责），所以 query / 高亮项内部持有即可，天然归零。
 */

import React, { useEffect, useRef, useState } from "react";
import { ListTree, Search } from "lucide-react";
import type { ThreadTreeState } from "../core/types";
import { allTreeRows, subtreeRows, threadTitle, type TreeRow } from "../core/selectors";
import { dotColorOf, dvar } from "../theme";
import type { Slot } from "./placement";

export type SwitcherMode =
  | { kind: "global" }
  | { kind: "column"; vpIndex: number; x: number; y: number }
  | { kind: "subtree"; rootId: string; x: number; y: number };

export interface ThreadSwitcherProps {
  state: ThreadTreeState;
  mode: SwitcherMode;
  /** 当前列槽（用于「锚定 / 第N列 / 细条 / 本列」状态徽标） */
  slots: Slot[];
  /** 最近访问的会话 id（global 模式的 chips） */
  recents: string[];
  onPick: (row: TreeRow, mode: SwitcherMode) => void;
  onClose: () => void;
}

export function ThreadSwitcher({ state, mode, slots, recents, onPick, onClose }: ThreadSwitcherProps) {
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  const isGlobal = mode.kind === "global";
  const isSubtree = mode.kind === "subtree";

  const baseRows = isSubtree ? subtreeRows(state, mode.rootId) : allTreeRows(state);
  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const rows = !filtering
    ? baseRows
    : baseRows.filter(
        (r) => r.title.toLowerCase().includes(q) || (r.anchor ?? "").toLowerCase().includes(q),
      );

  // 键盘上下移动时让高亮行保持在可视区
  useEffect(() => {
    listRef.current?.querySelector(`[data-swxrow="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  /** 会话当前的摆放状态徽标 */
  const statusOf = (id: string): { label: string } | null => {
    if (id === "main") return { label: "锚定" };
    const i = slots.findIndex((s) => s.id === id);
    if (i < 0) return null;
    return { label: slots[i].folded ? "细条" : `第 ${i + 2} 列` };
  };
  const curColId = mode.kind === "column" ? (slots[mode.vpIndex]?.id ?? null) : null;

  const recentRows =
    isGlobal && !filtering ? recents.filter((id) => state.threads[id]).slice(0, 5) : [];

  const panelClass = isGlobal ? "global" : isSubtree ? "subtree" : "local";
  const panelStyle = mode.kind === "global" ? undefined : { left: mode.x, top: mode.y };

  return (
    <>
      <div className={`swx-scrim ${isGlobal ? "" : "clear"}`} onMouseDown={onClose} />
      <div className={`swx ${panelClass}`} style={panelStyle}>
        {isSubtree ? (
          <div className="swx-title">
            <ListTree size={14} />
            『{threadTitle(state, mode.rootId)}』的子分支
          </div>
        ) : (
          <div className="swx-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              placeholder={isGlobal ? "搜索会话（标题 / 划选原文）…" : "把本列切换为…"}
              onChange={(e) => {
                setQuery(e.target.value);
                setHi(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setHi((h) => Math.min(h + 1, rows.length - 1));
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setHi((h) => Math.max(h - 1, 0));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  const row = rows[hi];
                  if (row) onPick(row, mode);
                }
              }}
            />
            {isGlobal && <span className="kbd">⌘K</span>}
          </div>
        )}

        {recentRows.length > 0 && (
          <>
            <div className="swx-hd">最近访问</div>
            <div className="swx-recent">
              {recentRows.map((id) => {
                const rt = state.threads[id];
                return (
                  <button
                    key={id}
                    className="swx-chip"
                    style={{ "--dc": dotColorOf(rt) } as React.CSSProperties}
                    onClick={() =>
                      onPick(
                        {
                          id,
                          depth: rt.depth,
                          relDepth: rt.depth,
                          isMain: false,
                          title: rt.title,
                          footnote: rt.footnote,
                          anchor: rt.anchorText,
                        },
                        mode,
                      )
                    }
                  >
                    <span className="dot" />
                    <span className="tt">{rt.title}</span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        <div className="swx-list" ref={listRef}>
          {rows.length === 0 && (
            <div className="swx-empty">
              {isSubtree
                ? "此会话还没有子分支——划选一段文字即可开出第一个"
                : `没有匹配「${query}」的会话`}
            </div>
          )}
          {rows.map((r, i) => {
            const st = statusOf(r.id);
            const isCur = curColId === r.id;
            return (
              <div
                key={r.id}
                data-swxrow={i}
                className={`swx-row ${i === hi ? "hi" : ""}`}
                style={
                  {
                    "--dc": r.isMain ? "#8a8377" : dvar(r.depth),
                    paddingLeft: filtering ? 9 : 9 + r.relDepth * 16,
                  } as React.CSSProperties
                }
                title={r.anchor ? `划选自：「${r.anchor}」` : undefined}
                onMouseEnter={() => setHi(i)}
                onClick={() => onPick(r, mode)}
              >
                <span className="dot" />
                {r.footnote !== null && <span className="n">{r.footnote}</span>}
                <span className={`t ${r.isMain ? "main" : ""}`}>{r.title}</span>
                {r.anchor && filtering && <span className="anch">「{r.anchor}」</span>}
                {isCur ? (
                  <span className="st">本列</span>
                ) : st ? (
                  <span className="st">{st.label}</span>
                ) : mode.kind === "column" && r.isMain ? (
                  <span className="st">⇐ 收起本列</span>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="swx-foot">
          {isSubtree ? (
            <>
              <span>点击行打开（列满走当前策略）</span>
              <span>esc 关闭</span>
            </>
          ) : (
            <>
              <span>↑↓ 选择</span>
              <span>⏎ 打开</span>
              <span>esc 关闭</span>
              {isGlobal ? (
                <span>点击 = 智能放置（列满走当前策略）</span>
              ) : (
                <span>点击 = 在本列打开</span>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
