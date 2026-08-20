/** Base UI Dialog 关闭事件里，本项目实际依赖的最小能力。 */
interface DialogCloseDetails {
  reason: string
  cancel(): void
  allowPropagation(): void
}

/**
 * Esc 的权威在工作区壳层 keydown 逐层关闭链：取消 Dialog 内建关闭并放行冒泡。
 * 点外等其他原因则直接通知壳层关闭当前面板。
 */
export function dialogCloseToShell(onClose: () => void) {
  return (open: boolean, details: DialogCloseDetails) => {
    if (open) return
    if (details.reason === "escape-key") {
      details.cancel()
      details.allowPropagation()
      return
    }
    onClose()
  }
}
