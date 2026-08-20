import type { Message } from "../../core/types"

export function webResearchPlacement(message: Message) {
  const activities = message.webResearch ?? []
  return {
    activities,
    insertAt:
      activities.length > 0 ? (message.webResearchTextOffset ?? 0) : undefined,
  }
}
