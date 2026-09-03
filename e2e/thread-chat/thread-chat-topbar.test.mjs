import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"
import { columnCountChoices } from "../../app/thread-chat/orchestration/navigation/thread-chat-topbar-logic.ts"

assert.deepEqual(columnCountChoices(null), [
  { value: "auto", label: "自适应", active: true },
  { value: 2, label: "2", active: false },
  { value: 3, label: "3", active: false },
  { value: 4, label: "4", active: false },
])
assert.deepEqual(
  columnCountChoices(3).filter((choice) => choice.active),
  [{ value: 3, label: "3", active: true }]
)

const [topbar, shell, messageActionsCss, topbarCss] = await Promise.all([
  readFile(
    new URL(
      "../../app/thread-chat/orchestration/navigation/thread-chat-topbar.tsx",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL("../../app/thread-chat/thread-chat-demo.tsx", import.meta.url),
    "utf8"
  ),
  readFile(
    new URL(
      "../../app/thread-chat/styles/message-actions.css",
      import.meta.url
    ),
    "utf8"
  ),
  readFile(
    new URL("../../app/thread-chat/styles/topbar.css", import.meta.url),
    "utf8"
  ),
])
assert.match(topbar, /aria-label="视图模式"/)
assert.match(topbar, /aria-label="列数"/)
assert.match(topbar, /aria-pressed=\{viewMode === "columns"\}/)
assert.match(topbar, /aria-pressed=\{choice\.active\}/)
assert.match(topbar, /aria-pressed=\{placementMode === "replace"\}/)
assert.match(topbar, /onToggleProject\(\)/)
assert.match(topbar, /onToggleArtifacts\(\)/)
assert.match(topbar, /title="Project"/)
assert.match(topbar, /title="Artifacts"/)
assert.match(topbar, /aria-label="打开 \/ 收起 Project"/)
assert.match(topbar, /aria-label="打开 \/ 收起 Artifacts"/)
assert.doesNotMatch(topbar, />\s*Project\s*</)
assert.doesNotMatch(topbar, />\s*Artifacts\s*</)
assert.match(topbar, /<span className="cnt">\{artifactCount\}<\/span>/)
assert.doesNotMatch(topbar, /artifactCount > 0/)
assert.match(shell, /const artifactCount = state\.artifactOrder\.length/)
assert.match(topbarCss, /\.tc \.tbtn \.cnt \{[\s\S]*line-height: 14px;/)
assert.doesNotMatch(`${topbar}\n${shell}`, /markdownCount|onToggleMarkdown/)

const projectButton = topbar.match(
  /<button[\s\S]*?onClick=\{onToggleProject\}[\s\S]*?<\/button>/
)?.[0]
const artifactsButton = topbar.match(
  /<button[\s\S]*?onClick=\{onToggleArtifacts\}[\s\S]*?<\/button>/
)?.[0]
assert.ok(projectButton)
assert.ok(artifactsButton)
assert.doesNotMatch(projectButton, /className="cnt"/)
assert.match(artifactsButton, /className="cnt"/)

await assert.rejects(
  access(
    new URL(
      "../../app/thread-chat/chat/actions/turn-variant-picker.tsx",
      import.meta.url
    )
  ),
  { code: "ENOENT" }
)
assert.doesNotMatch(
  messageActionsCss,
  /turn-variant|variant-arrow|variant-label/
)

console.log(
  "PASS  Thread Chat topbar exposes one active column choice and no variant picker"
)
