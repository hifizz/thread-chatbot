"use client";
/**
 * orchestration/thread-columns —— 列容器与列槽编排。
 *
 * 职责边界：会话树归 core store；「哪些会话摆在哪些列、谁折叠成细条」这类
 * 视口状态归这里的 React state（useColumnSlots）。列内长什么样由上层通过
 * renderThread 渲染插槽决定（本层不认识 chat / 分支装饰）。
 *
 * 列宽模型（fill）：列行永远铺满容器。自动列 flex:1 1 0；显式调宽的列以
 * flex-basis 承载宽度（flex:1 1 <px>，grow/shrink 保留），容器变化时全行
 * 吸收差值，不产生两侧 gutter。commit 以整行为单位（basis 总和 == 容器时
 * flex 解算逐列等于所存宽度，所见即所存），见 use-column-resize 头注。
 */

import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Thread, ThreadTreeState } from "../core/types";
import type { ThreadStore } from "../core/store";
import { accentOf } from "../theme";
import {
  normalizeForReplace,
  place,
  trimSlots,
  type PlaceEffect,
  type PlacementHint,
  type PlacementMode,
  type Slot,
} from "./placement";
import { useColumnResize, type ColumnResizeHandlers } from "./use-column-resize";

/** 约每 430px 一列（自适应列数的换算基准） */
export const COL_MIN_W = 430;

/* ---------------- 窗口宽度（外部 store：SSR 快照为 null，避免 hydration mismatch） ---------------- */
const subscribeResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const getWinW = (): number | null => window.innerWidth;
const getServerWinW = (): number | null => null;

export function useWindowWidth(): number | null {
  return useSyncExternalStore(subscribeResize, getWinW, getServerWinW);
}

/* ---------------- 列槽编排 hook ---------------- */

export interface UseColumnSlotsArgs {
  store: ThreadStore;
  /** 展开列上限（= 总列数 - 主线一列） */
  maxExpanded: number;
  /** 列满策略：替换⑥ / 细条⑤ */
  mode: PlacementMode;
}

/** 从宽度映射里删掉若干条目（纯函数；全都不存在时原样返回，避免无谓重渲） */
function omitWidths(w: Record<string, number>, ids: readonly string[]): Record<string, number> {
  if (!ids.some((id) => w[id] !== undefined)) return w;
  return Object.fromEntries(Object.entries(w).filter(([id]) => !ids.includes(id)));
}

