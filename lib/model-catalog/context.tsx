"use client"

import { createContext, useContext, useState, type ReactNode } from "react"
import type { PublicModelCatalog } from "./public"

const ModelCatalogContext = createContext<PublicModelCatalog | null>(null)
export function ModelCatalogProvider({ initial, children }: { initial: PublicModelCatalog; children: ReactNode }) {
  const [catalog] = useState(initial)
  return <ModelCatalogContext.Provider value={catalog}>{children}</ModelCatalogContext.Provider>
}
export function useModelCatalog() {
  const catalog = useContext(ModelCatalogContext)
  if (!catalog) throw new Error("ModelCatalogProvider 未挂载")
  return catalog
}
