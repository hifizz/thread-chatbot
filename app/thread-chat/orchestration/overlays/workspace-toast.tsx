"use client"

import { useCallback, useEffect, useState } from "react"
import {
  workspaceToastDuration,
  type WorkspaceToastState,
} from "./workspace-toast-logic"

export function useWorkspaceToast() {
  const [toast, setToast] = useState<WorkspaceToastState | null>(null)
  const showToast = useCallback((message: string, undo?: () => void) => {
    setToast({ message, undo })
  }, [])
  const dismissToast = useCallback(() => setToast(null), [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(
      () => setToast(null),
      workspaceToastDuration(toast)
    )
    return () => clearTimeout(timer)
  }, [toast])

  return { toast, showToast, dismissToast }
}

export function WorkspaceToast({
  toast,
  onDismiss,
}: {
  toast: WorkspaceToastState | null
  onDismiss(): void
}) {
  return (
    <div className={`toast ${toast ? "show" : ""}`}>
      <span>{toast?.message}</span>
      {toast?.undo && (
        <button
          className="undo"
          onClick={() => {
            toast.undo?.()
            onDismiss()
          }}
        >
          撤销
        </button>
      )}
    </div>
  )
}
