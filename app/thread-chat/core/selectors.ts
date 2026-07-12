/**
 * core/selectors —— 从会话树派生数据的纯函数（headless，不 import React）。
 * 全部只读，不修改 state；配合外部 store 的「version 快照」模型使用。
 */

import type { Message, Thread, ThreadTreeState } from "./types";

/** 会话标题（找不到时回退为 id，供 toast 等文案使用） */
export function threadTitle(state: ThreadTreeState, id: string): string {
  return state.threads[id]?.title ?? id;
}

/** 从主线到指定会话的完整链路（含两端），面包屑用 */
export function lineage(state: ThreadTreeState, id: string): Thread[] {
  const chain: Thread[] = [];
  let cur: Thread | undefined = state.threads[id];
  while (cur) {
    chain.unshift(cur);
    cur = cur.parentId ? state.threads[cur.parentId] : undefined;
  }
  return chain;
}

/** 沿 lineage 向上收集「继承的上文」：每一层父会话截取到 forkFromMsgId 为止 */
export function collectInherited(state: ThreadTreeState, thread: Thread): Message[] {
  if (!thread.parentId) return [];
  const parent = state.threads[thread.parentId];
  if (!parent) return [];
  const i = parent.messages.findIndex((m) => m.id === thread.forkFromMsgId);
  const upto = parent.messages.slice(0, i + 1);
  return parent.parentId === null ? upto : [...collectInherited(state, parent), ...upto];
}

/** 会话树/子树扁平化后的一行（切换器、子树弹层共用的行模型） */
export interface TreeRow {
  id: string;
  /** 绝对深度（主线 = 0），决定深度配色 */
  depth: number;
  /** 相对缩进层级：全树 rows 中等于 depth，子树 rows 中从 0 起 */
  relDepth: number;
  isMain: boolean;
  title: string;
  footnote: number | null;
  anchor: string | null;
}

function rowOf(t: Thread, relDepth: number): TreeRow {
  return {
    id: t.id,
    depth: t.depth,
    relDepth,
    isMain: t.id === "main",
    title: t.title,
    footnote: t.footnote,
    anchor: t.anchorText,
  };
}

/** 整棵树的先序遍历 rows（⌘K / 每列 ⇄ 切换器用） */
export function allTreeRows(state: ThreadTreeState): TreeRow[] {
  return subtreeRowsInner(state, "main", 0, true);
}

/** 以 rootId 为根的整棵子树 rows（不含根自身，relDepth 从 0 起），子树弹层用 */
export function subtreeRows(state: ThreadTreeState, rootId: string): TreeRow[] {
  return subtreeRowsInner(state, rootId, 0, false);
}

function subtreeRowsInner(
  state: ThreadTreeState,
  rootId: string,
  relDepth: number,
  includeRoot: boolean,
): TreeRow[] {
  const root = state.threads[rootId];
  if (!root) return [];
  const rows: TreeRow[] = [];
  const walk = (id: string, rel: number) => {
    const t = state.threads[id];
    if (!t) return;
    rows.push(rowOf(t, rel));
    t.children.forEach((c) => walk(c, rel + 1));
  };
  if (includeRoot) walk(rootId, relDepth);
  else root.children.forEach((c) => walk(c, relDepth));
  return rows;
}

/** 一组会话里「最久未使用」那个的下标（放置策略的 LRU 依据） */
export function lruIndex(ids: string[], lastActiveOf: (id: string) => number): number {
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
