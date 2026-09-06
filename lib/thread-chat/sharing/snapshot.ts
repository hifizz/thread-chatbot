import type { projects, threads, messages, artifacts } from "@/lib/db/schema"
import { SHARE_LIMITS } from "@/constants/sharing"
import { publicParts, publicText } from "./content"
import { publicSnapshotSchema, type PublicSnapshot, type ShareLayout } from "./contracts"

type Project = typeof projects.$inferSelect
type Thread = typeof threads.$inferSelect
type Message = typeof messages.$inferSelect
type Artifact = typeof artifacts.$inferSelect
function invalid(): never { throw new Error("SHARE_INVALID_SOURCE") }
function snapshotBudget() {
  let bytes = 0
  return <T>(value: T): T => {
    bytes += Buffer.byteLength(JSON.stringify(value), "utf8")
    if (bytes > SHARE_LIMITS.snapshotBytes) throw new Error("SHARE_TOO_LARGE")
    return value
  }
}
function unique<T extends { id: string }>(rows: T[]) {
  const map = new Map(rows.map((row) => [row.id, row]))
  if (map.size !== rows.length) invalid()
  return map
}
export function normalizeLayout(layout: ShareLayout, threadIds: Set<string>, artifactIds: Set<string>, rootId: string): ShareLayout {
  const seen = new Set<string>()
  return {
    view: layout.view, columnCount: layout.columnCount, placementMode: layout.placementMode,
    slots: layout.slots.filter((slot) => threadIds.has(slot.id) && slot.id !== rootId && !seen.has(slot.id) && !!seen.add(slot.id)),
    widths: Object.fromEntries(Object.entries(layout.widths).filter(([id]) => threadIds.has(id))),
    focusId: layout.focusId && threadIds.has(layout.focusId) ? layout.focusId : rootId,
    pins: [...new Map(layout.pins.filter((pin) => threadIds.has(pin.id)).map((pin) => [pin.id, pin])).values()],
    viewport: layout.viewport,
    artifactId: layout.artifactId && artifactIds.has(layout.artifactId) ? layout.artifactId : null,
    panelWidth: layout.panelWidth,
  }
}
function finish(snapshot: PublicSnapshot): PublicSnapshot {
  const result = publicSnapshotSchema.parse(snapshot)
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > SHARE_LIMITS.snapshotBytes) throw new Error("SHARE_TOO_LARGE")
  return result
}
function artifactBody(artifact: Artifact) {
  return { title: publicText(artifact.title), content: publicText(artifact.content), createdAt: artifact.createdAt.toISOString() }
}
export function buildArtifactSnapshot(project: Project, thread: Thread, source: Message, artifact: Artifact): PublicSnapshot {
  if (artifact.kind !== "markdown" || source.status !== "completed" || artifact.projectId !== project.id || thread.projectId !== project.id || source.projectId !== project.id || artifact.threadId !== thread.id || source.threadId !== thread.id || artifact.sourceMessageId !== source.id) invalid()
  return finish({ schemaVersion: 1, resourceType: "artifact", ...artifactBody(artifact) })
}
export function buildProjectSnapshot(project: Project, threadRows: Thread[], messageRows: Message[], artifactRows: Artifact[], layout: ShareLayout): PublicSnapshot {
  const include = snapshotBudget()
  if (threadRows.length > SHARE_LIMITS.threads) throw new Error("SHARE_TOO_LARGE")
  const threadMap = unique(threadRows), messageMap = unique(messageRows)
  unique(artifactRows)
  const roots = threadRows.filter((t) => t.parentId === null)
  if (roots.length !== 1) invalid()
  const root = roots[0]
  const needed = new Set(messageRows.filter((m) => !m.supersededAt).map((m) => m.id))
  for (const thread of threadRows) {
    if (thread.projectId !== project.id) invalid()
    const visited = new Set<string>([thread.id])
    let current = thread
    while (current.parentId) {
      const parent = threadMap.get(current.parentId)
      if (!parent || visited.has(parent.id) || current.depth !== parent.depth + 1) invalid()
      visited.add(parent.id); current = parent
    }
    if (thread.parentId) {
      const source = thread.forkMessageId && messageMap.get(thread.forkMessageId)
      if (!source || source.threadId !== thread.parentId || !thread.forkContext.includes(source.id)) invalid()
      for (const id of thread.forkContext) {
        const context = messageMap.get(id)
        if (!context || !visited.has(context.threadId) || context.threadId === thread.id) invalid()
        needed.add(id)
      }
      needed.add(source.id)
    }
  }
  const selectedArtifacts = artifactRows.filter((artifact) => {
    if (artifact.projectId !== project.id) invalid()
    const source = messageMap.get(artifact.sourceMessageId)
    if (!source || source.threadId !== artifact.threadId || !threadMap.has(artifact.threadId)) invalid()
    if (artifact.kind !== "markdown" || source.status !== "completed") return false
    needed.add(source.id)
    return true
  })
  if (needed.size > SHARE_LIMITS.messages || selectedArtifacts.length > SHARE_LIMITS.artifacts) throw new Error("SHARE_TOO_LARGE")
  const selectedMessages = [...needed].map((id) => {
    const message = messageMap.get(id)
    if (!message || message.projectId !== project.id || !threadMap.has(message.threadId)) invalid()
    return include({ id: message.id, threadId: message.threadId, sequence: message.sequence, role: message.role, status: message.status, historical: message.supersededAt !== null, parts: publicParts(message.parts, message.status) })
  }).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id))
  return finish({
    schemaVersion: 1, resourceType: "project", title: publicText(project.customTitle || project.autoTitle || "未命名项目"), rootThreadId: root.id,
    threads: threadRows.map((t) => ({ id: t.id, parentId: t.parentId, title: publicText(t.customTitle || t.autoTitle || "未命名分支"), depth: t.depth, footnote: t.footnote, anchorText: t.anchorText === null ? null : publicText(t.anchorText), forkMessageId: t.forkMessageId, forkContext: t.forkContext.map((id) => id), forkAnchor: t.forkAnchor ? { quote: { exact: publicText(t.forkAnchor.quote.exact), prefix: publicText(t.forkAnchor.quote.prefix), suffix: publicText(t.forkAnchor.quote.suffix) } } : null })),
    messages: selectedMessages,
    artifacts: selectedArtifacts.map((a) => include({ id: a.id, threadId: a.threadId, sourceMessageId: a.sourceMessageId, ...artifactBody(a) })),
    layout: normalizeLayout(layout, new Set(threadMap.keys()), new Set(selectedArtifacts.map((a) => a.id)), root.id),
  })
}
