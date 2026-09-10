/** 图表默认优先可读；只有用户主动适应画布才允许缩到 70% 以下。 */
export const MERMAID_CANVAS = {
  autoMinScale: 0.7,
  minScale: 0.1,
  maxScale: 4,
  zoomStep: 1.25,
  padding: 16,
  minHeight: 120,
  maxHeight: 560,
  viewportHeightRatio: 0.65,
  keyboardPan: 48,
} as const
