/** 工作区抽屉的层级、尺寸与窄屏降级参数。 */
export const WORKSPACE_DRAWER = {
  baseZIndex: 65,
  zIndexStep: 2,
  projectWidth: 520,
  artifactDefaultWidth: 520,
  artifactMinWidth: 320,
  narrowBreakpoint: 960,
  artifactMaxViewportRatio: 2 / 3,
  artifactMaxPersistedWidth: 4096,
  narrowViewportRatio: 0.94,
  resizeKeyboardStep: 16,
  resizeKeyboardLargeStep: 48,
} as const

/** 抽屉关闭过渡时长，与壳层退场动画保持一致。 */
export const WORKSPACE_DRAWER_EXIT_MS = 340

/** 划选气泡需位于全部工作区抽屉之上。 */
export const WORKSPACE_SELECTION_Z_INDEX = 71
