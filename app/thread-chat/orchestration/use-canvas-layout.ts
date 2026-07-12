"use client";
/**
 * orchestration/use-canvas-layout —— 画布模式的视图状态 hook（对标 useColumnSlots）。
 *
 * 职责边界：会话树归 core store；「哪个节点摆在画布哪个坐标」是视口状态，归这里。
 * 派生链（skill 契约 #11/#12：受控 nodes/edges、永不原地改对象）：
 * · base（结构 + 展示数据 + 尺寸估算）仅随 store version 重派生——state 对象原地
 *   修改、引用永不变化（见 core/use-thread-store 头注），必须以 version 为 memo key；
 * · autoPos（dagre TB 自动布局）只依赖 base，拖拽 / 选中不会重跑 dagre；
 * · nodes = base × (pin 覆盖坐标 ?? dagre 坐标) × 选中态，三层 useMemo 逐级缓存。
 *
 * pin 语义：节点一旦被手动拖动即写入 pins 覆盖表；树变化重新布局时只有未 pin
 * 节点吃 dagre 新坐标。pins 不进 core store，但要跨「列 ⇄ 画布」切换存活
 * （画布组件按需挂载 / 卸载），故由壳层持有一个稳定的可变宿主对象（CanvasViewState，
 * 与壳层持有 store 同一模式：useState(初始化函数) 造出的长寿对象，hook 里读写镜像）。
 */

import { useCallback, useMemo, useState } from "react";
import type {
  Edge,
  NodePositionChange,
  OnNodesChange,
  XYPosition,
} from "@xyflow/react";
import {
  graphlib,
  layout as dagreLayout,
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
} from "@dagrejs/dagre";
import type { ThreadTreeState } from "../core/types";
import type { ThreadStore } from "../core/store";
import { accentOf, dotColorOf, dvar } from "../theme";
import type { CanvasCardData, CanvasCardNode } from "./canvas-node";

/**
 * 跨模式切换存活的画布视图状态宿主（不进 core store）。
 * 由壳层 useState(() => ({ pins: new Map() })) 创建（type-only import，不牵连本模块运行时）；
 * hook 在事件回调里读写它，使 pin 表在画布卸载/重挂后仍在。
 */
export interface CanvasViewState {
  pins: ReadonlyMap<string, XYPosition>;
}

/** 写宿主镜像：对长寿对象的突变收敛在非 React 代码里（与 core/store 同一约定） */
function persistPins(host: CanvasViewState, pins: ReadonlyMap<string, XYPosition>): void {
  host.pins = pins;
}

/* ---------------- 卡片尺寸估算（与 thread-chat.css 的 .canvas-card 同步） ---------------- */

/** 卡宽固定（.canvas-card width） */
const CARD_W = 280;
/** 内容宽：280 − 13×2 padding − 3 左缘 − 1 右边框 */
const INNER_W = 250;

/** 粗估文本行数：CJK 记 1 字宽、其余记 0.55；上限与 CSS 的 line-clamp 一致 */
function estLines(text: string, fontPx: number, maxLines: number): number {
  let units = 0;
  for (const ch of text) units += ch.charCodeAt(0) > 0x2e7f ? 1 : 0.55;
  const perLine = Math.max(4, INNER_W / fontPx);
  return Math.min(maxLines, Math.max(1, Math.ceil(units / perLine)));
}

/** 估算卡高喂给 dagre：与实测高相差几个像素，误差由 ranksep 吸收（skill layouting 做法） */
function estimateCardHeight(d: CanvasCardData): number {
  let h = 24; // 上下 padding 11×2 + 上下边框
  h += 26; // chead：徽章 + 标题一行
  if (d.subtitle) h += estLines(d.subtitle, 11.5, 2) * 17.5 + 4;
  if (d.anchor) h += estLines(d.anchor, 11.5, 2) * 17.5 + 12; // 引文行 + 内边距 + 下距
  if (d.summary) h += estLines(d.summary, 12, 3) * 19 + 8;
  h += 14; // meta 行
  return Math.round(h);
}

/* ---------------- state → 节点 / 边（结构派生，纯函数） ---------------- */

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};

interface BaseGraph {
  nodes: CanvasCardNode[];
  edges: Edge[];
  sizes: Map<string, { width: number; height: number }>;
}

