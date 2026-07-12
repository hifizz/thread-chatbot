"use client";
/**
 * orchestration/canvas-node —— 画布模式的自定义节点：一个 thread 一张「手稿纸质」卡。
 *
 * 与列模式同一套纸墨视觉语言（复用 .tc 的 CSS 变量 / .anchor-tag）：
 * 深度色左缘 3px + 脚注号徽章 + 衬线标题 + 讨论焦点引文 + 末条消息摘要 + meta 行；
 * 主线卡特殊化为「锚定」tag + 主题副标题。data 全部由 use-canvas-layout 派生成
 * 展示就绪的字段（本组件纯展示、React.memo，skill 契约：custom node 优先 + memo）。
 *
 * 只读画布：Handle 仅为边的定位锚点（isConnectable=false，CSS 以 opacity 隐藏——
 * 不能 display:none，会破坏 React Flow 的边坐标计算，skill 契约 #8）。
 */

import React, { memo } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";

export interface CanvasCardData extends Record<string, unknown> {
  isMain: boolean;
  title: string;
  /** 主线卡的主题副标题（与列模式主线副标题同源，由壳层传入） */
  subtitle: string | null;
  depth: number;
  footnote: number | null;
  /** 讨论焦点（划选原文，已截断；主线为 null） */
  anchor: string | null;
  /** 末条消息摘要（~90 字，已截断） */
  summary: string;
  msgCount: number;
  artifactCount: number;
  /** 深度强调色 / 圆点色（theme.ts 的 accentOf / dotColorOf） */
  accent: string;
  dot: string;
}

export type CanvasCardNode = Node<CanvasCardData, "threadCard">;

export const CanvasCard = memo(function CanvasCard({ data }: NodeProps<CanvasCardNode>) {
  return (
    <div
      className="canvas-card"
      style={{ "--accent": data.accent } as React.CSSProperties}
      title="双击：回到列模式打开此会话"
    >
      <Handle type="target" position={Position.Top} isConnectable={false} />
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
      {data.summary && <div className="sum">{data.summary}</div>}
      <div className="meta">
        <span>{data.msgCount} 条消息</span>
        {data.artifactCount > 0 && (
          <span className="am">
            <span className="dot" style={{ background: data.dot }} />
            {data.artifactCount} Artifact
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  );
});
