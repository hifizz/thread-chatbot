import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const nextRouteDocs = await readFile(
  new URL(
    "../../node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md",
    import.meta.url
  ),
  "utf8"
)
assert.match(nextRouteDocs, /Web \[Request\]/)
assert.match(nextRouteDocs, /const \{ id \} = await ctx\.params/)
assert.match(nextRouteDocs, /return Response\.json/)

const aiTypes = await readFile(
  new URL("../../node_modules/ai/dist/index.d.ts", import.meta.url),
  "utf8"
)
assert.match(
  aiTypes,
  /declare function toUIMessageStream<[\s\S]*stream: ReadableStream<TextStreamPart/
)
assert.match(aiTypes, /declare function readUIMessageStream</)
assert.match(
  aiTypes,
  /@deprecated Use the standalone `toUIMessageStream` helper from[\s\S]*`'ai'` with `result\.stream` instead/
)
assert.match(aiTypes, /interface UIMessage<[^>]+>[\s\S]*parts: Array<UIMessagePart/)

console.log("PASS installed Next.js and AI SDK contracts")
