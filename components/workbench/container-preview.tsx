"use client"

import { useEffect, useMemo, useReducer, useState } from "react"
import {
  ExternalLinkIcon,
  HammerIcon,
  Loader2Icon,
  RefreshCwIcon,
  RotateCwIcon,
  Trash2Icon,
} from "lucide-react"
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button"
import { Button } from "@/components/ui/button"
import {
  SANDBOX_POLL_INTERVAL_MS,
  SANDBOX_POLL_MAX_ATTEMPTS,
} from "@/constants/sandbox"
import { toSandpackFiles } from "@/lib/workbench/files"
import type { DemoArtifact } from "@/lib/workbench/types"

// 容器沙箱预览（实验）：Demo 跑在 Apple container 的轻量 VM 里（真 next dev），
// iframe 直连容器 IP。生命周期：环境检测 → （构建镜像）→ 启动沙箱 → 同步文件 →
// 轮询 next dev 就绪 → 展示。文件再次同步依赖 VM 内 HMR 即时生效。

type Phase =
  | "checking"
  | "unavailable"
  | "need-image"
  | "building"
  | "starting"
  | "waiting"
  | "ready"
  | "error"

const PHASE_TEXT: Record<Phase, string> = {
  checking: "检测容器环境…",
  unavailable: "未检测到 Apple container",
  "need-image": "需要先构建基础镜像",
  building: "正在构建基础镜像（首次约 2~5 分钟）…",
  starting: "启动沙箱 VM 并同步文件…",
  waiting: "等待 next dev 就绪…",
  ready: "运行中",
  error: "沙箱出错",
}

async function api<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/sandbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
  return data
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function ContainerPreview({ artifact }: { artifact: DemoArtifact }) {
  const [phase, setPhase] = useState<Phase>("checking")
  const [url, setUrl] = useState<string | null>(null)
  const [detail, setDetail] = useState<string>("")
  const [retryNonce, retry] = useReducer((x: number) => x + 1, 0)
  const [iframeNonce, reloadIframe] = useReducer((x: number) => x + 1, 0)
  const [syncing, setSyncing] = useState(false)

  const files = useMemo(
    () =>
      Object.entries(toSandpackFiles(artifact.files)).map(
        ([path, content]) => ({
          path,
          content,
        })
      ),
    [artifact]
  )

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        setPhase("checking")
        setDetail("")
        let env = await (
          await fetch("/api/sandbox", { cache: "no-store" })
        ).json()
        if (cancelled) return
        if (!env.available) {
          setPhase("unavailable")
          return
        }
        if (env.building) setPhase("building")
        while (!cancelled && env.building) {
          await sleep(3000)
          env = await (
            await fetch("/api/sandbox", { cache: "no-store" })
          ).json()
          setDetail(env.buildLog?.split("\n").filter(Boolean).at(-1) ?? "")
        }
        if (cancelled) return
        if (env.buildError) throw new Error(env.buildError)
        if (!env.imageReady) {
          setPhase("need-image")
          return
        }

        setPhase("starting")
        const info = await api<{ url: string | null }>({
          action: "ensure",
          artifactId: artifact.id,
          files,
        })
        if (cancelled) return
        if (!info.url) throw new Error("沙箱未取得 IP")

        setPhase("waiting")
        for (let attempt = 0; attempt < SANDBOX_POLL_MAX_ATTEMPTS; attempt++) {
          if (cancelled) return
          const status = await api<{
            ready: boolean
            url: string | null
            logs?: string
          }>({
            action: "status",
            artifactId: artifact.id,
          })
          if (status.ready && status.url) {
            setUrl(status.url)
            setPhase("ready")
            return
          }
          setDetail(status.logs?.split("\n").filter(Boolean).at(-1) ?? "")
          await sleep(SANDBOX_POLL_INTERVAL_MS)
        }
        throw new Error("等待 next dev 就绪超时")
      } catch (err) {
        if (!cancelled) {
          setPhase("error")
          setDetail(String(err))
        }
      }
    }
    void run()
    return () => {
      cancelled = true
    }
    // files 由 artifact 派生，无需单列依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifact.id, retryNonce])

  const syncFiles = async () => {
    setSyncing(true)
    try {
      await api({ action: "apply", artifactId: artifact.id, files })
    } catch (err) {
      setDetail(String(err))
    } finally {
      setSyncing(false)
    }
  }

  const destroy = async () => {
    try {
      await api({ action: "destroy", artifactId: artifact.id })
    } finally {
      setUrl(null)
      retry()
    }
  }

  const buildImage = async () => {
    await api({ action: "build" })
    retry()
  }

  if (phase !== "ready") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        {(phase === "checking" ||
          phase === "building" ||
          phase === "starting" ||
          phase === "waiting") && (
          <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
        )}
        <p className="text-sm font-medium">{PHASE_TEXT[phase]}</p>
        {detail && (
          <p className="max-w-full truncate font-mono text-xs text-muted-foreground">
            {detail}
          </p>
        )}
        {phase === "unavailable" && (
          <p className="max-w-sm text-xs text-muted-foreground">
            请先安装并启动：
            <code>brew install container && container system start</code>
          </p>
        )}
        {phase === "need-image" && (
          <Button size="sm" onClick={buildImage}>
            <HammerIcon className="size-3.5" />
            构建基础镜像
          </Button>
        )}
        {phase === "error" && (
          <Button size="sm" variant="outline" onClick={() => retry()}>
            <RotateCwIcon className="size-3.5" />
            重试
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b px-2 text-xs text-muted-foreground">
        <span className="mr-1 inline-flex items-center gap-1.5">
          <span className="size-1.5 rounded-full bg-emerald-500" />真 Next.js ·{" "}
          {url?.replace("http://", "")}
        </span>
        <div className="ml-auto flex items-center">
          <TooltipIconButton
            tooltip="重新同步文件（HMR 生效）"
            side="bottom"
            onClick={syncFiles}
          >
            {syncing ? (
              <Loader2Icon className="size-3.5 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3.5" />
            )}
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="刷新预览"
            side="bottom"
            onClick={() => reloadIframe()}
          >
            <RotateCwIcon className="size-3.5" />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="在新标签页打开"
            side="bottom"
            onClick={() => url && window.open(url, "_blank")}
          >
            <ExternalLinkIcon className="size-3.5" />
          </TooltipIconButton>
          <TooltipIconButton
            tooltip="销毁沙箱 VM"
            side="bottom"
            onClick={destroy}
          >
            <Trash2Icon className="size-3.5" />
          </TooltipIconButton>
        </div>
      </div>
      <iframe
        key={iframeNonce}
        src={url ?? undefined}
        title={`容器沙箱预览：${artifact.title}`}
        className="min-h-0 w-full flex-1 border-0 bg-white"
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
      />
    </div>
  )
}
