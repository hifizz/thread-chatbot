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
