export interface WorkspaceToastState {
  message: string
  undo?: () => void
}

export function workspaceToastDuration(toast: WorkspaceToastState): number {
  return toast.undo ? 5200 : 2600
}
