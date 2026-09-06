"use client"
import { createContext, type ReactNode } from "react"

/** 分享页只提供阅读插槽，不创建 CanvasActions 写操作上下文。 */
export const CanvasReadOnlyContext = createContext<((threadId: string) => ReactNode) | null>(null)
