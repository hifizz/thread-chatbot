/** 根 Thread 的唯一领域判定；调用方不得各自重写 parentId 判断。 */
export function isRootThread(thread: { parentId: string | null }): boolean {
  return thread.parentId === null
}
