import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"

const stylesUrl = new URL("../../app/thread-chat/styles/", import.meta.url)
const messagesUrl = new URL("messages.css", stylesUrl)
const messages = readFileSync(messagesUrl, "utf8")
const otherStyles = readdirSync(stylesUrl)
  .filter((name) => name.endsWith(".css") && name !== "messages.css")
  .map((name) => readFileSync(new URL(name, stylesUrl), "utf8"))
  .join("\n")

assert.equal(
  messages.match(/\.tc \.message\.user \.msg-quote\s*\{/g)?.length,
  1
)
assert.match(
  messages,
  /\.msg-quote[\s\S]*?-webkit-line-clamp:\s*2;[\s\S]*?overflow:\s*hidden;/
)
assert.doesNotMatch(otherStyles, /\.msg-quote/)

console.log("PASS  user message quote styles are owned only by messages.css")
