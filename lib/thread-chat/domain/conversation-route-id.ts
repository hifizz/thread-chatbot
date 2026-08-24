const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

/** 公开 /thread-chat/{conversationId} 当前只接受 UUID 形状的稳定 ID。 */
export function isValidConversationRouteId(id: string): boolean {
  return UUID_RE.test(id)
}
