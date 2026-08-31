import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"

const panel = await readFile(
  new URL(
    "../../app/thread-chat/orchestration/artifacts/project-panel.tsx",
    import.meta.url
  ),
  "utf8"
)
const bound = await readFile(
  new URL(
    "../../app/thread-chat/orchestration/artifacts/store-bound-project-panel.tsx",
    import.meta.url
  ),
  "utf8"
)
const chatView = await readFile(
  new URL("../../app/thread-chat/chat/chat-view.tsx", import.meta.url),
  "utf8"
)
const shell = await readFile(
  new URL("../../app/thread-chat/thread-chat-demo.tsx", import.meta.url),
  "utf8"
)

// Contract edit UX: draft is local; cancel restores authoritative server values;
// save failure only sets error and therefore preserves the unsaved draft.
assert.match(panel, /const \[targetDraft, setTargetDraft\] = useState\(""\)/)
assert.match(panel, /const \[instructionsDraft, setInstructionsDraft\] = useState\(""\)/)
assert.match(panel, /setTargetDraft\(project\?\.target \?\? ""\)/)
assert.match(panel, /setInstructionsDraft\(project\?\.instructions \?\? ""\)/)
assert.match(panel, /const cancelEdit = \(\) =>/)
assert.match(panel, /await onSaveContract\(targetDraft, instructionsDraft\)/)
assert.match(panel, /setError\(/)
assert.doesNotMatch(
  panel.match(/const saveContract = async \(\) => \{[\s\S]*?\n  \}/)?.[0] ?? "",
  /setTargetDraft\(project/
)

// File lifecycle and removal are visible/recoverable rather than silently hidden.
assert.match(panel, /uploadProjectFile\(file,/)
assert.match(panel, /uploading \? "上传中…" : "上传文件"/)
assert.match(panel, /file\.status === "failed"/)
assert.match(panel, /file\.error/)
assert.match(panel, /window\.confirm\(/)
assert.match(panel, /历史消息中的附件不会被删除/)

// Project-wide artifact discovery/detail: search, descending createdAt, provenance,
// stopped/failed status labels, and source navigation are all present.
assert.match(panel, /right\.createdAt\.localeCompare\(left\.createdAt\)/)
assert.match(panel, /artifactQuery\.trim\(\)\.toLowerCase\(\)/)
assert.match(panel, /sourceThreadTitle/)
assert.match(panel, /sourceMessageStatus/)
assert.match(panel, /sourceStatusLabel\(selectedArtifact\.sourceMessageStatus\)/)
assert.match(panel, /onLocate\(viewThreadId, artifact\.sourceMessageId\)/)

// Archived workspaces expose read-only state and suppress edit/upload/remove controls.
assert.match(panel, /const archived = Boolean\(project\?\.archivedAt\)/)
assert.match(panel, /PROJECT_WORKSPACE_COPY\.archivedReadOnly/)
assert.match(panel, /!archived && !editing && project/)
assert.match(panel, /!archived && project/)
assert.match(panel, /!archived && \(/)

// The live panel consumes the same normalized store/runtime commands as ThreadChat.
assert.match(bound, /useConversationStore\(store/)
assert.match(bound, /store\.getState\(\)\.hydrateProject\(bootstrap\)/)
assert.match(bound, /commands\.updateProjectContract/)
assert.match(bound, /commands\.addProjectFile/)
assert.match(bound, /commands\.removeProjectFile/)
assert.match(shell, /<StoreBoundProjectPanel/)
assert.doesNotMatch(shell, /<ArtifactDrawer/)

// Artifact provenance can target an exact rendered message and briefly highlight it.
assert.match(chatView, /data-thread-chat-message-id=\{msg\.id\}/)
assert.match(bound, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/)
assert.match(bound, /element\.animate\(/)
assert.match(bound, /revealMessage\(sourceMessageId\)/)

console.log("project panel UI contract tests passed")
