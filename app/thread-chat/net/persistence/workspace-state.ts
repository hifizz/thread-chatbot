import type { WorkspaceUiState } from "../../core/types"

const WORKSPACE_VERSION = 1
const KEY_PREFIX = "thread-chat:workspace:"

export interface StoredWorkspace {
  version: typeof WORKSPACE_VERSION
  workspace: WorkspaceUiState
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

export function sanitizeWorkspaceState(value: unknown): WorkspaceUiState | null {
  if (typeof value !== "object" || value === null) return null
  const envelope = value as Record<string, unknown>
  if (envelope.version !== WORKSPACE_VERSION) return null
  const raw = envelope.workspace
  if (typeof raw !== "object" || raw === null) return null
  const workspace = raw as Record<string, unknown>
  const canvasRaw =
    typeof workspace.canvas === "object" && workspace.canvas !== null
      ? (workspace.canvas as Record<string, unknown>)
      : {}
  const pinsRaw =
    typeof canvasRaw.pins === "object" && canvasRaw.pins !== null
      ? (canvasRaw.pins as Record<string, unknown>)
      : {}
  const pins = Object.fromEntries(
    Object.entries(pinsRaw).flatMap(([id, position]) => {
      if (typeof position !== "object" || position === null) return []
      const point = position as Record<string, unknown>
      if (typeof point.x !== "number" || typeof point.y !== "number") return []
      return [[id, { x: point.x, y: point.y }]]
    })
  )
  const viewportRaw =
    typeof canvasRaw.viewport === "object" && canvasRaw.viewport !== null
      ? (canvasRaw.viewport as Record<string, unknown>)
      : null
  const panelRaw =
    typeof workspace.panelSizes === "object" && workspace.panelSizes !== null
      ? (workspace.panelSizes as Record<string, unknown>)
      : {}
  return {
    view: workspace.view === "canvas" ? "canvas" : "columns",
    openThreadIds: stringArray(workspace.openThreadIds),
    selectedThreadId:
      typeof workspace.selectedThreadId === "string"
        ? workspace.selectedThreadId
        : "",
    recents: stringArray(workspace.recents).slice(0, 6),
    canvas: {
      pins,
      ...(viewportRaw
        ? {
            viewport: {
              x: finite(viewportRaw.x, 0),
              y: finite(viewportRaw.y, 0),
              zoom: finite(viewportRaw.zoom, 1),
            },
          }
        : {}),
    },
    panelSizes: {
      ...(Array.isArray(panelRaw.columns)
        ? {
            columns: panelRaw.columns.filter(
              (item): item is number =>
                typeof item === "number" && Number.isFinite(item)
            ),
          }
        : {}),
      ...(typeof panelRaw.artifactDrawer === "number" &&
      Number.isFinite(panelRaw.artifactDrawer)
        ? { artifactDrawer: panelRaw.artifactDrawer }
        : {}),
    },
    expandedNodes: stringArray(workspace.expandedNodes),
  }
}

export function loadWorkspaceState(
  storage: Pick<Storage, "getItem">,
  projectId: string
): WorkspaceUiState | null {
  const raw = storage.getItem(`${KEY_PREFIX}${projectId}`)
  if (!raw) return null
  try {
    return sanitizeWorkspaceState(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveWorkspaceState(
  storage: Pick<Storage, "setItem">,
  projectId: string,
  workspace: WorkspaceUiState
): void {
  const value: StoredWorkspace = { version: WORKSPACE_VERSION, workspace }
  storage.setItem(`${KEY_PREFIX}${projectId}`, JSON.stringify(value))
}

