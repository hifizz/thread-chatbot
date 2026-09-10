"use client"

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import {
  type GenerationSettings,
} from "@/constants/generation-settings"

interface GenerationSettingsContextValue {
  settings: GenerationSettings | undefined
  setSettings: Dispatch<SetStateAction<GenerationSettings | undefined>>
}

const GenerationSettingsContext =
  createContext<GenerationSettingsContextValue | null>(null)

export function GenerationSettingsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [settings, setSettings] = useState<GenerationSettings | undefined>(undefined)
  const value = useMemo(() => ({ settings, setSettings }), [settings])

  return (
    <GenerationSettingsContext.Provider value={value}>
      {children}
    </GenerationSettingsContext.Provider>
  )
}

export function useGenerationSettings(): GenerationSettingsContextValue {
  const value = useContext(GenerationSettingsContext)
  if (!value) throw new Error("GenerationSettingsProvider 未挂载")
  return value
}
