/**
 * orchestration/placement —— 「列满怎么办」的放置策略（Strategy 模式，纯函数、可单测）。
 *
 * 列槽模型：slots = { id, folded }[]。folded=true 表示该槽折叠为 30px 竖直细条，
 * 细条不计入展开上限、可累积。两个策略：
 * · replace（方案⑥，默认）：列满替换来源列，无来源替换 LRU 列，可撤销（folded 恒 false）；
 * · fold（方案⑤细条）：列满不替换——新列照常追加，同时把展开列中「LRU 且非来源、
 *   非新开」的一列原地折成细条；点细条原地展开，展开后超限则再折叠一条 LRU。
 *
 * 放置提示（PlacementHint）：默认规则之上的两级覆盖，优先级 targetId > keepSource > 默认。
 * · keepSource（⌘/Ctrl，对齐浏览器 Cmd+click 心智）：来源列必须保留，新列放到它紧邻右侧；
 * · targetId（划选气泡迷你列条点选）：显式指定让位的列（replace 替换它 / fold 折叠它）。
 * previewPlacement 与 place 共用同一套策略代码，保证气泡里的预览与提交后的行为一致。
 */

import { lruIndex } from "../core/selectors";

export type PlacementMode = "replace" | "fold";

export interface Slot {
  id: string;
  folded: boolean;
}

/** 「打开到哪一列」的放置提示：显式 targetId > ⌘ keepSource > 默认规则 */
export interface PlacementHint {
  /** ⌘/Ctrl 修饰键：来源列必须保留，新列放到它紧邻右侧（来源=主线 → 第一个槽位） */
  keepSource?: boolean;
  /** 迷你列条点选的让位列：replace 模式替换它，fold 模式折叠它（优先级最高） */
  targetId?: string;
}

export interface PlaceCtx {
  /** 来源列（从哪一列发起的打开动作），replace 策略优先替换它 */
  sourceId?: string | null;
  /** 展开列的数量上限（= 总列数 - 主线一列） */
  maxExpanded: number;
  /** LRU 依据：会话的活跃计数 */
  lastActiveOf: (id: string) => number;
  /** 可选的放置提示（划选气泡 / ⌘ 点击传入） */
  hint?: PlacementHint;
}

export type PlaceEffect =
  | { kind: "visible" } // 目标已展开可见（或细条已原地展开且未挤掉别列），只需 flash
  | { kind: "appended" } // 有空位，追加了新列
  | { kind: "replaced"; idx: number; replacedId: string; prevSlots: Slot[] } // ⑥：替换（可撤销）
  | { kind: "folded"; foldedId: string }; // ⑤：目标已可见，同时把另一列折成了细条

export interface PlaceResult {
  slots: Slot[];
  effect: PlaceEffect;
}

export type PlacementStrategy = (slots: Slot[], threadId: string, ctx: PlaceCtx) => PlaceResult;

const cloneSlots = (slots: Slot[]) => slots.map((s) => ({ ...s }));
const expandedOf = (slots: Slot[]) => slots.filter((s) => !s.folded);

/** 来源列的槽位下标；来源不在槽内（主线 / 已关闭 / 未指定）时为 -1，其「邻右」= 第一个槽位 */
const sourceIdxOf = (slots: Slot[], ctx: PlaceCtx) =>
  ctx.sourceId ? slots.findIndex((s) => s.id === ctx.sourceId) : -1;

/** 在下标 i 处插入一个展开的新槽（其余槽右移） */
const insertSlot = (slots: Slot[], i: number, id: string): Slot[] => {
  const next = cloneSlots(slots);
  next.splice(i, 0, { id, folded: false });
  return next;
};

