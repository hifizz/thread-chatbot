"use client"
/**
 * chat/markdown-body —— 独立的 Markdown 渲染器（react-markdown + remark-gfm），
 * 与 assistant-ui 的 runtime 解耦，供分支对话页的 assistant 正文使用。
 *
 * 关键约束：整个组件按 source 用 memo 记忆——source 不变时绝不重渲染。
 * 这样 branchable-chat 在渲染后「手绘」到 .md-body 里的锚点高亮 / 脚注上标，
 * 不会被 React 的 reconcile 抹掉（详见 branchable-chat 的绘制 effect 注释）。
 * 渲染进一个稳定容器 `<div className="md-body">`，即锚点定位的坐标系容器。
 */

import React, { memo, useState } from "react"
import Markdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"

/** 代码块：语言标签 + 复制按钮 + 高亮体（视觉参考 assistant-ui markdown-text 的代码头） */
function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false)
  const onCopy = () => {
    if (copied || typeof navigator === "undefined" || !navigator.clipboard)
      return
    navigator.clipboard.writeText(code).then(
      () => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      },
      () => {}
    )
  }
  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="lang">{lang || "code"}</span>
        <button className="copy" onClick={onCopy} title="复制代码">
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

const components: Components = {
  // 代码块被默认包在 <pre> 里；把 <pre> 透传成 children，让 code 自己产出完整卡片，
  // 避免出现 <pre><div class=md-code> 的多余嵌套。
  pre: ({ children }) => <>{children}</>,
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className || "")
    const raw = String(children ?? "")
    // 有语言围栏、或内容含换行 = 代码块；否则是行内 code
    const isBlock = match !== null || raw.includes("\n")
    if (isBlock) {
      return <CodeBlock lang={match?.[1] ?? ""} code={raw.replace(/\n$/, "")} />
    }
    return (
      <code className="md-inline-code" {...props}>
        {children}
      </code>
    )
  },
}

export const MarkdownBody = memo(function MarkdownBody({
  source,
}: {
  source: string
}) {
  return (
    <div className="md-body">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </Markdown>
    </div>
  )
})
