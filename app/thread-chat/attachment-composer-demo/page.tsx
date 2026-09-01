"use client"

import { useCallback, useState } from "react"

import { AttachmentComposerDemo } from "../chat/composer/attachment-composer-demo"
import type { DemoAttachment } from "../chat/composer/attachment-composer-demo-model"

export default function AttachmentComposerDemoPage() {
  const [attachments, setAttachments] = useState<DemoAttachment[]>([])

  const handleChange = useCallback((nextAttachments: DemoAttachment[]) => {
    setAttachments(nextAttachments)
    console.log("attachments changed", nextAttachments)
  }, [])

  return (
    <main className="tc min-h-screen bg-background px-4 py-12 text-foreground sm:px-6">
      <section className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">
            ThreadChat · Frontend Demo
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">
            Attachment Composer
          </h1>
          <p className="max-w-xl text-sm leading-6 text-muted-foreground">
            通过多选、拖拽或粘贴添加文件。粘贴的纯文本会转换为本地 .txt
            文件；所有操作仅保留在当前浏览器页面，不会上传或发送消息。
          </p>
        </header>

        <AttachmentComposerDemo
          attachments={attachments}
          onChange={handleChange}
        />

        <p
          data-testid="attachment-count"
          className="text-xs text-muted-foreground"
        >
          当前附件：{attachments.length}
        </p>
      </section>
    </main>
  )
}
