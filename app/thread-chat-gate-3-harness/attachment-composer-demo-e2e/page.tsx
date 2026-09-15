"use client"

import { useState } from "react"
import { AttachmentComposerDemo } from "../../thread-chat/chat/composer/attachment-composer-demo"
import type { DemoAttachment } from "../../thread-chat/chat/composer/attachment-composer-demo-model"

export default function AttachmentComposerE2EPage() {
  const [attachments, setAttachments] = useState<DemoAttachment[]>([])
  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <div className="mx-auto w-full max-w-xl">
        <AttachmentComposerDemo
          attachments={attachments}
          onChange={(next) => {
            setAttachments(next)
            console.log("attachments changed", next)
          }}
        />
      </div>
    </main>
  )
}
