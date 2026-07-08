"use client"

import { useEffect, useMemo } from "react"
import {
  SandpackCodeEditor,
  SandpackPreview,
  SandpackProvider,
  useSandpack,
} from "@codesandbox/sandpack-react"
import { useTheme } from "next-themes"
import {
  Code2Icon,
  ContainerIcon,
  EyeIcon,
  Loader2Icon,
  CodeXmlIcon,
  XIcon,
} from "lucide-react"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
import { ContainerPreview } from "@/components/workbench/container-preview"
import {
  DEMO_BASE_DEPENDENCIES,
  DEMO_ENTRY_FILE,
  DEMO_EXTERNAL_RESOURCES,
} from "@/constants/workbench"
import { normalizeDemoPath, toSandpackFiles } from "@/lib/workbench/files"
import { useWorkbench, type WorkbenchView } from "@/lib/workbench/store"
import { cn } from "@/lib/utils"

// 右侧代码工作台：bolt.new 式的「聊天在左、预览/代码在右」面板。
// 流式期间只挂代码编辑器（autorun 关闭，代码逐字流入），生成完成后
// 通过 key 重挂 SandpackProvider 触发一次干净的打包运行并切到预览。

/**
 * 流式期间把最新文件内容同步进 Sandpack 状态（不触发打包），
 * 并让编辑器始终聚焦正在生成的那个文件，形成"AI 正在打字"的效果。
 */
