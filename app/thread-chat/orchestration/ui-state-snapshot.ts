import type { TreeUiState } from "../net/persist"

export function createTreeUiStateSnapshot(state: TreeUiState): TreeUiState {
  return {
    slots: state.slots,
    widths: state.widths,
    forceCols: state.forceCols,
    mode: state.mode,
    viewMode: state.viewMode,
  }
}
