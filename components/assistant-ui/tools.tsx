"use client"

import { WeatherTool } from "@/components/assistant-ui/weather-tool"
import { NotepadTool } from "@/components/assistant-ui/notepad-tool"
import { CompareTableTool } from "@/components/assistant-ui/compare-table-tool"
import { MarkdownArtifactTool } from "@/components/assistant-ui/markdown-artifact-tool"

export function AssistantTools() {
  return (
    <>
      <WeatherTool />
      <NotepadTool />
      <CompareTableTool />
      <MarkdownArtifactTool />
    </>
  )
}
