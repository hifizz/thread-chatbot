"use client"

import { useAssistantTool, type ToolCallMessagePartComponent } from "@assistant-ui/react"
import { NotebookPenIcon } from "lucide-react"
import { z } from "zod"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const notepadSchema = z.object({
  title: z.string(),
  content: z.string(),
})

type NotepadArgs = { title?: string; content?: string }
type NotepadResult = { title: string; content: string; savedAt: string }

const NOTEPAD_STORAGE_KEY = "thread-chat:notepad"

const NotepadToolUI: ToolCallMessagePartComponent<NotepadArgs, NotepadResult> = ({
  args,
  result,
}) => {
  const title = result?.title ?? args.title
  const content = result?.content ?? args.content

  return (
    <Card data-slot="notepad-tool" className="w-full max-w-sm gap-3 py-4">
      <CardHeader className="gap-1 px-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <NotebookPenIcon className="size-4" />
          {title || "Notepad"}
        </CardTitle>
        {result?.savedAt && (
          <CardDescription className="text-xs">
            Saved to browser storage at {new Date(result.savedAt).toLocaleTimeString()}
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="px-4 text-sm whitespace-pre-wrap">
        {content || "Writing…"}
      </CardContent>
    </Card>
  )
}

export function NotepadTool() {
  useAssistantTool({
    toolName: "writeNote",
    type: "frontend",
    display: "standalone",
    description:
      "Write and save a short note (title + content) to the user's notepad, stored in the browser.",
    parameters: notepadSchema,
    execute: async ({ title, content }) => {
      const note = { title: title ?? "", content: content ?? "" }
      const savedAt = new Date().toISOString()
      try {
        localStorage.setItem(NOTEPAD_STORAGE_KEY, JSON.stringify({ ...note, savedAt }))
      } catch {
        // localStorage unavailable (privacy mode, SSR) - non-fatal, note still renders in-thread
      }
      return { ...note, savedAt }
    },
    render: NotepadToolUI,
  })
  return null
}
