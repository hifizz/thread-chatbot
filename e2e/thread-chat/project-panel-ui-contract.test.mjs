import assert from "node:assert/strict"
import { access, readFile } from "node:fs/promises"

const root = new URL("../../", import.meta.url)
const artifactDir = new URL(
  "app/thread-chat/orchestration/artifacts/",
  root
)
const [projectDrawer, artifactsDrawer, projectBound, artifactsBound, shell, chatView] =
  await Promise.all([
    readFile(new URL("project-drawer.tsx", artifactDir), "utf8"),
    readFile(new URL("artifacts-drawer.tsx", artifactDir), "utf8"),
    readFile(new URL("store-bound-project-drawer.tsx", artifactDir), "utf8"),
    readFile(new URL("store-bound-artifacts-drawer.tsx", artifactDir), "utf8"),
    readFile(new URL("app/thread-chat/thread-chat-demo.tsx", root), "utf8"),
    readFile(new URL("app/thread-chat/chat/chat-view.tsx", root), "utf8"),
  ])

for (const legacyFile of [
  "project-panel.tsx",
  "store-bound-project-panel.tsx",
  "artifact-drawer.tsx",
]) {
  await assert.rejects(access(new URL(legacyFile, artifactDir)), { code: "ENOENT" })
}

// Project Drawer 只承载 Overview / Files，并提供完整 tab 语义与编辑态 Esc。
assert.match(projectDrawer, /type ProjectDrawerSection = "overview" \| "files"/)
assert.doesNotMatch(projectDrawer, /ProjectDrawerSection[^\n]*artifacts/)
assert.equal(projectDrawer.match(/role="tab"/g)?.length, 2)
assert.equal(projectDrawer.match(/role="tabpanel"/g)?.length, 2)
assert.match(projectDrawer, /aria-selected=/)
assert.match(projectDrawer, /aria-controls=/)
assert.match(projectDrawer, /onKeyDownCapture=/)
assert.match(projectDrawer, /event\.key === "Escape"/)
assert.match(projectDrawer, /event\.stopPropagation\(\)/)
assert.match(projectDrawer, /cancelEdit\(\)/)

// 原 Contract 与 File 生命周期能力仍在 Project Drawer 内。
assert.match(projectDrawer, /await onSaveContract\(targetDraft, instructionsDraft\)/)
assert.match(projectDrawer, /uploadProjectFile\(file,/)
assert.match(projectDrawer, /file\.status === "failed"/)
assert.match(projectDrawer, /window\.confirm\(/)
assert.match(projectDrawer, /历史消息中的附件不会被删除/)
assert.match(projectDrawer, /PROJECT_WORKSPACE_COPY\.archivedReadOnly/)

// 尚未持久化的 UUID 是明确空态，不得被误报为无限加载。
assert.match(projectDrawer, /Project 尚未创建/)
assert.match(projectDrawer, /发送第一条消息后/)
assert.match(projectDrawer, /!project \? \(/)
assert.doesNotMatch(projectDrawer, /Project 加载中/)

// Artifacts Drawer 独立负责全 Project 列表、搜索、详情和来源定位。
assert.match(artifactsDrawer, /artifacts\.length >= ARTIFACT_SEARCH_THRESHOLD/)
assert.match(artifactsDrawer, /right\.createdAt\.localeCompare\(left\.createdAt\)/)
assert.match(artifactsDrawer, /无匹配 Artifact/)
assert.match(artifactsDrawer, /还没有 Artifact/)
assert.match(artifactsDrawer, /selectedArtifact/)
assert.match(artifactsDrawer, /onLocate\(viewThreadId, artifact\.sourceMessageId\)/)
assert.match(artifactsDrawer, /listScrollRef/)
assert.match(artifactsDrawer, /detailRef\.current\?\.scrollTo/)
assert.match(artifactsDrawer, /className="project-resource-list dense"/)

// 两个 store-bound 组件订阅同一 normalized store；壳层只做一次刷新并组合渲染。
assert.match(projectBound, /useConversationStore\(store/)
assert.match(artifactsBound, /useConversationStore\(store/)
assert.match(projectBound, /commands\.updateProjectContract/)
assert.match(projectBound, /commands\.addProjectFile/)
assert.match(projectBound, /commands\.removeProjectFile/)
assert.match(artifactsBound, /state\.artifactOrder/)
assert.match(shell, /const refreshProject = useCallback/)
assert.match(shell, /runtime\.client\.getProject\(treeId\)/)
assert.match(shell, /<StoreBoundProjectDrawer/)
assert.match(shell, /<StoreBoundArtifactsDrawer/)
assert.doesNotMatch(shell, /<ProjectPanel|<ArtifactDrawer/)

// 来源消息仍可被精确定位并短暂高亮。
assert.match(chatView, /data-thread-chat-message-id=\{msg\.id\}/)
assert.match(artifactsBound, /scrollIntoView\(/)
assert.match(artifactsBound, /element\.animate\(/)
assert.match(artifactsBound, /revealMessage\(sourceMessageId\)/)

console.log("PASS  split Project/Artifacts drawers preserve workspace UI contracts")
