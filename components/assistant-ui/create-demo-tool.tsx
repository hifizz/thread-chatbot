"use client"

import { useEffect, useMemo, useRef } from "react"
import {
  useAssistantTool,
  type ToolCallMessagePartComponent,
} from "@assistant-ui/react"
import { ChevronRightIcon, CodeXmlIcon, Loader2Icon } from "lucide-react"
import { CREATE_DEMO_TOOL_NAME } from "@/constants/workbench"
import { mergeDemoDependencies } from "@/lib/workbench/files"
import { useWorkbench } from "@/lib/workbench/store"
import type { DemoArtifact, DemoFile } from "@/lib/workbench/types"
import { cn } from "@/lib/utils"

// createDemo 的消息内 UI：一张可点击的 artifact 卡片。
// 真正的代码/预览在右侧 WorkbenchPanel 展示，这里只负责：
// 1) 把流式 args 持续 upsert 进 workbench store（含历史消息重挂载时的幂等恢复）
// 2) 生成开始时自动打开面板并切到代码视图，结束时切回预览
// 3) 作为随时可以重新打开某个 Demo 的入口

type CreateDemoArgs = {
  title?: string
  files?: Partial<DemoFile>[]
  dependencies?: Record<string, string>
}
type CreateDemoResult = { ok: boolean; title: string; fileCount: number }

const CreateDemoToolUI: ToolCallMessagePartComponent<
  CreateDemoArgs,
  CreateDemoResult
> = ({ toolCallId, args, argsText, status }) => {
  const running = status.type === "running"
  const activeId = useWorkbench((s) => s.activeId)
  const panelOpen = useWorkbench((s) => s.open)
  const isActive = panelOpen && activeId === toolCallId

  const artifact = useMemo<DemoArtifact>(
    () => ({
      id: toolCallId,
      title: args?.title?.trim() || "React Demo",
      files: (args?.files ?? []).filter(
        (f): f is DemoFile =>
          typeof f?.path === "string" && typeof f?.content === "string"
      ),
      dependencies: mergeDemoDependencies(args?.dependencies),
      status: running ? "streaming" : "complete",
    }),
    // argsText 是 args 的流式来源，作为稳定的变更信号
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [toolCallId, argsText, status.type]
  )

  // 只在"本次会话实时生成"时自动打开面板；历史消息重挂载（status 一开始就是
  // complete）只恢复数据，不打扰用户
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    const { upsertArtifact, openArtifact, setView } = useWorkbench.getState()
    upsertArtifact(artifact)
    if (running && !autoOpenedRef.current) {
      autoOpenedRef.current = true
      openArtifact(artifact.id)
      setView("code")
    }
    if (!running && autoOpenedRef.current) {
      autoOpenedRef.current = false
      if (useWorkbench.getState().activeId === artifact.id) setView("preview")
    }
  }, [artifact, running])

  const fileCount = artifact.files.length
  const streamingFile = running ? artifact.files.at(-1)?.path : undefined

  return (
    <button
      type="button"
      onClick={() => useWorkbench.getState().openArtifact(toolCallId)}
      className={cn(
        "group my-2 flex w-full max-w-md items-center gap-3 rounded-xl border p-3 text-left transition-colors",
        "bg-card hover:bg-accent/50",
        isActive && "border-ring/40 bg-accent/30"
      )}
    >
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground",
          running && "animate-pulse"
        )}
      >
        <CodeXmlIcon className="size-4.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {artifact.title === "React Demo" && running
            ? "正在生成 Demo…"
            : artifact.title}
        </div>
        <div className="truncate font-mono text-xs text-muted-foreground">
          {running
            ? streamingFile
              ? `正在编写 ${streamingFile}`
              : "正在思考文件结构…"
            : `${fileCount} 个文件 · 点击在工作台查看`}
        </div>
      </div>
      {running ? (
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" />
      ) : (
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      )}
    </button>
  )
}

export function CreateDemoTool() {
  useAssistantTool({
    toolName: CREATE_DEMO_TOOL_NAME,
    type: "backend",
    display: "standalone",
    render: CreateDemoToolUI,
  })
  return null
}
