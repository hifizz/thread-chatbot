"use client"

import type { FC } from "react"
import ReactMarkdown, { type Components } from "react-markdown"
import remarkGfm from "remark-gfm"

// Document-scale typography for the standalone preview. This intentionally does
// not reuse markdown-text.tsx's component map: that one depends on assistant-ui
// message-part context (useIsMarkdownCodeBlock, CodeHeader), which doesn't exist
// under a plain react-markdown render.
// react-markdown passes its hast `node` to every component; strip it so the
// prop spread doesn't leak node="[object Object]" onto the DOM elements.
const stripNode = <P extends { node?: unknown }>(props: P): Omit<P, "node"> => {
  const { node, ...rest } = props
  void node
  return rest
}

const previewComponents: Components = {
  h1: (props) => (
    <h1
      className="mt-8 mb-3 scroll-m-20 text-2xl font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-7 mb-3 scroll-m-20 text-xl font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-6 mb-2 scroll-m-20 text-lg font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h4: (props) => (
    <h4
      className="mt-5 mb-2 scroll-m-20 text-base font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h5: (props) => (
    <h5
      className="mt-4 mb-1.5 text-sm font-semibold first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  h6: (props) => (
    <h6
      className="mt-4 mb-1.5 text-sm font-medium first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  p: (props) => (
    <p
      className="my-3 leading-relaxed first:mt-0 last:mb-0"
      {...stripNode(props)}
    />
  ),
  a: (props) => (
    <a
      className="text-primary underline underline-offset-2 hover:text-primary/80"
      target="_blank"
      rel="noreferrer"
      {...stripNode(props)}
    />
  ),
  blockquote: (props) => (
    <blockquote
      className="my-3 border-s-2 border-muted-foreground/30 ps-4 text-muted-foreground"
      {...stripNode(props)}
    />
  ),
  ul: (props) => (
    <ul
      className="my-3 ms-5 list-disc marker:text-muted-foreground [&>li]:mt-1"
      {...stripNode(props)}
    />
  ),
  ol: (props) => (
    <ol
      className="my-3 ms-5 list-decimal marker:text-muted-foreground [&>li]:mt-1"
      {...stripNode(props)}
    />
  ),
  li: (props) => <li className="leading-relaxed" {...stripNode(props)} />,
  hr: (props) => (
    <hr className="my-4 border-muted-foreground/20" {...stripNode(props)} />
  ),
  table: (props) => (
    <table
      className="my-3 w-full border-separate border-spacing-0 overflow-y-auto"
      {...stripNode(props)}
    />
  ),
  th: (props) => (
    <th
      className="bg-muted px-3 py-1.5 text-start font-medium first:rounded-ss-lg last:rounded-se-lg"
      {...stripNode(props)}
    />
  ),
  td: (props) => (
    <td
      className="border-s border-b border-muted-foreground/20 px-3 py-1.5 text-start last:border-e"
      {...stripNode(props)}
    />
  ),
  tr: (props) => (
    <tr
      className="m-0 border-b p-0 first:border-t [&:last-child>td:first-child]:rounded-es-lg [&:last-child>td:last-child]:rounded-ee-lg"
      {...stripNode(props)}
    />
  ),
  strong: (props) => <strong className="font-semibold" {...stripNode(props)} />,
  pre: (props) => (
    <pre
      className="my-3 overflow-x-auto rounded-xl border border-border/50 bg-muted/30 p-3.5 text-[13px] leading-relaxed"
      {...stripNode(props)}
    />
  ),
}

export const MarkdownPreview: FC<{ content: string }> = ({ content }) => {
  return (
    <div className="mx-auto max-w-3xl px-6 py-6 text-[15px] [&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.85em]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={previewComponents}>
        {content}
      </ReactMarkdown>
    </div>
  )
}
