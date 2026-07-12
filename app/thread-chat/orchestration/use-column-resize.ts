"use client";
/**
 * orchestration/use-column-resize —— 列间分割线的拖拽 / 键盘 / 双击复位逻辑。
 *
 * 布局模型（与 ColumnShell 的约定）：列行永远铺满容器——自动列 flex:1 1 0，
 * 显式调宽列 flex:1 1 <px>（flex-basis 承载宽度，grow/shrink 保留）。推论：
 * 只有「整行 basis 总和 == 容器宽」时 flex 解算才逐列等于所存宽度（零自由空间），
 * 否则剩余空间会被 grow 均摊进每一列。因此 commit 的单位是整行：
 * · 拖拽末帧 / 键盘步进把行内每个展开列的实测宽度一起写回（零和 + 其余列未动
 *   保证总和 == 容器），commit 瞬间 flex 解算结果与末帧 DOM 相同，无视觉跳动；
 * · 双击「恢复自动均分」同理作用于整行——只删两列会把它们的 basis 释放给全行
 *   均摊（结果并非均分），故删除整行条目，让所有列回到 flex:1 1 0 的均分。
 *
 * 流畅性优先的实现约定：
 * · 拖拽期间绝不 setState —— pointermove 只累计位移，rAF 合帧后每帧至多一次
 *   直接写两列 DOM 的 style.flex/width（flex:0 0 auto + width，1:1 跟手）；
 *   pointerup 才整行 commit 回 React 状态（widths），并在 React 冲刷后、首帧
 *   绘制前把两列 inline 样式对齐成 commit 值（清掉命令式残留的 width，避免
 *   陈旧 width / flex:0 0 auto 在后续窗口 resize 时干扰 flex-basis 布局）。
 * · 零和分配：左 +d 右 -d，位移截断到两列都 ≥ --col-min；上限不再由 --col-max
 *   约束（该变量已从样式移除，缺省 = Infinity；若未来重新定义则重新生效），
 *   拖拽上限自然由「邻列 min + 容器宽」决定。
 * · 双击复位属「程序性变宽」，走 CSS transition（.cols.easing）的 FLIP：先删
 *   整行条目让 React 回到自动布局，再在 rAF 里量出目标宽、钉回起始宽、挂
 *   .easing 写目标宽，过渡结束后清掉内联样式交还自动布局。拖拽期间绝不挂该类。
 */

import { useEffect, useRef } from "react";
import type React from "react";

const FALLBACK_MIN = 340;
/** --col-max 已从样式移除：缺省上限为 Infinity（若未来重新定义该变量则重新生效） */
const FALLBACK_MAX = Infinity;
/** 键盘 ←/→ 单次调整步长（px） */
const KEY_STEP = 24;
/** 与 .cols.easing 的 transition 时长对齐（+缓冲），到点清理内联样式 */
const EASE_MS = 320 + 60;

interface DragSession {
  pointerId: number;
  handle: HTMLElement;
  leftEl: HTMLElement;
  rightEl: HTMLElement;
  leftId: string;
  rightId: string;
  leftStart: number;
  rightStart: number;
  startX: number;
  min: number;
  max: number;
  /** 待处理的 rAF id（0 = 无） */
  raf: number;
  /** 最新指针位移（未 clamp），rAF 帧里统一换算 */
  delta: number;
  /** 是否发生过实际拖动（纯点击 / 双击不落状态、不碰 DOM） */
  moved: boolean;
  lastLeft: number;
  lastRight: number;
}

interface EaseSession {
  els: HTMLElement[];
  timer: number;
}

export interface UseColumnResizeArgs {
  colsRef: React.RefObject<HTMLDivElement | null>;
  /** 该列当前是否有显式宽度条目（双击复位的空操作短路） */
  hasWidth: (id: string) => boolean;
  /** 拖拽末帧 / 键盘步进的提交：整行合并写入各列宽度 */
  onCommit: (patch: Record<string, number>) => void;
  /** 双击复位：删除整行的宽度条目（恢复自动均分） */
  onReset: (ids: string[]) => void;
}

export interface ColumnResizeHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLElement>, leftId: string, rightId: string) => void;
  onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
  onDoubleClick: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>, leftId: string, rightId: string) => void;
}