/* ---------------- 方案⑥：列满替换 ---------------- */
export const replaceStrategy: PlacementStrategy = (slots, threadId, ctx) => {
  const at = slots.findIndex((s) => s.id === threadId);
  if (at >= 0) {
    // replace 策略下不应存在细条；防御：若有（策略切换的瞬时态）则原地展开
    if (slots[at].folded) {
      const next = cloneSlots(slots);
      next[at].folded = false;
      return { slots: next, effect: { kind: "visible" } };
    }
    return { slots, effect: { kind: "visible" } };
  }

  const replaceAt = (idx: number): PlaceResult => {
    const prevSlots = cloneSlots(slots);
    const replacedId = slots[idx].id;
    const next = cloneSlots(slots);
    next[idx] = { id: threadId, folded: false };
    return { slots: next, effect: { kind: "replaced", idx, replacedId, prevSlots } };
  };

  // ① 显式 override（迷你列条点选）：用户点名让位的列，无视空位直接替换（可撤销照旧）
  const ovId = ctx.hint?.targetId;
  if (ovId) {
    const ovIdx = slots.findIndex((s) => s.id === ovId);
    if (ovIdx >= 0) return replaceAt(ovIdx);
    // 指定列已不在场：忽略 override，落回后续规则
  }

  const srcIdx = sourceIdxOf(slots, ctx);

  if (slots.length < ctx.maxExpanded) {
    // ② 有空位：默认追加到最右；⌘ keepSource 改为紧邻来源右侧插入（来源=主线 → 第一个槽位）
    const insertAt = ctx.hint?.keepSource ? srcIdx + 1 : slots.length;
    return { slots: insertSlot(slots, insertAt, threadId), effect: { kind: "appended" } };
  }

  // ③ 列满
  let idx: number;
  if (ctx.hint?.keepSource) {
    // ⌘：替换来源列的邻右列（来源=主线 → 第一个槽位）；来源已是最右列时退化为
    // 替换「除来源外的 LRU」；连候选都没有（仅 1 槽且即来源）时无从保留，替换来源兜底
    if (srcIdx < slots.length - 1) {
      idx = srcIdx + 1;
    } else {
      const pool = slots.filter((s) => s.id !== ctx.sourceId);
      idx = pool.length
        ? slots.indexOf(pool[lruIndex(pool.map((p) => p.id), ctx.lastActiveOf)])
        : srcIdx;
    }
  } else {
    // 默认：替换来源列；来源不可见时替换最久未使用的列
    idx = srcIdx;
    if (idx < 0) idx = lruIndex(slots.map((s) => s.id), ctx.lastActiveOf);
  }
  return replaceAt(idx);
};

/* ---------------- 方案⑤：列满折叠细条 ---------------- */
export const foldStrategy: PlacementStrategy = (slots, threadId, ctx) => {
  const at = slots.findIndex((s) => s.id === threadId);
  if (at >= 0 && !slots[at].folded) return { slots, effect: { kind: "visible" } };

  let next: Slot[];
  let appended = false;
  if (at >= 0) {
    // 目标是细条：原地展开
    next = cloneSlots(slots);
    next[at].folded = false;
  } else {
    // 默认追加到最右；⌘ keepSource 改为紧邻来源槽位右侧插入（来源=主线 → 第一个槽位）
    const insertAt = ctx.hint?.keepSource ? sourceIdxOf(slots, ctx) + 1 : slots.length;
    next = insertSlot(slots, insertAt, threadId);
    appended = true;
  }

  const doneEffect: PlaceEffect = appended ? { kind: "appended" } : { kind: "visible" };
  const foldById = (foldId: string): PlaceResult => ({
    slots: next.map((s) => (s.id === foldId ? { ...s, folded: true } : s)),
    effect: { kind: "folded", foldedId: foldId },
  });

  // ① 显式 override（迷你列条点选）：用户点名让位的列——无论是否超限都折叠它
  //   （折叠恰好一条，展开数 = 原展开数 ≤ 上限，不变式保持）
  const ovId = ctx.hint?.targetId;
  if (ovId && ovId !== threadId) {
    const ov = next.find((s) => s.id === ovId && !s.folded);
    if (ov) return foldById(ov.id);
  }

  const expanded = expandedOf(next);
  if (expanded.length <= ctx.maxExpanded) return { slots: next, effect: doneEffect };

  // ② 展开数超限：折叠一条 LRU。候选池 = 展开列 − {新开, 来源}——新开的目标永不折；
  //   ⌘ keepSource 下「不折来源」升级为硬保证。数学上 preferred 为空 ⟺ 展开列只剩
  //   {新开, 来源}（仅 maxExpanded=1 可达），此时「来源保持展开」与「展开数 ≤ 上限」
  //   不可两全，且新开右侧不存在可折的非来源展开列；按「不允许超限」优先折来源兜底
  //   （细条仍在场，一键可原地展开）。
  const preferred = expanded.filter((s) => s.id !== threadId && s.id !== ctx.sourceId);
  const pool = preferred.length ? preferred : expanded.filter((s) => s.id !== threadId);
  if (!pool.length) return { slots: next, effect: doneEffect }; // 理论上到不了，保证不崩
  const foldId = pool[lruIndex(pool.map((s) => s.id), ctx.lastActiveOf)].id;
  return foldById(foldId);
};

