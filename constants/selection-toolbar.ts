/** 划选操作入口与浮层布局。 */
export const SELECTION_TOOLBAR_COPY = {
  label: "划选文本操作",
  continue: "在当前对话问",
  mobileContinue: "本对话继续",
  pendingQuestion: "请先完成或清空抽屉中的问题",
  continueLabel: "引用这段内容，在当前对话中继续提问",
  branch: "此处提问",
  branchLabel: "围绕这段内容，单独展开提问",
} as const
export const SELECTION_TOOLBAR_WIDTH = 220
/** 手机原生选区手柄连续变化，停止后再显示操作入口。 */
export const MOBILE_SELECTION_SETTLE_MS = 180
export const SELECTION_TOOLBAR_SELECTOR = ".selection-toolbar"
export const SELECTION_SURFACE_SELECTOR = ".sel-bubble, .selection-toolbar, [data-selection-drawer]"
