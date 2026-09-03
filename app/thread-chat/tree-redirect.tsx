"use client"
/**
 * 裸路径 /thread-chat 的入口跳板：客户端 effect 里读 localStorage 的「最近一棵」
 * treeId（无则生成新 UUID），router.replace 到 /thread-chat/{treeId}。
 * replace 不留历史——回退键不会弹回跳板页。localStorage 只在 effect 里碰（避免
 * SSR/hydration 问题），跳转前渲染 .tc 风格的一行轻量占位。
 */

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useProjectListStore } from "./core/project-list-store"

export function TreeRedirect() {
  const router = useRouter()
  const refreshProjects = useProjectListStore((state) => state.refresh)
  useEffect(() => {
    let cancelled = false
    void refreshProjects()
      .then((projects) => {
        if (!cancelled)
          router.replace(
            `/thread-chat/${projects[0]?.id ?? crypto.randomUUID()}`
          )
      })
      .catch(() => {
        if (!cancelled) router.replace(`/thread-chat/${crypto.randomUUID()}`)
      })
    return () => {
      cancelled = true
    }
  }, [refreshProjects, router])
  return (
    <div className="tc">
      <div className="boot-loading">正在打开对话…</div>
    </div>
  )
}
