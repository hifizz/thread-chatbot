/**
 * Canvas Dagre 布局能力。
 *
 * 卡片正文会在流式期间逐 token 变化，但 Dagre 只关心节点 id / 尺寸和边。
 * 这里按这组最小输入做有界缓存，让展示数据更新继续渲染而不重复全图布局。
 */

import dagre, {
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
} from "@dagrejs/dagre"
import type { XYPosition } from "@xyflow/react"

const { graphlib, layout: dagreLayout } = dagre

export interface CanvasLayoutSpec {
  nodes: readonly {
    id: string
    width: number
    height: number
  }[]
  edges: readonly {
    source: string
    target: string
  }[]
}

const MAX_LAYOUT_CACHE_ENTRIES = 32
const layoutCache = new Map<string, ReadonlyMap<string, XYPosition>>()

function layoutKey(spec: CanvasLayoutSpec): string {
  return JSON.stringify([
    spec.nodes.map(({ id, width, height }) => [id, width, height]),
    spec.edges.map(({ source, target }) => [source, target]),
  ])
}

function calculateLayout(spec: CanvasLayoutSpec): Map<string, XYPosition> {
  const graph = new graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>()
  // LR 横向布局下语义对调：ranksep = 水平层距；nodesep = 兄弟卡垂直间距。
  graph.setGraph({
    rankdir: "LR",
    nodesep: 40,
    ranksep: 110,
    marginx: 24,
    marginy: 24,
  })
  graph.setDefaultEdgeLabel(() => ({}))
  spec.nodes.forEach(({ id, width, height }) => {
    // 传副本，dagre 会往 label 里写 x/y。
    graph.setNode(id, { width, height })
  })
  spec.edges.forEach(({ source, target }) => graph.setEdge(source, target))
  dagreLayout(graph)

  const positions = new Map<string, XYPosition>()
  spec.nodes.forEach(({ id, width, height }) => {
    const point = graph.node(id)
    // dagre 给的是节点中心，React Flow 期望左上角。
    positions.set(id, {
      x: (point.x ?? 0) - width / 2,
      y: (point.y ?? 0) - height / 2,
    })
  })
  return positions
}

/** 相同语义布局输入返回同一只读坐标表；不同输入才执行 Dagre。 */
export function canvasLayoutPositions(
  spec: CanvasLayoutSpec
): ReadonlyMap<string, XYPosition> {
  const key = layoutKey(spec)
  const cached = layoutCache.get(key)
  if (cached) {
    // 命中时移到末尾，维持一个很小的 LRU 工作集。
    layoutCache.delete(key)
    layoutCache.set(key, cached)
    return cached
  }

  const positions = calculateLayout(spec)
  layoutCache.set(key, positions)
  if (layoutCache.size > MAX_LAYOUT_CACHE_ENTRIES) {
    const oldestKey = layoutCache.keys().next().value
    if (oldestKey !== undefined) layoutCache.delete(oldestKey)
  }
  return positions
}
