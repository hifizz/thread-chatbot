"use client"
/**
 * orchestration/thread-canvas —— 画布视图层（与 thread-columns 平级的第二个编排层）。
 *
 * Phase 1 只读画布：React Flow 容器 + 节点/边装配 + pan/zoom/fitView + MiniMap/Controls。
 * 会话树归 core store（经 useThreadStore 以 version 驱动重派生）；坐标/pin 等视口
 * 状态归 use-canvas-layout。双击节点走壳层统一意图 openBranchUI 回列模式深读。
 *
 * Phase 2 节点内对话（openspec: add-canvas-conversations）：
 * · 单击选中节点 = 展开外挂面板（canvas-node 的 CanvasExpand）；
 * · CanvasActionsContext 注入 send/abort/retry（壳层 chat-controller）+ 画布内
 *   聚焦（focusThread）+ 树快照读取，穿过 React Flow 直达自定义节点（D3）；
 * · focusNode:{id,n}（壳层在画布内 fork 时置值，n 递增去重）→ selectNode +
 *   setCenter 平滑跟随（D4）；偏移按 LR 布局适配（见 focusThread 注释）。
 *
 * 本文件经 next/dynamic({ ssr:false }) 懒加载：React Flow 及其样式只在进入画布
 * 模式时才落地（首屏与列模式不背这份体积；RF 也依赖 DOM，天然需要跳过 SSR）。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type FitViewOptions,
  type NodeMouseHandler,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { RotateCcw } from "lucide-react"
import type { ThreadStore } from "../core/store"
import { useThreadStore } from "../core/use-thread-store"
import { dc } from "../theme"
import {
  CanvasActionsContext,
  CanvasCard,
  EXPAND_W,
  type CanvasActions,
  type CanvasChatActions,
  type CanvasCardNode,
} from "./canvas-node"
import { useCanvasLayout, type CanvasViewState } from "./use-canvas-layout"

/** nodeTypes 稳定引用：模块级定义，避免 React Flow 整树重挂（skill 契约 #4） */
const nodeTypes = { threadCard: CanvasCard }

const fitViewOptions: FitViewOptions = { padding: 0.18, maxZoom: 1 }

/** 聚焦动画时长（ms）与最低缩放：太小的 zoom 下面板文字不可读，聚焦顺手抬到可读档 */
const FOCUS_DURATION_MS = 320
const FOCUS_MIN_ZOOM = 0.85
/** 聚焦中心点的偏移：LR 主轴取横向（D1）——中心右移给右侧后续子分支留视野；
    纵向补外挂面板高度的一半量级（面板在 LR 下仍挂卡下方），卡 + 面板整体入画 */
const FOCUS_OFFSET_X = 120
const FOCUS_OFFSET_Y = 140

/** MiniMap 节点深度色走 .fc-N 类 + CSS fill（SVG 的 fill 属性不解析 var()，只能经 CSS） */
const minimapNodeClass = (n: CanvasCardNode) =>
  n.data.depth > 0 ? `fc-${dc(n.data.depth)}` : ""

export interface ThreadCanvasProps {
  store: ThreadStore
  /** 主线卡的主题副标题（与列模式主线副标题同源） */
  mainSubtitle?: string
  /** 画布视图状态宿主（pin 表跨「列 ⇄ 画布」切换存活），壳层持有的稳定对象 */
  viewState: CanvasViewState
  /** 统一意图：双击节点 = 回列模式打开该会话（壳层 openBranchUI） */
  onOpenThread: (threadId: string) => void
  /** 打开全局 Markdown 面板并选中对应交付物。 */
  onOpenArtifact: (artifactId: string) => void
  /** 会话动作（send/abort/retry）：壳层用 chat-controller 组装（D3，同一发送链路） */
  chat: CanvasChatActions
  /** 画布内 fork 的视口跟随指令：壳层每次 fork 置 {id, n}（n 递增去重），
      新节点入树后 selectNode + setCenter 平滑跟随（D4）；离开画布时壳层清空 */
  focusNode?: { id: string; n: number } | null
}

