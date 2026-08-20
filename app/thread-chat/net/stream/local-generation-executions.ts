/** 本页正在消费的 generation 流注册表：按 thread 互斥，并提供 generation 只读查询。 */
export function createLocalGenerationExecutions() {
  const byThread = new Map<
    string,
    { generationId: string; controller: AbortController }
  >()
  const activeGenerationIds = new Set<string>()

  function begin(threadId: string, generationId: string) {
    const controller = new AbortController()
    const previous = byThread.get(threadId)
    if (previous) activeGenerationIds.delete(previous.generationId)
    byThread.set(threadId, { generationId, controller })
    activeGenerationIds.add(generationId)
    return {
      controller,
      isOwner: () => byThread.get(threadId)?.controller === controller,
    }
  }

  function clearIfOwner(threadId: string, controller: AbortController): void {
    const current = byThread.get(threadId)
    if (current?.controller === controller) {
      byThread.delete(threadId)
      activeGenerationIds.delete(current.generationId)
    }
  }

  function detach(threadId: string): void {
    byThread.get(threadId)?.controller.abort()
  }

  return {
    begin,
    clearIfOwner,
    detach,
    hasThread: (threadId: string) => byThread.has(threadId),
    isGenerationActive: (generationId: string) =>
      activeGenerationIds.has(generationId),
    detachAll: () =>
      byThread.forEach((execution) => execution.controller.abort()),
  }
}
