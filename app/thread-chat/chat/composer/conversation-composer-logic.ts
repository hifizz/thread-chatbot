export function shouldSubmitComposerKey(input: {
  key: string
  shiftKey: boolean
  isComposing: boolean
  keyCode: number
}) {
  return (
    input.key === "Enter" &&
    !input.shiftKey &&
    !input.isComposing &&
    input.keyCode !== 229
  )
}

export function composerSubmission(
  value: string,
  busy: boolean
): string | null {
  if (busy) return null
  const text = value.trim()
  return text ? text : null
}

const COMPOSER_MAX_HEIGHT = {
  column: 120,
  canvas: 68,
} as const

export function composerMaxHeight(variant: keyof typeof COMPOSER_MAX_HEIGHT) {
  return COMPOSER_MAX_HEIGHT[variant]
}
