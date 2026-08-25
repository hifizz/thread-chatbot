import { createStore } from "zustand/vanilla"
import type {
  ListProjectsResult,
  ProjectSummary,
  ThreadChatAppState,
  ThreadChatAppStore,
} from "./types"

const compareProjects = (left: ProjectSummary, right: ProjectSummary) =>
  right.updatedAt.localeCompare(left.updatedAt) ||
  right.id.localeCompare(left.id)

function createInitialState(
  initialCatalog?: ListProjectsResult
): ThreadChatAppState {
  const items = initialCatalog?.items ?? []
  return {
    catalog: {
      projectsById: Object.fromEntries(items.map((item) => [item.id, item])),
      orderedProjectIds: items.toSorted(compareProjects).map((item) => item.id),
      loadState: initialCatalog ? { status: "ready" } : { status: "idle" },
      activeFilter: "active",
      nextCursor: initialCatalog?.nextCursor ?? null,
    },
    shellUi: {
      sidebarOpen: true,
      sidebarWidth: 280,
      projectSearchQuery: "",
      pendingProjectId: null,
    },
  }
}

export function createThreadChatAppStore(initialCatalog?: ListProjectsResult) {
  return createStore<ThreadChatAppStore>()((set) => ({
    ...createInitialState(initialCatalog),
    mergeProjectPage(result, reset = false) {
      set((state) => {
        const projectsById = reset ? {} : { ...state.catalog.projectsById }
        for (const item of result.items) projectsById[item.id] = item
        return {
          catalog: {
            ...state.catalog,
            projectsById,
            orderedProjectIds: Object.values(projectsById)
              .toSorted(compareProjects)
              .map((item) => item.id),
            loadState: { status: "ready" },
            nextCursor: result.nextCursor,
          },
        }
      })
    },
    upsertProjectSummary(summary) {
      set((state) => {
        const projectsById = {
          ...state.catalog.projectsById,
          [summary.id]: summary,
        }
        return {
          catalog: {
            ...state.catalog,
            projectsById,
            orderedProjectIds: Object.values(projectsById)
              .toSorted(compareProjects)
              .map((item) => item.id),
          },
        }
      })
    },
    removeProjectSummary(projectId) {
      set((state) => {
        const projectsById = { ...state.catalog.projectsById }
        delete projectsById[projectId]
        return {
          catalog: {
            ...state.catalog,
            projectsById,
            orderedProjectIds: state.catalog.orderedProjectIds.filter(
              (id) => id !== projectId
            ),
          },
        }
      })
    },
    setCatalogLoadState(loadState) {
      set((state) => ({ catalog: { ...state.catalog, loadState } }))
    },
    setCatalogFilter(activeFilter) {
      set((state) => ({
        catalog: {
          ...state.catalog,
          activeFilter,
          projectsById: {},
          orderedProjectIds: [],
          loadState: { status: "idle" },
          nextCursor: null,
        },
      }))
    },
    setProjectRoutePending(pendingProjectId) {
      set((state) => ({ shellUi: { ...state.shellUi, pendingProjectId } }))
    },
    setSidebarOpen(sidebarOpen) {
      set((state) => ({ shellUi: { ...state.shellUi, sidebarOpen } }))
    },
    setSidebarWidth(sidebarWidth) {
      set((state) => ({
        shellUi: {
          ...state.shellUi,
          sidebarWidth: Math.max(200, Math.min(520, sidebarWidth)),
        },
      }))
    },
    setProjectSearchQuery(projectSearchQuery) {
      set((state) => ({
        shellUi: { ...state.shellUi, projectSearchQuery },
      }))
    },
  }))
}
