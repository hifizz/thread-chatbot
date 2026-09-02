function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== "object" || value === null) return value

  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)])
  )
}

/** Gate 1 会对此字符串做 SHA-256；这里先固定跨层一致的语义序列化。 */
export function canonicalCommandPayload(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

export function hasSameCommandSemantics(
  left: unknown,
  right: unknown
): boolean {
  return canonicalCommandPayload(left) === canonicalCommandPayload(right)
}
