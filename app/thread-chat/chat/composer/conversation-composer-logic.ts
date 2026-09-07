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