export function useColumnSlots({ store, maxExpanded, mode }: UseColumnSlotsArgs) {
  const [slots, setSlots] = useState<Slot[]>([]);
  /** 显式列宽（px，threadId → width）：有值的列以 flex-basis 承载宽度，无值 = 自动均分。
      拖拽/键盘 commit 以整行为单位落条目（fill 模型下 basis 总和==容器才无跳动），
      双击复位删除整行条目。条目跟随「槽位空间」走：替换/原地切换会话时转移给新 id；
      收起/裁掉清条目；fold/unfold 保留条目（细条固定 30px 不参与）。 */
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const flashSeq = useRef(0);
  const colsRef = useRef<HTMLDivElement | null>(null);

  // 窗口变窄 / 强制列数调小时：从左裁掉最早的槽（细条一并参与，见 trimSlots）。
  // 这是 React 官方的「渲染期间调整派生状态」写法：条件自熄，比 effect 少一轮往返。
  const effectiveSlots = trimSlots(slots, maxExpanded);
  if (effectiveSlots.length !== slots.length) {
    setSlots(effectiveSlots);
    // 被裁掉的列同步清掉显式宽度
    const kept = new Set(effectiveSlots.map((s) => s.id));
    const dropped = slots.filter((s) => !kept.has(s.id)).map((s) => s.id);
    if (dropped.length) setWidths((w) => omitWidths(w, dropped));
  }

  /** 闪烁提示某列（并滚动到可视区） */
  const flashThread = (id: string) => setFlash({ id, n: ++flashSeq.current });

  useEffect(() => {
    if (!flash) return;
    const el = colsRef.current?.querySelector(`.column[data-thread-id="${flash.id}"]`);
    el?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    const t = setTimeout(() => setFlash(null), 950);
    return () => clearTimeout(t);
  }, [flash]);

  /** 统一放置入口：打开（或原地展开）某会话，返回发生的副作用供上层做 toast。
      hint 为可选放置提示（⌘ keepSource / 迷你列条 targetId），见 placement.ts */
  function openThread(id: string, sourceId: string | null, hint?: PlacementHint): PlaceEffect {
    store.touch(id);
    const state = store.getState();
    const { slots: next, effect } = place(mode, effectiveSlots, id, {
      sourceId,
      maxExpanded,
      lastActiveOf: (tid) => state.threads[tid]?.lastActive ?? 0,
      hint,
    });
    setSlots(next);
    // 槽位空间连续性：替换发生时，被替换列的显式宽度转移给顶上来的新列
    if (effect.kind === "replaced") {
      setWidths((w) => {
        const inherit = w[effect.replacedId];
        const rest = omitWidths(w, [effect.replacedId, id]);
        return inherit !== undefined ? { ...rest, [id]: inherit } : rest;
      });
    }
    flashThread(id);
    return effect;
  }

  /** 列内导航：面包屑 = collapse（目标已在别列时收起本列）；切换器 = swap（交换两列） */
  function navColumn(vpIndex: number, targetId: string, dup: "collapse" | "swap" = "collapse") {
    const next = effectiveSlots.map((s) => ({ ...s }));
    const fromId = next[vpIndex].id;
    if (targetId === "main") {
      next.splice(vpIndex, 1);
      setSlots(next);
      setWidths((w) => omitWidths(w, [fromId])); // 本列收起：清宽度
      flashThread("main");
      return;
    }
    store.touch(targetId);
    const other = next.findIndex((s) => s.id === targetId);
    if (other >= 0 && other !== vpIndex) {
      if (dup === "swap") {
        // 交换两列的会话；folded 标记留在原槽位，展开数不变
        const a = next[other].id;
        next[other].id = next[vpIndex].id;
        next[vpIndex].id = a;
        // 宽度跟槽位不跟会话：交换两个 id 的宽度条目，槽位视觉宽度不动
        setWidths((w) => {
          const wf = w[fromId];
          const wt = w[targetId];
          if (wf === undefined && wt === undefined) return w;
          return {
            ...omitWidths(w, [fromId, targetId]),
            ...(wf !== undefined ? { [targetId]: wf } : null),
            ...(wt !== undefined ? { [fromId]: wt } : null),
          };
        });
      } else {
        // 目标已在别列：收起本列，并确保目标处于展开态
        next[other].folded = false;
        next.splice(vpIndex, 1);
        setWidths((w) => omitWidths(w, [fromId])); // 本列收起：清宽度
      }
    } else {
      next[vpIndex].id = targetId;
      // 原地把本列切成另一个会话：宽度留在槽位上（转移给新 id）
      if (fromId !== targetId) {
        setWidths((w) => {
          const wf = w[fromId];
          const rest = omitWidths(w, [fromId, targetId]);
          return wf !== undefined ? { ...rest, [targetId]: wf } : rest;
        });
      }
    }
    setSlots(next);
    flashThread(targetId);
  }

  function closeColumn(vpIndex: number) {
    const next = effectiveSlots.map((s) => ({ ...s }));
    const removed = next.splice(vpIndex, 1);
    setSlots(next);
    if (removed.length) setWidths((w) => omitWidths(w, removed.map((s) => s.id)));
  }

  /** 撤销（replace 策略的 toast 用）：整体恢复到替换前的槽位 */
  function restoreSlots(prev: Slot[]) {
    setSlots(prev);
  }

  /** fold → replace 切换：细条全部展开，从左裁掉超限列；返回被裁的会话 id */
  function normalizeToReplace(): string[] {
    const { slots: next, dropped } = normalizeForReplace(effectiveSlots, maxExpanded);
    setSlots(next);
    if (dropped.length) setWidths((w) => omitWidths(w, dropped));
    return dropped;
  }

  /** 拖拽末帧 / 键盘步进的提交：整行合并写入显式列宽 */
  function commitWidths(patch: Record<string, number>) {
    setWidths((w) => ({ ...w, ...patch }));
  }

  /** 双击分割线：删除整行的显式宽度，恢复自动均分 */
  function resetWidths(ids: string[]) {
    setWidths((w) => omitWidths(w, ids));
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
  };
}

/* ---------------- 列容器组件 ---------------- */