export const strategies: Record<PlacementMode, PlacementStrategy> = {
  replace: replaceStrategy,
  fold: foldStrategy,
};

/** 统一入口：按当前模式放置 */
export function place(
  mode: PlacementMode,
  slots: Slot[],
  threadId: string,
  ctx: PlaceCtx,
): PlaceResult {
  return strategies[mode](slots, threadId, ctx);
}

/** previewPlacement 用的哨兵 id：预览「尚未创建」的新分支会落到哪 */
const PREVIEW_NEW_ID = "__preview_new__";

/** 放置预览：新列将出现的槽位 + 将被替换 / 折叠的列（null = 无） */
export interface PlacePreview {
  /** 新列将出现的槽位下标（0 = 主线右侧第一个槽位） */
  insertAt: number;
  /** 将被替换的会话 id（replace 类效果；此时新列占其槽位，无额外插入） */
  replaceId: string | null;
  /** 将被折叠成细条的会话 id（fold 效果） */
  foldId: string | null;
}

/**
 * 预览「即将开启的新分支会放到哪」：内部就是拿哨兵 id 跑一遍 place()，
 * 与提交共用同一套策略代码——气泡迷你列条显示的目标即提交后的实际行为。
 */
export function previewPlacement(mode: PlacementMode, slots: Slot[], ctx: PlaceCtx): PlacePreview {
  const { slots: next, effect } = place(mode, slots, PREVIEW_NEW_ID, ctx);
  return {
    insertAt: next.findIndex((s) => s.id === PREVIEW_NEW_ID),
    replaceId: effect.kind === "replaced" ? effect.replacedId : null,
    foldId: effect.kind === "folded" ? effect.foldedId : null,
  };
}

/**
 * 窄屏 / 强制列数收缩时的裁列：从最左的槽裁起（不分细条与否），
 * 直到展开列数不超过上限。replace 模式下等价于原先的「slice 掉最早的列」。
 */
export function trimSlots(slots: Slot[], maxExpanded: number): Slot[] {
  const out = cloneSlots(slots);
  while (out.length && expandedOf(out).length > Math.max(0, maxExpanded)) out.shift();
  return out;
}

/**
 * fold → replace 的模式切换归一化：把所有细条展开，再从左裁掉超限列。
 * 返回归一化后的 slots 与被裁掉的会话 id（供 toast 说明）。
 */
export function normalizeForReplace(
  slots: Slot[],
  maxExpanded: number,
): { slots: Slot[]; dropped: string[] } {
  const expanded = slots.map((s) => ({ id: s.id, folded: false }));
  const keep = Math.max(0, maxExpanded);
  const dropCount = Math.max(0, expanded.length - keep);
  return { slots: expanded.slice(dropCount), dropped: expanded.slice(0, dropCount).map((s) => s.id) };
}
