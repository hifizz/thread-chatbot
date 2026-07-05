"use client"

import {
  useAssistantTool,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react"
import { SearchIcon, BookOpenIcon, LoaderIcon } from "lucide-react"

// 深度研究过程可见：把 webSearch / readUrl 的工具调用渲染成检索卡片与来源链接。

type SearchArgs = { query?: string }
type SearchResult = {
  query: string
  answer?: string
  results: { title: string; url: string; snippet: string }[]
}

const WebSearchToolUI: ToolCallMessagePartComponent<
  SearchArgs,
  SearchResult
> = ({ args, result, status }) => {
  const isRunning = status.type === "running"
  return (
    <div
      data-slot="web-search-tool"
      className="my-1.5 flex flex-col gap-2 rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2.5"
    >
      <div className="flex items-center gap-2 text-sm font-medium">
        {isRunning ? (
          <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <SearchIcon className="size-4 text-muted-foreground" />
        )}
        <span>联网搜索</span>
        <span className="font-normal text-muted-foreground">
          {result?.query ?? args.query ?? ""}
        </span>
      </div>
      {result?.results?.length ? (
        <ul className="flex flex-col gap-1">
          {result.results.map((r, i) => (
            <li key={i} className="truncate text-xs">
              <a
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {r.title || r.url}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        !isRunning && (
          <span className="text-xs text-muted-foreground">无结果</span>
        )
      )}
    </div>
  )
}

type ReadArgs = { url?: string }
type ReadResult = { url: string; content: string }

const ReadUrlToolUI: ToolCallMessagePartComponent<ReadArgs, ReadResult> = ({
  args,
  result,
  status,
}) => {
  const isRunning = status.type === "running"
  const url = result?.url ?? args.url ?? ""
  let host = url
  try {
    host = new URL(url).host
  } catch {
    // 保留原始字符串
  }
  return (
    <div
      data-slot="read-url-tool"
      className="my-1.5 flex w-fit items-center gap-2 rounded-xl border border-border/60 bg-muted/40 px-3.5 py-2 text-sm"
    >
      {isRunning ? (
        <LoaderIcon className="size-4 animate-spin text-muted-foreground" />
      ) : (
        <BookOpenIcon className="size-4 text-muted-foreground" />
      )}
      <span className="font-medium">深读网页</span>
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="max-w-[20rem] truncate text-primary hover:underline"
      >
        {host}
      </a>
    </div>
  )
}

export function ResearchTools() {
  useAssistantTool({
    toolName: "webSearch",
    type: "backend",
    render: WebSearchToolUI,
  })
  useAssistantTool({
    toolName: "readUrl",
    type: "backend",
    render: ReadUrlToolUI,
  })
  return null
}
