/**
 * Canvas thread card 的渲染尺寸与 dagre 估高参数。
 *
 * `estimated*` 是布局使用的有意近似值；其余字段由 CanvasCard 发布为 CSS 变量，
 * 同时参与布局计算，避免 TS 与 CSS 各自维护一份事实。
 */
export const CANVAS_CARD_DIMENSIONS = {
  width: 280,
  paddingBlock: 11,
  paddingInline: 13,
  borderBlock: 1,
  borderInlineStart: 3,
  borderInlineEnd: 1,
  headerMinHeight: 20,
  headerMarginBottom: 6,
  bodyFontSize: 11.5,
  bodyLineHeight: 1.5,
  bodyMaxLines: 2,
  estimatedBodyLineHeight: 17.5,
  subtitleMarginBottom: 4,
  anchorPaddingBlock: 3,
  anchorMarginBottom: 6,
  summaryFontSize: 12,
  summaryLineHeight: 1.58,
  summaryMaxLines: 3,
  estimatedSummaryLineHeight: 19,
  summaryMarginBottom: 8,
  estimatedMetaHeight: 14,
} as const

export const CANVAS_CARD_INNER_WIDTH =
  CANVAS_CARD_DIMENSIONS.width -
  CANVAS_CARD_DIMENSIONS.paddingInline * 2 -
  CANVAS_CARD_DIMENSIONS.borderInlineStart -
  CANVAS_CARD_DIMENSIONS.borderInlineEnd

export const CANVAS_CARD_BASE_HEIGHT =
  CANVAS_CARD_DIMENSIONS.paddingBlock * 2 +
  CANVAS_CARD_DIMENSIONS.borderBlock * 2

export const CANVAS_CARD_ANCHOR_CHROME_HEIGHT =
  CANVAS_CARD_DIMENSIONS.anchorPaddingBlock * 2 +
  CANVAS_CARD_DIMENSIONS.anchorMarginBottom
