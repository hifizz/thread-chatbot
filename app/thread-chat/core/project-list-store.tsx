"use client"

import React, { createContext, useContext, useEffect, useState } from "react"
import { createStore, type StoreApi } from "zustand/vanilla"
import { useStore } from "zustand"

import type { ProjectListItemDTO } from "@/lib/thread-chat/contracts/dto"
import {
  createThreadChatClient,
  type ThreadChatClient,
} from "../net/client"

interface ProjectListState {
  items: ProjectListItemDTO[] | null
  refreshing: boolean
  loadFailed: boolean
  refresh(): Promise<ProjectListItemDTO[]>
  setTitle(projectId: string, title: string): void
  restoreTitle(projectId: string, expected: string, title: string): void
  remove(projectId: string): void
}

export type ProjectListStore = StoreApi<ProjectListState>

export function createProjectListStore(
  client: Pick<ThreadChatClient, "listProjects">
): ProjectListStore {
  let pending: Promise<ProjectListItemDTO[]> | null = null
  let revision = 0

  return createStore<ProjectListState>()((set, get) => ({
    items: null,
    refreshing: false,
    loadFailed: false,
    refresh() {
      if (pending) return pending
      const startedAtRevision = revision
      set({ refreshing: true, loadFailed: false })
      pending = client
        .listProjects(false)
        .then((items) => {
          if (revision === startedAtRevision) set({ items })
          return items
        })
        .catch((error: unknown) => {
          if (revision === startedAtRevision && get().items === null)
            set({ loadFailed: true })
          throw error
        })
        .finally(() => {
          pending = null
          set({ refreshing: false })
        })
      return pending
    },
    setTitle(projectId, title) {
      if (!get().items?.some((item) => item.id === projectId)) return
      revision += 1
      set((state) => ({
        items: state.items!.map((item) =>
          item.id === projectId ? { ...item, title } : item
        ),
      }))
    },
    restoreTitle(projectId, expected, title) {
      if (
        !get().items?.some(
          (item) => item.id === projectId && item.title === expected
        )
      )
        return
      revision += 1
      set((state) => ({
        items: state.items!.map((item) =>
          item.id === projectId ? { ...item, title } : item
        ),
      }))
    },
    remove(projectId) {
      if (!get().items?.some((item) => item.id === projectId)) return
      revision += 1
      set((state) => ({
        items: state.items!.filter((item) => item.id !== projectId),
      }))
    },
  }))
}

const ProjectListStoreContext = createContext<ProjectListStore | null>(null)

export function ProjectListStoreProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [store] = useState(() =>
    createProjectListStore(createThreadChatClient())
  )

  useEffect(() => {
    void store.getState().refresh().catch(() => undefined)
  }, [store])

  return (
    <ProjectListStoreContext.Provider value={store}>
      {children}
    </ProjectListStoreContext.Provider>
  )
}

export function useProjectListStoreApi(): ProjectListStore {
  const store = useContext(ProjectListStoreContext)
  if (!store)
    throw new Error("useProjectListStoreApi 必须在 ProjectListStoreProvider 内使用")
  return store
}

export function useProjectListStore<T>(
  selector: (state: ProjectListState) => T
): T {
  return useStore(useProjectListStoreApi(), selector)
}
