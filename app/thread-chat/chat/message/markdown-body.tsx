"use client"
/**
 * chat/markdown-body —— 独立的 Markdown 渲染器（react-markdown + remark-gfm），
 * 与 assistant-ui 的 runtime 解耦，供分支对话页的 assistant 正文使用。
 *
 * 关键约束：整个组件按 source 用 memo 记忆——source 不变时绝不重渲染。
 * 这样 anchored-markdown 在渲染后「手绘」到 .md-body 里的锚点高亮 / 脚注上标，
 * 不会被 React 的 reconcile 抹掉（详见 anchored-markdown 的绘制 effect 注释）。
 * 渲染进稳定容器 `<div className="md-body tc-prose">`：md-body 是锚点坐标契约，
 * tc-prose 承担正文排版。
 */

import React, {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
} from "react"
import Markdown, { type Components, type ExtraProps } from "react-markdown"
import remarkGfm from "remark-gfm"
import { Check, Copy } from "lucide-react"

import { ShikiCode } from "@/components/markdown/shiki-code"
import { cn } from "@/lib/utils"
import { safePublicHref } from "@/lib/thread-chat/sharing/content"
import { SHARE_ATTACHMENT } from "@/constants/sharing"
import {
  createMarkdownSettlementBatch,
  markdownSettlementRevision,
  type MarkdownSettlementBatch,
} from "@/lib/markdown/settlement-batch"

interface MarkdownSettlementContextValue {
  batch: MarkdownSettlementBatch
  streaming: boolean
}

const MarkdownSettlementContext =
  createContext<MarkdownSettlementContextValue | null>(null)

export const PublicMarkdownContext = createContext(false)

/** 代码块：语言标签 + 复制按钮 + 高亮体（视觉参考 assistant-ui markdown-text 的代码头） */
function CodeBlock({
  lang,
  code,
  meta,
}: {
  lang: string
  code: string
  meta?: string
}) {
  const settlement = useContext(MarkdownSettlementContext)
  const settlementBatch = settlement?.batch
  const [copied, setCopied] = useState(false)
  const registrationRef = useRef<ReturnType<
    MarkdownSettlementBatch["register"]
  > | null>(null)

  useLayoutEffect(() => {
    if (!settlement) return
    const registration = settlement.batch.register()
    registrationRef.current = registration
    return () => {
      if (registrationRef.current === registration)
        registrationRef.current = null
      registration.cancel()
    }
  }, [settlement])

  const onSettled = useCallback(() => {
    if (!settlementBatch) return
    registrationRef.current?.settle()
  }, [settlementBatch])

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
  const copyButton = (
    <button className="copy" onClick={onCopy} title="复制代码">
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  )

  return (
    <div className={lang ? "md-code" : "md-code no-lang"}>
      {lang ? (
        <div className="md-code-head">
          <span className="lang">{lang}</span>
          {copyButton}
        </div>
      ) : (
        copyButton
      )}
      <ShikiCode
        code={code}
        language={lang}
        meta={meta}
        streaming={settlement?.streaming ?? false}
        themeMode="light"
        onSettled={onSettled}
      />
    </div>
  )
}

type MarkdownCodeProps = ComponentProps<"code"> & ExtraProps

function MarkdownCode({
  className,
  children,
  node,
  ...props
}: MarkdownCodeProps) {
  const match = /(?:^|\s)language-([^\s]+)/.exec(className || "")
  const raw = String(children ?? "")
  // 有语言围栏、或内容含换行 = 代码块；否则是行内 code
  const isBlock = match !== null || raw.includes("\n")
  if (isBlock) {
    const nodeData = node?.data as { meta?: unknown } | undefined
    const meta = typeof nodeData?.meta === "string" ? nodeData.meta : undefined
    return (
      <CodeBlock
        lang={match?.[1] ?? ""}
        code={raw.replace(/\n$/, "")}
        meta={meta}
      />
    )
  }
  return (
    <code className="md-inline-code" {...props}>
      {children}
    </code>
  )
}

const components: Components = {
  // 代码块被默认包在 <pre> 里；把 <pre> 透传成 children，让 code 自己产出完整卡片，
  // 避免出现 <pre><div class=md-code> 的多余嵌套。
  pre: ({ children }) => <>{children}</>,
  code: MarkdownCode,
  table: ({ children }) => (
    <div className="md-table-scroll" role="region" aria-label="表格" tabIndex={0}>
      <table>{children}</table>
    </div>
  ),
}

export type MarkdownDensity = "default" | "compact"

const publicComponents: Components = {
  ...components,
  img: () => <span>[{SHARE_ATTACHMENT}]</span>,
  a: ({ href, children }) => {
    const safe = href && safePublicHref(href)
    return safe ? <a href={safe} target="_blank" rel="noopener noreferrer nofollow">{children} ↗</a> : <span>{children}</span>
  },
}

export const MarkdownBody = memo(function MarkdownBody({
  source,
  streaming = false,
  density = "default",
  onContentSettled,
}: {
  source: string
  streaming?: boolean
  density?: MarkdownDensity
  onContentSettled?: (revision: number) => void
}) {
  const publicView = useContext(PublicMarkdownContext)
  const batch = useMemo(
    () =>
      createMarkdownSettlementBatch(
        markdownSettlementRevision(source, streaming)
      ),
    [source, streaming]
  )
  const snapshot = useSyncExternalStore(
    batch.subscribe,
    batch.getSnapshot,
    batch.getSnapshot
  )
  const notifiedBatchRef = useRef<MarkdownSettlementBatch | null>(null)
  const contextValue = useMemo(() => ({ batch, streaming }), [batch, streaming])

  // 子代码块先在 layout effect 注册；父容器 commit 后再封口，零代码块也可结算。
  useEffect(() => {
    if (!streaming) batch.seal()
  }, [batch, streaming])

  // snapshot 变为 settled 时，对应 token/plaintext DOM 已经完成 commit。
  useEffect(() => {
    if (streaming || !snapshot.settled || notifiedBatchRef.current === batch)
      return
    notifiedBatchRef.current = batch
    onContentSettled?.(snapshot.revision)
  }, [batch, onContentSettled, snapshot, streaming])

  return (
    <div
      className={cn(
        "md-body tc-prose",
        density === "compact" && "tc-prose-compact"
      )}
      data-content-revision={snapshot.revision}
      data-content-settled={snapshot.settled && !streaming ? "true" : "false"}
    >
      <MarkdownSettlementContext.Provider value={contextValue}>
        <Markdown remarkPlugins={[remarkGfm]} components={publicView ? publicComponents : components} skipHtml={publicView}>
          {source}
        </Markdown>
      </MarkdownSettlementContext.Provider>
    </div>
  )
})
