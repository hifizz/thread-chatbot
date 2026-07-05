"use client"

import { useEffect, useState } from "react"
import type { SkillMeta } from "./types"

/** 客户端拉取 /api/skills 的元数据列表（仅元数据，不含正文）。 */
export function useSkills() {
  const [skills, setSkills] = useState<SkillMeta[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/skills", { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : []))
      .then((data: SkillMeta[]) => setSkills(data))
      .catch(() => {})
      .finally(() => setIsLoading(false))
    return () => controller.abort()
  }, [])

  return { skills, isLoading }
}