function CanvasFlow({
  store,
  mainSubtitle,
  viewState,
  onOpenThread,
  onOpenArtifact,
  chat,
  focusNode,
}: ThreadCanvasProps) {
  const version = useThreadStore(store)
  const { nodes, edges, onNodesChange, resetLayout, selectNode, pinCount } =
    useCanvasLayout({
      store,
      version,
      mainSubtitle,
      viewState,
    })
  const { fitView, setCenter, getZoom } = useReactFlow()

  /* 最新 nodes 镜像：focusThread 是进 Context 的稳定回调，经 ref 取坐标而非闭包捕获，
     避免 actions 每个 version 换新引用（面板 memo 白费） */
  const nodesRef = useRef(nodes)
  useEffect(() => {
    nodesRef.current = nodes
  }, [nodes])

  /** 画布内聚焦某节点：单选（展开面板）+ setCenter 平滑跟随（偏移按 LR 适配） */
  const focusThread = useCallback(
    (id: string) => {
      const node = nodesRef.current.find((x) => x.id === id)
      if (!node) return
      selectNode(id)
      const w = node.initialWidth ?? EXPAND_W
      const h = node.initialHeight ?? 120
      void setCenter(
        node.position.x + w / 2 + FOCUS_OFFSET_X,
        node.position.y + h / 2 + FOCUS_OFFSET_Y,
        {
          zoom: Math.max(getZoom(), FOCUS_MIN_ZOOM),
          duration: FOCUS_DURATION_MS,
        }
      )
    },
    [selectNode, setCenter, getZoom]
  )

  /* 节点面板的动作面（D3）：chat 三件套直达壳层 chat-controller；
     getState 供面板渲染读树快照（锚点 title 文案等） */
  const actions = useMemo<CanvasActions>(
    () => ({
      ...chat,
      focusThread,
      openArtifact: onOpenArtifact,
      getState: store.getState,
    }),
    [chat, focusThread, onOpenArtifact, store]
  )

  /* 画布内 fork：新节点入树后聚焦（ref 去重——effect 依赖含 nodes，每个 version
     都会跑；新节点可能晚于 focusNode 指令一拍出现，未找到时不标记已处理、下轮重试） */
  const handledFocus = useRef(0)
  useEffect(() => {
    if (!focusNode || focusNode.n === handledFocus.current) return
    if (!nodes.some((x) => x.id === focusNode.id)) return
    handledFocus.current = focusNode.n
    focusThread(focusNode.id)
  }, [focusNode, nodes, focusThread])

  /* 重新排列：清 pin → 全量 dagre 重排；坐标 commit 之后再 fitView 动画跟上 */
  const [relayoutN, setRelayoutN] = useState(0)
  const onRelayout = () => {
    resetLayout()
    setRelayoutN((n) => n + 1)
  }
  useEffect(() => {
    if (relayoutN > 0) void fitView({ ...fitViewOptions, duration: 320 })
  }, [relayoutN, fitView])

  const onNodeDoubleClick = useCallback<NodeMouseHandler<CanvasCardNode>>(
    (_, node) => onOpenThread(node.id),
    [onOpenThread]
  )

  return (
    /* React Flow 父容器必须有确定宽高：flex:1 + min-height:0 + width:100%（skill 契约 #3） */
    <div className="canvas-wrap">
      <CanvasActionsContext.Provider value={actions}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDoubleClick={onNodeDoubleClick}
          fitView
          fitViewOptions={fitViewOptions}
          minZoom={0.2}
          maxZoom={1.75}
          nodesConnectable={false}
          deleteKeyCode={null}
          zoomOnDoubleClick={false}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.4} />
          <Controls position="bottom-left" showInteractive={false} />
          <MiniMap<CanvasCardNode>
            pannable
            zoomable
            nodeClassName={minimapNodeClass}
            maskColor="rgba(245, 242, 234, 0.75)"
          />
          <Panel position="top-left" className="canvas-panel">
            <button
              className="cbtn"
              title="清除手动固定的节点位置，重新自动布局并适配视口"
              onClick={onRelayout}
            >
              <RotateCcw
                size={11}
                style={{ verticalAlign: "-1px", marginRight: 4 }}
              />
              重新排列{pinCount > 0 ? ` · 已固定 ${pinCount}` : ""}
            </button>
            <span className="canvas-tip">
              单击节点就地对话（可划选开分支）· 拖动固定位置 · 双击回列模式
            </span>
          </Panel>
        </ReactFlow>
      </CanvasActionsContext.Provider>
    </div>
  )
}

export function ThreadCanvas(props: ThreadCanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasFlow {...props} />
    </ReactFlowProvider>
  )
}
