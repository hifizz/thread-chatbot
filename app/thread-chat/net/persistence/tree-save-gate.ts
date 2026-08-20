export interface TreeSaveGate {
  markPending(): void
  finishDebounce(): boolean
  takePendingFlush(): boolean
  setSuppressed(value: boolean): void
  isSuppressed(): boolean
}

export function createTreeSaveGate(): TreeSaveGate {
  let pending = false
  let suppressed = false

  return {
    markPending() {
      pending = true
    },
    finishDebounce() {
      pending = false
      return !suppressed
    },
    takePendingFlush() {
      if (!pending || suppressed) return false
      pending = false
      return true
    },
    setSuppressed(value) {
      suppressed = value
      if (value) pending = false
    },
    isSuppressed() {
      return suppressed
    },
  }
}
