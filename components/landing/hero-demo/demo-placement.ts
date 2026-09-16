/**
 * 演示侧的「列满怎么办」精简放置：与工作台 orchestration/columns/placement.ts 同语义
 * （replace / fold、hint 优先级 targetId > keepSource > 默认、预览与提交共用一套代码），
 * 但只依赖本地活跃序，不 import 工作台模块——首页演示与工作台代码保持隔离。
 * 「自适应」按最多三列处理（窄屏由 CSS 横滑承担）。
 */
export type DemoPlacementMode = "replace" | "fold";

export interface DemoSlot {
  id: string;
  folded: boolean;
}

export interface DemoPlacementHint {
  keepSource?: boolean;
  targetId?: string;
}

export interface DemoPlaceCtx {
  sourceId?: string | null;
  maxExpanded: number;
  lastActiveOf: (id: string) => number;
  hint?: DemoPlacementHint;
}

export type DemoPlaceEffect =
  | { kind: "visible" }
  | { kind: "appended" }
  | { kind: "replaced"; idx: number; replacedId: string; prevSlots: DemoSlot[] }
  | { kind: "folded"; foldedId: string };

export interface DemoPlaceResult {
  slots: DemoSlot[];
  effect: DemoPlaceEffect;
}

export interface DemoPlacePreview {
  insertAt: number;
  replaceId: string | null;
  foldId: string | null;
}

function cloneSlots(slots: DemoSlot[]): DemoSlot[] {
  return slots.map((s) => ({ ...s }));
}

function expandedOf(slots: DemoSlot[]): DemoSlot[] {
  return slots.filter((s) => !s.folded);
}

function demoLruIndex(ids: string[], lastActiveOf: (id: string) => number): number {
  let idx = 0;
  let min = Infinity;
  ids.forEach((id, i) => {
    const la = lastActiveOf(id);
    if (la < min) {
      min = la;
      idx = i;
    }
  });
  return idx;
}

function sourceIdxOf(slots: DemoSlot[], ctx: DemoPlaceCtx): number {
  return ctx.sourceId ? slots.findIndex((s) => s.id === ctx.sourceId) : -1;
}

function insertSlot(slots: DemoSlot[], i: number, id: string): DemoSlot[] {
  const next = cloneSlots(slots);
  next.splice(Math.max(0, Math.min(i, next.length)), 0, { id, folded: false });
  return next;
}

function replaceStrategy(slots: DemoSlot[], threadId: string, ctx: DemoPlaceCtx): DemoPlaceResult {
  const at = slots.findIndex((s) => s.id === threadId);
  if (at >= 0) {
    if (slots[at].folded) {
      const next = cloneSlots(slots);
      next[at].folded = false;
      return { slots: next, effect: { kind: "visible" } };
    }
    return { slots, effect: { kind: "visible" } };
  }
  const replaceAt = (idx: number): DemoPlaceResult => {
    const prevSlots = cloneSlots(slots);
    const replacedId = slots[idx].id;
    const next = cloneSlots(slots);
    next[idx] = { id: threadId, folded: false };
    return { slots: next, effect: { kind: "replaced", idx, replacedId, prevSlots } };
  };
  const ovId = ctx.hint?.targetId;
  if (ovId) {
    const ovIdx = slots.findIndex((s) => s.id === ovId);
    if (ovIdx >= 0) return replaceAt(ovIdx);
  }
  const srcIdx = sourceIdxOf(slots, ctx);
  if (slots.length < Math.max(1, ctx.maxExpanded)) {
    const insertAt = ctx.hint?.keepSource ? srcIdx + 1 : slots.length;
    return { slots: insertSlot(slots, insertAt, threadId), effect: { kind: "appended" } };
  }
  let idx: number;
  if (ctx.hint?.keepSource) {
    if (srcIdx < slots.length - 1) {
      idx = srcIdx + 1;
    } else {
      const pool = slots.filter((s) => s.id !== ctx.sourceId);
      idx = pool.length
        ? slots.indexOf(pool[demoLruIndex(pool.map((p) => p.id), ctx.lastActiveOf)])
        : srcIdx;
    }
  } else {
    idx = srcIdx;
    if (idx < 0) idx = demoLruIndex(slots.map((s) => s.id), ctx.lastActiveOf);
  }
  return replaceAt(idx);
}

function foldStrategy(slots: DemoSlot[], threadId: string, ctx: DemoPlaceCtx): DemoPlaceResult {
  const at = slots.findIndex((s) => s.id === threadId);
  if (at >= 0 && !slots[at].folded) return { slots, effect: { kind: "visible" } };
  let next: DemoSlot[];
  let appended = false;
  if (at >= 0) {
    next = cloneSlots(slots);
    next[at].folded = false;
  } else {
    const insertAt = ctx.hint?.keepSource ? sourceIdxOf(slots, ctx) + 1 : slots.length;
    next = insertSlot(slots, insertAt, threadId);
    appended = true;
  }
  const doneEffect: DemoPlaceEffect = appended ? { kind: "appended" } : { kind: "visible" };
  const foldById = (foldId: string): DemoPlaceResult => ({
    slots: next.map((s) => (s.id === foldId ? { ...s, folded: true } : s)),
    effect: { kind: "folded", foldedId: foldId },
  });
  const ovId = ctx.hint?.targetId;
  if (ovId && ovId !== threadId) {
    const ov = next.find((s) => s.id === ovId && !s.folded);
    if (ov) return foldById(ov.id);
  }
  const expanded = expandedOf(next);
  if (expanded.length <= Math.max(1, ctx.maxExpanded)) return { slots: next, effect: doneEffect };
  const preferred = expanded.filter((s) => s.id !== threadId && s.id !== ctx.sourceId);
  const pool = preferred.length ? preferred : expanded.filter((s) => s.id !== threadId);
  if (!pool.length) return { slots: next, effect: doneEffect };
  return foldById(pool[demoLruIndex(pool.map((s) => s.id), ctx.lastActiveOf)].id);
}

export function placeDemoSlot(
  mode: DemoPlacementMode,
  slots: DemoSlot[],
  threadId: string,
  ctx: DemoPlaceCtx,
): DemoPlaceResult {
  return mode === "fold" ? foldStrategy(slots, threadId, ctx) : replaceStrategy(slots, threadId, ctx);
}

const PREVIEW_NEW_ID = "__preview_new__";

export function previewDemoPlacement(
  mode: DemoPlacementMode,
  slots: DemoSlot[],
  ctx: DemoPlaceCtx,
): DemoPlacePreview {
  const { slots: next, effect } = placeDemoSlot(mode, slots, PREVIEW_NEW_ID, ctx);
  return {
    insertAt: next.findIndex((s) => s.id === PREVIEW_NEW_ID),
    replaceId: effect.kind === "replaced" ? effect.replacedId : null,
    foldId: effect.kind === "folded" ? effect.foldedId : null,
  };
}

export function trimDemoSlots(slots: DemoSlot[], maxExpanded: number): DemoSlot[] {
  const out = cloneSlots(slots);
  while (out.length && expandedOf(out).length > Math.max(0, maxExpanded)) out.shift();
  return out;
}

/**
 * 「自适应」= 最多三列（主线 + 2 分支）；显式列数扣掉主线那一列。
 * 窄屏不在这里收窄：CSS 用 100vw 槽宽 + 横滑表达，避免 SSR/CSR 视口不一致。
 */
export function maxExpandedFor(forceCols: number | null): number {
  const total = forceCols ?? 3;
  return Math.max(1, total - 1);
}