function ColumnShell({
  thread,
  flashing,
  width,
  children,
}: {
  thread: Thread;
  flashing: boolean;
  /** 显式列宽（px）：有值则以 flex-basis 承载（flex:1 1 <px>，grow/shrink 保留，
      行永远铺满容器），无值走自动均分（CSS flex:1 1 0）。下限仍由 CSS min-width 兜底 */
  width?: number;
  children: React.ReactNode;
}) {
  const isMain = thread.id === "main";
  return (
    <div
      className={`column ${isMain ? "main" : "branch"} ${flashing ? "flash" : ""}`}
      data-thread-id={thread.id}
      style={
        {
          "--accent": accentOf(thread),
          ...(width !== undefined ? { flex: `1 1 ${width}px` } : null),
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
}

/** 相邻两个展开列之间的可拖拽分割线（任一侧是细条则不渲染，见 ThreadColumns） */
function ColumnResizer({
  leftId,
  rightId,
  label,
  rz,
}: {
  leftId: string;
  rightId: string;
  label: string;
  rz: ColumnResizeHandlers;
}) {
  return (
    <div
      className="col-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      title="拖动调整两侧列宽 · 双击恢复均分（聚焦后 ←/→ 微调）"
      tabIndex={0}
      onPointerDown={(e) => rz.onPointerDown(e, leftId, rightId)}
      onPointerMove={rz.onPointerMove}
      onPointerUp={rz.onPointerUp}
      onPointerCancel={rz.onPointerCancel}
      onDoubleClick={rz.onDoubleClick}
      onKeyDown={(e) => rz.onKeyDown(e, leftId, rightId)}
    />
  );
}

/** 方案⑤的竖直细条：深度色左缘 + 竖排标题 + 脚注号徽章，点击原地展开 */
function FoldedStrip({ thread, onClick }: { thread: Thread; onClick: () => void }) {
  return (
    <button
      className="col-strip"
      data-thread-id={thread.id}
      style={{ "--accent": accentOf(thread) } as React.CSSProperties}
      title={`「${thread.title}」已折叠为细条 · 点击原地展开`}
      onClick={onClick}
    >
      {thread.footnote !== null && <span className="fn">{thread.footnote}</span>}
      <span className="vt">{thread.title}</span>
    </button>
  );
}

export interface ThreadColumnsProps {
  state: ThreadTreeState;
  slots: Slot[];
  /** 显式列宽映射（useColumnSlots.widths），无条目的列自动均分 */
  widths: Record<string, number>;
  flashId: string | null;
  colsRef: React.RefObject<HTMLDivElement | null>;
  /** 渲染一列的内部内容（主线 vpIndex = -1；分支列为槽位下标） */
  renderThread: (threadId: string, vpIndex: number) => React.ReactNode;
  /** 点击细条（上层走统一的 openThread 意图入口） */
  onExpandStrip: (id: string) => void;
  /** 拖拽末帧 / 键盘步进：整行合并写入各列的显式宽度 */
  onCommitWidths: (patch: Record<string, number>) => void;
  /** 双击分割线：删除整行的显式宽度（恢复自动均分） */
  onResetWidths: (ids: string[]) => void;
}

export function ThreadColumns({
  state,
  slots,
  widths,
  flashId,
  colsRef,
  renderThread,
  onExpandStrip,
  onCommitWidths,
  onResetWidths,
}: ThreadColumnsProps) {
  const rz = useColumnResize({
    colsRef,
    hasWidth: (id) => widths[id] !== undefined,
    onCommit: onCommitWidths,
    onReset: onResetWidths,
  });
  const main = state.threads["main"];

  // 展平为渲染单元（主线 + 各槽位），在相邻两个「展开列」之间插入分割线
  const cells: { thread: Thread; folded: boolean; vpIndex: number }[] = [];
  if (main) cells.push({ thread: main, folded: false, vpIndex: -1 });
  slots.forEach((s, i) => {
    const t = state.threads[s.id];
    if (t) cells.push({ thread: t, folded: s.folded, vpIndex: i });
  });

  const nodes: React.ReactNode[] = [];
  cells.forEach((c, i) => {
    const prev = cells[i - 1];
    if (prev && !prev.folded && !c.folded) {
      nodes.push(
        <ColumnResizer
          key={`rz:${prev.thread.id}:${c.thread.id}`}
          leftId={prev.thread.id}
          rightId={c.thread.id}
          label={`调整「${prev.thread.title}」与「${c.thread.title}」的列宽`}
          rz={rz}
        />,
      );
    }
    nodes.push(
      c.folded ? (
        <FoldedStrip key={c.thread.id} thread={c.thread} onClick={() => onExpandStrip(c.thread.id)} />
      ) : (
        <ColumnShell
          key={c.thread.id}
          thread={c.thread}
          width={widths[c.thread.id]}
          flashing={flashId === c.thread.id}
        >
          {renderThread(c.thread.id, c.vpIndex)}
        </ColumnShell>
      ),
    );
  });

  return (
    <div className="cols" ref={colsRef}>
      {nodes}
    </div>
  );
}
