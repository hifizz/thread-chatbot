"use client"
/**
 * orchestration/canvas-node —— 画布模式的自定义节点：一个 thread 一张「手稿纸质」卡。
 *
 * 与列模式同一套纸墨视觉语言（复用 .tc 的 CSS 变量 / .anchor-tag）：
 * 深度色左缘 3px + 脚注号徽章 + 衬线标题 + 讨论焦点引文 + 末条消息摘要 + meta 行；
 * 主线卡特殊化为「锚定」tag + 主题副标题。data 全部由 use-canvas-layout 派生成
 * 展示就绪的字段（React.memo，skill 契约：custom node 优先 + memo）。
 *
 * Phase 2 节点内对话（openspec: add-canvas-conversations）：选中节点在卡片下方
 * 展开「外挂面板」CanvasExpand——绝对定位、不参与 dagre 布局（展开零重排，D1）；
 * 消息渲染复用列模式全套（AnchoredAssistantBody：Markdown + SmoothText + 锚点
 * 手绘 effect，D2）并挂列模式的划选 DOM 契约（.msg-list[data-list] /
 * .message[data-msg-id] / .bubble[data-role]），document 级划选气泡零改动生效；
 * 发送 / 停止 / 重试经 CanvasActionsContext 直达壳层 chat-controller（D3）；
 * 手势共处（D5）：面板挂 nodrag/nowheel（选字不拖节点、内滚不缩放画布），
 * 双击 stopPropagation 不误触「回列模式」。
 *
 * Handle 仅为边的定位锚点（isConnectable=false，CSS 以 opacity 隐藏——
 * 不能 display:none，会破坏 React Flow 的边坐标计算，skill 契约 #8）。
 */

import React, { memo } from "react"
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react"
import type { Message } from "../../core/types"
import { CANVAS_CARD_DIMENSIONS } from "./canvas-card-dimensions"
import { CanvasExpand } from "./canvas-expand"

export interface CanvasCardData extends Record<string, unknown> {
  isMain: boolean
  title: string
  /** 主线卡的主题副标题（与列模式主线副标题同源，由壳层传入） */
  subtitle: string | null
  depth: number
  footnote: number | null
  /** 讨论焦点（划选原文，已截断；主线为 null） */
  anchor: string | null
  /** 末条消息摘要（~90 字，已截断） */
  summary: string
  msgCount: number
  artifactCount: number
  /** 深度强调色 / 圆点色（theme.ts 的 accentOf / dotColorOf） */
  accent: string
  dot: string
  /** 完整消息列表（外挂面板用）：store 原地可变，base 随 version 重派生保证最新 */
  messages: Message[]
  /** mini composer 预填（空分支的代拟首问，语义同列模式 composerPrefillFor） */
  prefill: string | null
}

export type CanvasCardNode = Node<CanvasCardData, "threadCard">

export const CanvasCard = memo(function CanvasCard({
  id,
  data,
  selected,
}: NodeProps<CanvasCardNode>) {
  return (
    <div
      className="canvas-card tc-accent-context" /* 选中态样式由 .react-flow__node.selected 提供；此前的条件类拼接丢空格产出 canvas-cardexpanded 单 token，选中即丢全部卡片样式（codex review P1） */
      style={
        {
          "--tc-accent": data.accent,
          "--canvas-card-width": `${CANVAS_CARD_DIMENSIONS.width}px`,
          "--canvas-card-padding-block": `${CANVAS_CARD_DIMENSIONS.paddingBlock}px`,
          "--canvas-card-padding-inline": `${CANVAS_CARD_DIMENSIONS.paddingInline}px`,
          "--canvas-card-header-min-height": `${CANVAS_CARD_DIMENSIONS.headerMinHeight}px`,
          "--canvas-card-header-margin-bottom": `${CANVAS_CARD_DIMENSIONS.headerMarginBottom}px`,
          "--canvas-card-body-font-size": `${CANVAS_CARD_DIMENSIONS.bodyFontSize}px`,
          "--canvas-card-body-line-height":
            CANVAS_CARD_DIMENSIONS.bodyLineHeight,
          "--canvas-card-body-max-lines": CANVAS_CARD_DIMENSIONS.bodyMaxLines,
          "--canvas-card-anchor-padding-block": `${CANVAS_CARD_DIMENSIONS.anchorPaddingBlock}px`,
          "--canvas-card-anchor-margin-bottom": `${CANVAS_CARD_DIMENSIONS.anchorMarginBottom}px`,
          "--canvas-card-summary-font-size": `${CANVAS_CARD_DIMENSIONS.summaryFontSize}px`,
          "--canvas-card-summary-line-height":
            CANVAS_CARD_DIMENSIONS.summaryLineHeight,
          "--canvas-card-summary-max-lines":
            CANVAS_CARD_DIMENSIONS.summaryMaxLines,
          "--canvas-card-summary-margin-bottom": `${CANVAS_CARD_DIMENSIONS.summaryMarginBottom}px`,
        } as React.CSSProperties
      }
      title={selected ? undefined : "单击：就地展开对话 · 双击：回到列模式打开"}
    >
      {/* LR 横向树：入边锚在左缘、出边锚在右缘（与 dagre rankdir:LR 对应） */}
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <div className="chead">
        {data.isMain ? (
          <span className="anchor-tag">锚定</span>
        ) : (
          data.footnote !== null && <span className="fn">{data.footnote}</span>
        )}
        <span className="ttl">{data.title}</span>
      </div>
      {data.subtitle && <div className="sub">{data.subtitle}</div>}
      {data.anchor && <div className="anch">「{data.anchor}」</div>}
      {/* 展开时摘要收起（面板已呈现完整末条，避免重复）；dagre 估高不感知选中态，
          故这只改本卡内部高度、不改布局输入——零重排（D1） */}
      {!selected && data.summary && <div className="sum">{data.summary}</div>}
      <div className="meta">
        <span>{data.msgCount} 条消息</span>
        {data.artifactCount > 0 && (
          <span className="am">
            <span className="dot" style={{ background: data.dot }} />
            {data.artifactCount} Markdown
          </span>
        )}
      </div>
      {selected && <CanvasExpand threadId={id} data={data} />}
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  )
})
