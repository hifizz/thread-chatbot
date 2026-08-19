import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import test from "node:test"

import { SELECTION_QUESTION_MAX_HEIGHT } from "../../app/thread-chat/branching/selection-composer-dimensions.ts"

const componentUrl = new URL(
  "../../app/thread-chat/branching/selection-bubble.tsx",
  import.meta.url
)
const cssUrl = new URL(
  "../../app/thread-chat/styles/selection.css",
  import.meta.url
)

test("selection question height has one runtime source", async () => {
  const [component, css] = await Promise.all([
    readFile(componentUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ])

  assert.equal(SELECTION_QUESTION_MAX_HEIGHT, 68)
  assert.match(
    component,
    /Math\.min\(ta\.scrollHeight, SELECTION_QUESTION_MAX_HEIGHT\)/
  )
  assert.match(
    component,
    /"--selection-question-max-height": `\$\{SELECTION_QUESTION_MAX_HEIGHT\}px`/
  )
  assert.match(css, /max-height:\s*var\(--selection-question-max-height\)/)
  assert.doesNotMatch(css, /max-height:\s*68px/)
})