/** 零和 clamp：把位移 d 截断到「左右两列都落在 [min,max]」的可行区间内 */
function clampDelta(d: number, leftW: number, rightW: number, min: number, max: number): number {
  const lo = Math.max(min - leftW, rightW - max);
  const hi = Math.min(max - leftW, rightW - min);
  if (lo > hi) return 0; // 起始宽已越界（CSS clamp 兜底，理论上到不了）
  return Math.min(hi, Math.max(lo, d));
}

function forceReflow(el: HTMLElement): number {
  return el.offsetWidth;
}

export function useColumnResize({
  colsRef,
  hasWidth,
  onCommit,
  onReset,
}: UseColumnResizeArgs): ColumnResizeHandlers {
  const drag = useRef<DragSession | null>(null);
  const ease = useRef<EaseSession | null>(null);

  // 卸载兜底：拖拽 / 过渡进行中被卸载时，清干净 body 样式、rAF 与定时器
  useEffect(
    () => () => {
      const s = drag.current;
      if (s) {
        drag.current = null;
        if (s.raf) cancelAnimationFrame(s.raf);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      const e = ease.current;
      if (e) {
        ease.current = null;
        window.clearTimeout(e.timer);
      }
    },
    [],
  );

  const colEl = (id: string): HTMLElement | null =>
    colsRef.current?.querySelector<HTMLElement>(`.column[data-thread-id="${CSS.escape(id)}"]`) ??
    null;

  /** 行内全部展开列（DOM 顺序；细条不参与宽度体系） */
  const rowCols = (): { el: HTMLElement; id: string }[] => {
    const els = colsRef.current?.querySelectorAll<HTMLElement>(".column[data-thread-id]");
    if (!els) return [];
    return Array.from(els).flatMap((el) => {
      const id = el.dataset.threadId;
      return id ? [{ el, id }] : [];
    });
  };

  /** 整行实测宽度（commit 的基底：其余列钉在当前实测宽，保证 basis 总和==容器） */
  const measureRow = (): Record<string, number> => {
    const patch: Record<string, number> = {};
    for (const { el, id } of rowCols()) patch[id] = el.getBoundingClientRect().width;
    return patch;
  };

  /** min/max 以 CSS 变量为唯一来源（--col-min / --col-max，从 .tc 继承到分割线上） */
  const limitsOf = (el: HTMLElement) => {
    const cs = getComputedStyle(el);
    return {
      min: parseFloat(cs.getPropertyValue("--col-min")) || FALLBACK_MIN,
      max: parseFloat(cs.getPropertyValue("--col-max")) || FALLBACK_MAX,
    };
  };

  /** 结束程序性过渡：移除 .easing 并清掉内联样式，交还自动布局（可被拖拽/键盘随时打断） */
  const stopEase = () => {
    const e = ease.current;
    if (!e) return;
    ease.current = null;
    window.clearTimeout(e.timer);
    colsRef.current?.classList.remove("easing");
    e.els.forEach((el) => {
      el.style.width = "";
      el.style.flex = "";
    });
  };

  /** 把当前位移换算成两列宽度并直写 DOM（拖拽期间的唯一写入口，每帧至多一次） */
  const applyDrag = (s: DragSession) => {
    const d = clampDelta(s.delta, s.leftStart, s.rightStart, s.min, s.max);
    s.lastLeft = s.leftStart + d;
    s.lastRight = s.rightStart - d;
    s.leftEl.style.flex = "0 0 auto";
    s.leftEl.style.width = `${s.lastLeft}px`;
    s.rightEl.style.flex = "0 0 auto";
    s.rightEl.style.width = `${s.lastRight}px`;
  };

  const finishDrag = (s: DragSession) => {
    drag.current = null;
    if (s.raf) cancelAnimationFrame(s.raf);
    s.handle.classList.remove("active");
    if (s.handle.hasPointerCapture(s.pointerId)) s.handle.releasePointerCapture(s.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (!s.moved) return; // 纯点击（含双击的两次按放）：不碰状态
    // 末帧对齐：把最后一次位移同步进 DOM，保证 commit 值与视觉严格一致
    applyDrag(s);
    // 整行 commit：basis 总和 == 容器（零和 + 其余列未动），flex 解算逐列等于末帧 DOM
    const patch = measureRow();
    patch[s.leftId] = s.lastLeft;
    patch[s.rightId] = s.lastRight;
    onCommit(patch);
    // React 已在事件末尾同步冲刷；首帧绘制前把两列 inline 对齐成 commit 值——
    // 清掉命令式 width，flex 显式钉成 1 1 <px>（若 commit 值与旧条目相同，React
    // 会跳过写入，残留的 flex:0 0 auto 会让该列在后续 resize 中不参与伸缩）。
    requestAnimationFrame(() => {
      if (drag.current || ease.current) return; // 新交互已接管，样式归它管
      for (const [el, w] of [
        [s.leftEl, s.lastLeft],
        [s.rightEl, s.lastRight],
      ] as const) {
        if (!el.isConnected) continue;
        el.style.flex = `1 1 ${w}px`;
        el.style.width = "";
      }
    });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLElement>, leftId: string, rightId: string) => {
    if (e.button !== 0 || drag.current) return;
    const leftEl = colEl(leftId);
    const rightEl = colEl(rightId);
    if (!leftEl || !rightEl) return;
    stopEase(); // 复位过渡进行中则立刻完成，确保量到的是稳定宽度
    const handle = e.currentTarget;
    const { min, max } = limitsOf(handle);
    drag.current = {
      pointerId: e.pointerId,
      handle,
      leftEl,
      rightEl,
      leftId,
      rightId,
      leftStart: leftEl.getBoundingClientRect().width,
      rightStart: rightEl.getBoundingClientRect().width,
      startX: e.clientX,
      min,
      max,
      raf: 0,
      delta: 0,
      moved: false,
      lastLeft: 0,
      lastRight: 0,
    };
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("active");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const onPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = drag.current;
    if (!s || e.pointerId !== s.pointerId) return;
    s.delta = e.clientX - s.startX;
    if (!s.moved && Math.abs(s.delta) >= 1) s.moved = true;
    if (s.moved && !s.raf) {
      s.raf = requestAnimationFrame(() => {
        s.raf = 0;
        applyDrag(s);
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    const s = drag.current;
    if (s && e.pointerId === s.pointerId) finishDrag(s);
  };

  // 系统抢走指针（如手势）：与 pointerup 同样按当前位置收尾，视觉不回跳
  const onPointerCancel = onPointerUp;

  const onDoubleClick = () => {
    if (drag.current) return;
    const colsEl = colsRef.current;
    if (!colsEl) return;
    const cells = rowCols();
    if (!cells.some((c) => hasWidth(c.id))) return; // 本就自动均分
    stopEase();
    const firsts = cells.map((c) => c.el.getBoundingClientRect().width);
    // 先提交状态：双击是离散事件，React 会在本任务末同步冲刷 DOM（整行回到自动布局）
    onReset(cells.map((c) => c.id));
    // rAF 跑在冲刷之后、绘制之前：量出目标宽（Last）→ 钉回起始宽（First）→
    // 挂 .easing 写目标宽，由 CSS transition 完成动画（FLIP），全程不再碰状态。
    // 各列同时长同缓动，过渡中每帧宽度和恒等于容器——动画期间也无 gutter。
    requestAnimationFrame(() => {
      if (drag.current || ease.current) return; // 已有新交互接管，状态本身已是最终值
      if (cells.some((c) => !c.el.isConnected)) return;
      const lasts = cells.map((c) => c.el.getBoundingClientRect().width);
      if (cells.every((_, i) => Math.abs(lasts[i] - firsts[i]) < 1)) return;
      const pin = (el: HTMLElement, w: number) => {
        el.style.flex = "0 0 auto";
        el.style.width = `${w}px`;
      };
      cells.forEach((c, i) => pin(c.el, firsts[i]));
      forceReflow(colsEl); // 确立过渡起点
      colsEl.classList.add("easing");
      cells.forEach((c, i) => pin(c.el, lasts[i]));
      ease.current = {
        els: cells.map((c) => c.el),
        timer: window.setTimeout(stopEase, EASE_MS),
      };
    });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>, leftId: string, rightId: string) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    if (drag.current) return;
    const leftEl = colEl(leftId);
    const rightEl = colEl(rightId);
    if (!leftEl || !rightEl) return;
    e.preventDefault();
    stopEase();
    const { min, max } = limitsOf(e.currentTarget);
    const lw = leftEl.getBoundingClientRect().width;
    const rw = rightEl.getBoundingClientRect().width;
    const d = clampDelta(e.key === "ArrowRight" ? KEY_STEP : -KEY_STEP, lw, rw, min, max);
    if (d === 0) return;
    // 键盘步进同样整行 commit：其余列钉在当前实测宽，零和步进不引发整行重排
    const patch = measureRow();
    patch[leftId] = lw + d;
    patch[rightId] = rw - d;
    onCommit(patch);
  };

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick, onKeyDown };
}
