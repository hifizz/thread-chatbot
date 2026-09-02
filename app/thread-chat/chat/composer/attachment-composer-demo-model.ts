export type DemoAttachmentSource = "picker" | "drop" | "paste"

export type DemoAttachment = {
  id: string
  file: File
  source: DemoAttachmentSource
}

export type AttachmentComposerDemoProps = {
  attachments: DemoAttachment[]
  onChange(nextAttachments: DemoAttachment[]): void
}

export function createDemoAttachments(
  files: Iterable<File>,
  source: DemoAttachmentSource
): DemoAttachment[] {
  return Array.from(files, (file) => ({
    id: crypto.randomUUID(),
    file,
    source,
  }))
}

export function createPastedTextAttachment(
  text: string,
  now = Date.now()
): DemoAttachment | null {
  if (!text.trim()) return null

  return {
    id: crypto.randomUUID(),
    file: new File([text], `pasted-text-${now}.txt`, {
      type: "text/plain",
    }),
    source: "paste",
  }
}

export function appendDemoAttachments(
  current: readonly DemoAttachment[],
  added: readonly DemoAttachment[]
): DemoAttachment[] {
  return [...current, ...added]
}

export function removeDemoAttachment(
  current: readonly DemoAttachment[],
  id: string
): DemoAttachment[] {
  return current.filter((attachment) => attachment.id !== id)
}
