"use client"

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import type { ThreadChatApiCapabilities } from "../api/capabilities"
import {
  createNewProjectDraftStore,
  createThreadChatAppRuntime,
} from "./runtime"
import type {
  ListProjectsResult,
  NavigationCapability,
  NewProjectDraftStore,
  ThreadChatAppRuntime,
  ThreadChatProjectRuntime,
} from "./types"
import type { StoreApi } from "zustand/vanilla"

const ThreadChatAppRuntimeContext = createContext<ThreadChatAppRuntime | null>(
  null
)
const ThreadChatProjectRuntimeContext =
  createContext<ThreadChatProjectRuntime | null>(null)
const NewProjectDraftStoreContext =
  createContext<StoreApi<NewProjectDraftStore> | null>(null)
const appRuntimeLifecycleVersions = new WeakMap<ThreadChatAppRuntime, number>()

function projectIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/thread-chat\/([^/]+)$/)
  if (!match || match[1] === "new") return null
  return decodeURIComponent(match[1])
}

export function ThreadChatAppProvider({
  children,
  initialCatalog,
  api,
  navigation,
}: {
  children: ReactNode
  initialCatalog?: ListProjectsResult
  api?: ThreadChatApiCapabilities
  navigation?: NavigationCapability
}) {
  const router = useRouter()
  const [runtime] = useState(() =>
    createThreadChatAppRuntime({
      api,
      initialCatalog,
      navigation: navigation ?? {
        replace: (path) => router.replace(path),
        currentProjectId: () =>
          typeof window === "undefined"
            ? null
            : projectIdFromPathname(window.location.pathname),
      },
    })
  )
  useEffect(() => {
    const version = (appRuntimeLifecycleVersions.get(runtime) ?? 0) + 1
    appRuntimeLifecycleVersions.set(runtime, version)
    return () => {
      queueMicrotask(() => {
        if (appRuntimeLifecycleVersions.get(runtime) === version) {
          appRuntimeLifecycleVersions.delete(runtime)
          runtime.destroy()
        }
      })
    }
  }, [runtime])
  return (
    <ThreadChatAppRuntimeContext.Provider value={runtime}>
      {children}
    </ThreadChatAppRuntimeContext.Provider>
  )
}

export function ThreadChatProjectProvider({
  children,
  projectId,
}: {
  children: ReactNode
  projectId: string
}) {
  const appRuntime = useThreadChatAppRuntime()
  const [runtime] = useState(() =>
    appRuntime.projectRuntimeRegistry.acquire(projectId)
  )

  useEffect(() => {
    const bootstrap = runtime.store.getState().requests.bootstrap
    const ready =
      bootstrap.status === "ready"
        ? Promise.resolve()
        : runtime.commands.loadProjectBootstrap()
    runtime.generationCoordinator.resumeLoadedRuns()
    void ready.finally(() => {
      if (appRuntime.appStore.getState().shellUi.pendingProjectId === projectId)
        appRuntime.appStore.getState().setProjectRoutePending(null)
    })
  }, [appRuntime, projectId, runtime])

  useEffect(() => {
    const leased = appRuntime.projectRuntimeRegistry.acquire(projectId)
    if (leased !== runtime)
      throw new Error("Project Runtime identity changed during Provider lease.")
    return () => appRuntime.projectRuntimeRegistry.release(projectId)
  }, [appRuntime, projectId, runtime])

  return (
    <ThreadChatProjectRuntimeContext.Provider value={runtime}>
      {children}
    </ThreadChatProjectRuntimeContext.Provider>
  )
}

export function NewProjectDraftProvider({
  children,
  initialRequestedModelId,
}: {
  children: ReactNode
  initialRequestedModelId?: string
}) {
  const [store] = useState(() =>
    createNewProjectDraftStore(initialRequestedModelId)
  )
  return (
    <NewProjectDraftStoreContext.Provider value={store}>
      {children}
    </NewProjectDraftStoreContext.Provider>
  )
}

export function useThreadChatAppRuntime(): ThreadChatAppRuntime {
  const runtime = useContext(ThreadChatAppRuntimeContext)
  if (!runtime)
    throw new Error("ThreadChatAppProvider is required for this hook.")
  return runtime
}

export function useThreadChatProjectRuntime(): ThreadChatProjectRuntime {
  const runtime = useContext(ThreadChatProjectRuntimeContext)
  if (!runtime)
    throw new Error("ThreadChatProjectProvider is required for this hook.")
  return runtime
}

export function useNewProjectDraftStoreApi(): StoreApi<NewProjectDraftStore> {
  const store = useContext(NewProjectDraftStoreContext)
  if (!store)
    throw new Error("NewProjectDraftProvider is required for this hook.")
  return store
}
