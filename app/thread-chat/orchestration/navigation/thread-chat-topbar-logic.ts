export type ColumnCountChoice = "auto" | 2 | 3 | 4

export function columnCountChoices(forceCols: number | null, autoLabel = "Auto") {
  return (["auto", 2, 3, 4] as const).map((value) => ({
    value,
    label: value === "auto" ? autoLabel : String(value),
    active: value === "auto" ? forceCols === null : forceCols === value,
  }))
}
