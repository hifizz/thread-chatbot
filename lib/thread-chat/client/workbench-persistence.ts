import type {
  ThreadChatProjectStore,
  ThreadWorkbenchSnapshotV1,
} from "./types"

const WORKBENCH_STORAGE_PREFIX = "thread-chat:project-workbench:v1:"

export function projectWorkbenchStorageKey(projectId: string) {
  return `${WORKBENCH_STORAGE_PREFIX}${projectId}`
}

export function createWorkbenchSnapshot(
  state: ThreadChatProjectStore
): ThreadWorkbenchSnapshotV1 {
  return {
    schemaVersion: 1,
    columnSlots: structuredClone(state.ui.columnSlots),
    focusedSlotId: state.ui.focusedSlotId ?? "root",
    rootColumnWidthPx: state.ui.rootColumnWidthPx,
    forceColumnCount: state.ui.forceColumnCount,
    placementMode: state.ui.placementMode,
    viewMode: state.ui.viewMode,
    canvasPins: structuredClone(state.ui.canvasPins),
  }
}

export function parseWorkbenchSnapshot(
  value: string | null
): ThreadWorkbenchSnapshotV1 | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Partial<ThreadWorkbenchSnapshotV1>
    if (
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.columnSlots) ||
      (parsed.focusedSlotId !== "root" &&
        typeof parsed.focusedSlotId !== "string") ||
      !Object.prototype.hasOwnProperty.call(parsed, "rootColumnWidthPx") ||
      !Object.prototype.hasOwnProperty.call(parsed, "forceColumnCount") ||
      (parsed.placementMode !== "replace" && parsed.placementMode !== "fold") ||
      (parsed.viewMode !== "columns" && parsed.viewMode !== "canvas") ||
      typeof parsed.canvasPins !== "object" ||
      parsed.canvasPins === null
    )
      return null
    return parsed as ThreadWorkbenchSnapshotV1
  } catch {
    return null
  }
}
