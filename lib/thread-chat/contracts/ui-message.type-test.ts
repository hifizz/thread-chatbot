import type {
  ThreadChatUIMessage,
  ThreadChatUIMessageChunk,
} from "@/lib/thread-chat/contracts/ui-message"

const completeMessage = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "assistant",
  metadata: {
    messageId: "00000000-0000-4000-8000-000000000001",
    threadId: "00000000-0000-4000-8000-000000000002",
    modelId: "test/model",
  },
  parts: [
    { type: "reasoning", text: "reason", state: "done" },
    { type: "text", text: "answer", state: "done" },
    {
      type: "source-url",
      sourceId: "source-1",
      url: "https://example.com",
      title: "Example",
    },
    {
      type: "file",
      mediaType: "text/plain",
      filename: "note.txt",
      url: "/api/attachments/file-1",
    },
    {
      type: "tool-createMarkdownArtifact",
      toolCallId: "tool-1",
      state: "output-available",
      input: { title: "Plan", content: "# Plan" },
      output: {
        created: true,
        artifactId: "00000000-0000-4000-8000-000000000003",
      },
    },
    { type: "data-quote", data: { text: "selected text" } },
  ],
} satisfies ThreadChatUIMessage

const textDelta = {
  type: "text-delta",
  id: "text-1",
  delta: "delta",
} satisfies ThreadChatUIMessageChunk

const dataChunk = {
  type: "data-artifact-progress",
  id: "progress-1",
  transient: true,
  data: {
    toolCallId: "tool-1",
    phase: "streaming",
    characterCount: 10,
    lineCount: 1,
    headings: [],
  },
} satisfies ThreadChatUIMessageChunk

void completeMessage
void textDelta
void dataChunk
