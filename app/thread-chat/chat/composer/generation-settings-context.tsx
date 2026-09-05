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
  DEFAULT_GENERATION_SETTINGS,
  type GenerationSettings,
} from "@/constants/generation-settings"

interface GenerationSettingsContextValue {
  settings: GenerationSettings
  setSettings: Dispatch<SetStateAction<GenerationSettings>>
}

const GenerationSettingsContext =
  createContext<GenerationSettingsContextValue | null>(null)

export function GenerationSettingsProvider({
  children,
}: {
  children: ReactNode
}) {
  const [settings, setSettings] = useState<GenerationSettings>(
    DEFAULT_GENERATION_SETTINGS
  )
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
