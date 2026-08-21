import assert from "node:assert/strict"
import {
  createWebResearchActivityDispatcher,
  webResearchSourcesFromOutput,
} from "../../lib/chat/web-research-activity.ts"
import { projectGenerationResult } from "../../lib/thread-chat/application/project-generation-result.ts"

const output = {
  results: [
    { title: " Primary ", url: " https://example.com/a " },
    { title: "Duplicate", url: "https://example.com/a" },
    { title: "", url: "https://example.com/b" },
    { title: "missing URL" },
  ],
}
const canonicalSources = [
  { title: "Primary", url: "https://example.com/a" },
  { title: "https://example.com/b", url: "https://example.com/b" },
]
assert.deepEqual(webResearchSourcesFromOutput(output), canonicalSources)

const activities = []
const dispatch = createWebResearchActivityDispatcher((activity) =>
  activities.push(activity)
)
dispatch({
  type: "tool-input-available",
  toolCallId: "search-1",
  toolName: "webSearch",
  input: { query: "source normalization" },
})
dispatch({
  type: "tool-output-available",
  toolCallId: "search-1",
  output,
})
assert.deepEqual(activities.at(-1).sources, canonicalSources)

const projected = projectGenerationResult({
  generationId: "generation-1",
  threadId: "main",
  assistantMessageId: "assistant-1",
  terminalStatus: "completed",
  responseMessage: {
    parts: [
      {
        type: "tool-webSearch",
        toolCallId: "search-1",
        state: "output-available",
        input: { query: "source normalization" },
        output,
      },
    ],
  },
})
assert.deepEqual(projected.result.webResearch[0].sources, canonicalSources)

console.log(
  "PASS  live and persisted web research share one source normalization contract"
)