function buildBaseGraph(state: ThreadTreeState, mainSubtitle: string | null): BaseGraph {
  const artifactCountOf = new Map<string, number>();
  state.artifactOrder.forEach((aid) => {
    const a = state.artifacts[aid];
    if (a) artifactCountOf.set(a.sourceThreadId, (artifactCountOf.get(a.sourceThreadId) ?? 0) + 1);
  });

  const nodes: CanvasCardNode[] = [];
  const edges: Edge[] = [];
  const sizes = new Map<string, { width: number; height: number }>();

  // 先序 DFS（与 selectors.allTreeRows 同序）：父节点先于子节点入数组
  const walk = (id: string) => {
    const t = state.threads[id];
    if (!t) return;
    const last = t.messages[t.messages.length - 1];
    const data: CanvasCardData = {
      isMain: t.id === "main",
      title: t.title,
      subtitle: t.id === "main" ? mainSubtitle : null,
      depth: t.depth,
      footnote: t.footnote,
      anchor: t.anchorText ? clip(t.anchorText, 40) : null,
      summary: last ? clip(last.text, 90) : "",
      msgCount: t.messages.length,
      artifactCount: artifactCountOf.get(t.id) ?? 0,
      accent: accentOf(t),
      dot: dotColorOf(t),
    };
    const size = { width: CARD_W, height: estimateCardHeight(data) };
    nodes.push({
      id: t.id,
      type: "threadCard",
      position: { x: 0, y: 0 }, // 占位，随后由 pin / dagre 覆盖
      data,
      // 实测前的初始尺寸：受控节点不回写 measured（dimensions change 被忽略），
      // MiniMap / 首帧 fitView 依赖 userNode 自带尺寸（nodeHasDimensions）才会渲染
      initialWidth: size.width,
      initialHeight: size.height,
      deletable: false,
      connectable: false,
    });
    sizes.set(t.id, size);

    if (t.parentId) {
      // 边 = parentId → id，子节点深度色描边；label 为脚注号徽章（镜像列模式脚注）
      const color = dvar(t.depth);
      edges.push({
        id: `e-${t.parentId}-${t.id}`,
        source: t.parentId,
        target: t.id,
        label: t.footnote !== null ? String(t.footnote) : undefined,
        style: { stroke: color, strokeWidth: 1.6 },
        labelStyle: { fill: "#fff", fontWeight: 700, fontSize: 10, fontFamily: "var(--font-mono)" },
        labelBgStyle: { fill: color },
        labelBgPadding: [5, 3],
        labelBgBorderRadius: 5,
        selectable: false,
        focusable: false,
      });
    }
    t.children.forEach(walk);
  };
  walk("main");
  return { nodes, edges, sizes };
}

/* ---------------- dagre TB 自动布局（兄弟横向铺开的 tidy tree） ---------------- */

function layoutPositions(base: BaseGraph): Map<string, XYPosition> {
  const g = new graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>();
  // nodesep：兄弟卡间距；ranksep：层间距（容纳边 label 徽章 + 吸收卡高估算误差）
  g.setGraph({ rankdir: "TB", nodesep: 48, ranksep: 96, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));
  base.nodes.forEach((n) => {
    const s = base.sizes.get(n.id)!;
    g.setNode(n.id, { width: s.width, height: s.height }); // 传副本，dagre 会往 label 里写 x/y
  });
  base.edges.forEach((e) => g.setEdge(e.source, e.target));
  dagreLayout(g);

  const out = new Map<string, XYPosition>();
  base.nodes.forEach((n) => {
    const p = g.node(n.id);
    const s = base.sizes.get(n.id)!;
    // dagre 给的是节点中心，React Flow 期望左上角
    out.set(n.id, { x: (p.x ?? 0) - s.width / 2, y: (p.y ?? 0) - s.height / 2 });
  });
  return out;
}

/* ---------------- hook ---------------- */

export interface UseCanvasLayoutArgs {
  store: ThreadStore;
  /** store 快照版本号（useThreadStore 返回值）：state 引用稳定，派生必须以它为 key */
  version: number;
  /** 主线卡副标题（壳层传入，与列模式同源） */
  mainSubtitle?: string;
  /** 视图状态宿主：pins 借它跨画布挂载/卸载存活（壳层持有的稳定可变对象） */
  viewState: CanvasViewState;
}

export function useCanvasLayout({ store, version, mainSubtitle, viewState }: UseCanvasLayoutArgs) {
  /** hook 内的 pins 快照驱动重渲；viewState.pins 是它的长寿镜像（事件回调里读写） */
  const [pins, setPins] = useState<ReadonlyMap<string, XYPosition>>(() => new Map(viewState.pins));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  /* store 原地修改、state 引用永不变化：组一个随 version 变化的快照对象作为派生 key */
  const snap = useMemo(() => ({ state: store.getState(), version }), [store, version]);
  /* 结构 + 展示数据：仅随快照重派生（data 引用稳定，拖拽/选中不重建） */
  const base = useMemo(() => buildBaseGraph(snap.state, mainSubtitle ?? null), [snap, mainSubtitle]);
  /* dagre 坐标：只依赖结构 */
  const autoPos = useMemo(() => layoutPositions(base), [base]);
  /* 受控 nodes：pin 覆盖 dagre，未 pin 节点在树变化时自动重排 */
  const nodes = useMemo<CanvasCardNode[]>(
    () =>
      base.nodes.map((n) => ({
        ...n,
        position: pins.get(n.id) ?? autoPos.get(n.id) ?? n.position,
        selected: n.id === selectedId,
      })),
    [base, autoPos, pins, selectedId],
  );

  /* 受控回写：position 变更（拖拽/键盘移动）即 pin；select 变更维护单选态 */
  const onNodesChange = useCallback<OnNodesChange<CanvasCardNode>>(
    (changes) => {
      const moved = changes.filter(
        (c): c is NodePositionChange & { position: XYPosition } =>
          c.type === "position" && c.position !== undefined,
      );
      if (moved.length) {
        const next = new Map(viewState.pins); // 宿主永远是最新镜像（事件串行，无竞态）
        moved.forEach((c) => next.set(c.id, c.position));
        persistPins(viewState, next);
        setPins(next);
      }
      changes.forEach((c) => {
        if (c.type === "select") {
          setSelectedId((cur) => (c.selected ? c.id : cur === c.id ? null : cur));
        }
      });
    },
    [viewState],
  );

  /** 重新排列：清空 pin，全部节点回到 dagre 坐标（fitView 由画布组件跟进） */
  const resetLayout = useCallback(() => {
    const empty = new Map<string, XYPosition>();
    persistPins(viewState, empty);
    setPins(empty);
  }, [viewState]);

  return { nodes, edges: base.edges, onNodesChange, resetLayout, pinCount: pins.size };
}
