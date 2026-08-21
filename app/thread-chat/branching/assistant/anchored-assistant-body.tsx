"use client"

import type { Message, ThreadTreeState } from "../../core/types"
import { WebResearchPanel } from "../../orchestration/overlays/web-research-panel"
import { AnchoredMarkdown } from "./anchored-markdown"
import { webResearchPlacement } from "./web-research-placement"

export function AnchoredAssistantBody({
  state,
  message,
  onOpenThread,
}: {
  state: ThreadTreeState
  message: Message
  onOpenThread: (targetId: string, opts?: { keepSource?: boolean }) => void
}) {
  const research = webResearchPlacement(message)
  const hasResearch = research.activities.length > 0

  return (
    <AnchoredMarkdown
      state={state}
      msg={message}
      onOpenThread={onOpenThread}
      insertAt={research.insertAt}
      insert={
        hasResearch ? (
          <WebResearchPanel
            activities={research.activities}
            route={message.researchRoute}
            plan={message.researchPlan}
            complete={message.status === "done"}
          />
        ) : undefined
      }
    />
  )
}
