"use client"

import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { MODEL_CATALOG_REFRESH_MS } from "@/constants/model-catalog"
import type { PublicModelCatalog } from "./public"

const ModelCatalogContext = createContext<PublicModelCatalog | null>(null)
export function ModelCatalogProvider({ initial, children, refreshEnabled = true }: { initial: PublicModelCatalog; children: ReactNode; refreshEnabled?: boolean }) {
  const [catalog, setCatalog] = useState(initial)
  useEffect(() => {
    if (!refreshEnabled) return
    const controller = new AbortController()
    let pending = false
    async function refresh() {
      if (pending || document.visibilityState === "hidden") return
      pending = true
      try {
        const response = await fetch("/api/models", { cache: "no-store", signal: controller.signal })
        if (response.ok) setCatalog(await response.json())
      } catch { /* 短暂断网保留已加载菜单；每次付费请求仍由服务端重新验证。 */ }
      finally { pending = false }
    }
    const timer = setInterval(refresh, MODEL_CATALOG_REFRESH_MS)
    window.addEventListener("focus", refresh)
    return () => { controller.abort(); clearInterval(timer); window.removeEventListener("focus", refresh) }
  }, [refreshEnabled])
  return <ModelCatalogContext.Provider value={catalog}>{children}</ModelCatalogContext.Provider>
}
export function useModelCatalog() {
  const catalog = useContext(ModelCatalogContext)
  if (!catalog) throw new Error("ModelCatalogProvider 未挂载")
  return catalog
}