function StreamSync({
  files,
  activeFile,
}: {
  files: Record<string, string>
  activeFile?: string
}) {
  const { sandpack } = useSandpack()
  useEffect(() => {
    sandpack.updateFile(files, undefined, false)
    // sandpack 对象每次渲染都是新引用，依赖它会导致无限循环
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files])
  useEffect(() => {
    if (
      activeFile &&
      sandpack.files[activeFile] &&
      sandpack.activeFile !== activeFile
    ) {
      sandpack.setActiveFile(activeFile)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, files])
  return null
}

const ViewToggle = ({
  view,
  streaming,
  onChange,
}: {
  view: WorkbenchView
  streaming: boolean
  onChange: (view: WorkbenchView) => void
}) => {
  const itemClass = (active: boolean) =>
    cn(
      "flex items-center gap-1 rounded-md px-2.5 py-1 transition-colors disabled:opacity-50",
      active
        ? "bg-background text-foreground shadow-sm"
        : "hover:text-foreground"
    )
  return (
    <div className="flex items-center rounded-lg bg-muted p-0.5 text-xs font-medium text-muted-foreground">
      <button
        type="button"
        disabled={streaming}
        onClick={() => onChange("preview")}
        className={itemClass(view === "preview")}
      >
        <EyeIcon className="size-3.5" />
        预览
      </button>
      <button
        type="button"
        onClick={() => onChange("code")}
        className={itemClass(view === "code")}
      >
        <Code2Icon className="size-3.5" />
        代码
      </button>
    </div>
  )
}

export function WorkbenchPanel() {
  const open = useWorkbench((s) => s.open)
  const artifact = useWorkbench((s) =>
    s.activeId ? s.artifacts[s.activeId] : undefined
  )
  const view = useWorkbench((s) => s.view)
  const setView = useWorkbench((s) => s.setView)
  const runtime = useWorkbench((s) => s.runtime)
  const setRuntime = useWorkbench((s) => s.setRuntime)
  const close = useWorkbench((s) => s.close)
  const { resolvedTheme } = useTheme()

  const streaming = artifact?.status === "streaming"

  const files = useMemo(() => toSandpackFiles(artifact?.files), [artifact])
  const modelPaths = useMemo(
    () =>
      (artifact?.files ?? [])
        .map((f) => normalizeDemoPath(f.path))
        .filter(Boolean),
    [artifact]
  )
  // 流式期间跟随正在生成的文件；完成后回到入口文件
  const activeFile = streaming
    ? (modelPaths.at(-1) ?? DEMO_ENTRY_FILE)
    : files[DEMO_ENTRY_FILE]
      ? DEMO_ENTRY_FILE
      : modelPaths[0]
  const visibleFiles = useMemo(() => {
    const visible = [
      ...new Set([...modelPaths, ...(activeFile ? [activeFile] : [])]),
    ]
    return visible.filter((path) => files[path] !== undefined)
  }, [modelPaths, activeFile, files])

  // 依赖列表在参数流的末尾才出现，流式期间保持稳定的基础依赖，
  // 避免 customSetup 变化导致 Sandpack 中途重置；完成后随 key 重挂用全量依赖
  const customSetup = useMemo(
    () => ({
      dependencies: streaming
        ? DEMO_BASE_DEPENDENCIES
        : (artifact?.dependencies ?? {}),
    }),
    [streaming, artifact]
  )

  if (!open || !artifact) return null

  return (
    <aside
      data-slot="workbench-panel"
      className="relative flex h-full w-full animate-in flex-col overflow-hidden border-l bg-background duration-200 fade-in slide-in-from-right-8 max-md:absolute max-md:inset-0 max-md:z-40 md:w-[58%] md:shrink-0"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
        <CodeXmlIcon className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate text-sm font-medium">
          {artifact.title}
        </span>
        {streaming && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="size-3.5 animate-spin" />
            生成中
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <ViewToggle view={view} streaming={!!streaming} onChange={setView} />
          <TooltipIconButton
            tooltip={
              runtime === "container"
                ? "切回浏览器沙箱（Sandpack）"
                : "容器沙箱（实验）：Apple container VM 里跑真 next dev"
            }
            side="bottom"
            disabled={!!streaming}
            onClick={() =>
              setRuntime(runtime === "container" ? "sandpack" : "container")
            }
            className={cn(
              runtime === "container" && "bg-accent text-foreground"
            )}
          >
            <ContainerIcon className="size-4" />
          </TooltipIconButton>
          <TooltipIconButton tooltip="关闭工作台" side="bottom" onClick={close}>
            <XIcon className="size-4" />
          </TooltipIconButton>
        </div>
      </header>
      {/* Sandpack(stitches) 的样式不在 @layer 里，会压过 Tailwind v4 分层的普通工具类，
          这里必须用 important 才能把默认 160px 高度链撑满面板。
          .sp-loading 是父层的白色加载遮罩：bundler 域名有 Cloudflare 挑战时其 done
          握手可能丢失导致遮罩永不消失，而 iframe 内部自带编译进度 UI，直接隐藏它
          （保留 .sp-error-overlay 错误遮罩不受影响）*/}
      <div className="min-h-0 flex-1 [&_.cm-editor]:!h-full [&_.sp-code-editor]:!h-full [&_.sp-editor]:!h-full [&_.sp-loading]:!hidden [&_.sp-preview]:!h-full [&_.sp-preview-container]:!h-full [&_.sp-preview-iframe]:!h-full [&_.sp-preview-iframe]:!flex-1 [&_.sp-stack]:!h-full [&_.sp-wrapper]:!h-full">
        <SandpackProvider
          key={`${artifact.id}:${streaming ? "stream" : "run"}`}
          template="react-ts"
          theme={resolvedTheme === "dark" ? "dark" : "light"}
          files={files}
          customSetup={customSetup}
          options={{
            externalResources: DEMO_EXTERNAL_RESOURCES,
            ...(visibleFiles.length > 0 && activeFile
              ? { visibleFiles, activeFile }
              : {}),
            autorun: !streaming,
            autoReload: !streaming,
            initMode: "immediate",
          }}
        >
          {streaming && <StreamSync files={files} activeFile={activeFile} />}
          <div
            className={cn(
              "h-full",
              (view !== "preview" || runtime === "container") && "hidden"
            )}
          >
            <SandpackPreview
              className="!h-full"
              showOpenInCodeSandbox={false}
              showRefreshButton
            />
          </div>
          {runtime === "container" && !streaming && (
            <div className={cn("h-full", view !== "preview" && "hidden")}>
              <ContainerPreview artifact={artifact} />
            </div>
          )}
          <div className={cn("h-full", view !== "code" && "hidden")}>
            <SandpackCodeEditor
              className="!h-full"
              showTabs
              showLineNumbers
              readOnly={streaming}
              showReadOnly={false}
            />
          </div>
        </SandpackProvider>
      </div>
    </aside>
  )
}
