# ADR-0003：模型只获得高层只读 Browser Tool

- Status: Proposed (OpenSpec approval pending)
- Date: 2026-08-03
- Related: design D3/D5/D6；`sandboxed-browser-retrieval` spec

## Context

允许模型提供 URL、selector、JavaScript 或任意动作序列，会让 prompt injection 直接控制浏览器。产品目标只是读取公开 JS 渲染文档，不是 computer-use agent。

## Decision

工具 schema 只接受当前响应 sourceId 与枚举 approvedGoal。服务端运行固定只读流程：验证来源、导航、有限 wait、可选批准的 disclosure expand、提取 visible main text、净化、停止。禁止登录、表单、上传、支付、权限、下载、popup 和未批准跨域。

## Alternatives

- 通用 browser actions：弃选，超出产品目标与风险承受能力。
- 让模型写 Playwright：弃选，相当于远程代码执行。
- 只返回 screenshot 给视觉模型：首版弃选，成本更高且文本引用更难；必要时另立 spec。

## Consequences / Review triggers

覆盖能力有限但可审计。新增 goal/action 必须通过新的威胁分析和 ADR，不允许在 prompt 中临时放宽。
