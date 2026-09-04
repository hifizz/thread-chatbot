"use client"

import Image from "next/image"
import { useEffect, useState } from "react"
import { Download, FileText, RotateCcw } from "lucide-react"
import {
  Attachment,
  AttachmentContent,
  AttachmentDescription,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import type { ConversationViewMessage } from "../../core/types"

function attachmentTypeLabel(filename: string | undefined, mediaType: string) {
  const extension = filename?.match(/\.([^.]+)$/)?.[1]
  if (extension) return `${extension.toUpperCase()} 文件`
  return mediaType === "text/plain" ? "文本文件" : "附件"
}

type MessageFilePart = Extract<
  NonNullable<ConversationViewMessage["uiParts"]>[number],
  { type: "file" }
>

type TextPreviewState =
  | { status: "idle" | "loading" }
  | { status: "ready"; content: string }
  | { status: "error"; message: string }

function TextAttachmentPreview({ part }: { part: MessageFilePart }) {
  const [open, setOpen] = useState(false)
  const [requestVersion, setRequestVersion] = useState(0)
  const [preview, setPreview] = useState<TextPreviewState>({ status: "idle" })

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void fetch(`${part.url}/content`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.ok) return response.text()
        const body = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(body?.error ?? "文件打开失败，请重试")
      })
      .then((content) => setPreview({ status: "ready", content }))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setPreview({
          status: "error",
          message: error instanceof Error ? error.message : "文件打开失败，请重试",
        })
      })
    return () => controller.abort()
  }, [open, part.url, requestVersion])

  const filename = part.filename ?? "附件"

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) setPreview({ status: "loading" })
        setOpen(nextOpen)
      }}
    >
      <Attachment size="sm" className="w-[min(18rem,72vw)] flex-nowrap">
        <AttachmentMedia aria-hidden="true">
          <FileText />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle title={filename}>{filename}</AttachmentTitle>
          <AttachmentDescription>
            {attachmentTypeLabel(part.filename, part.mediaType)}
          </AttachmentDescription>
        </AttachmentContent>
        <DialogTrigger
          render={
            <button
              type="button"
              aria-label={`预览 ${filename}`}
              className="absolute inset-0 z-10 cursor-pointer rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          }
        />
      </Attachment>
      <DialogContent className="grid h-[min(80dvh,48rem)] max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 overflow-hidden p-4 sm:max-w-4xl">
        <div className="min-w-0 pe-10">
          <DialogTitle className="truncate">{filename}</DialogTitle>
          <DialogDescription className="mt-1 text-xs">
            {attachmentTypeLabel(part.filename, part.mediaType)}
          </DialogDescription>
        </div>
        <div className="min-h-0 overflow-auto rounded-xl border bg-muted/30">
          {(preview.status === "idle" || preview.status === "loading") && (
            <div className="space-y-3 p-4" role="status">
              <span className="sr-only">文件加载中</span>
              <div className="space-y-3" aria-hidden="true">
                <Skeleton className="h-3 w-2/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-3 w-5/6" />
              </div>
            </div>
          )}
          {preview.status === "error" && (
            <div
              className="flex min-h-full flex-col items-center justify-center gap-3 p-4 text-center"
              role="alert"
            >
              <p>{preview.message}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setPreview({ status: "loading" })
                  setRequestVersion((version) => version + 1)
                }}
              >
                <RotateCcw aria-hidden="true" />
                重试
              </Button>
            </div>
          )}
          {preview.status === "ready" &&
            (preview.content ? (
              <pre
                className="m-0 min-h-full whitespace-pre-wrap break-words p-4 font-mono text-xs leading-5 text-foreground"
                tabIndex={0}
              >
                {preview.content}
              </pre>
            ) : (
              <div
                className="flex min-h-full items-center justify-center p-4 text-muted-foreground"
                role="status"
              >
                这个文件没有内容
              </div>
            ))}
        </div>
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={
              <a href={`${part.url}?download=1`} download={part.filename} />
            }
          >
            <Download aria-hidden="true" />
            下载文件
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * text/data-artifact/data-research 仍由现有正文、Artifact 卡和研究面板渲染；
 * 这里仅补齐此前没有平行字段的 reasoning/source/file/tool parts。
 */
export function UIMessageSupplementalParts({
  message,
}: {
  message: ConversationViewMessage
}) {
  const parts = message.uiParts ?? []
  const reasoning = parts.filter(
    (part): part is Extract<typeof part, { type: "reasoning" }> =>
      part.type === "reasoning" && Boolean(part.text.trim())
  )
  const sources = parts.filter((part) => part.type === "source-url")
  const files = parts.filter((part) => part.type === "file")
  const tools = parts.filter((part) => part.type.startsWith("tool-"))
  if (
    reasoning.length === 0 &&
    sources.length === 0 &&
    files.length === 0 &&
    tools.length === 0
  )
    return null

  return (
    <div data-ui-message-supplemental="true">
      {reasoning.length > 0 && (
        <details className="inherited">
          <summary>思考过程</summary>
          <div className="inherited-body">
            {reasoning.map((part, index) => (
              <p key={index}>{part.text}</p>
            ))}
          </div>
        </details>
      )}
      {files.length > 0 && (
        <div
          data-ui-message-files="true"
          className="mt-2 ms-auto flex w-fit max-w-full flex-wrap justify-end gap-2"
        >
          {files.map((part, index) =>
            part.mediaType.startsWith("image/") ? (
              <Dialog key={`${part.url}-${index}`}>
                <DialogTrigger
                  type="button"
                  aria-label={`预览 ${part.filename ?? "用户上传的图片"}`}
                  className="block w-fit max-w-[min(18rem,72vw)] cursor-zoom-in rounded-md border-0 bg-transparent p-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Image
                    src={part.url}
                    alt={part.filename ?? "用户上传的图片"}
                    width={640}
                    height={480}
                    sizes="(max-width: 480px) 72vw, 288px"
                    unoptimized
                    className="h-auto max-h-48 w-auto max-w-full rounded-md object-contain"
                  />
                </DialogTrigger>
                <DialogContent className="max-h-[calc(100dvh-2rem)] gap-0 overflow-hidden p-2 sm:max-w-5xl">
                  <DialogTitle className="sr-only">
                    {part.filename ?? "用户上传的图片"}
                  </DialogTitle>
                  <div className="flex max-h-[calc(100dvh-3rem)] min-h-32 items-center justify-center overflow-hidden">
                    <Image
                      src={part.url}
                      alt={part.filename ?? "用户上传的图片"}
                      width={2048}
                      height={2048}
                      sizes="calc(100vw - 3rem)"
                      unoptimized
                      className="h-auto max-h-[calc(100dvh-3rem)] w-auto max-w-full object-contain"
                    />
                  </div>
                </DialogContent>
              </Dialog>
            ) : (
              <TextAttachmentPreview
                key={`${part.url}-${index}`}
                part={part}
              />
            )
          )}
        </div>
      )}
      {sources.map((part, index) => (
        <a
          key={`${part.url}-${index}`}
          href={part.url}
          target="_blank"
          rel="noreferrer"
        >
          {part.title ?? part.url}
        </a>
      ))}
      {tools.map((part, index) => {
        const state = "state" in part ? String(part.state) : ""
        return (
          <span key={`${part.type}-${index}`} hidden={state === "output-available"}>
            {state ? `工具：${state}` : ""}
          </span>
        )
      })}
    </div>
  )
}

