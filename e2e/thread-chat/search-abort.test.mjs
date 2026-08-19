import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

import { webSearch } from "../../lib/ai/search.ts"

const originalFetch = globalThis.fetch
const controller = new AbortController()
let receivedSignal
globalThis.fetch = async (_url, init) => {
  receivedSignal = init.signal
  return new Promise((_resolve, reject) => {
    init.signal.addEventListener(
      "abort",
      () => reject(init.signal.reason),
      { once: true }
    )
  })
}

try {
  const pending = webSearch("latest release", 5, controller.signal)
  controller.abort(new DOMException("stopped", "AbortError"))
  await assert.rejects(pending, (error) => error?.name === "AbortError")
  assert.equal(receivedSignal.aborted, true)
} finally {
  globalThis.fetch = originalFetch
}

const tools = await readFile(
  new URL("../../lib/chat/research-tools.ts", import.meta.url),
  "utf8"
)
assert.equal(tools.match(/\{ abortSignal \}/g)?.length, 2)
assert.match(tools, /webSearch\([\s\S]*abortSignal/)
assert.match(tools, /extractUrl\(url, abortSignal\)/)

console.log("PASS  stopping generation aborts in-flight AnySearch operations")
