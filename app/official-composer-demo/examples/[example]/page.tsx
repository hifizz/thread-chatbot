import { notFound } from "next/navigation"
import { ComposerDemo } from "@/components/demo/elements/composer"
import { ComposerSlashDemo } from "@/components/demo/elements/composer-slash"
import { ComposerMentionsDemo } from "@/components/demo/elements/composer-mentions"
import { ComposerAttachmentsDemo } from "@/components/demo/elements/composer-attachments"
import { ComposerModelsDemo } from "@/components/demo/elements/composer-models"
import { ComposerTriggerPopoverSample } from "@/components/pages/docs/samples/composer-trigger-popover"
import { DemoStage } from "@/components/demo/elements/demo-stage"

const examples = {
  composer: ComposerDemo,
  "slash-commands": ComposerSlashDemo,
  mentions: ComposerMentionsDemo,
  attachments: ComposerAttachmentsDemo,
  "model-picker": ComposerModelsDemo,
  "trigger-popover": ComposerTriggerPopoverSample,
}

export default async function ExamplePage({ params }: { params: Promise<{ example: string }> }) {
  const { example } = await params
  if (!Object.hasOwn(examples, example)) notFound()
  const Example = examples[example as keyof typeof examples]
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-5 text-foreground">
      <div className="flex h-[360px] w-full max-w-3xl items-center justify-center rounded-[6px] border border-foreground/10 p-6">
        <DemoStage replay={example === "attachments"}>
          <Example />
        </DemoStage>
      </div>
    </main>
  )
}
